-- Spec 0022, AC-1 and AC-3: the company's currency follows its country, and the register
-- identifier is no longer forced into the Swiss CHE shape.
--
-- The generated diff also re-emitted a REVOKE ALL plus a full DML GRANT on the
-- `assigned_expert_summaries` and `expert_bookings` views, one of the four things `pnpm db:diff`
-- gets wrong (AGENTS.md). Both views grant SELECT only to `authenticated`; the widening is
-- dropped here by hand rather than committed.

ALTER TABLE "public"."companies"
  DROP CONSTRAINT "companies_uid_check";

ALTER TABLE "public"."companies"
  ADD COLUMN "currency" text NOT NULL DEFAULT 'CHF'::text;

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

COMMENT ON COLUMN "public"."companies"."currency" IS 'ISO 4217, set from the country by the catalogue in src/lib/countries.ts; money on the snapshot is in it.';

COMMENT ON COLUMN "public"."companies"."uid" IS 'The national commercial register identifier as printed in the company''s country.';
