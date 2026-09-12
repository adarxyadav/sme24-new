# 0019. Structured assessment forms: rationale

The decision record for [index.md](index.md). `/develop` reads the index; this file holds the why, the options weighed, and the content inventory the build script must reproduce.

## Context

Feature 17 is the first thing an expert produces in the product after a client has paid: the structured record of the on site visit. Everything after it (the gap report in feature 18, the program in feature 20, the progress dashboard in feature 21) reads from this record, so its shape has to hold for years while the standards it rates keep changing. The scope row asks for three questionnaires (Compliance, Safety Management System, Safety Culture), per item scores and notes, partial saves, a submit that locks and versions, and a client who sees status but never the working draft.

Phillip, the EHS partner, supplied two checklists as single file HTML apps: an ISO 45001 gap assessment with 27 clauses in the seven management system sections plus three annex sub checklists that roll up to a suggested clause rating, and a technical standards assessment with 18 standards and 327 requirements. Both apps rate Compliant, Partially Compliant or Non Compliant, worth 1, 0.5 and 0, average the rated values into a percentage, and keep a note per item. The content sits in a JSON block inside each file; the UI persists through an artifact only API and is not reusable. The content carries its Excel origin: ten standards lost the trailing zero of `1.10`, `1.20` and `2.10`, so their numbering repeats within a section; one Hot Work row still says line breaking; ISO 5.4 carries the 5.2 requirement; the ISO template was converted from a quality management checklist and eight clauses still say quality or customer satisfaction; one Electrical row has no requirement; the Security standard names Lonza, the company the checklist was written for. The content is English only, and the product ships German and English from day one.

The forces: the model must survive standards changing (a corrected or extended standard must not move a past score); the expert works on a laptop on site, sometimes with poor signal, and a lost afternoon of ratings is the one failure the expert will not forgive; the client and ops need the state of the work without seeing it; every later feature must compute the same score from the same rows; the tenant contract of spec 0002 already names the four tables (kind G content, kind T assessments) and the access pattern; and the third questionnaire is not written yet, so the engine cannot be shaped around it. Not deciding leaves features 18 to 21 with nothing to read and the pilot experts on Phillip's spreadsheets.

The owner settled the five load bearing decisions before this spec (one engine with separate assessments per questionnaire; content as versioned data built by a hand run script and seeded by a migration mirroring the benchmark pair; the three value scale with annex rollup and a per standard not applicable; the two tenant tables with a trigger enforced single submit and expert only writes; a pure scoring function and the route and namespace names). This spec records them and settles what remained: how the content is identified and how a version changes, where an exclusion lives, how completeness and locking are enforced, how the expert learns what is booked, how the build script fixes the content and drafts the German, and how autosave behaves when the network does not.

## Options considered

The five owner decisions are fixed. The options below are the residual choices this spec had to make.

### Option 1: Content by generated ids and exclusions on the assessment row

Versions and items get `uuid` primary keys at insert time, the seed migration finds a parent by `(version, position)` with a subselect, and an assessment row carries an `excluded_sections jsonb` array the expert updates through a widened column grant.

**Pros**:
- The tenant tables follow the contract with no second row shape in `assessment_answers`.
- One fewer partial unique index and check.

**Cons**:
- A generated id per content row means the seed migration is not deterministic and the answer rows of two environments reference different ids for the same item, which makes support and a data copy between staging and production harder than they need to be.
- An exclusion written as a column update on `assessments` needs its own grant, its own validation and its own audit story, and does not ride the autosave and lock path the answers already have; a jsonb array of `{key, note}` cannot be constrained by the database beyond "is an array".

### Option 2: Deterministic content ids, exclusions as answer rows, guards in triggers (chosen)

Version key `<questionnaire key>@<version>` and item id `<version key>/<position>` are text primary keys the migration can write verbatim, so the same content row has the same id everywhere. A section exclusion is an `assessment_answers` row with `item_id` null and `section_key` set, gated by two exclusivity checks and its own partial unique index. Completeness on submit and the lock after submit live in triggers, so they hold for every role.

