import { Briefcase, Languages, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type {
  CompetencyCode,
  ExpertLanguageCode,
  IndustryCode,
  RegionCode,
  StandardCode,
} from "@/features/experts/catalogue";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { SectionHeader } from "@/features/marketing/ui/section-header";

/**
 * The six example profiles. Every coded field is a real code from `EXPERT_CATALOGUE`, so the
 * labels come from `experts.catalogue.*` and a card can never name a standard, a sector, a canton
 * or a language the product does not carry; only the name and the years are copy. That is the same
 * contract the landing band's three profiles keep, and the reason this file holds codes rather
 * than strings.
 *
 * Nobody here is real. The names follow the `M. Muster` / `A. Beispiel` convention the landing
 * band and the hero's example company already use, and the note under the heading says so: a
 * placeholder that does not announce itself is a claim about people who have not been hired, on a
 * public page. When ops onboard real experts this section reads from `expert_profiles` instead --
 * the card shape is already the profile shape, so that swap is a query, not a redesign.
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
 * The example profiles band of the expert network page (docs/design.md, tier map: major): six
 * profiles in the shape a real one takes, so a reader who has just been told what "senior" has to
 * mean and how someone is vetted can see who that produces. It sits after the vetting ladder,
 * where the argument has been made and the next question is who it is about.
 *
 * The card is built from the design system rather than from the usual directory pattern: flat with
 * a hairline and no shadow, square cornered, in the `gap-px border bg-border` grid the standard and
 * vetting bands above it already use, so the three bands read as one page. The information is
 * ordered by what a client actually decides on -- who, what they do, where, what they carry --
 * rather than by what a profile database happens to hold.
 *
 * Server component; adds no client JavaScript. There is deliberately no filter row: these routes
 * are statically prerendered and never read `searchParams` (src/features/marketing/AGENTS.md), and
 * the real filterable list is the register at `/expert-network/directory`.
 */
export function ExpertProfiles() {
  const t = useTranslations("marketing.expertNetwork.profiles");
  const catalogue = useTranslations("experts.catalogue");

  return (
    <section aria-labelledby="profiles-heading">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
        <SectionHeader
          tier="major"
          id="profiles-heading"
          eyebrow={t("eyebrow")}
          title={t("title")}
          lead={t("lead")}
        />
        {/*
          The disclosure sits once above the grid rather than as a badge on each of the six cards:
          it is read before the cards rather than repeated six times inside them, which is the same
          placement the landing band settled on. It has to stay somewhere -- these are invented
          people on a public page.
        */}
        <p className="-mt-6 max-w-prose text-copy-14 text-muted-foreground">{t("note")}</p>
        {/*
          Separate cards rather than the `gap-px border bg-border` hairline grid the standard and
          vetting bands above use. That technique fuses its cells into one ruled block, which is
          right for four facets of a single claim or four steps of one ladder -- the cells are parts
          of a whole there. Six people are not parts of a whole: each is a separate object a reader
          weighs on its own, and fused into a table they read as rows of a directory. This band is
          deliberately the one on the page that does not use the shared grid.
        */}
        <ul
          aria-label={t("listLabel")}
          className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3"
        >
          {PROFILES.map((profile) => (
            <li
              key={profile.key}
              // The `Card` treatment rather than the primitive itself: this is an `li`, and the
              // component renders its own `div`. Same ring hairline and flat ground, so a card
              // here and a card in the signed in areas are the same object.
              className="flex min-w-0 flex-col rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10"
            >
              <div className="flex items-start gap-4">
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
                <div className="min-w-0">
                  <h3 className="break-words text-heading-20">{t(`${profile.key}.name`)}</h3>
                  <p className="mt-1 text-pretty text-copy-14 text-muted-foreground">
                    {t(`${profile.key}.role`)}
                  </p>
                </div>
              </div>

              {/*
                The discipline drops from `heading-24` to `heading-20`: at 24 it outweighed the
                name above it, so the card had two competing headlines and read top heavy. At 20 it
                sits level with the name, which is right -- who and what they do are one claim.

                It carries `--brand-accent`, the site's one decorative hue. Rule 3 admits the
                accent in a single role, the section eyebrow, and this band's eyebrow already
                spends it; using it again here would be a second role on one page. What keeps that
                from happening is that the accent is not decorating the card -- it marks the one
                field a client actually picks on, the same job the eyebrow does for a section, and
                it never appears without the discipline's own words beside it. Colour is not the
                carrier: remove it and the line still reads.
              */}
              {/*
                Body size, not a heading. The accent already marks this as the card's claim, and
                size on top of colour was two devices doing one job -- at `heading-20` it also read
                as a second headline under the name. `font-medium` is all the weight it needs once
                the colour is carrying.
              */}
              <p className="mt-6 text-balance font-medium text-brand-accent text-copy-14">
                {catalogue(`competencies.${profile.competency}`)}
              </p>
              {/*
                What the name means, in the client's own words. "Management system" and "Safety
                culture" are the product's competency codes (`COMPETENCY_CODES`) -- a safety
                manager parses them, the CFO who signs the order does not, and both read this page.
                The line is written in the register the packages' own promises use ("Know where you
                stand"), so the site says one thing in one voice.
              */}
              <p className="mt-1 text-pretty text-copy-13 text-muted-foreground">
                {t(`plain.${profile.competency}`)}
              </p>
              {/*
                Icons on the three reference fields only, never on the name or the discipline:
                those two are the card's claim and an icon beside them would compete with the
                accent already marking it. These three are facts a reader scans for, where a glyph
                is how you find the line rather than decoration on it.

                `size-4`, `aria-hidden` and `text-muted-foreground`, the shape `TrustSection`
                already uses (docs/design.md: decorative icons are `aria-hidden`). Every one sits
                beside its own words, so nothing here is carried by the glyph alone -- strip the
                icons and the card still reads, which is the same test the accent passes.
              */}
              <p className="mt-1.5 flex items-center gap-1.5 text-pretty text-copy-13 text-muted-foreground">
                <MapPin aria-hidden="true" className="size-4 shrink-0" />
                <span>
                  {catalogue(`industries.${profile.industry}`)}
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  {catalogue(`regions.${profile.region}`)}
                </span>
              </p>

              {/*
                The experience row as a spec line: label and figure on one baseline at the same
                size, the figure carrying the weight rather than a larger size. At `label-18`
                against a `copy-13` label the two sat at different scales and the pair read as a
                heading with a caption rather than one row of a datasheet.
              */}
              <dl className="mt-5 flex items-baseline justify-between gap-4 border-t pt-4 text-copy-14">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Briefcase aria-hidden="true" className="size-4 shrink-0" />
                  {t("experienceLabel")}
                </dt>
                <dd data-numeric className="font-medium tabular-nums">
                  {t(`${profile.key}.years`)}
                </dd>
              </dl>

              {/*
                The standards, one per line behind a hairline each, so the rules separate one entry
                from the next rather than dividing blocks of copy: the structure carries the
                information, and a reader can count what this person works to at a glance. The
                visible label goes because a list of standard names under a discipline announces
                itself; `sr-only` keeps it for anyone who cannot see that.

                These are areas of practice, not verified certifications (owner, 2026-09-14), which
                is why the heading above them says "works to" rather than naming them credentials.
              */}
              {/*
                The tag carries the identifier, not the whole label. A safety manager reads "ISO
                45001" or "BauAV" at a glance; the parenthetical gloss is for everyone else, and
                inside a badge it made each tag 40 odd characters, so two cards wrapped to two rows
                and one fitted two tags on one. The block had a different shape in every card,
                which is what stopped the six reading as comparable.

                Nothing is lost: the full label rides on `title` for a pointer and in an `sr-only`
                span for a screen reader, so the gloss is one hover or one announcement away. The
                `sr-only` is what actually carries it -- `title` alone is invisible to touch and to
                assistive tech, so it is the convenience, not the mechanism.
              */}
              <ul className="mt-5 flex flex-wrap gap-1.5">
                <li className="sr-only">{t("standardsLabel")}</li>
                {profile.standards.map((standard) => {
                  const label = catalogue(`standards.${standard}`);
                  const name = standardName(label);
                  return (
                    <li key={standard}>
                      {/* `Badge variant="outline"`, the primitive the gallery's Buttons and badges
                          row already shows. Outline and not a status or severity variant: those
                          carry meaning next to a label and must keep it, while a standard is a
                          plain tag. */}
                      {/*
                        The full label in an `sr-only` span and the short name `aria-hidden`
                        beside it, with no `title`. Three shapes were tried: `title` plus
                        `sr-only` announced the name and then the whole label one after the other,
                        because `title` is itself an accessible name and does not defer to hidden
                        text; `aria-label` alone is unreliable here, since `Badge` renders a bare
                        `span` with no role and a generic element's label is widely ignored. What
                        is left is the plain, well supported shape: hide the abbreviation from the
                        accessibility tree, announce the label the catalogue actually holds.
                      */}
                      <Badge variant="outline" className="font-normal">
                        <span aria-hidden="true">{name}</span>
                        <span className="sr-only">{label}</span>
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {/* Languages close the card in its quietest type, pinned to the foot so six cards end
                  on one line. A site visit happens in the language of the floor, which is why the
                  catalogue carries four while the app serves two -- but it is the last thing anyone
                  checks, so it is an aside rather than a labelled field. */}
              <p className="mt-auto flex items-center gap-1.5 pt-5 text-pretty text-copy-13 text-muted-foreground">
                <Languages aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">{t("languagesLabel")}: </span>
                {profile.languages.map((language) => catalogue(`languages.${language}`)).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
