import { Factory, Languages, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  COMPETENCY_CODES,
  type CompetencyCode,
  type ExpertLanguageCode,
  type IndustryCode,
  type RegionCode,
  type StandardCode,
} from "@/features/experts/catalogue";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { ExpertProfilesFilter } from "@/features/marketing/ui/expert-profiles-filter";

/** The grid the filter points at and its rules target. One id, written once and read once. */
const GRID_ID = "expert-profiles-grid";

/**
 * The six example profiles. Every coded field is a real code from `EXPERT_CATALOGUE`, so the
 * labels come from `experts.catalogue.*` and a card can never name a standard, a sector, a canton
 * or a language the product does not carry; only the name and the years are copy. That is the same
 * contract the landing band's three profiles keep, and the reason this file holds codes rather
 * than strings.
 *
 * Nobody here is real. The names follow the `M. Muster` / `A. Beispiel` convention the landing
 * band and the hero's example company already use. The visible line that said so was removed on
 * 2026-09-14 (owner decision), so the only disclosure left is `sr-only` -- see the KNOWN GAP note
 * in the markup below, and restore the line before launch: a placeholder that does not announce
 * itself is a claim about people who have not been hired, on a public page. When ops onboard real
 * experts this section reads from `expert_profiles` instead -- the card shape is already the
 * profile shape, so that swap is a query, not a redesign.
 *
 * Six rather than the landing band's three: this is the page the reader came to for the network,
 * so the grid has to show range (four sectors, four cantons, three competencies, all four working
 * languages) rather than a sample.
 */
const PROFILES = [
  {
    key: "manufacturing",
    competency: "management_system",
    industry: "C",
    region: "ZH",
    standards: ["iso_45001", "ekas_6508"],
    languages: ["de", "en"],
  },
  {
    key: "construction",
    competency: "safety_culture",
    industry: "F",
    region: "BE",
    standards: ["suva_asa", "bauav"],
    languages: ["de", "fr"],
  },
  {
    key: "chemical",
    competency: "compliance",
    industry: "C",
    region: "BS",
    standards: ["stfv", "iso_14001"],
    languages: ["de", "en"],
  },
  {
    key: "energy",
    competency: "management_system",
    industry: "D",
    region: "VD",
    standards: ["iso_50001", "esti"],
    languages: ["fr", "de"],
  },
  {
    key: "logistics",
    competency: "safety_culture",
    industry: "H",
    region: "TI",
    standards: ["iso_45001", "psa"],
    languages: ["it", "de"],
  },
  {
    key: "food",
    competency: "compliance",
    industry: "C",
    region: "SG",
    standards: ["iso_9001", "arg_argv"],
    languages: ["de", "en"],
  },
] as const satisfies readonly {
  readonly key: string;
  readonly competency: CompetencyCode;
  readonly industry: IndustryCode;
  readonly region: RegionCode;
  readonly standards: readonly StandardCode[];
  readonly languages: readonly ExpertLanguageCode[];
}[];

/**
 * The identifier half of a catalogue standard label, which is written `NAME (gloss)` for most of
 * the list: "ISO 45001 (occupational health and safety)" gives "ISO 45001", and a label with no
 * parenthetical ("Suva ASA specialists", "Labour Act and ordinances") is returned whole, because
 * there is no shorter name to fall back to.
 *
 * The split is taken from the label rather than held as a second list of names beside the
 * catalogue: two lists drift, and the label is already the one source both catalogs share. Pure,
 * runs anywhere.
 */
function standardName(label: string): string {
  const open = label.indexOf(" (");
  return open === -1 ? label : label.slice(0, open);
}

