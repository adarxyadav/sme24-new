# Verify: contact directory · spec 0018 · updated 2026-09-12
_Steps derived from spec 0018 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones. Every row and address below is invented; nothing from the purchased list appears in a test, a fixture or a screenshot (invariant 11)._

## UI / manual
- [ ] Sign in as `expert@example.com`, open `/de/expert/kontakte` → the sidebar shows "Kontakte" after "Profil", the header shows the balance and the "Credits kaufen" and "Ihre Freischaltungen" buttons, the search form and the results → AC-5
- [ ] Search a company name present in the local import → every row shows `x••••@domain`, the phone as `+41 •• ••• •• 67`, the name and title in clear, and "Freischalten · 1 Credit, CHF 1.99" → AC-4, AC-5
- [ ] Enter one character in "Firma" and submit → the inline error under the field, no results, no request to the function → AC-4
- [ ] Open `/de/expert/kontakte?after=not-a-cursor` → the not found page → AC-5
- [ ] Set the country select to a code and a title, submit → only rows of that country whose title contains the text; the "Mehr laden" link carries the same filters plus the cursor → AC-4, AC-5
- [ ] Follow "Mehr laden" 40 times (or craft a cursor with `p: 41`) → the page depth message with a link back to page 1, no 500 → AC-4
- [ ] With a balance of 1 (a `directory_credit_entries` row `grant +1` inserted by hand), click "Freischalten" on one row → the email and phones swap to the raw values in that row, the header balance drops to 0 without a reload, `directory.unlocked` is captured with ids only → AC-11, AC-12, AC-14
- [ ] Reload → the row still shows the raw values and the "Freigeschaltet" badge → AC-11
- [ ] Click "Freischalten" on a second row at balance 0 → the inline "Keine Credits mehr." with the "Credits kaufen" link, nothing debited → AC-11, AC-12
- [ ] Sign in as `client@example.com`, open `/de/expert/kontakte` → redirected away; `GET /api/directory/unlocks/export` → 404 → AC-1, AC-13
- [ ] Set the seeded expert's `expert_profiles.status` to `invited`, call `revealContact` (or open the directory) → "Ihr Expertenkonto ist nicht aktiv." / the onboarding redirect; restore `active` → AC-12
- [ ] Open `/de/expert/kontakte/freigeschaltet` → the unlocked contacts newest first with raw values and Zurich times; "CSV herunterladen" downloads `sme24-directory-unlocks-<yyyy-mm-dd>.csv` with a BOM, a German header row (the expert's stored language), CRLF lines, a quoted cell where a value holds a comma, and `'+41 …` on a phone → AC-13
- [ ] Set the expert's `profiles.locale` to `en`, download again → the header row is English → AC-13 (stored language, not the URL)
- [ ] Open `/de/expert/kontakte/guthaben` → the pack card reads 50 credits, CHF 1.99 per credit, CHF 99.50 net, MWST 8.1% CHF 8.06, total CHF 107.56; the country field is fixed to Schweiz → AC-6, AC-9
- [ ] Buy by invoice → returned to the credits page with "Rechnung angefordert" and the due date; the order row has `buyer_expert_id`, `credits 50`, `organization_id null`, `company_id null`, `billing_country 'CH'`, no ledger row yet → AC-7, AC-9
- [ ] Mark that order paid from `/admin/orders` → one `purchase` ledger row of 50, the balance reads 50, the confirmation email carries "Ihre 50 Credits sind auf Ihrem Konto …", the Slack alert names `Expert: <name>`; mark paid again → still one ledger row → AC-8, AC-10
- [ ] With Stripe test keys, buy by card → Stripe's page opens in German for a `de` order, the return lands on `…/kontakte/guthaben?order=<id>` with the "Ihre Zahlung wird bestätigt" state until the webhook lands, then "Ihre Credits sind auf Ihrem Konto"; `directory.credits_purchased` is captured once, deduped on the order → AC-9, AC-10, AC-14
- [ ] `/admin/orders` → the credit order shows the expert's name with the "Credits" badge and no schedule action; a schedule attempt through the action answers `not_deliverable` → AC-10
- [ ] The invoice PDF of a credit order lives at `experts/<buyer_expert_id>/<invoice id>.pdf` and downloads through `/api/orders/<id>/invoice` as the expert; a client gets 404 → AC-9
- [ ] Sign in as `ops@example.com`, open `/de/admin/directory` → the latest import card (or "no import yet"), the three totals, the experts table with balance, credits bought (grants excluded), unlocks and last unlock; the sidebar shows "Kontaktverzeichnis" before "Design Galerie" → AC-15
- [ ] Remove the revealed contact by email with reason "The person asked to be removed" → "Entfernt. Eine Freischaltung wurde mit entfernt."; the row is gone from the search, the unlocks page and the next CSV; the buyer's balance is unchanged; `directory_suppressions` holds the hash; removing the same address again → "Kein Kontakt mit dieser Adresse …" → AC-15
- [ ] Open `/de/datenschutz` → the "Kontaktverzeichnis" block names the batch `20260902 Global Account Lists`, CHF 1.99, 30 days and the objection address; the retention table lists the six directory tables; `/de/agb` shows "Gekaufte Kontakte" and "Version 2" → AC-16
- [ ] Set a signed in user's `profiles.terms_version` to `1` → the re consent dialog appears once with the version 2 changelog; accepting writes `terms_version '2'` and clears it → AC-16
- [ ] A fresh sign up and a provider sign up land at `terms_version '2'` (column default, trigger fallback, `accept_terms()` default) → AC-16

## Commands
- [ ] `pnpm directory:import docs/raw/<file>.xlsx --dry-run` (local keys) → counts per outcome and per country, the unmapped spellings by name, digits redacted, no address, no name, no company name; nothing written to companies or contacts, one `directory_imports` row with `dry_run true` → AC-2
- [ ] `pnpm directory:import docs/raw/<file>.xlsx` → `rows_loaded` matches the dry run, a second run reports them as `updated`, and a row whose email hash is in `directory_suppressions` is skipped and counted → AC-2
- [ ] Point `.env.local` at staging while `IMPORT_POLICY.status` is `awaiting_lawyer` and run the import → exit 1 with the refusal, nothing written → AC-3, AC-17
- [ ] Rename a column header in a copy of the workbook and run the import → exit 1 naming the missing column → AC-2
- [ ] `pnpm test:db` → every suite green, including `directory_contacts`, `directory_search`, `directory_reveal`, `directory_unlocks`, `directory_credit_entries`, the widened `orders` and `contract` files → AC-1, AC-7, AC-8, AC-11
- [ ] `pnpm test` → green, including the credit pack seed equality test, the import policy test, the import script test on an invented workbook, the credit action tests and the analytics catalogue test with the three new events → AC-3, AC-6, AC-14
- [ ] `pnpm test:e2e e2e/directory.spec.ts e2e/legal.spec.ts` on the local stack → green, axe clean on the browse, the credits page, the admin page and the terms dialog → AC-5, AC-15, AC-16
- [ ] `psql`: as the seeded expert (`set_config('request.jwt.claims', …)`), `select count(*) from directory_contacts` → 0; `select email from directory_search()` → null on every locked row → AC-1, AC-4

## Value sourcing
- [ ] Import: a company name with doubled spaces and mixed case lands as one `name_normalised` and one company row → `normaliseCompanyName`
- [ ] Import: "Schweiz", "Suisse" and "SWITZERLAND" all land as `CH`; "Virgin Islands" is reported unmapped and skipped → `COUNTRY_NAMES`, never a guess
- [ ] Import: a row with `--batch "x"` records `source_batch x`; without the flag, the Summary sheet's Source cell → `source_batch`
- [ ] Reveal: the SQL hash of `Gone@Alpha.test` equals `emailHash("gone@alpha.test")` in Node (`24241b3d…`) → one hash rule in two places
- [ ] Search: `page_size 500` is clamped to 25; `after_page 40` is served, `41` is `SM429` → the depth cap in the function
- [ ] Search: ops see raw values with `unlocked false` → `unlocked` means "this caller paid"
- [ ] Checkout: `net_rappen 9950`, `vat_rappen 806`, `gross_rappen 10756` come from `computeAmounts` on the package row, `credits 50` from `packages.credits`, `package_name_snapshot` from `directory.packs.directory_50.name` in the buyer's language (German for a `de` order) → frozen at purchase
- [ ] Settle: change `packages.credits` to 60 after a pending invoice order was created, mark it paid → the grant is 50, the frozen value → `the_order.credits`
- [ ] Return URL: a German order returns to `/de/expert/kontakte/guthaben?order=<id>`, an English one to `/en/expert/directory/credits?order=<id>` → `getPathname` with the locale
- [ ] Export: `unlocked at` is ISO 8601 UTC in the file and Zurich local time on the page; the file name date is the Zurich day (23:30 UTC on the 12th names the 13th) → two clocks, one source
- [ ] Alerts: a client order still names `organizations.name`; an expert order names `Expert: <full_name>`, or `Expert` with no name → `buyerLabel`

## Acceptance-criteria coverage
- AC-1 covered by the client and expert direct read steps, `pnpm test:db` · AC-2 by the four import commands · AC-3 by the staging refusal · AC-4 by the masked search, the one character refusal, the depth cap and the psql step · AC-5 by the browse, the not found cursor, the load more link and the e2e axe run · AC-6 by the credits page figures and the seed equality test · AC-7 by the invoice purchase row and `orders.test.sql` · AC-8 by the mark paid twice step · AC-9 by the invoice and card purchases, the return URLs and the PDF path · AC-10 by the email sentence, the alert label, the admin badge and `not_deliverable` · AC-11 by the reveal, the reload and the refusal at zero · AC-12 by the reveal click, the inline errors and the inactive expert · AC-13 by the unlocks page and the two CSV downloads · AC-14 by the three captures · AC-15 by the admin page and the removal · AC-16 by the privacy block, the terms clause, the dialog and the three defaults · AC-17 remains a launch gate: the lawyer's commit, then the staging import as the last step of `docs/directory.md`'s checklist
