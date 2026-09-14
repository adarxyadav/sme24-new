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
            <li key={profile.key} className="flex flex-col gap-5 bg-background px-6 py-8">
              <div className="flex items-center gap-3">
                {/* No photo: these are examples, so the avatar falls back to its initials rather
                    than inventing a face for a person who does not exist. */}
                <ExpertAvatar fullName={t(`${profile.key}.name`)} photoUrl={null} />
                <div className="flex min-w-0 flex-col">
                  <p className="truncate font-semibold text-base">{t(`${profile.key}.name`)}</p>
                  {/* Sector and canton on one line: together they are the answer to "would this
                      person know my plant", which is one thought rather than two facts. */}
                  <p className="truncate text-muted-foreground text-sm">
                    {catalogue(`industries.${profile.industry}`)} ·{" "}
                    {catalogue(`regions.${profile.region}`)}
                  </p>
                </div>
              </div>

              {/*
                The competency is the card's spoken claim and takes a full line of its own, because
                it is the one field that says what this person is brought in to do. The reference
                this section was drawn from gave every field an identical pill, which at our flat
                square badge styling turns a card into a wall of grey rectangles and flattens the
                one line a client actually chooses on.
              */}
              <p className="font-semibold text-sm">
                {catalogue(`competencies.${profile.competency}`)}
              </p>

              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="eyebrow text-muted-foreground">{t("experienceLabel")}</dt>
                  <dd>{t(`${profile.key}.experience`)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="eyebrow text-muted-foreground">{t("standardsLabel")}</dt>
                  {/* The standards as their catalogue labels, so a card cannot name one the
                      product does not carry. Not mono, though a standard number looks like an
                      identifier: the catalogue labels are full descriptive names ("ISO 45001
                      (occupational health and safety)"), so at the mono scale two of them wrapped
                      to two lines and became the heaviest thing on the card, outweighing the
                      competency line that is meant to carry it. */}
                  <dd className="text-pretty text-muted-foreground">
                    {profile.standards
                      .map((standard) => catalogue(`standards.${standard}`))
                      .join(" · ")}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="eyebrow text-muted-foreground">{t("languagesLabel")}</dt>
                  {/* Last because it is the last question a client asks, and the one a site visit
                      makes concrete: the visit happens in the language of the floor, which is why
                      the catalogue carries four and the app only serves two. */}
                  <dd className="text-pretty">
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
