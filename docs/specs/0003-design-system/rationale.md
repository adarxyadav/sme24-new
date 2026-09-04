# 0003. Design system and UI foundation: rationale

Decision record for [index.md](index.md). `/develop` does not need this file; it is for people and for a later `/architect` update.

## Context

SME24 serves four surfaces from one Next.js app: the public marketing site and the three signed in areas for clients, experts and ops. Spec 0001 chose Tailwind v4 with shadcn/ui and left the visual language to this feature. Today the app runs the stock `radix-nova` preset with a neutral gray palette, one primitive (`Button`), a plain top bar shared by all three areas, and a font mapping that silently falls back because `--font-sans` points at a variable the layout never sets. There is no brand: no logo, no color, no chosen typeface, no `design.md`.

The forces: the audience is regulated Swiss companies and senior EHS experts, so the product has to read as calm, precise and trustworthy rather than playful. Two languages ship from day one and German runs roughly a third longer than English, so every control must tolerate long labels. WCAG 2.2 AA is a commitment on every page, and the tooling (Biome accessibility rules plus axe in Playwright) is already in place but has almost nothing to scan yet. Ops and experts will spend long sessions in tables and lists, which makes density and a dark mode practical needs rather than polish. Later slices draw charts (benchmarks, gap reports, dashboards) and show risk levels, so the color vocabulary must cover severities and chart series now or every feature invents its own.

Not deciding means each of the next twenty features styles itself: three shells, ad hoc colors that fail contrast, and an accessibility debt that surfaces in axe one page at a time. A foundation that arrives after the pages is a rewrite of the pages.

## Options considered

### Option 1: Formalize the stock shadcn theme

Keep the neutral preset as is, write `design.md` around it, install components as features need them.

**Pros**:
- Fastest; zero token work and no new dependencies.
- Every shadcn example applies unchanged.

**Cons**:
- No brand identity; the product looks like every shadcn starter, which undercuts trust with paying pilot clients.
- No status, severity or chart vocabulary, so features 9, 18 and 24 still have to invent colors, and the contrast of those inventions is unguarded.

### Option 2: Token based system on shadcn/ui with a custom "Swiss precision" direction (chosen)

Keep shadcn as the component layer and define SME24's own tokens (brand teal, cool neutrals, status, severity, chart), type scale, shell and page primitives on top, with a contrast test, a gallery and `design.md`.

**Pros**:
- Owns the look without forking anything; upstream components keep working because the token names stay.
- Accessibility becomes a test (contrast pairs in Vitest, axe on the gallery) rather than a review step.
- The full inventory lands once, so later features only compose.

**Cons**:
- A day or two of token, shell and gallery work before any product feature benefits.
- The gallery is a page to maintain; a primitive added without a section escapes the scan.

### Option 3: Adopt a complete third party design system

Take an opinionated kit on top of Tailwind (a dashboard library such as Tremor, or a paid component set) for the signed in areas.

**Pros**:
- Dashboard patterns (charts, KPI cards, tables) arrive finished and coherent.
- Less design decision making for a small team.

**Cons**:
- A second component vocabulary beside shadcn, or a migration away from the components spec 0001 already chose.
- Accessibility and localization quality depend on the vendor; the long German label rule and WCAG 2.2 AA cannot be enforced from outside.
- Theming to a brand means fighting the kit's opinions.

### Option 4: Custom component library from scratch

Hand write every primitive on Radix (or plain elements) with the SME24 look baked in.

**Pros**:
- Complete control over markup, styling and bundle.

**Cons**:
- Weeks of work to reach the coverage shadcn gives in an afternoon, and every accessibility detail (focus trapping, roving tab index, announcements) is rebuilt by hand.
- A one person team cannot maintain it beside the product.

## Rationale

