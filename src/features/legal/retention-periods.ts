/**
 * The day counts the purge tasks enforce (spec 0015, AC-8). They live here rather than in the
 * task files so the privacy page can read them without pulling the Trigger.dev SDK, the service
 * client and `@/lib/env` into a static page's module graph: every other app to task import in
 * this repo is an `import type`, erased at compile time, and a value import would not be.
 *
 * The tasks import these constants, so there is still one source: changing a period here changes
 * both what runs and what the page says. Pure data.
 */

/** The enquiry address hash is a flood guard only; after this many days it is nulled (spec 0009, AC-13). */
export const IP_HASH_RETENTION_DAYS = 30;

/** Closed enquiries are deleted this many days after they were handled (spec 0009, AC-13). */
export const CLOSED_RETENTION_DAYS = 365;

/** Email delivery rows are deleted this many days after they were created (spec 0006). */
export const EMAIL_DELIVERY_RETENTION_DAYS = 90;