**Pros**:
- The seed migration is a pure function of the JSON, byte stable on a rerun, and a diff between two environments is a text diff.
- Exclusions autosave, lock, audit and obey the expert only policy for free, and the score function sees one list of answer rows.
- A submitted assessment is provably complete and provably frozen, whichever client asks, including the service role.

**Cons**:
- Text primary keys with a slash and an at sign are unusual in this schema and need a comment.
- `assessment_answers` holds two row shapes; every reader has to filter on `item_id is null` or not.
- A completeness count in a trigger is more SQL in the database than a check in the action would be.

### Option 3: A third tenant table for sections

An `assessment_sections` table with one row per section per assessment holding the exclusion, its note and, later, a per section comment.

**Pros**:
- Each concept in its own table, easy to read.
- A natural home for a per section summary if feature 18 wants one.

**Cons**:
- Spec 0002 registered two kind T tables for this feature; a third is a spec 0002 amendment plus a pgTAP file, a record of processing row and a set of policies, for a flag and a note.
- Nothing today needs a section row that is not an exclusion.

### Option 4: The expert learns what is booked through the service client

`startAssessment` authorises the caller and reads `orders` through the service client to find the booking, the ops admin pattern; the expert page shows no booking.

**Pros**:
- No new view, no change to the spec 0011 rule that experts do not read `orders`.

**Cons**:
- The expert page cannot show the booking (the date, the package) without a service read in a server component, which the Biome rule forbids, so the expert would still not know what they are visiting for.
- An insert policy cannot re check an `order_id` it cannot see, so the guard would live only in the action.

## Rationale

Option 2 because the forces are versioning, lost work and consistency. Deterministic content ids make the content a pure function of the committed JSON, which is what "content is data, versioned" has to mean in practice: the seed migration is reproducible, the equality test can compare the file to the rendered SQL, and a content row means the same thing on every environment. Position as the key, never Phillip's number, is what survives the Excel collapse and any renumbering he does later. Putting exclusions in the answer table is the smallest change that gives them the whole answer path, and the two exclusivity checks make the second row shape a database fact rather than a convention; the reader cost is one filter. The triggers are where completeness and the lock belong because the tenant contract already puts state machines in the database (`research_runs`, `orders`, `expert_assignments`), the service role bypasses RLS but not a trigger, and "a submitted assessment is locked and versioned" is the one promise the client and feature 18 rely on. The `expert_bookings` view is a narrowing of spec 0011's rule rather than a reversal: the rule protected money and billing, and the view exposes neither; the definer view shape is the one spec 0013 already uses for the client visible half of an expert.

Two smaller calls. Site and date live on the assessment (`site`, `conducted_on`) because Phillip's app recorded company, site, consultant and date per assessment and the report will need them; they are the only columns an expert may change on the row besides `status`, so the grant stays at three. No score column, because the score is derivable and a stored copy would be a second source of truth that goes stale on the day a version is corrected; the cost is one pure computation per read over at most 327 rows.

## What the spec deliberately does not decide

- The Safety Culture rating scale. Five maturity levels are not three compliance values; the engine stores a three value code and the Follow-up records that the third questionnaire needs a scale decision when it exists, not a speculative `rating_scale` column now.
- A reopen after submit, a reassignment of a draft, an offline queue, per row conflict detection, and whether a submission moves the order to `delivered`: each is a Follow-up with the shape it would take, none is in scope.
- The ops view of a raw assessment: feature 18's report is the intended ops and client surface.
- The German text itself. The build script drafts it and flags it; the reviewer and the deadline are a Follow-up.

## Content inventory

What the raw files hold on 12 September 2026, which the build script must reproduce and the content test asserts.

**ISO 45001** (`docs/raw/iso45001_assessment.html`, `<script id="iso-data">`, keys `sections` and `annexes`). Seven sections with 27 clauses, each clause with `clause`, `title`, `requirement`, `question` and `annex` (null or A, B, C):

