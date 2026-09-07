# 0012. Named peer comparison, rationale

The decision record behind [index.md](index.md). `/develop` does not read this file.

## Context

Feature 9 (spec 0008) ships a working benchmark: a client's extracted KPIs are compared against a curated table of published Swiss and European statistics, mostly the Suva accident rates, and the result is a quartile position per KPI, a ranked gap list and an annual incident cost in CHF. It is arithmetic on stored rows, immutable, and traceable. It also compares a company against a statistical band rather than against companies. "You are in the third quartile of section C for firms your size" is true, defensible and abstract. Clients ask who the other companies are, because that is the question they actually have.

Three forces shape the answer.

**The research pipeline already solves the hard half.** Feature 8 takes a company name, reads public disclosures through Parallel, and has a model extract and validate KPIs with citations per value. Pointed at a peer company, it produces exactly the peer data this feature needs. Building a second extraction path would duplicate the provider interface, the validation prompt, the error classification and the retry rail, all of which took a feature to get right.

**Peer research is slow and costs money.** A real run took 4.4 minutes and touched eleven sources. Ten peers per industry section and size band, across the sections that matter, is a real bill and a real amount of ops time. Any design that re researches peers per client, or per dashboard view, is not viable. Peers have to be researched once and shared, which immediately collides with the tenant contract from spec 0002: `companies`, `research_runs` and `company_kpis` all carry `organization_id not null` with RLS scoped to the caller's organization. A peer belongs to no client.

**Spec 0008's rationale states that nothing in the benchmark calls a model, and the arithmetic depends on it.** The whole value of `computeBenchmark` being a pure function is that a CHF figure a client quotes to their board can be reproduced from the stored snapshot forever. Choosing which companies to compare against is the one part of this feature a model is genuinely good at and arithmetic is not. So the amendment has to draw a line that is precise enough to enforce, not a vague "we use AI carefully".

Not deciding means the dashboard keeps making an abstract claim while the pipeline that could make it concrete sits already built, and it means the "no model call" sentence in spec 0008 either silently rots or blocks a feature it was never meant to block.

## Options considered

### Option 1: separate peer tables with a shared extractor

New `peer_companies` and `peer_kpis` tables with no organization column, plus a `research-peer-company` task that calls the same Parallel provider and the same validation prompt but writes to the peer tables.

**Pros**:
- Cleanest conceptual separation: shared reference data never sits in a tenant scoped table, and no existing RLS policy is touched.
- Peer tables can be shaped exactly for peer needs without carrying client columns.

**Cons**:
- A second task and a second write path that call the same provider and prompt. They will drift: an error code added to one, a validation rule fixed in the other.
- The whole failure rail (error classification, the stale sweep, the alert, resume on `wait.for`) has to be reproduced or refactored to be shared, which is most of feature 8's task.
- Ops cannot inspect a peer through any surface that already exists.

### Option 2: a house organization owned by ops (chosen)

One seeded `organizations` row owned by ops. Every peer is a normal `companies` row inside it with an `is_peer` marker, researched by the unchanged `research-company` task, its KPIs ordinary `company_kpis` rows. Two narrow read policies let any authenticated user read approved peers.

**Pros**:
- Zero changes to the research pipeline. The task, the provider, the prompt, the error rail and the sweep all work as they are.
- Ops inspect a peer through the dashboard and the run views that already exist.
- The tenant contract is unchanged: `organization_id` stays `not null` everywhere, and every existing policy keeps its shape.
- The read widening is small and testable: two policies, both gated on the peer marker.

**Cons**:
- "An organization" stops always meaning "a client", which is a new idea in this codebase and one a future reader has to learn.
- Two of the most sensitive policies in the schema get a new branch, so a mistake there is a cross tenant leak rather than a cosmetic bug.
- Every existing client query needs an `is_peer = false` filter, and a missed one shows a peer in a client's company list.

### Option 2b: the house organization with peer state as columns on `companies`

A variant of the chosen option raised during the cross check: keep the house organization but drop `peer_companies`, holding `is_peer`, `peer_status`, `display_label` and the proposal metadata as columns on `companies` directly.

**Pros**:
- One fewer table and no join in the two widened policies.
- Less machinery for what is, at heart, "may this company be shown as a peer, and under what label".

**Cons**:
- Puts six columns that are meaningless for 99 percent of rows onto the busiest table in the schema, which every client query then carries.
- The proposal metadata and the rejected candidates are the bulk of the state, and rejected candidates should not become `companies` rows at all: a rejected candidate is a name and a reason, not an assessed company.
- The `unique (industry_section, size_band, display_label)` index would sit on `companies`, mixing a peer concern into a table whose indexes are all tenant scoped.

