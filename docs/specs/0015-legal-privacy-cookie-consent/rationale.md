# 0015. Legal, privacy and cookie consent: rationale

The reasoning behind [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the scope row calls this "Legal, privacy and cookie consent", which reads as one
> feature but is four independent things: a consent mechanism, a set of published documents, a
> terms versioning change, and a data rights workflow. They are specced together because they share
> one audience and one review, and because splitting them would leave the analytics gate stranded
> behind a document review. They are built as four separate milestones for the same reason, so the
> consent thread can ship without waiting for legal copy. If the lawyer review drags, milestones 1,
> 3 and 4 are still shippable.

SME24 processes personal data of three kinds of people and has no published word about any of it.
Client contacts sign up with a name and an email and get benchmarked; experts are invited, hold a
profile with a photo and a biography, and are assigned to organisations; anonymous visitors submit
enquiries whose address is hashed. Behind them sit nine processors across four jurisdictions:
Supabase in Zurich, Vercel in Frankfurt, Trigger.dev in the EU, Resend, PostHog EU, Sentry EU,
Stripe, the Parallel Task API, and Anthropic through the Vercel AI Gateway.

Three forces make this due now rather than later. Feature 15 (analytics and monitoring) cannot ship
without a consent gate, and spec 0001 anticipated that by stubbing an `ANALYTICS_CONSENT_COOKIE`
constant with a comment naming this feature. The sign up form already asks people to accept terms
and a privacy policy that do not exist, which is the kind of detail that is embarrassing rather
than merely incomplete. And Release 1 targets paying pilot clients, some with EU operations, who
will ask for a DPA before signing.

The governing law is the revised Swiss FADP, in force since September 2023. It is meaningfully
lighter than the GDPR: it does not itself require a cookie banner, it exempts smaller companies
from the record of processing, and its information duty asks for less. But SME24 serves EU clients,
so the GDPR standard is the one worth building to, because building twice is worse than building
once to the stricter bar.

Two hard constraints came out of the research and shaped the design more than any preference did.
Analytics consent has no self hosted or EU hosted exemption: PostHog needs opt in wherever it runs,
because the legal basis follows the data rather than the infrastructure. And Article 958f of the
Swiss Code of Obligations requires accounting records to be kept for ten years, which directly
contradicts a deletion request. Any design that promised full deletion would have been promising
something the company is not allowed to do.

The cost of not deciding is that feature 15 stays blocked, the sign up form keeps linking nowhere,
and the first client to ask a data protection question gets an improvised answer.

## Options considered

### Option 1: A consent management platform

Adopt a hosted consent tool (Cookiebot, Usercentrics, Osano and similar) that scans the site,
renders the banner, maintains the cookie inventory and stores a consent record per visitor. Write
the legal pages by hand and keep data requests as email.

**Pros**:

- The banner, the per cookie inventory and the consent proof come as a product, maintained by
  someone whose job is tracking regulatory change.
- Generates the cookie declaration page automatically and keeps it current as the stack changes.
- Consent records give you an evidential answer if a regulator ever asks.

**Cons**:

- A third party script on every page, which is a bundle cost on pages governed by a hard first
  load budget (`pnpm budget`) and an irony: a script that loads before consent in order to ask
  about consent.
- A monthly fee and a vendor relationship for a site with exactly one non essential purpose.
- Their banner, their design language, on a site with a deliberate art direction in `docs/design.md`.
- The consent record is personal data stored with another processor, so the tool that manages
  compliance adds a line to the very policy it is helping you write.

### Option 2: A first party consent cookie with hand written pages and an ops worked queue

Own the whole surface. A cookie the app writes through a server action, an analytics gate that
reads it, four legal pages as translated message keys, a `terms_version` column, and a
`data_requests` table shaped exactly like the `enquiries` table ops already work.

**Pros**:

- No new dependency, no new environment variable, no script before consent, no bundle cost beyond
  a small component.
- The banner is the project's own design system, and the pages are ordinary marketing pages with
  the metadata, alternates and static rendering everything else has.
- The privacy page is generated from typed constants, so it cannot drift from the code without a
  test failing. That is a stronger guarantee than a scanner, which sees only what the browser
  loads.
- Data requests reuse a table shape, an RLS pattern, an audit trigger, an alert rail and an ops
  page layout that all already exist and are tested.

**Cons**:

- The legal text is written by an engineer. It needs a lawyer's review before it can be relied on.
- Regulatory change is now your problem. If the ePrivacy rules shift, someone has to notice.
- No consent record, so no evidence a particular person consented.
- Each new processor or table is a manual documentation edit, enforced by a test rather than a
  scan.

### Option 3: Geo gated banner, Swiss visitors default on

Show the banner to EU visitors only, and rely on the FADP's opt out model for Swiss visitors, who
are the large majority. Same pages and same request queue as option 2.

**Pros**:

- Materially better analytics coverage on the primary market, because most visitors never see a
  bar to refuse.
- Defensible on a literal reading: the FADP genuinely does not require a consent banner for
  analytics cookies.

**Cons**:

- Needs reliable geo detection on statically prerendered pages, which means the proxy or the edge,
  and spec 0001 rules out Edge runtime.
- The literal reading is contested, and the reasoning it rests on is uncomfortable to write in
  public: the privacy page would have to explain that your rights depend on where you appear to be.
- A VPN or a mislocated IP silently gives someone the wrong treatment.
- For a company selling compliance services to regulated Swiss firms, the optics of a minimal
  compliance posture on its own site are bad in a way that does not show up in a cost benefit
  calculation.

## Rationale

Option 2, for three reasons rooted in the forces above.

The bundle is the first. Spec 0009 established a first load JavaScript budget per page and a
`pnpm budget` gate that fails a build for exceeding it, and it already lists two deferred items
about shaving kilobytes off the public shell. Adding a third party consent script to every page
would spend that budget on the one script that must run before anything else, and would put a
vendor's code ahead of the site's own content on pages where first paint is the product. A cookie
plus a small component costs a fraction of that.

The second is that the privacy page's accuracy is a code problem, not a legal one. Consent
platforms scan what the browser loads, which is a good way to catch a stray tracking pixel and a
bad way to describe what happens to a research run's output on a server in Zurich. Most of what
SME24 must disclose never touches the browser at all: Parallel receives company names, Anthropic
receives research text, Stripe receives payment details, Trigger.dev runs the jobs. A scanner sees
none of it. Building the page from typed constants that tests hold to the actual code inverts
that: the page is right by construction, and a new processor breaks a test rather than silently
falsifying a published document.

The third is that this is not new work. `enquiries` is already an ops worked queue with a status,
a handled by and handled at pair written once, an ops note, an audit trigger, RLS, a Slack alert
and an admin list and detail page. `data_requests` is the same shape with a deadline column. The
marginal cost of option 2 over option 1 is mostly the legal prose, which option 1 does not write
either.

On option 3: the arithmetic favours it and I am recommending against it anyway. The technical
objection is real (geo detection on static pages, with no Edge runtime available) but the honest
objection is the one that decides it. SME24 sells EHS compliance consulting to regulated Swiss
companies. A site whose own privacy posture is the minimum defensible reading, tuned by visitor
location, is selling one thing and practising another. That is a product decision as much as a
legal one, and it happens to also be the simpler build.

Two of the research findings overrode what would otherwise have been reasonable choices, and both
are worth recording because they are counter intuitive. Hosting PostHog in the EU does not remove
the consent requirement, which kills the tempting argument that EU residency plus no cross site
tracking equals legitimate interest. And the ten year retention on accounting records means a
deletion request cannot honestly promise deletion, which is why the design anonymises instead and
says so on the page. A design that quietly deleted the person and left dangling invoices would
have broken the books; one that promised full deletion would have been a false statement in a
published policy.

A cross check on a second model read the drafted spec cold and found twenty four places where a
builder would have had to invent a decision. Five were load bearing and are now settled in the
spec: anonymisation was undefined column by column and named no `auth.users` scrub, so a "deleted"
person would still have been able to sign in; `requested_by` cascaded on delete, which would have
destroyed the record proving a deletion was performed at the moment it was performed; the terms
version constant had no stated starting value, and shipping it at `'2'` would have blocked every
signed in user on deploy day; the version column is `text`, so the "older than" wording tempted an
ordering comparison that reads `'10'` as older than `'2'`; and the consent bar had no stated default
DOM state, which would have flashed the bar on every load for visitors who had already chosen. That
last one is the same shape as the ICU grouping hydration bug this project already hit once, and
jsdom would not have caught it either. Three findings were considered and rejected, recorded in
Follow-up so they are not re raised as new.

On the engineer's preferences: you chose the recommended option at every question, so there is no
conflict to record. The one place I would flag pressure later is the terms re consent dialog. You
chose blocking, which is right for proving acceptance, and the temptation once it exists is to bump
the version for small edits. Do not. A blocking interruption spends user goodwill, and a version
bump should mean the deal changed.

## References

**Project sources** (verifiable, in this repo):

- `AGENTS.md`, the marketing rule: marketing pages stay static, browser code reads public
  variables through `@/lib/env.public`, `pnpm build && pnpm budget` is the gate.
- `src/lib/analytics/client.tsx`: the `ANALYTICS_CONSENT_COOKIE` constant stubbed by spec 0001
  with a comment naming feature 14, and the existing consent aware PostHog loader.
- Spec 0005 (auth): `profiles.terms_accepted_at` written only by the profiles trigger or
  `accept_terms()`, and the owed terms version noted there.
- Spec 0009 (marketing): `PATHNAMES` and `MARKETING_ROUTES`, `marketingMetadata`, the footer's
  empty legal group, the enquiry form's privacy link, and the first load budget.
- Spec 0014 (ops admin): the pattern of revoking `UPDATE` from app roles and authorising in the
  action, then writing through the service client `requireOps` mints.
- `supabase/schemas/32_enquiries.sql`: the kind I table contract this feature copies.
- `src/trigger/purge-enquiries.ts`: the scheduled retention pattern and its exported day constants.

**Practices and standards**:

- Swiss revised FADP (revidiertes DSG), in force 1 September 2023: the Art. 19 information duty,
  the Art. 25 right of access, and the Art. 12 record of processing with its exemption for
  companies under 250 employees engaged in low risk processing.
- Art. 958f of the Swiss Code of Obligations: ten year retention of accounting records.
- EU GDPR Art. 6(1)(a) with the ePrivacy Directive Art. 5(3): consent as the legal basis for
  analytics cookies, with no exemption for self hosting or EU residency.
- EDPB Guidelines 03/2022 on deceptive design, and the EDPB Cookie Banner Task Force report of
  January 2023: reject must match accept in size, colour and position on the first layer.
- Idempotency of user initiated writes: the partial unique index rather than an application check.

**Links** (web verified during the design conversation, 9 September 2026):

Primary sources were not reachable for every point below; where a claim rests on a secondary
source it is named as such, and the two items flagged as unsettled are marked.

- FADP guide 2026 (SIDD, secondary): https://www.sidd.swiss/en/insights/fadp-guide-2026/
- The record of processing activities (PwC Switzerland, secondary):
  https://www.pwc.ch/en/insights/regulation/the-record-of-processing-activities.html
- The FADP and the cookie banner confusion (Hostpoint, secondary):
  https://www.hostpoint.ch/en/blog/the-new-fadp-and-the-cookie-banner-confusion-what-are-the-latest-rules/
- Revised FADP compliance guide (iubenda, secondary):
  https://www.iubenda.com/en/help/76886-how-to-comply-with-the-revised-swiss-federal-act-on-data-protection
- Electronic bookkeeping and retention (KMU Admin, official):
  https://www.kmu.admin.ch/kmu/en/home/concrete-know-how/finances/accounting-and-auditing/electronic-bookkeeping.html
- PostHog GDPR compliance documentation (vendor, primary for its own product):
  https://posthog.com/docs/privacy/gdpr-compliance
- Data protection representative in Switzerland (DataRep, secondary; **the domicile test here is
  not confirmed from the Fedlex text**):
  https://www.datarep.com/2023/08/14/the-new-data-protection-representative-role-in-switzerland/

Two points remain genuinely unsettled and are carried as follow ups rather than stated as fact in
the spec: whether "domicile" for the Swiss representative duty is read as legal seat only (moot for
a Swiss domiciled company, but unconfirmed), and the status of the consent or pay debate, which is
live legislative argument rather than settled law and does not affect this design.
