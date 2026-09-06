import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { MARK_PATH, MARK_VIEWBOX } from "@/components/brand/brand-mark";
import { splitSentences } from "@/components/brand/statement";
import type { MarketingPage } from "@/features/marketing/metadata";
import { resolveLocale } from "@/i18n/routing";

/**
 * The social card of every marketing page (spec 0009, AC-2): the page's statement in Geist Bold
 * on the jet black ground with the brand mark, 1200 by 630, no photography. One
 * `opengraph-image.tsx` per page re-exports these; the font file is vendored under
 * `src/assets/fonts/` (OFL) and read once at module scope. Runs at build time (both locales come
 * from the locale layout's `generateStaticParams`).
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const FONT_FILE = join(process.cwd(), "src", "assets", "fonts", "Geist-Bold.ttf");
const fontBytes = readFileSync(FONT_FILE);
const GEIST_BOLD: ArrayBuffer = fontBytes.buffer.slice(
  fontBytes.byteOffset,
  fontBytes.byteOffset + fontBytes.byteLength,
) as ArrayBuffer;

// Brand constants of `globals.css` as sRGB, because satori reads CSS values, not tokens.
const JET = "#000000";
const PURE_WHITE = "#ffffff";
const MUTED = "#a3a3a3";

type Params = { readonly locale: string };

/** The localized statement of one page, the site name when the key is missing. Server. */
async function statementOf(page: MarketingPage, locale: string): Promise<string> {
  const resolved = resolveLocale(locale);
  const [t, common] = await Promise.all([
    getTranslations({ locale: resolved, namespace: `marketing.${page}.og` }),
    getTranslations({ locale: resolved, namespace: "common" }),
  ]);
  return t.has("statement") ? t("statement") : common("appName");
}

/**
 * `generateImageMetadata` of a page's image route: one image per locale with the statement as
 * its localized `alt`. Server, build time.
 */
export async function ogImageMetadata(page: MarketingPage, { params }: { params: Params }) {
  return [
    {
      id: "card",
      alt: await statementOf(page, params.locale),
      size: OG_SIZE,
      contentType: OG_CONTENT_TYPE,
    },
  ];
}

/** The image route's default export: renders the statement card for the page in the locale. Server, build time. */
export async function renderOgImage(
  page: MarketingPage,
  { params }: { params: Promise<Params> },
): Promise<ImageResponse> {
  const { locale } = await params;
  const [statement, common, brand] = await Promise.all([
    statementOf(page, locale),
    getTranslations({ locale: resolveLocale(locale), namespace: "common" }),
    getTranslations({ locale: resolveLocale(locale), namespace: "brand" }),
  ]);
  const lines = splitSentences(statement);
  const longest = Math.max(...lines.map((line) => line.text.length));
  const fontSize = longest > 26 ? 64 : longest > 18 || lines.length > 2 ? 76 : 88;
  // The square stop hugs the last word and sits on the baseline (the descender is about a fifth
  // of the size), so a wrapped sentence keeps its stop next to the text.
  const square = {
    display: "flex",
    width: fontSize * 0.2,
    height: fontSize * 0.2,
    marginLeft: fontSize * 0.1,
    marginBottom: fontSize * 0.22,
    background: PURE_WHITE,
  } as const;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: JET,
        color: PURE_WHITE,
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg
          width={48}
          height={64}
          viewBox={MARK_VIEWBOX}
          role="img"
          aria-label={common("appName")}
        >
          <path d={MARK_PATH} fill={PURE_WHITE} />
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 36, letterSpacing: -1 }}>{common("appName")}</span>
          <span style={{ fontSize: 16, letterSpacing: 5, color: MUTED }}>
            {brand("descriptor").toUpperCase()}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {lines.map((line) => {
          const words = line.text.split(" ");
          const last = words.length - 1;
          return (
            <div
              key={line.text}
              style={{
                display: "flex",
                flexWrap: "wrap",
                columnGap: fontSize * 0.26,
                fontSize,
                lineHeight: 1.1,
                letterSpacing: -3,
              }}
            >
              {words.map((word, index) =>
                index === last && line.stop ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a static word list rendered once into a PNG, never reordered
                  <span key={`${index}`} style={{ display: "flex", alignItems: "flex-end" }}>
                    <span>{word}</span>
                    <span style={square} />
                  </span>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a static word list rendered once into a PNG, never reordered
                  <span key={`${index}`}>{word}</span>
                ),
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: MUTED }}>
        {brand("domain").toUpperCase()}
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [{ name: "Geist", data: GEIST_BOLD, style: "normal", weight: 700 }],
    },
  );
}
