import { z } from "zod";

/**
 * The research feature's boundary schemas (spec 0007, AC-3, AC-8): the lookup form, the rerun
 * form and the website rule. The same schemas type the forms. Pure, runs anywhere.
 */

/**
 * Normalises a typed website to an origin (AC-3): lowercase host, path, query and fragment
 * dropped, `https` forced, a typed `www.` kept. `example.ch` becomes `https://example.ch`,
 * `https://Example.ch/reports?x=1` becomes `https://example.ch`. Null when nothing usable was
 * typed. Pure.
 */
export function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
  return `https://${host}`;
}

const nameField = z.string().trim().min(2, "nameShort").max(200, "nameLong");

// The browser resolver already transforms the values before the server action parses them again
// (AC-3), so both fields accept their own output: null for an empty website or legal name.
const websiteField = z
  .string()
  .trim()
  .max(500, "websiteInvalid")
  .nullish()
  .transform((value, context) => {
    if (!value) return null;
    const normalised = normalizeWebsite(value);
    if (normalised === null) {
      context.addIssue({ code: "custom", message: "websiteInvalid" });
      return z.NEVER;
    }
    return normalised;
  });

/** The lookup form on `/app`: the company name (prefilled from the organization) and an optional website. */
export const lookupSchema = z.object({
  name: nameField,
  website: websiteField,
  locale: z.string().optional(),
});
export type LookupInput = z.input<typeof lookupSchema>;
export type LookupValues = z.output<typeof lookupSchema>;

/** The rerun form (AC-8): the editable company details plus the company id. */
export const rerunSchema = z.object({
  companyId: z.uuid(),
  name: nameField,
  legalName: z
    .string()
    .trim()
    .max(200, "legalNameLong")
    .nullish()
    .transform((value) => (value ? value : null)),
  website: websiteField,
  locale: z.string().optional(),
});
export type RerunInput = z.input<typeof rerunSchema>;
export type RerunValues = z.output<typeof rerunSchema>;

/** The host of a stored website (`https://www.example.ch` gives `www.example.ch`), or null. Pure. */
export function websiteHost(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.toLowerCase();
  } catch {
    return null;
  }
}
