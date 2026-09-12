# Review, feat/contact-directory-spec, 2026-09-12

**Reviewed by**: Opus 5 (1M context) (author on an unnamed model; fresh eye on this diff)
**Scope**: 11 files (8 modified tracked, 3 new untracked), uncommitted working tree vs `HEAD`
**Verdict**: Approve with nits

## Summary

This diff is the `/test` pass for spec 0018 plus one real bug fix. The fix rewrites `localeOf` in `src/features/directory/actions.ts` so it reads both locale spellings the four directory call sites actually post; the previous version resolved a short code (`"de"`) to the English default, so a German expert's `directory.unlocked` event and every Zod validation message came back English. Three new Vitest files (86 tests pass across the directory suite) give genuine, error-path-heavy coverage of the reveal and removal actions, the directory reads and the boundary schemas. The five pgTAP edits are a preflight guard only, with no new assertions — defensible, but they add no coverage for the thing that motivated the change.

The `localeOf` fix is correct, correctly scoped, and does not break any other call site. I found no blockers and no majors. The findings below are minors and nits.

## Minor

### 🟡 `localeFromCode` still swallows an unrecognised locale into English, `src/features/directory/actions.ts:77`

**Problem**: The new branch is `isLocale(posted) ? posted : localeFromCode(posted)`. `localeFromCode` (`src/i18n/routing.ts:37-40`) returns `DEFAULT_LOCALE` (`en-CH`) for anything it does not recognise, so a posted `"fr"`, `"de-DE"`, `""` or a typo silently becomes English rather than surfacing as a problem. This is the same silent-fallback shape as the bug just fixed, one level down.

For the reveal and removal actions the blast radius is contained: `revealContactSchema` and `removeContactSchema` both enum `locale` on `["de","en"]` (`src/features/directory/schema.ts:102`, `:130`), so a garbage value is refused a few lines later and the only consequence is that the *validation message* explaining the refusal is in the wrong language. That is cosmetic.

For the two credit actions it is not contained. `creditCheckoutSchema` (`schema.ts:113`) has **no `locale` field at all** — `billingAddressSchema` does not carry one either — so the posted locale is never validated by anything. `localeOf`'s answer flows straight into `prepareCreditOrder`, where it picks `package_name_snapshot` (`actions.ts:245-246`), the persisted `orders.locale` (`:267`) and the Stripe return URL (`creditsReturnUrl`, `:274-280`). A caller who posts `locale: "fr"` gets an English snapshot and an English `orders.locale` frozen onto a durable row.

**Why it matters**: In practice only the credits form posts this field and it posts `useLocale()`, which is always a valid full tag, so there is no live user-facing bug today. The risk is durability: the value is frozen into an immutable-by-convention order row and a Stripe URL, and nothing between the browser and the insert would ever tell you it was wrong. The same class of defect is exactly what this diff just spent a fix on.

**Suggested fix**: Either add `locale: z.enum(LOCALES)` (or the short-code enum, matching the other two directory schemas) to `creditCheckoutSchema` so an unrecognised value is a `validation` / `invalid_billing_address` refusal rather than a silent English order, or have `localeOf` log a breadcrumb through `log.warn` when `posted` is a string that is neither a locale nor a known code, so a bad call site shows up in the logs instead of looking correct.

### 🟡 The five pgTAP edits add a guard but no assertion for the change that motivated them, `supabase/tests/directory_contacts.test.sql:10-23` (and the four sibling files)

**Problem**: All five files receive a byte-identical `do $$ ... end $$` block that raises when any of the six directory tables holds a row, with the comment "a hand run `pnpm directory:import` against the local stack leaves tens of thousands of rows behind". No `plan(N)` count changes, and no new `ok`/`is`/`throws_ok` assertion is added in any of the five. So relative to the review question: the diff to these files is a test-environment preflight, not new coverage of the locale fix or of anything else.

**Why it matters**: The guard itself is a genuine improvement — the alternative was five suites failing with an opaque ordering mismatch, which is a real time sink and matches the "verify directory gotchas" note in the project's memory. But it should be read as tooling, not as test coverage, and it comes with two smaller problems of its own:

1. The message says "this database holds rows beyond the seed", while the check is `exists (select 1 ...)` — i.e. *any* row, not rows beyond the seed. Today `supabase/seed.sql` inserts nothing into the six directory tables so the two coincide, but the day a directory seed row is added, every one of these five suites aborts with a message that describes a condition that is not the one being tested.
2. The block sits *after* `select plan(N)`, so the abort happens with a plan already emitted and no `finish()`. The transaction rolls back and the raise text is clear enough, so this is not harmful, but a `raise exception` after a plan reads as a failed run rather than a refused one.

**Suggested fix**: Change the message to match the predicate ("this database holds directory rows; run `pnpm db:reset` before the tests"), or make the predicate match the message by excluding whatever the seed is expected to contain. Optionally move the block above `select plan(N)` so a refused run is not also a broken plan. Duplicating the block five times is acceptable; pgTAP has no include mechanism here.

## Nits

