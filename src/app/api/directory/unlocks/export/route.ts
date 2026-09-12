import { NextResponse } from "next/server";
import { DIRECTORY_EXPORT_PAGE_SIZE } from "@/features/directory/catalogue";
import {
  csvLine,
  EXPORT_COLUMNS,
  type ExportColumn,
  exportFileName,
} from "@/features/directory/export";
import { unlockedContactsPage } from "@/features/directory/queries";
import { localeFromCode } from "@/i18n/routing";
import { createTranslatorFor } from "@/i18n/standalone";
import { roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The CSV export of the caller's unlocks (spec 0018, AC-13). Sits outside `[locale]` like every
 * route handler, where neither the proxy's matcher nor the expert shell layout runs, so it checks
 * the claims itself on the user client and answers 404 for anyone but an active expert (the
 * definer function refuses the rest with SM403, which lands as the same 404). The header row is
 * in the caller's stored language (`profiles.locale`, the column every product email reads),
 * because there is no locale segment to read here.
 *
 * Streams one page of 500 at a time until a short page, with no row cap: the function's time
 * budget is the only bound. A cell that starts with `=`, `+`, `-` or `@` is prefixed with a
 * single quote so a spreadsheet never executes it.
 */
export async function GET(): Promise<Response> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "expert" || typeof claims?.sub !== "string") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", claims.sub)
    .maybeSingle();
  const locale = localeFromCode(profile?.locale ?? "en");

  // The first page proves the caller may read at all before any header is sent: a refused
  // function answers 404 here rather than a broken file.
  let first: Awaited<ReturnType<typeof unlockedContactsPage>>;
  try {
    first = await unlockedContactsPage(supabase, null, DIRECTORY_EXPORT_PAGE_SIZE);
  } catch (error) {
    log.warn("directory export refused", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const t = await createTranslatorFor(locale);
  const header = csvLine(
    EXPORT_COLUMNS.map((column: ExportColumn) => t(`directory.export.columns.${column}`)),
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // The byte order mark, so a spreadsheet opens the file as UTF-8.
        controller.enqueue(encoder.encode(`\uFEFF${header}`));
        let page = first;
        for (;;) {
          for (const row of page.rows) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.companyName,
                  row.country ?? row.companyCountry ?? "",
                  row.city ?? row.companyCity ?? "",
                  row.firstName ?? "",
                  row.lastName ?? "",
                  row.title ?? "",
                  row.email,
                  row.phone ?? "",
                  row.mobile ?? "",
                  // ISO 8601 in UTC, which a spreadsheet parses; the page shows Zurich time.
                  new Date(row.unlockedAt).toISOString(),
                ]),
              ),
            );
          }
          const last = page.rows.at(-1);
          if (page.rows.length < DIRECTORY_EXPORT_PAGE_SIZE || !last) break;
          page = await unlockedContactsPage(
            supabase,
            { createdAt: last.unlockedAt, id: last.unlockId },
            DIRECTORY_EXPORT_PAGE_SIZE,
          );
        }
        controller.close();
      } catch (error) {
        log.error("directory export failed mid stream", {
          reason: error instanceof Error ? error.message : String(error),
        });
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