/**
 * The example profiles band of the expert network page (docs/design.md, tier map: major,
 * openerless): six profiles in the shape a real one takes, directly under the hero, so the claim
 * the page opens with -- "Senior people. No juniors." -- is answered by the people it is about
 * before the standard and the vetting ladder explain how such a person is found. It needs no
 * visible heading of its own, only the `sr-only` one that names the landmark and keeps a level
 * above the cards' `h3`: the hero directly above names what the cards are.
 *
 * The card is built from the design system rather than from the usual directory pattern: flat with
 * a hairline and no shadow, square cornered, in the `gap-px border bg-border` grid the standard and
 * vetting bands above it already use, so the three bands read as one page. The information is
 * ordered by what a client actually decides on -- who, what they do, where, what they carry --
 * rather than by what a profile database happens to hold.
 *
 * Server component. The one client island is `ExpertProfilesFilter` above the grid (owner decision
 * of 2026-09-14, which reversed the "deliberately no filter row" this band shipped with): it sets
 * `data-competency` on the grid and the rules below hide what does not match, so the six cards stay
 * server rendered and the band still works with JavaScript off. These routes are statically
 * prerendered and never read `searchParams` (src/features/marketing/AGENTS.md), so the filter
 * mirrors itself into the query string with `replaceState` instead, the shape `RegisterDirectory`
 * uses on the sibling page. The real filterable list is still the register at
 * `/expert-network/directory`; this one narrows six examples.
 */
