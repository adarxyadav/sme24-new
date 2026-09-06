# Assessment & gap report · SME24

Part of the [SME24 scope](index.md). After payment an expert visits the client and captures the assessment as structured data in the app, so the gap report, matching and progress tracking all read from one source.

## Slice 5: Assessment & gap report

### 16. Expert accounts & profiles · needs a decision
Ops invites senior EHS experts. An expert signs in to an expert area, keeps a profile (competencies, industries, standards covered, languages, region, availability), and sees the assessments and programs assigned to them. Profile data feeds matching in Slice 6.
**Done when:** ops can invite an expert, the expert completes a profile and sees only their assigned assessments and clients; a client can see the name and profile summary of the expert assigned to them.
Carried over from earlier specs: reuse the `pnpm user:invite` path (invite, fixed role, confirm handler) behind an ops UI and record the expert's own consent at first sign in (spec 0005).
- [ ] Design it (spec): `/architect expert accounts & profiles`

### 17. Structured assessment forms · needs a decision
The three questionnaires the expert completes in the app during or after the on site visit: Compliance (35 plus standards and guides), Safety Management System (ISO 45001, 7 categories), and Safety Culture (8 categories at 5 maturity levels). Questionnaire content, versioning, scoring and evidence notes are the decisions; the model must survive standards changing.
**Done when:** the assigned expert can complete, save partially and submit each of the three assessment types with per item scores and notes; a submitted assessment is locked and versioned; the client sees status but not the working draft.
- [ ] Design it (spec): `/architect structured assessment forms`

### 18. Gap report · needs a decision
From a submitted assessment the system generates a per client gap overview: findings ranked by risk, the standards or categories they map to, and recommended actions, in the client's language, readable in the dashboard and downloadable as a document. The expert reviews and releases it.
**Done when:** submitting an assessment produces a draft report the expert can edit and release; the client is notified and can read and download the released report; the gap list is stored as structured findings the program builder can reuse.
- [ ] Design it (spec): `/architect gap report`