- ⚪ `src/features/directory/actions.ts:69-73`, the docstring says "the four call sites post two spellings on purpose". It is accurate (I checked all four: `unlock-cell.tsx:67` and `remove-contact-form.tsx:59` post `LOCALE_CODE[locale]`, `credits-form.tsx:74` posts `useLocale()` for both credit actions), but "on purpose" oversells it — the split is a consequence of the two directory schemas enumerating short codes while `creditCheckoutSchema` carries no locale field at all, not a design decision. Consider saying which schema forces which spelling so the next reader does not have to re-derive it.
- ⚪ `src/features/directory/actions.ts:74`, `localeOf` is now the only one of the six `localeOf` helpers in `src/features/` that handles both spellings; the other five (`auth`, `benchmark`, `research`, `self-assessment`, `checkout`) still call `resolveLocale(posted)` directly. I verified every one of their forms posts the full tag from `useLocale()`, so **none of them is broken** and no change is owed — but the divergence is now invisible. A one-line comment on the directory helper saying "the other feature `localeOf` helpers take the full tag only, because their forms post `useLocale()` directly" would stop someone from either copying this shape everywhere or "simplifying" it back.
- ⚪ `tests/features/directory/reveal-actions.test.ts:57`, the `getLocale` mock returns `"en-CH"` unconditionally, so the `getLocale()` fallback branch of `localeOf` (line 79) is only ever exercised for English. A case posting no `locale` at all with the mock returning `"de-CH"` would close the last uncovered branch of the function the diff exists to fix.
- ⚪ `docs/scope/commerce.md:62`, "Test it" is ticked while "Verify it" above it is still unticked, even though `verify.md` in the same diff ticks almost every step. That ordering will read as odd in the scope board; presumably the verify tick lands with the verify report.

## Strengths

- **The `localeOf` fix is right, and right for the right reason.** I traced all four call sites and all five sibling `localeOf` helpers. `isLocale(posted) ? posted : localeFromCode(posted)` handles `"de"`, `"en"`, `"de-CH"` and `"en-CH"` correctly and changes behaviour for no other caller, because no other feature's forms post the short code. Notably the prior review pass's claim that the old bug reached `package_name_snapshot`, the Stripe return URLs and `orders.locale` is **not** correct: those three are fed only by the credits form, which posts the full tag and was always resolving correctly. The real old blast radius was narrower — the `locale` property on `directory.unlocked` and the language of the Zod messages on the reveal and removal forms — and `verify.md` proves the event property live on `/de/expert/kontakte`.
- **`reveal-actions.test.ts` is error-path-first, not happy-path-first.** Nine of its sixteen cases are refusals: all three SQLSTATE mappings, the unknown-code path that must reach Sentry, a client caller, a signed-out caller, an expert whose profile flipped to `invited`, a non-uuid contact id, a non-address email and an unknown reason. Several assert `boundary.rpcCalls).toEqual([])`, which is the assertion that actually proves authorisation happened *before* the RPC rather than merely alongside it — the thing that matters given the proxy never runs for a server action post.
- **The privacy invariant is tested as an invariant, not as a shape.** `reveal-actions.test.ts:137-140` serialises the whole captured event and asserts that none of `erika`, `Muster`, `alpha.test`, `Alpha Werke`, `123 45 67` appears anywhere in it, and `:296-297` does the same for the removal log line. That catches a future field addition that a `toEqual` on a fixed property list would not.
- **`schema.test.ts` treats the cursor as attacker-controlled input.** It round-trips through base64url, then feeds it a SQL-injection string in the uuid position, a non-JSON payload, a JSON scalar, out-of-range and fractional page ordinals, and an over-long name — and correctly distinguishes page 41 (decodes fine; the *function* answers SM429 so the page can render a depth message rather than a misleading 404) from page 1 and page 0 (must be null). That distinction is subtle and easy to get backwards.
- **The pgTAP guard is a real fix for a real, already-experienced failure mode**, even though it is not coverage. It turns a confusing ordering failure into a one-line instruction.
- `queries.test.ts` correctly tests the "throws rather than renders empty" contract on four separate reads, which is the project's stated queries-throw rule, and pins the bigint-arrives-as-a-string detail (`unlocks: "1"` → `1`) that would otherwise silently render as a string.

## Test coverage

Strong, and materially better than before this diff. The directory suite is 10 files / 86 tests, all passing (`npx vitest run tests/features/directory/`), and Biome is clean on the changed files.

- **Newly covered**: the reveal action end to end (success, already-unlocked, all three SQLSTATE mappings, the unexpected path with the Sentry assertion, four authorisation refusals, uuid validation); the removal action (removed, not_found, lowercasing/trimming, two validation refusals, role refusals, the unexpected path); the locale fix specifically (`reveal-actions.test.ts:143-156` asserts `"de"` in and `"de"` out, `"en"` in and `"en"` out, and its comment names the exact regression); the keyset paging rule in `searchDirectory` and `listUnlockedContacts`; the masked-vs-raw mapping; the three ops reads and their throw-on-error contract; every boundary schema including the tampered cursor.
- **No overlap** with the already-committed `credit-actions.test.ts`, which covers `startCreditCheckout` and `requestCreditInvoice`. The three new files fill the gaps that file left.
- **Still uncovered**: the `getLocale()` fallback branch of `localeOf` for a non-English request (nit above); `listDirectoryCountries` and `getLatestImport` in `queries.ts` have no Vitest case, though both are thin and `getLatestImport`'s error path is the same `queryError` shape already proven four times; and the two deferred items (the invoice PDF's `SELLER_IBAN` and the Slack `buyerLabel`) remain unexercised by owner choice and are correctly marked BLOCKED in `verify.md` rather than ticked — not raised as findings here.
- The five pgTAP files add no assertions; their plans are unchanged at 36 / 12 / 30 / 23 / 13.