| Section | Clauses |
|---|---|
| 4 Context of the organization | 4.1, 4.2, 4.3, 4.4 |
| 5 Leadership | 5.1, 5.2, 5.3, 5.4 |
| 6 Planning | 6.1.1, 6.1.2.1 (Annex A), 6.1.3, 6.1.4 (Annex B), 6.2.1 |
| 7 Support | 7.2, 7.3 (Annex C), 7.4, 7.5. (the trailing dot is a typo) |
| 8 Operation | 8.1.2, 8.1.3, 8.1.4 |
| 9 Performance Evaluation | 9.1.1, 9.1.2, 9.2, 9.3 |
| 10 Improvement | 10.1, 10.2, 10.3 |

Annexes: A for 6.1.2.1 (18 items, 8 rateable), B for 6.1.4 (9 items, 5 rateable), C for 7.3 (6 items, all rateable); each item has `row`, `text`, `rateable`. Non rateable items are context lines under a rateable one (for example the hazards listed under "b) routine and non-routine activities"). Total 60 items, 46 rateable, 27 scored. Section keys in the content file: `c4` to `c10`; annex labels `A.1` to `A.18`, `B.1` to `B.9`, `C.1` to `C.6`; every annex item's `parentPosition` is its clause.

**Technical standards** (`docs/raw/standards_assessment.html`, `<script id="std-data">`, key `standards`). Each standard has `key`, `name`, `sections` (each `code`, `name`, `clauses`), each requirement `item`, `title`, `requirement`, `question`, `rateable` (all true):

| Standard key | Groups | Requirements |
|---|---|---|
| electrical_safety | 3 | 21 |
| fire_protection_storage | 7 | 53 |
| ppe | 2 | 19 |
| industrial_hygiene_sampling | 5 | 21 |
| projects | 3 | 16 |
| security | 2 | 10 |
| line_breaking | 1 | 14 |
| hot_work | 1 | 14 |
| confined_space | 1 | 28 |
| high_work | 1 | 18 |
| excavation | 1 | 20 |
| loto | 1 | 18 |
| explosion_protection | 1 | 9 |
| mechanical_integrity | 3 | 17 |
| moc_pssr | 2 | 12 |
| incident_investigation | 1 | 13 |
| contractor_management | 6 | 16 |
| effective_communication | 1 | 8 |

18 standards, 42 groups, 327 requirements. Section keys are the standard keys; group keys are `<standard key>.<code>`.

**The collapsed numbers** (a repeated label within one group; the later occurrence gets its trailing zero back):

| Standard, group | Repeated | Restored |
|---|---|---|
| electrical_safety 2 | 2.1 at the tenth position | 2.10 |
| fire_protection_storage 1 | 1.1 at the tenth, 1.2 at the twentieth | 1.10, 1.20 |
| ppe 1 | 1.1 at the tenth | 1.10 |
| line_breaking 1 | 1.1 at the tenth | 1.10 |
| hot_work 1 | 1.1 at the tenth | 1.10 |
| confined_space 1 | 1.1 at the tenth, 1.2 at the twentieth | 1.10, 1.20 |
| high_work 1 | 1.1 at the tenth | 1.10 |
| excavation 1 | 1.1 at the tenth, 1.2 at the twentieth | 1.10, 1.20 |
| loto 1 | 1.1 at the tenth | 1.10 |
| incident_investigation 1 | 1.1 at the tenth | 1.10 |

The rule in `content-fixes.ts` is generic (a label already seen in the same group gets a `0` appended), so it needs no table, and the content test asserts these ten.

## The override table, for Phillip to confirm

The replacement texts `content-fixes.ts` applies. Each is keyed by questionnaire, section and raw label. The wording is a draft in the register of the surrounding rows; Phillip confirms or edits before milestone 1 commits the content (a Follow-up in the index).

