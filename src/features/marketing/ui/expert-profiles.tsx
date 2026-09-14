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
              <p className="mt-6 text-balance text-brand-accent text-heading-20">
                {catalogue(`competencies.${profile.competency}`)}
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
              <ul className="mt-5 flex flex-wrap gap-1.5">
                <li className="sr-only">{t("standardsLabel")}</li>
                {profile.standards.map((standard) => (
                  <li key={standard}>
                    {/* `Badge variant="outline"`, the primitive the gallery's Buttons and badges
                        row already shows, rather than hairline rows of this section's own. Outline
                        and not a status or severity variant: those carry meaning next to a label
                        and must keep it, while a standard is a plain tag. The badge is square at
                        the 0.125rem radius like everything else, so a row of them reads as tags on
                        a document rather than pills. */}
                    <Badge variant="outline" className="text-pretty font-normal">
                      {catalogue(`standards.${standard}`)}
                    </Badge>
                  </li>
                ))}
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
