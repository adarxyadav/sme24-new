# Assessments

_How the two checklists travel from Phillip's HTML exports into the database, how an expert fills one in, what locks it, what the client and ops see of it, and what each environment needs before the first real assessment. Spec: [0019 Structured assessment forms](specs/0019-structured-assessment-forms/index.md). The ops alert rides the rail in [email.md](email.md); the analytics events follow [analytics.md](analytics.md)._

## The content flow (raw HTML to JSON to seed migration)

1. **The raw exports.** Phillip's two files, `iso45001_assessment.html` and `standards_assessment.html`, live in the gitignored `docs/raw/` and each carries its content as one `<script type="application/json">` block. They never enter the repository; the JSON files below are what is committed.
2. **`pnpm questionnaires:build`** (`scripts/build-questionnaires.mts`, pure half in `src/features/assessments/content-build.ts`) reads the block of each file (`--iso <path>` and `--standards <path>` override the defaults), maps it to content in document order (ISO: 7 sections, 27 clauses, then the 33 annex checks under their clause; Compliance: 18 standards, 42 groups, 327 requirements), applies every fix in `content-fixes.ts` (the restored `1.10` style labels, the OH&S wording, the Hot Work and Electrical texts, no `Lonza`), drafts the German of every text whose English changed, and writes `src/features/assessments/content/iso45001.json` and `compliance.json`. Every text is a `{de, en}` pair; each file records its origin in `sourceNote`. Commit both files.
3. **`pnpm questionnaires:migration`** (`scripts/questionnaires-migration.mts` over the pure `renderQuestionnaireMigration` in `seed-migration.ts`) parses the committed files with the content schema and writes `supabase/migrations/<timestamp>_questionnaire_seed.sql`: one upsert per version row and one per item, parents before children, never a delete. A rerun changes no row count. Commit the migration, then `pnpm db:reset`, `pnpm test:db` and `pnpm db:types`.
4. **On deploy** `deploy.yml` applies the migration with `supabase db push --include-all`, the same as any other migration, so the content reaches staging and production without a hand step.

Identity is the position within a version, never the display label: an item's id is `<version key>/<position>` (for example `iso45001@1/42` for clause 7.3), and `questionnaire_versions.key` is `<questionnaire key>@<version>`. `tests/features/assessments/content.test.ts` asserts the counts, the positions, every text fix and that `QUESTIONNAIRE_KEYS` in `catalogue.ts` equals the files on disk; `supabase/tests/questionnaires.test.sql` asserts 60 and 327 items per version in the database.

## The German review loop (`deReviewed`)

The build script drafts German through the AI Gateway, and every drafted text carries `deReviewed: false`. On the German page such an item shows a small "machine translated, not yet reviewed" note; nothing else changes. Both files ship with every item unreviewed today.

To review, edit the `de` texts in the JSON file by hand and set `deReviewed: true` on that item, then run `pnpm questionnaires:migration` and commit the file and the generated migration together. A rerun of `pnpm questionnaires:build` keeps the German and the flag of every item whose three English texts (title, requirement, question) are byte for byte unchanged, and drafts anew only where the English moved, so a review is never overwritten by a rebuild. `--no-translate` refuses to write unless every German is reused, so a rerun without a gateway key can never ship an English text as German.

## The version rule

Every assessment is pinned to one `questionnaire_versions` row (`assessments.questionnaire_version_key`, for example `iso45001@1`) at the moment it starts, and no app role may update that column. The rows of a version are never deleted or renumbered, because an assessment pinned to it keeps reading its items for life.

- **A text correction within a version** (a typo, a reviewed German) stays on the same version: edit the JSON, regenerate the migration, and the upserts update the texts in place. Every assessment, open or submitted, shows the corrected text.
- **A change of substance** (an item added, removed, or its meaning changed) is a new version: bump `version` in the file, and the migration inserts a new set of rows (`iso45001@2/1` onward) beside the old ones. `startAssessment` pins new assessments to the newest version; every earlier assessment keeps its own. A new file version never rewrites a row of an older one.

## Filling one in

`/expert/clients/[organizationId]` lists the organization's assessments and offers Start per questionnaire (Continue while a draft exists; the partial unique index allows one draft per company and questionnaire). `startAssessment` links the row to the expert's newest booking in `scheduled` or `in_progress` whose package runs that questionnaire (`PACKAGE_QUESTIONNAIRES` in `catalogue.ts`: the compliance package runs both, the management system package ISO 45001 only) and prefills the visit date from it.