| Where | Field | Now | Replacement |
|---|---|---|---|
| ISO 4.3 | title | Determining the scope of the quality management system | Determining the scope of the OH&S management system |
| ISO 5.2 | question | … commit to meeting requirements and continually improving quality? … Is it available to customers? | … commit to meeting requirements and continually improving OH&S performance? … Is it available to interested parties? |
| ISO 5.2 | requirement | continual improvement of the OHO&S management system | continual improvement of the OH&S management system |
| ISO 5.4 | requirement | the 5.2 policy text, duplicated | Establish, implement and maintain a process for consultation and participation of workers at all levels and functions, and of workers' representatives where they exist, in the development, planning, implementation, performance evaluation and actions for improvement of the OH&S management system; provide the mechanisms, time, training and resources needed; give timely access to clear and relevant information; remove or minimise barriers to participation; emphasise the consultation of non managerial workers on the matters listed in 5.4 d) and their participation in those listed in 5.4 e). |
| ISO 6.2.1 | requirement | are relevant to conformity of products and services and the enhancement of customer satisfaction | are relevant to the OH&S policy and to the improvement of OH&S performance |
| ISO 7.4 | question | communications with employees, suppliers, customers or other stakeholders about quality and customer satisfaction | communications with workers, contractors, visitors and other interested parties about OH&S matters |
| ISO 7.5. | label and question | `7.5.`; Quality policy, objectives, KPI | `7.5`; OH&S policy, objectives, KPI |
| ISO 9.1.1 | question | Are quality objectives, key process indicators or other measures of product quality, service quality, or process quality defined … measurements are driving quality performance | Are OH&S objectives, key process indicators or other measures of OH&S performance defined … measurements are driving OH&S performance |
| ISO 9.3 | question | matters related to quality; can also include quality focus | matters related to OH&S; can also include an OH&S focus |
| ISO 10.1 | question | Do they enhance customer satisfaction? | Do they improve OH&S performance? |
| ISO 5.4 | question | attendence | attendance |
| Hot Work 1.1 | title, requirement, question | line breaking | hot work |
| Electrical 3.3 | requirement (empty) and question | Program to check GFCIs (USA), DR (Brazil), FE (Switzerland) or country specific ground fault interrupters | requirement: A program is in place to check ground fault circuit interrupters (GFCI in the USA, DR in Brazil, FI in Switzerland) or the country specific equivalent at the defined interval. question: Is there a program to check ground fault circuit interrupters (or the country specific equivalent) at a defined interval, with records? |
| Security 1.6 | title, requirement, question | non-Lonza employees | people who are not employees of the company (visitors, contractors, truck and railroad personnel) |
| Security 1.6 | requirement | escorted by a Lonza employee | escorted by an employee of the company |
| Security 1.7 | title, requirement | all Lonza employees | all employees of the company |

Every remaining occurrence of the word Lonza, if any appears in a later export, is replaced by the literal "the company" as the owner decided, and the content test asserts the word is absent.

## The German draft

`translate.ts` sends one section at a time (a section's items with their English title, requirement and question) to `structuredOutput` with a schema that returns the same items with German texts, so a batch is bounded (at most 53 items) and a failure retries one section. The prompt (`questionnaire-translation@1`) fixes the register (Swiss Standard German with `ss`, formal `Sie` where a question addresses the reader, the official German titles of the ISO 45001 clauses, "Arbeitssicherheit und Gesundheitsschutz" for OH&S with the abbreviation kept, "Managementsystem" not "Qualitätsmanagementsystem") and asks for a translation, not a paraphrase. A rerun reuses the German of any item whose three English texts are byte equal to the committed file's, and keeps its `deReviewed` flag; anything else is drafted anew with `deReviewed: false`. The reviewer edits the JSON directly and sets the flag; the flag reaches `questionnaire_items.de_reviewed` through the migration and the German page shows a note on unreviewed items.

## Cross check

Not yet run. The owner asked for the spec in one autonomous pass; the fresh model cross check (decision completeness: a value an action must produce whose source the spec never names) is the next step and is recommended at GA. Run it before `/develop`.
