/**
 * The expert catalogue (spec 0013, AC-1): every coded list an expert profile holds, in the order
 * the forms render them. The codes are the contract between three places: this file, the `<@`
 * check constraints in `supabase/schemas/13_expert_profiles.sql`, and the
 * `experts.catalogue.<list>.<code>` label keys in both message catalogs. Two Vitest tests keep the
 * three equal, so adding a code is a catalogue entry, a migration and two label keys.
 *
 * Labels live in the catalogs rather than here because they differ by reader language; this file
 * holds only what the code needs. Pure data, runs anywhere.
 */

/** The three assessment types of feature 17, keyed like `packages` so matching can join on them. */
export const COMPETENCY_CODES = ["compliance", "management_system", "safety_culture"] as const;
export type CompetencyCode = (typeof COMPETENCY_CODES)[number];

/**
 * The NOGA section letters. `companies.industry_code` is a full NOGA code, so feature 19 matches
 * on its first letter; the label of each section is a `experts.catalogue.industries.<code>` key.
 */
export const INDUSTRY_CODES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
] as const;
export type IndustryCode = (typeof INDUSTRY_CODES)[number];

/**
 * The standards and Swiss regulations an expert can cover. Curated rather than open text so
 * matching can rank on them; no retired standard (OHSAS 18001 is gone), and ops extend the list
 * in code plus a migration.
 */
export const STANDARD_CODES = [
  "iso_45001",
  "iso_14001",
  "iso_9001",
  "iso_50001",
  "ekas_6508",
  "suva_asa",
  "arg_argv",
  "vuv",
  "stfv",
  "scc",
  "iso_31000",
  "esti",
  "bauav",
  "psa",
] as const;
export type StandardCode = (typeof STANDARD_CODES)[number];

/** The languages an expert works in. Wider than the app's own `de` and `en`: a site visit happens in the local language. */
export const LANGUAGE_CODES = ["de", "fr", "it", "en"] as const;
export type ExpertLanguageCode = (typeof LANGUAGE_CODES)[number];

/** The 26 cantons, matching `companies.canton`. Alphabetical, which is how the form renders them. */
export const REGION_CODES = [
  "AG",
  "AI",
  "AR",
  "BE",
  "BL",
  "BS",
  "FR",
  "GE",
  "GL",
  "GR",
  "JU",
  "LU",
  "NE",
  "NW",
  "OW",
  "SG",
  "SH",
  "SO",
  "SZ",
  "TG",
  "TI",
  "UR",
  "VD",
  "VS",
  "ZG",
  "ZH",
] as const;
export type RegionCode = (typeof REGION_CODES)[number];

/** Whether the expert is taking work. Expert and ops only: a client never sees this. */
export const AVAILABILITY_CODES = ["available", "limited", "unavailable"] as const;
export type AvailabilityCode = (typeof AVAILABILITY_CODES)[number];

/** The account lifecycle, mirroring `expert_profiles.status`. */
export const EXPERT_STATUSES = ["invited", "active", "inactive"] as const;
export type ExpertStatus = (typeof EXPERT_STATUSES)[number];

/**
 * The five list columns by the name they carry in the database, which is the key the equality test
 * and the profile form both iterate. `availability` is a single value, not a list, so it is not here.
 */
export const EXPERT_CATALOGUE = {
  competencies: COMPETENCY_CODES,
  industries: INDUSTRY_CODES,
  standards: STANDARD_CODES,
  languages: LANGUAGE_CODES,
  regions: REGION_CODES,
} as const;

export type ExpertListName = keyof typeof EXPERT_CATALOGUE;

/** The list columns in the order the profile form renders them. */
export const EXPERT_LIST_NAMES = [
  "competencies",
  "industries",
  "standards",
  "languages",
  "regions",
] as const satisfies readonly ExpertListName[];

/** How many rows the ops expert list returns per page (AC-7). */
export const EXPERTS_PAGE_SIZE = 50;

/** How long a signed photo URL stays valid, in seconds (AC-6): long enough to render, short enough not to be a link worth passing on. */
export const PHOTO_URL_TTL_SECONDS = 600;

/** The private bucket every expert photo lives in (AC-6). */
export const PHOTO_BUCKET = "expert-photos";

/** The largest photo the upload action accepts, in bytes (AC-6). Mirrors the bucket's own limit. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** The image types the upload action accepts, mapped to the extension the object path uses (AC-6). */
export const PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type PhotoMimeType = keyof typeof PHOTO_TYPES;

/** True when the browser reported a type the bucket accepts. Pure, runs anywhere. */
export function isPhotoMimeType(value: string): value is PhotoMimeType {
  return value in PHOTO_TYPES;
}