On `/expert/clients/[organizationId]/assessments/[assessmentId]` a rating saves at once and a note on blur, each with its own indicator; a failed save keeps the local value and offers a retry. An annex check under an ISO clause is rated on its own and never counted: the checks suggest a clause rating (`suggestedRating` in `model.ts`) and Apply writes it to the clause. Submit shows what is still unrated per section and, once complete, moves the row `draft -> submitted` exactly once. From then on `assessment_answers` is frozen for every role including the service role (the `check_assessment_open` trigger raises `assessment_locked`), and the page renders the locked score summary from the pure `computeScore`, the one scoring function in the codebase.

## The exclusion rule

Only a questionnaire whose catalogue entry has `allowsSectionExclusion: true` offers a Not applicable control on a section; that is Compliance, where a site may simply have no hot work or no excavation. ISO 45001 never does (every clause applies to every management system), and `setSectionExclusion` answers `not_allowed` for it.

Excluding a standard writes one `assessment_answers` row with `item_id` null and the `section_key`, carrying the optional reason as its note; including it again deletes that row. An excluded standard is greyed with its items disabled, drops out of the score and of the completeness check, and appears in the score summary and the gap list as excluded, with the reason. The exclusion is frozen with the rest once submitted.

## The state lines

The client's booked assessment card on `/app` and the Assessment column on `/admin/orders` show, per booked order, one line per questionnaire the package runs: not started, in progress since a date, or submitted on a date (`listAssessmentStates` in `queries.ts` and the pure `orderAssessmentLines` in `states.ts`). That is all the client ever sees of an assessment: a client member reads `assessments` rows of their organization and no `assessment_answers` row at all, which `assessment_answers.test.sql` proves as a role and `e2e/assessments.spec.ts` proves through a client session's own access token. No client route renders an answer, a score or a note.

## The alert and the events

| What | When | Fields |
| --- | --- | --- |
| `assessment.submitted` (Slack alert) | after the row moves to `submitted`, best effort | company, questionnaire, expert, the whole percent score |
| `assessment.started` (PostHog) | after the insert | `locale`, `organizationId`, `assessmentId`, `questionnaireKey`, `orderId` or null |
| `assessment.submitted` (PostHog) | after the write | the same five |

## Local development

- `supabase start` applies the migrations including the content seed; the four role test accounts come from `seed.sql`. The seeded expert is active but not assigned: give them an `expert_assignments` row (or book an order from `/admin/orders`) before visiting `/expert/clients/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.
- Without `TRIGGER_SECRET_KEY` the alert logs `trigger_unavailable` and the submit still succeeds; without `NEXT_PUBLIC_POSTHOG_KEY` the events log and return false.
- Tests: `supabase/tests/questionnaires.test.sql`, `assessments.test.sql` and `assessment_answers.test.sql` (pgTAP), `tests/features/assessments/` (Vitest over the content, the fixes, the migration renderer, the model, the schemas and the actions) and `e2e/assessments.spec.ts` (Playwright with axe: both runs, the client probe, the keyboard rating; local stack only, one worker).
- **After a manual session, clean the audit log before `pnpm test:db`.** `assessment_answers.test.sql` counts every audited insert on that table, so rows a hand run left behind fail the suite. Remove the fixtures, then the audit rows of the five tables the run touched, behind the append only trigger:

  ```sql
  begin;
  set local app.audit_maintenance = 'on';
  delete from public.audit_log
   where table_name in ('assessments', 'assessment_answers', 'orders', 'expert_assignments', 'companies');
  commit;
  ```

  The e2e spec does the same for its own rows in `afterAll` through `purgeAuditRows` in `e2e/db.ts`, which is why the spec runs on the local stack only.

## Per environment checklist (staging, then production)

- [ ] **The seed migration is applied** by `deploy.yml`: `questionnaire_versions` holds `iso45001@1` and `compliance@1`.
- [ ] **The counts are right**: `select version_key, count(*) from questionnaire_items group by 1` answers 60 for `iso45001@1` and 327 for `compliance@1`.
- [ ] **One real start and submit** by a test expert on a booked order: Start on the client page, a few ratings and a note, a reload that shows them again, Submit, the locked score; then a second write refused with `assessment_locked`.
- [ ] **The Slack alert lands**: `assessment.submitted` names the company, the questionnaire, the expert and the score.
- [ ] **The client card** on `/app` shows the state line per questionnaire for that order and nothing else of the assessment.
- [ ] **`/admin/orders`** shows the same state in the Assessment column.
- [ ] **Both languages** of the expert page render, and the German shows the machine translated note until the review loop above has run.
