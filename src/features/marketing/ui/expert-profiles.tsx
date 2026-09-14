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
        <ul
          aria-label={t("listLabel")}
          className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {PROFILES.map((profile) => (
            <li key={profile.key} className="flex min-w-0 flex-col bg-background p-6">
              <div className="flex items-start gap-4">
                {/* `ExpertAvatar`, the primitive the expert pages and the gallery already use
                    (spec 0013, AC-6), rather than a monogram of this section's own. An earlier
                    pass drew a solid square here for the weight it gave the card; the gallery
                    shows the avatar is circular and grey, so that square was a second expert mark
                    on the site and the build mandate's first rule is not to invent a control that
                    exists. A real profile swaps the initials for a photo and nothing moves.
                    Larger than the default 12 because this is a marketing card rather than a list
                    row, which the primitive takes as a `className`. */}
                <ExpertAvatar
                  fullName={t(`${profile.key}.name`)}
                  photoUrl={null}
                  className="size-14 shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="break-words text-heading-20">{t(`${profile.key}.name`)}</h3>
                  <p className="mt-1 text-pretty text-copy-14 text-muted-foreground">
                    {t(`${profile.key}.role`)}
                  </p>
                </div>
              </div>

              <p className="mt-6 text-balance text-heading-24">
                {catalogue(`competencies.${profile.competency}`)}
              </p>
              <p className="mt-2 text-pretty text-copy-13 text-muted-foreground">
                {catalogue(`industries.${profile.industry}`)}
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                {catalogue(`regions.${profile.region}`)}
              </p>

              {/* Experience stays legible at reading size, outside the decorative monogram. */}
              <dl className="mt-6 flex items-baseline justify-between gap-4 border-t pt-4">
                <dt className="text-copy-13 text-muted-foreground">{t("experienceLabel")}</dt>
                <dd data-numeric className="text-label-18">
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
              <p className="mt-auto pt-5 text-pretty text-copy-13 text-muted-foreground">
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
