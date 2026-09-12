import { createFormatter, createTranslator } from "next-intl";
import type { ContentGroup, ContentSection } from "@/features/assessments/content-schema";
import type { AssessmentAnswer, AssessmentItem } from "@/features/assessments/model";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { de, en, type TestLocale } from "../../emails/ui/helpers";

export { de, en, renderWithIntl, type TestLocale } from "../../emails/ui/helpers";

const MESSAGES = { "de-CH": de, "en-CH": en } as const;

/**
 * The server side next-intl boundary for an async server component under test: a translator over
 * the real catalog and a formatter in the Swiss time zone, both following `env.locale` so one
 * file can render both languages. Hand it to `vi.mock("next-intl/server", ...)` from a hoisted
 * `env` object.
 */
export function serverIntlMock(env: { locale: TestLocale }) {
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({
        locale: env.locale,
        messages: MESSAGES[env.locale],
        namespace: namespace as never,
        formats,
      }),
    getFormatter: async () => createFormatter({ locale: env.locale, formats, timeZone: TIME_ZONE }),
    getLocale: async () => env.locale,
  };
}

/**
 * The App Router hooks `@/i18n/navigation` wraps. next-intl's `createNavigation` reads `redirect`
 * and `permanentRedirect` at import time, so a partial mock without them fails the whole file.
 */
export function navigationMock(
  overrides: { refresh?: () => void; push?: (href: unknown) => void } = {},
) {
  const noop = () => {};
  return {
    usePathname: () => "/en",
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({
      push: overrides.push ?? noop,
      replace: noop,
      refresh: overrides.refresh ?? noop,
      prefetch: noop,
      back: noop,
    }),
    useParams: () => ({ locale: "en-CH" }),
    redirect: noop,
    permanentRedirect: noop,
    notFound: noop,
  };
}

/** The formatter the components print dates and percentages with, so a test never hard codes a zone offset. */
export const formatEn = createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE });
export const formatDe = createFormatter({ locale: "de-CH", formats, timeZone: TIME_ZONE });

export const ORG_ID = "0e000000-0000-4000-8000-000000000002";
export const COMPANY_ID = "0e000000-0000-4000-8000-000000000003";
export const ORDER_ID = "0e000000-0000-4000-8000-000000000004";
export const ASSESSMENT_ID = "0e000000-0000-4000-8000-000000000005";
export const EXPERT_ID = "0e000000-0000-4000-8000-000000000001";
export const VERSION_KEY = "iso45001@1";

/** A `{de, en}` pair whose German is recognisable, so a test can tell which language rendered. */
export const text = (en: string) => ({ de: `${en} (de)`, en });

export const itemId = (position: number, versionKey = VERSION_KEY) => `${versionKey}/${position}`;

/** One `questionnaire_items` row in the model's shape; a clause by default, a sub item with `parentId`. */
export function item(
  position: number,
  label: string,
  sectionKey: string,
  overrides: Partial<AssessmentItem> = {},
): AssessmentItem {
  return {
    id: itemId(position),
    position,
    parentId: null,
    sectionKey,
    groupKey: null,
    label,
    rateable: true,
    title: text(`Item ${label}`),
    requirement: null,
    question: text(`Question ${label}`),
    deReviewed: true,
    ...overrides,
  };
}

/** Two ISO like sections: two clauses in c4, one clause in c7 with two rateable annex checks and one context line. */
export const SECTIONS: readonly ContentSection[] = [
  { key: "c4", label: "4", title: text("Context of the organization"), groups: [] },
  { key: "c7", label: "7", title: text("Support"), groups: [] },
];

export const ITEMS: readonly AssessmentItem[] = [
  item(1, "4.1", "c4", { requirement: text("- Records kept\n- Training planned") }),
  item(2, "4.2", "c4", { deReviewed: false }),
  item(3, "7.2", "c7"),
  item(4, "A.1", "c7", { parentId: itemId(3) }),
  item(5, "A.2", "c7", { parentId: itemId(3) }),
  item(6, "A.3", "c7", { parentId: itemId(3), rateable: false }),
];

/** The technical standards shape: one standard with three groups, the third one empty. */
export const GROUPS: readonly ContentGroup[] = [
  { key: "hot_work.1", label: "1", title: text("Fire watch") },
  { key: "hot_work.2", label: "2", title: text("Permits") },
  { key: "hot_work.3", label: "3", title: text("Equipment") },
];

export const GROUPED_ITEMS: readonly AssessmentItem[] = [
  item(1, "1.1", "hot_work", { id: "compliance@1/1", groupKey: "hot_work.1" }),
  item(2, "1.2", "hot_work", { id: "compliance@1/2", groupKey: "hot_work.1" }),
  item(3, "2.1", "hot_work", { id: "compliance@1/3", groupKey: "hot_work.2" }),
];

export function answer(
  itemId: string,
  rating: AssessmentAnswer["rating"],
  note: string | null = null,
): AssessmentAnswer {
  return { itemId, sectionKey: null, rating, note };
}

export function exclusion(sectionKey: string, note: string | null = null): AssessmentAnswer {
  return { itemId: null, sectionKey, rating: null, note };
}