export function ExpertProfiles() {
  const t = useTranslations("marketing.expertNetwork.profiles");
  const catalogue = useTranslations("experts.catalogue");

  return (
    <section aria-labelledby="profiles-heading">
      <div className="mx-auto flex max-w-6xl flex-col px-4 pb-16 sm:px-6 md:pb-28">
        {/*
          The band carries no visible opener (owner decision of 2026-09-14), the third case on the
          site after the landing page's worked figure and the pricing packages. It had a major one
          -- eyebrow, "Who turns up. Six examples." and a lead -- until then, above six cards that
          each already name a person, a discipline and a canton under a hero that has just claimed
          exactly what they show. The heading stays as `sr-only`, so the landmark keeps its name
          and the cards keep an `h2` above their `h3`.

          The band drops its top padding and keeps its bottom one, the same way the pricing
          packages do: the tier's top padding exists to clear the band's own opener, and with no
          opener there is nothing up there to clear. Kept, it stacked with the hero anchor's
          `md:py-40` bottom into 272px of white between the hero's button and the first card, which
          reads as a missing section rather than as room around a control. What separates the
          button from the grid is the hero's own bottom padding, which is already generous.
        */}
        <h2 id="profiles-heading" className="sr-only">
          {t("title")}
        </h2>
        {/*
          KNOWN GAP (owner decision of 2026-09-14): the visible disclosure is gone. It read
          "Example profiles, in the shape a real one takes. The network is being onboarded now."
          and sat here, above the grid.

          What is left is `sr-only`: this band's heading ("Who turns up. Six examples.") and the
          list's own `aria-label`. So a screen reader is still told these are examples and a
          sighted reader is not -- six invented people (`M. Muster`, `A. Beispiel`) are shown with
          years, cantons and standards and nothing on the page says they are illustrations.

          The `note` key stays in both catalogs, unused, so restoring the line is one JSX element
          rather than a copy round trip. Put it back before launch, or when real experts replace
          `PROFILES`, whichever comes first.
        */}
        {/*
          Separate cards rather than the `gap-px border bg-border` hairline grid the standard and
          vetting bands above use. That technique fuses its cells into one ruled block, which is
          right for four facets of a single claim or four steps of one ladder -- the cells are parts
          of a whole there. Six people are not parts of a whole: each is a separate object a reader
          weighs on its own, and fused into a table they read as rows of a directory. This band is
          deliberately the one on the page that does not use the shared grid.
        */}
        {/*
          The filter sits above the grid as a control over the cards rather than one more thing
          stacked in the band, so it carries the air an opener would have had. The spacing rides on
          the control itself and not a wrapper: it renders nothing until it is interactive, and a
          `div` holding the margin would leave an empty band above the grid without JavaScript.
        */}
        <ExpertProfilesFilter
          controls={GRID_ID}
          label={t("filter.label")}
          allLabel={t("filter.all")}
          // Resolved here rather than in the island: the labels are `experts.catalogue` strings,
          // and that namespace does not reach the browser (spec 0004, AC-6). Written out rather
          // than folded from `COMPETENCY_CODES`, because `Object.fromEntries` widens the keys to
          // `string` and the record's type is the thing keeping this in step with the catalogue:
          // a fourth competency should fail to compile here, not ship a chip with no label.
          competencyLabels={{
            compliance: catalogue("competencies.compliance"),
            management_system: catalogue("competencies.management_system"),
            safety_culture: catalogue("competencies.safety_culture"),
          }}
        />
        {/*
          The filter is a client island above a server rendered grid, not a client list. It writes
          the chosen competency to `data-competency` on this `ul`, and the rules below hide the
          cards that do not carry it. All six therefore stay in the prerendered HTML: a visitor
          without JavaScript gets the whole grid and no filter rather than an empty band, and a
          crawler indexes six profiles. Nothing is hidden until the filter mounts and writes an
          attribute, so the server's markup and the first client paint agree.

          One rule per competency rather than one clever selector: CSS cannot express "hide the
          cards whose value differs from the parent's", and three explicit pairs are legible where
          a `:not()` chain would not be. `COMPETENCY_CODES` drives them, so a fourth competency
          adds its rule automatically.
        */}
        <style>
          {COMPETENCY_CODES.map(
            (code) =>
              `#${GRID_ID}[data-competency="${code}"]>li:not([data-competency="${code}"]){display:none}`,
          ).join("")}
        </style>
        <ul
          id={GRID_ID}
          aria-label={t("listLabel")}
          className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3"
        >
          {PROFILES.map((profile) => (
            <li
              key={profile.key}
              // What the filter above matches on. It is the card's own competency code rather than
              // its label, so the rules never depend on a translated string.
              data-competency={profile.competency}
              // The `Card` treatment rather than the primitive itself: this is an `li`, and the
              // component renders its own `div`. Same ring hairline and flat ground, so a card
              // here and a card in the signed in areas are the same object.
              className="flex min-w-0 flex-col gap-5 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10"
            >
              <div className="flex items-center gap-4">
                {/* `ExpertAvatar`, the primitive the expert pages and the gallery already use
                    (spec 0013, AC-6), rather than a monogram of this section's own. An earlier
                    pass drew a solid square here for the weight it gave the card; the gallery
                    shows the avatar is circular and grey, so that square was a second expert mark
                    on the site and the build mandate's first rule is not to invent a control that
                    exists. A real profile swaps the initials for a photo and nothing moves.
                    Larger than the default 12 because this is a marketing card rather than a list
                    row, which the primitive takes as a `className`. */}
                {/* The accent tint, the pill's own `--brand-accent-subtle` on
                    `--brand-accent` -- the pair already in the contrast gate in both themes, so
                    this costs no new token and no new check. Grey initials on a grey circle was
                    the flattest thing on the card, and a portrait would imply a real member. */}
                <ExpertAvatar
                  fullName={t(`${profile.key}.name`)}
                  photoUrl={null}
                  className="size-14 shrink-0 bg-brand-accent-subtle **:data-[slot=avatar-fallback]:bg-transparent **:data-[slot=avatar-fallback]:text-brand-accent"
                />
                {/* The name over the seniority line (owner, 2026-09-14). "22 years, ASA
                    specialist" is who this person is rather than one specification among five, so
                    it reads as the name's subtitle and the block below keeps only the facts a
                    reader compares across cards. The years carry the weight and the tabular
                    figures so they align down the column; the role follows in the quiet colour. */}
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="break-words text-heading-20">{t(`${profile.key}.name`)}</h3>
                  {/* Two lines of room whatever the role's length. "16 years, Fleet and warehouse
                      safety" turns at three across where the other five sit on one line, and one
                      card taller by a line takes its whole grid row with it. Reserved rather than
                      truncated: the role is the half of this line that says what the seniority was
                      in. Two `copy-14` lines at leading 1.5 is 42px. */}
                  <p className="min-h-10.5 text-pretty text-copy-14">
                    <span data-numeric className="font-medium tabular-nums">
                      {t(`${profile.key}.years`)}
                    </span>
                    <span className="text-muted-foreground">
                      <span aria-hidden="true">, </span>
                      {t(`${profile.key}.role`)}
                    </span>
                  </p>
                </div>
              </div>

              {/*
                The specification: four labelled fields under one hairline, the shape the earlier
                card had and the current one lost. It holds what a reader compares across cards --
                sector, canton, standards, languages -- while who the person is (the name and the
                seniority line) stays in the head. `mt-auto` pins the block to the foot, so the
                hairline lands on the same line in all six cards however long the name or the
                discipline above it ran, which is what makes the grid read as comparable rather
                than as six cards of different heights.

                A caps label over its value, rather than a label and value on one baseline. The
                inline shape only works where the value is one short token; "Suva ASA specialists ·
                Labour Act and ordinances" is not, so it wrapped under a right aligned figure and
                the rows stopped lining up. Stacked, every field is two lines whatever it holds.

                `dl` because these are name and value pairs, and a `dt`/`dd` per field rather than
                one long list: each pair is its own group, which is how a screen reader announces
                "Sector, manufacturing" instead of running the four together.
              */}
              {/*
                The `dl` wraps rather than stacking, and every `dt`/`dd` pair is a direct child of
                it in its own `div`. That nesting is load bearing: a `dl` may group a pair in a
                `div`, but the pair has to be that `div`'s own child, and an extra wrapper around
                two of them -- which is how sector and canton first shared a row -- puts the items
                a level too deep and axe fails the card on WCAG 1.3.1 ("Description list item does
                not have a `dl` parent element"). So the row is made here, on the list itself:
                `w-full` on the three full width pairs forces the break, and the two that share a
                line are simply the two that do not carry it.
              */}
              <dl className="mt-auto flex flex-wrap gap-x-5 gap-y-2.5 border-t pt-4">
                {/*
                  An icon in place of the caps label (owner, 2026-09-14). Each field was a label
                  over its value, two lines of which one was a heading the reader does not need
                  spelled out on every card: "Zurich" is obviously a canton and "German, English"
                  obviously languages. The glyph marks the row instead, the value sits beside it,
                  and the block halves in height.

                  The label survives in an `sr-only` `dt`, because an icon cannot name a field for
                  a screen reader and `dl` needs a `dt` per `dd` regardless. So the four rows still
                  announce "Sector, manufacturing" and the glyph is never the only carrier of
                  meaning, which is what rule 3 and the icon rule both ask (docs/design.md).
                */}
                {/*
                  Sector and canton share a row (owner, 2026-09-14). They wrap to two rows rather
                  than splitting the width in half: a 50/50 grid gives each about 14 characters at
                  three across, where "Verarbeitendes Gewerbe" turned and "Baugewerbe" did not, so
                  the German cards came out at three different heights. Wrapping, each field takes
                  the width its own words need and a pair too long for one row drops the canton
                  under the sector in every card at that width rather than in some.

                  The gap between the two fields has to beat the gap inside one, or the row reads
                  as four evenly spaced things rather than two pairs. `gap-x-4` against the fields'
                  own `gap-2` was only 2:1 and the icons' own side bearing narrowed it further, so
                  "Manufacturing" and the pin beside it sat about as far apart as the pin and
                  "Zurich". `gap-x-5` (20px) is 2.5:1, which reads as a grouping. `gap-x-6` reads
                  slightly better still and costs more than it buys: at 24px the German pair no
                  longer fits at two across, so one card in six turned and took its row with it.

                  Whether the pair turns depends on both values: at three across in German
                  "Verarbeitendes Gewerbe · Basel-Stadt" wraps where the same sector with "Zürich"
                  does not, so two cards in a row of three grow by a line at that one width.
                  Reserving a second row for every card fixes it and costs 31px of empty space in
                  all six at every other width -- and does not even square the row, because the
                  standards tags wrap at the same breakpoint anyway. Left to wrap: 1024px is the
                  one width where this grid is not square, and it is square everywhere else.
                */}
                <div className="flex items-start gap-2 text-copy-14">
                  <dt className="sr-only">{t("sectorLabel")}</dt>
                  <Factory
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <dd className="min-w-0 text-pretty">
                    {catalogue(`industries.${profile.industry}`)}
                  </dd>
                </div>

                <div className="flex items-start gap-2 text-copy-14">
                  <dt className="sr-only">{t("cantonLabel")}</dt>
                  <MapPin
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <dd className="min-w-0 text-pretty">{catalogue(`regions.${profile.region}`)}</dd>
                </div>

                {/* No icon on this row, unlike the three around it (owner, 2026-09-14). The other
                    fields are plain text and need a glyph to be found at a glance; the standards
                    are outlined badges, which already mark themselves out as a different kind of
                    thing. A `ShieldCheck` was also the weakest of the four semantically -- these
                    are areas of practice, not verified certifications (owner, 2026-09-14), and a
                    shield with a tick says the opposite. The `sr-only` `dt` still names the row.

                    The tags sit flush left rather than keeping the indent the glyph would have
                    given them (owner, 2026-09-14): the discipline line directly above starts at
                    the block's own left edge, so the pair reads as one group against that edge
                    rather than as a row that lost its icon. */}
                {/*
                  The pair gets its own room, above and below (owner, 2026-09-14). Its two lines
                  sit 6px apart, which is right -- the discipline and its tags are one group -- but
                  the `dl`'s uniform 10px left that group only 4px more separation from the rows
                  either side than its own halves have from each other, so the block read as five
                  evenly spaced lines rather than three fields of which one is a pair. `my-1.5`
                  takes the outer gaps to 16px against the inner 6px, which is the same proximity
                  step the sector and canton fields use on their own row.
                */}
                <div className="my-1.5 flex w-full flex-col items-start gap-1.5">
                  {/*
                    The discipline heads the standards rather than sitting above the hairline
                    (owner, 2026-09-14). What someone does and what they work to are one claim --
                    "Management system" over ISO 45001 and EKAS 6508 reads as a discipline and its
                    evidence, where the line above the rule read as a second headline under the
                    name and left the tags unheaded once the shield went.

                    It is the row's visible `dt` rather than a paragraph above one, because that is
                    what it now is: the term these tags qualify. So the pair announces "Management
                    system, ISO 45001..." and the field needs no `sr-only` label of its own -- the
                    `standardsLabel` key stays in both catalogs for the landing band, which still
                    uses it.

                    It carries `--brand-accent`, the site's one decorative hue. Rule 3 admits the
                    accent in a single role and this band's eyebrow already spends it; what keeps
                    this from being a second role is that the accent is not decorating the card --
                    it marks the one field a client actually picks on, the same job the eyebrow
                    does for a section. Colour is not the carrier: remove it and the line still
                    reads.
                  */}
                  <dt className="text-balance font-medium text-brand-accent text-copy-14">
                    {catalogue(`competencies.${profile.competency}`)}
                  </dt>
                  <dd className="min-w-0">
                    {/*
                      The tag carries the identifier, not the whole label. A safety manager reads
                      "ISO 45001" or "BauAV" at a glance; the parenthetical gloss is for everyone
                      else, and inside a badge it made each tag 40 odd characters, so the block had
                      a different shape in every card. The full label rides in an `sr-only` span
                      with the short name `aria-hidden` beside it: `title` is itself an accessible
                      name and does not defer to hidden text, and `aria-label` on `Badge`'s bare
                      `span` is widely ignored.
                    */}
                    <ul className="flex flex-wrap gap-1.5">
                      {profile.standards.map((standard) => {
                        const label = catalogue(`standards.${standard}`);
                        return (
                          <li key={standard}>
                            <Badge variant="outline" className="font-normal">
                              <span aria-hidden="true">{standardName(label)}</span>
                              <span className="sr-only">{label}</span>
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>

                {/* A site visit happens in the language of the floor, which is why the catalogue
                    carries four while the app serves two. It is the last thing anyone checks, so
                    it closes the block. */}
                <div className="flex w-full items-start gap-2 text-copy-14">
                  <dt className="sr-only">{t("languagesLabel")}</dt>
                  <Languages
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <dd className="min-w-0 text-pretty">
                    {profile.languages
                      .map((language) => catalogue(`languages.${language}`))
                      .join(", ")}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