Option 2 fits the forces best. Spec 0001 already committed to shadcn, so the cheapest reliable path to a branded, accessible product is to change what shadcn reads (the tokens) rather than what it is. The Swiss precision direction is chosen because the audience judges trust before features: restrained neutrals, hairline borders and one accent read as careful, and they are also the easiest look to keep consistent across three areas and two languages. Deep teal green is the brand color because it says environment and safety without being the default SaaS blue, passes AA on white and on dark surfaces, and never collides with the red that critical risk needs; Swiss red was set aside for exactly that collision, navy for being indistinct, and near black because it leaves emphasis entirely to status colors.

Geist stays because it is already loaded, has tabular figures for CHF tables, and switching fonts buys nothing at this stage. Four severity levels plus four outcome states are defined now because gap findings and benchmarks need them soon and adding a level under pressure produces inconsistent colors. The sidebar shell for all three areas is chosen over a per area mix because admin navigation outgrows a top bar by Slice 3 and one shell is one set of keyboard and mobile tests. The engineer picked every one of these directions from a recommended set in the design conversation.

The smaller calls made while writing:

- **Theme storage**: `next-themes` with browser storage over a cookie or a profile column. A cookie cannot reach statically rendered marketing pages, and a profile column needs a migration, an action and still a client script for first paint. Runner up: the cookie approach, if cross device consistency ever matters more than static rendering.
- **Charts**: Recharts through shadcn Chart over Nivo, visx or deciding per feature. It reads the chart tokens with no mapping layer and has the most examples; the cost is client only rendering, which the gap report (feature 18) must solve separately. Runner up: Nivo, for its SSR friendly SVG if PDF charts turn out to be the main use.
- **Gallery**: an ops only route under `/admin` over Storybook. It runs in the real shell with real tokens, the existing axe suite scans it, and there is no second build. Runner up: Storybook, if a designer joins and needs isolated component previews.
- **Contrast enforcement**: a Vitest test over the CSS file plus axe, over axe alone, because axe only sees pages the suite visits and reports after the fact; the unit test fails the commit that breaks a pair.
- **Density**: keep the preset's 32px controls and add a compact table variant instead of a global density toggle; one knob, and the only place density matters today is ops lists.
- **Radius** `0.375rem` over the preset's `0.625rem`: the smaller value matches the precise direction; the preset derives every other radius from it so nothing else changes.
- **Cool neutrals** (a trace of blue in the grays) over pure gray: they sit beside the teal without looking muddy, and the chroma is low enough that the contrast math is unaffected.
- **Long text**: wrap everywhere, truncate only in table cells with the full text on hover and focus, so sighted and screen reader users get the same content. Free truncation was rejected because German labels lose meaning.
- **Motion**: minimal and disabled under reduced motion; richer motion can be added per feature and is easier to add than to police.
- **Marketing**: same tokens with a display type scale rather than a separate theme, so sign in and consent pages do not show a seam; feature 13 adds marketing blocks on top.

Tracer Bullet shapes the build plan: the first slice threads the brand tokens, the theme toggle and the gallery through the real app with axe running, so the pipeline that guards the rest exists before the inventory is filled in.

## Tool discovery

Searched on 2026-09-04 for Agent Skills and MCP servers covering the three new dependencies. No MCP server exists for any of them (they are small client libraries). Skill candidates found: `pharbuz/ai-agent-skills@next-themes`, `andy-spike/skills@recharts`, `emilkowalski/skills@ask-sonner`, plus two shadcn adjacent ones (`defi-naly/skillbank@shadcn-charts`, `laguagu/claude-code-nextjs-skills@nextjs-shadcn`) that overlap the installed `shadcn` skill. Installed the same day into `.claude/skills/`: `next-themes`, `recharts` and `ask-sonner` (listed under Implementation skills in `index.md`). Declined: `defi-naly/skillbank@shadcn-charts` and `laguagu/claude-code-nextjs-skills@nextjs-shadcn`, both overlapping the installed `shadcn` skill. Both lists belong in root `AGENTS.md` through `/sync`.
