import { useTranslations } from "next-intl";
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
        <p className="-mt-6 max-w-prose text-muted-foreground text-sm">{t("note")}</p>
        <ul
          aria-label={t("listLabel")}
          className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {PROFILES.map((profile) => (
            <li key={profile.key} className="flex flex-col gap-6 bg-background px-6 py-8">
              {/*
                Identity sits at the top at label scale, deliberately quieter than the figure below
                it. These are examples, so the name is the least informative thing on the card --
                what a reader is actually weighing is the experience, the discipline and the
                sector. A real profile swaps the initials for a photo and nothing else moves.
              */}
              <div className="flex items-center gap-3">
                <ExpertAvatar
                  fullName={t(`${profile.key}.name`)}
                  photoUrl={null}
                  className="size-9"
                />
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-label-14">{t(`${profile.key}.name`)}</p>
                  {/* Sector and canton on one line: together they answer "would this person know
                      my plant", which is one thought rather than two facts. */}
                  <p className="truncate text-label-13 text-muted-foreground">
                    {catalogue(`industries.${profile.industry}`)} ·{" "}
                    {catalogue(`regions.${profile.region}`)}
                  </p>
                </div>
              </div>

              {/*
                The years lead the card. The page's whole argument is "fifteen years, minimum", so
                the figure is what a reader scans this grid for, and it was previously set at body
                size inside a run-on sentence ("22 years, ASA specialist") under an EXPERIENCE
                label that carried more visual weight than it did. Split out at heading scale with
                `data-numeric`, it becomes the card's entry point and the role beneath it reads as
                the qualifier it is.
              */}
              <div className="flex flex-col gap-1">
                <p data-numeric className="text-heading-32">
                  {t(`${profile.key}.years`)}
                </p>
                <p className="text-copy-14 text-muted-foreground">{t(`${profile.key}.role`)}</p>
              </div>

              {/*
                The competency: what this person is brought in to do, and the line a client chooses
                on. It sits directly under the figure because together they are the claim -- this
                many years, of this -- and above the hairline because everything below is
                reference.
              */}
              {/* `mb-auto` pushes the slack above the foot rather than below the competency, so
                  the rule lands on one line across all six cards however many lines the standards
                  below it run to. Without it the foot floated directly after the claim and the
                  hairline sat at a different height in every card, which across a grid built from
                  hairlines reads as misalignment. */}
              <p className="mb-auto text-heading-16">
                {catalogue(`competencies.${profile.competency}`)}
              </p>

              {/*
                The foot: the same hairline the grid is built from, separating the claim above from
                the reference below. Standards keep their label because a list of certifications
                needs naming; experience and languages lost theirs, because "22 years" and
                "German · English" already say what they are and three identical caps eyebrows per
                card made the grid read as eighteen repetitions of one form row.
              */}
              <dl className="flex flex-col gap-3 border-t pt-5 text-copy-13">
                <div className="flex flex-col gap-1">
                  <dt className="eyebrow text-muted-foreground">{t("standardsLabel")}</dt>
                  {/* The standards as their catalogue labels, so a card cannot name one the
                      product does not carry. Not mono, though a standard number looks like an
                      identifier: the catalogue labels are full descriptive names ("ISO 45001
                      (occupational health and safety)"), so at the mono scale two of them wrapped
                      to two lines and became the heaviest thing on the card. */}
                  {/* Two lines reserved whether the text fills them or not. The catalogue labels
                      are full descriptive names of uneven length, so this line runs to one line in
                      some cards and two in others; left to flow, the foot's hairline landed 20px
                      higher on the short ones and the rules did not line up across a row. A
                      `min-h` of two lines is the cheapest fix that keeps every card's rule on one
                      level without truncating a standard's name. */}
                  <dd className="min-h-[2lh] text-pretty text-muted-foreground">
                    {profile.standards
                      .map((standard) => catalogue(`standards.${standard}`))
                      .join(" · ")}
                  </dd>
                </div>
                {/* Languages carry no label: the values name themselves, and a site visit happens
                    in the language of the floor, which is why the catalogue holds four while the
                    app serves two. `sr-only` keeps the pair valid and the meaning announced. */}
                <div className="flex flex-col gap-1">
                  <dt className="sr-only">{t("languagesLabel")}</dt>
                  <dd className="text-pretty text-muted-foreground">
                    {profile.languages
                      .map((language) => catalogue(`languages.${language}`))
                      .join(" · ")}
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
