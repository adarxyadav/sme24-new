# Scope: SME24

An AI powered EHS (Environment, Health and Safety) consulting marketplace for regulated companies in Switzerland. A company benchmarks its EHS risk for free, sees the annual cost of incidents in CHF, then buys a fixed price package that pairs it with a senior EHS expert to close the gaps and track progress. Three kinds of people use it: client companies (several people per company), EHS experts, and your own ops team.

**Build approach:** Tracer Bullet (vertical slices; each feature runs end to end through database, background jobs, API and UI, real and deployable, narrow rather than mocked).
**Workflow:** GA (after `/develop`: `/check verify`, then `/test`, then a fresh model `/check review`, then `/document`; most features need a spec). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Beta`) to do more or less.

**Release 1** (the free to paid loop, your three month target for the waiting pilot clients) is Slices 1 to 4. Slices 5 to 8 complete the product after that. German and English from day one. Swiss data protection (revised FADP) with GDPR readiness and cookie consent, and WCAG 2.2 AA on every page, are built into the foundations and launch slice rather than bolted on later.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model | Foundation | done |
| 4 | Design system & UI foundation | Foundation | done |
| 5 | Localization (German & English) | Foundation | done |
| 6 | Auth, organizations & roles | Slice 1 | in-progress |
| 7 | Transactional email & ops alerts | Slice 1 | planned |
| 8 | Company lookup & research pipeline | Slice 1 | planned |
| 9 | Peer benchmark & CHF opportunity | Slice 2 | planned |
| 10 | Self assessment fallback | Slice 2 | planned |
| 11 | Package checkout with Swiss VAT | Slice 3 | planned |
| 12 | Ops admin: orders, companies & scheduling | Slice 3 | planned |
| 13 | Marketing site & retainer enquiry | Slice 4 | planned |
| 14 | Legal, privacy & cookie consent | Slice 4 | planned |
| 15 | Analytics & monitoring | Slice 4 | planned |
| 16 | Expert accounts & profiles | Slice 5 | planned |
| 17 | Structured assessment forms | Slice 5 | planned |
| 18 | Gap report | Slice 5 | planned |
| 19 | Expert matching | Slice 6 | planned |
| 20 | Program builder & progress updates | Slice 6 | planned |
| 21 | Embedded BI progress dashboard | Slice 7 | planned |
| 22 | Client team invitations | Slice 8 | planned |
| 23 | In app notification center | Slice 8 | planned |
| 24 | Ops metrics dashboard | Slice 8 | planned |

## Epics

Build order is the `#` above. Each epic file holds its features grouped by phase.

- [Foundations](foundations.md) · 1 to 5 · 5 of 5 done · everything the slices stand on: stack, tooling, data model, design system, two languages.
- [Client funnel](client.md) · 6 to 10, 22, 23 · 0 of 7 done · sign in, company lookup, AI research, benchmark and CHF opportunity, plus later team and notification strands.
- [Commerce & ops](commerce.md) · 11, 12, 24 · 0 of 3 done · fixed price checkout with Swiss VAT, the ops admin, ops metrics.
- [Launch](launch.md) · 13 to 15 · 0 of 3 done · marketing site, legal and consent, analytics and monitoring. Release 1 ships after this.
- [Assessment & gap report](assessment.md) · 16 to 18 · 0 of 3 done · experts, the three structured assessments, the generated gap report.
- [Programs & tracking](programs.md) · 19 to 21 · 0 of 3 done · matching, the improvement program, the embedded progress dashboard.

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Date slot booking in the app**: client picks an on site date from expert availability at checkout · needs a decision
- **French and Italian**: the two remaining national languages; the localization foundation keeps this cheap
- **Fully automated matching**: assign the expert without ops confirmation · needs a decision
- **Public expert sign up**: experts apply through the site instead of being invited by ops
- **EU VAT and multi currency**: only CHF with Swiss MWST is in scope now · needs a decision
- **Public API and integrations**: client systems pulling benchmark and program data · needs a decision
- **Account settings page**: name, language, password change and sign out everywhere; the sign in flows ship without it · from spec 0005

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· Beta`) sets that one feature's rigor above or below the project default; no tag inherits the default (GA here). It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