### Option 3: nullable `organization_id` on the existing tables

Relax `organization_id` to nullable on `companies`, `research_runs` and `company_kpis`, and treat a null organization as shared peer data.

**Pros**:
- No new table and no house organization concept.

**Cons**:
- Weakens the kind T tenant contract from spec 0002 on three live tables at once. Every existing policy, index and query has to be re read for the null case, and a null org in an `= (select private.jwt_org_id())` comparison is a silent no match rather than an error, which is exactly the kind of leak that is hard to see in review.
- The migration is backward incompatible in spirit even where it is not in letter, and previews share staging.

## Rationale

Option 2 wins on the force that dominates: peer research must reuse feature 8 whole. A second extraction path is not a small cost, it is a slow duplication of the most failure prone code in the product, and it would have to be kept in step forever. A house organization buys that reuse for one seeded row and two policies. Option 1's cleanliness is real but it is bought with a duplicated task; Option 3's economy is bought by loosening the tenant contract on three live tables, which is the one thing spec 0002 exists to protect.

The chosen selection model, a model proposal gated by ops approval, follows from the second and third forces together. Fully automatic selection puts a hallucinated company in front of a client with nobody having looked, and spends a real research run on each bad guess. A purely ops curated list keeps spec 0008's rule fully intact but makes the feature depend on ops holding market knowledge across 21 sections, which is slow enough that the feature would not get filled. Putting the model where recall is the job and the human where liability is the job costs one screen and gets both.

Keeping the named peers as a display layer over the statistics, rather than as the comparison basis, is the conservative call and the right one. If peer values drove the CHF figure, then adding a peer would change a number a client already quoted, and the explanation would be "the set changed", which is not an explanation anyone accepts about money. Statistics based figures move only when the statistics are refreshed, deliberately, through the seed migration. The peer layer adds a percentile and a picture, and those can move without anything a client repeated becoming wrong.

The five peer threshold is a judgement about credibility rather than statistics. With three companies, one odd value visibly defines the picture and the claim "companies like mine" is thin. With five, a single outlier is visible as an outlier. Ten is the target because it makes the labels `Peer A` to `Peer J` a natural set and because past ten the marginal peer buys little for a real research cost.

Anonymised labels are the safer first version and cost almost nothing to reverse. Every value comes from a public report, so naming is defensible in principle, but the product would be putting a named Swiss company on another company's screen next to a judgement about their safety performance, and the first complaint costs more to handle than the extra clarity buys. The names and sources sit in the disclosure, so the claim is still checkable, and the ops screen already carries what a named version would need.

The dot strip beats ranked bars mostly on page economy and honesty. Eight KPIs times eleven bars is a very tall page, and a strict rank invites reading precision into values whose confidence differs per source. A strip shows the spread and the client's place in it without implying that peer four and peer five are meaningfully ordered. It also extends `QuartileBand`, which is already built and already passes axe, rather than introducing a second visual language on the same card. Radar was weighed and dropped: it needs a common scale across KPIs that do not share one, it hides the band, and making it readable to a screen reader means shipping the table anyway.

Bumping `MODEL_VERSION` to `benchmark-model@2` when no existing figure changes looks like churn, and it is not. The version map exists so a reader knows which payload shape it holds; two shapes behind one key defeats it. The bump costs a map entry and buys the guarantee that spec 0008's rule ("a formula change bumps the version and adds a schema, never rewrites old rows") stays literally true.

Option 2b was weighed after the cross check and rejected on where the state belongs rather than on table count. Most of the peer lifecycle is about candidates, including ones that get rejected, and a rejected candidate should never become a `companies` row. Keeping that lifecycle in its own table also keeps `companies` free of six columns that are null for every client row.

The peer run write path deserves a note, because it is the one place this design gives something up. A client research run is inserted by the client under RLS, so the database itself enforces the quota and the tenant. A peer run cannot work that way: an ops user's JWT never carries the house organization id, so the insert policy can never pass, and the run has to go through the service client. That trades a database gate for an application gate on this one path. It is acceptable because the path is ops only and server only, because the open run index and the quota branch still apply as backstops in the database, and because the ops confirm makes the spend deliberate. It is worth knowing about, which is why it is written out in the spec rather than left implicit.

The enforcement test is the part of this spec most likely to matter in a year. The line between allowed and forbidden model calls is easy to state and easy to erode, one plausible commit at a time. An import boundary test in Vitest turns the rule into something the build checks, which is the only kind of architectural rule that survives.
