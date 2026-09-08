# Assessment & gap report · SME24

Part of the [SME24 scope](index.md). After payment an expert visits the client and captures the assessment as structured data in the app, so the gap report, matching and progress tracking all read from one source.

## Slice 5: Assessment & gap report

### 16. Expert accounts & profiles · in-progress
Ops invites senior EHS experts. An expert signs in to an expert area, keeps a profile (competencies, industries, standards covered, languages, region, availability), and sees the assessments and programs assigned to them. Profile data feeds matching in Slice 6.
**Done when:** ops can invite an expert, the expert completes a profile and sees only their assigned assessments and clients; a client can see the name and profile summary of the expert assigned to them.
Carried over from earlier specs: reuse the `pnpm user:invite` path (invite, fixed role, confirm handler) behind an ops UI and record the expert's own consent at first sign in (spec 0005).
Spec: [0013](../specs/0013-expert-accounts-profiles/index.md). One expert owned profile table with catalogue coded lists (the three assessment competencies, NOGA sections, standards, languages, cantons), a separate ops only notes table, a view that shows a client the summary of its active experts only, a private photo bucket, the invite steps shared between an ops action and the script, and manual ops assign and end actions on the existing assignments table until features 12 and 19 automate them.
- [x] Design it (spec): `/architect expert accounts & profiles`
- [x] Build it: `/develop expert accounts & profiles`
  - [x] Schema, catalogue and the invite thread: the three tables and the view with their policies and pgTAP files, the assign eligibility trigger, the catalogue and its equality test, the shared invite module, the ops experts list, invite and resend (AC-1, AC-2, AC-3, AC-7, AC-13)
  - [x] One expert end to end: onboarding with consent, ops assign and end, the expert home and the read only client page, the client's "Your expert" card (AC-4, AC-9, AC-11, AC-12)
  - [x] The full profile and offboarding: the profile form for the expert and ops, the photo bucket with signed URLs, ops notes, deactivate and reactivate (AC-5, AC-6, AC-8, AC-10)
  - [x] Emails, alert and the closing pass: the three templates and the onboarded alert, both catalogs, axe on every new page, the design gallery, the runbook (AC-14, AC-15)
- [x] Verify it: `/check verify expert accounts & profiles` — 14 of 15 criteria met in the real app ([verify.md](../specs/0013-expert-accounts-profiles/verify.md)); AC-6 closed by `/debug expert photo upload limit` on 8 Sep 2026, so all 15 are met. The photo upload needed `experimental.serverActions.bodySizeLimit` in `next.config.ts` (Next caps a server action body at 1 MB by default, below the 2 MB the spec and the bucket both promise) plus a client side size check so an oversized file is refused visibly.
- [x] Test it: `/test expert accounts & profiles` — 91 Vitest tests over six files (schema, form, queries, and the photo field, avatar, checkbox group and account actions components), including the AC-6 size guard regression `/debug` owed; Vitest 1433 passed 1 skipped, pgTAP 556, e2e experts 6 of 6. The suite found and fixed one defect: the invite email schema trimmed after validating, so a pasted address with whitespace was refused.
- [ ] Review it (fresh model): `/check review expert accounts & profiles`
- [ ] Document it: `/document expert accounts & profiles`

### 17. Structured assessment forms · needs a decision
The three questionnaires the expert completes in the app during or after the on site visit: Compliance (35 plus standards and guides), Safety Management System (ISO 45001, 7 categories), and Safety Culture (8 categories at 5 maturity levels). Questionnaire content, versioning, scoring and evidence notes are the decisions; the model must survive standards changing.
**Done when:** the assigned expert can complete, save partially and submit each of the three assessment types with per item scores and notes; a submitted assessment is locked and versioned; the client sees status but not the working draft.
- [ ] Design it (spec): `/architect structured assessment forms`

### 18. Gap report · needs a decision
From a submitted assessment the system generates a per client gap overview: findings ranked by risk, the standards or categories they map to, and recommended actions, in the client's language, readable in the dashboard and downloadable as a document. The expert reviews and releases it.
**Done when:** submitting an assessment produces a draft report the expert can edit and release; the client is notified and can read and download the released report; the gap list is stored as structured findings the program builder can reuse.
- [ ] Design it (spec): `/architect gap report`
