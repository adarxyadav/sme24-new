import { SearchXIcon, UnlockIcon, UsersIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DIRECTORY_MAX_PAGE } from "@/features/directory/catalogue";
import {
  getCreditBalance,
  listDirectoryCountries,
  searchDirectory,
} from "@/features/directory/queries";
import {
  type DirectorySearch,
  decodeSearchCursor,
  directorySearchSchema,
  searchQuery,
} from "@/features/directory/schema";
import { BalanceBadge } from "@/features/directory/ui/balance-badge";
import { DirectoryProvider } from "@/features/directory/ui/directory-context";
import { DirectoryResultsTable } from "@/features/directory/ui/results-table";
import { DirectorySearchForm, type SearchFormErrors } from "@/features/directory/ui/search-form";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("directory");
  return { title: t("title") };
}

/** The first value of a query parameter that a browser may repeat. */
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The field errors of a refused search, keyed the way the form renders them. */
function fieldErrors(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  const errors: { q?: SearchFormErrors["q"]; title?: SearchFormErrors["title"] } = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    const message = issue.message === "tooLong" ? "tooLong" : "tooShort";
    if (field === "q" && !errors.q) errors.q = message;
    if (field === "title" && !errors.title) errors.title = message;
  }
  return errors;
}

/**
 * The contact directory (spec 0018, AC-5): search by company, title and country, masked results
 * in pages of 25 on a keyset cursor, the caller's credit balance and the way to buy more. The
 * search lives in the URL, so a reload or a shared link shows the same page; a malformed cursor
 * is a 404, and a cursor past the depth cap renders a message rather than walking on. Server
 * component, expert only through the shell gate and the definer functions' own role check.
 */
export default async function ExpertDirectoryPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = {
    q: single(params.q),
    title: single(params.title),
    country: single(params.country),
    after: single(params.after),
  };
  const parsed = directorySearchSchema.safeParse(raw);
  const search: DirectorySearch = parsed.success
    ? parsed.data
    : { q: undefined, title: undefined, country: undefined, after: undefined };
  const errors: SearchFormErrors = parsed.success ? {} : fieldErrors(parsed.error);
  const cursor = decodeSearchCursor(search.after);
  if (search.after && !cursor) notFound();
  const pastDepth = cursor !== null && cursor.page > DIRECTORY_MAX_PAGE;

  const [t, locale, supabase, messages] = await Promise.all([
    getTranslations("directory"),
    getLocale(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const [balance, countries, page] = await Promise.all([
    getCreditBalance(supabase),
    listDirectoryCountries(supabase),
    parsed.success && !pastDepth ? searchDirectory(supabase, search, cursor) : null,
  ]);

  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  const countryLabel = (code: string | null) => {
    if (!code) return null;
    try {
      return regionNames.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const countryOptions = countries.map((country) => ({
    code: country.code,
    label: countryLabel(country.code) ?? country.code,
    contacts: country.contacts,
  }));
  const hasFilters = Boolean(search.q || search.title || search.country);
  const directoryEmpty = countries.length === 0;

  // The provider and its client children read the `directory` namespace, so the whole page sits
  // inside one client provider; the server components between them are unaffected.
  return (
    <NextIntlClientProvider messages={clientMessages(messages, ["directory"])}>
      <DirectoryProvider balance={balance}>
        <PageStack>
          <PageHeader
            title={t("title")}
            description={t("lead")}
            actions={
              <>
                <BalanceBadge />
                <Button asChild variant="outline">
                  <Link href="/expert/directory/unlocks">
                    <UnlockIcon aria-hidden="true" data-icon="inline-start" />
                    {t("header.unlocks")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/expert/directory/credits">{t("header.buy")}</Link>
                </Button>
              </>
            }
          />

          <DirectorySearchForm
            values={{ q: raw.q ?? "", title: raw.title ?? "", country: search.country ?? "" }}
            errors={errors}
            countries={countryOptions}
          />

          {pastDepth ? (
            <Alert variant="info">
              <AlertTitle>{t("results.pageDepth.title")}</AlertTitle>
              <AlertDescription>
                <p>{t("results.pageDepth.description", { pages: DIRECTORY_MAX_PAGE })}</p>
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link href={{ pathname: "/expert/directory", query: searchQuery(search) }}>
                    {t("results.pageDepth.reset")}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : page === null ? null : page.rows.length === 0 && directoryEmpty ? (
            <EmptyState
              icon={UsersIcon}
              title={t("empty.noRows.title")}
              description={t("empty.noRows.description")}
            />
          ) : page.rows.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title={t("empty.noMatch.title")}
              description={t("empty.noMatch.description")}
              action={
                hasFilters || page.page > 1 ? (
                  <Button asChild variant="outline">
                    <Link href="/expert/directory">{t("empty.noMatch.reset")}</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <section className="flex flex-col gap-4" aria-labelledby="directory-results-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="directory-results-heading" className="font-semibold text-lg">
                  {t("results.heading")}
                </h2>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {t("results.caption", { page: page.page, count: page.rows.length })}
                </p>
              </div>
              <DirectoryResultsTable rows={page.rows} countryLabel={countryLabel} />
              {page.nextCursor ? (
                <div>
                  <Button asChild variant="outline">
                    <Link
                      href={{
                        pathname: "/expert/directory",
                        // The search travels with the cursor: a keyset taken under one search means
                        // nothing under another.
                        query: searchQuery(search, page.nextCursor),
                      }}
                    >
                      {t("results.more")}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </section>
          )}
        </PageStack>
      </DirectoryProvider>
    </NextIntlClientProvider>
  );
}
