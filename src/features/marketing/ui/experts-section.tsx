import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import type { IndustryCode, StandardCode } from "@/features/experts/catalogue";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { Link } from "@/i18n/navigation";

/**
 * The example profiles. Every coded field is a real code from `EXPERT_CATALOGUE`, so the labels
 * come from `experts.catalogue.*` and a card can never name a standard or a sector the product
 * does not have; only the name, the years and the region are copy.
 *
 * They are illustrations of the network's shape, not members of it -- the note under the section
 * heading says so, because a placeholder that does not announce itself is a claim about people who
 * have not been hired. The names follow the `Muster AG` convention the hero still already uses for
 * its example company.
 */
const PROFILES = [
  {
    key: "manufacturing",
    industry: "C",
    standards: ["ekas_6508", "iso_45001"],
  },
  {
    key: "construction",
    industry: "F",
    standards: ["suva_asa", "arg_argv"],
  },
  {
    key: "chemical",
    industry: "C",
    standards: ["iso_45001", "iso_14001"],
  },
] as const satisfies readonly {
  readonly key: string;
  readonly industry: IndustryCode;
  readonly standards: readonly StandardCode[];
}[];

/**
 * The expert band of the landing page (docs/design.md, tier map: major): three example profiles in
 * the shape a real one takes, so the reader can see who turns up rather than only being told they
 * are senior. It sits after the packages, where the reader has just seen what a visit costs and
 * the next question is who is coming.
 *
 * Nobody here is real, and the page never implies otherwise: one note under the heading says so
 * for all three. The moment ops onboard real experts this section reads from `expert_profiles`
 * instead and the note goes -- the card shape is already the profile shape, so that swap is a
 * query, not a redesign. Server component; adds no client JavaScript.
 */
export function ExpertsSection() {
  const t = useTranslations("marketing.landing.experts");
  const catalogue = useTranslations("experts.catalogue");

  return (
    <section aria-labelledby="experts-heading">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
        <SectionHeader
          tier="major"
          id="experts-heading"
          eyebrow={t("eyebrow")}
          title={t("title")}
          emphasis={{ leadSentences: 1 }}
          // A step under the tier's display scale: this heading carries its own lead in the muted
          // colour, so at `display` the two sentences run to three lines of display type over the
          // cards they introduce and the section opens heavier than the packages above it.
          className="**:data-[slot=statement]:text-2xl **:data-[slot=statement]:leading-tight **:data-[slot=statement]:md:text-3xl"
        />
        {/*
          The cards carry a real call to action rather than a badge marking each one a placeholder
          (owner decision, 2026-09-10), so the disclosure moves here: one line under the heading,
          where it is read once before the three cards rather than repeated three times inside
          them. It has to stay somewhere -- these are invented people on a public page.
        */}
        <p className="-mt-6 max-w-prose text-muted-foreground text-sm">{t("note")}</p>
        <ul aria-label={t("listLabel")} className="grid gap-4 md:grid-cols-3">
          {PROFILES.map((profile) => (
            <li key={profile.key}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-5">
                  <div className="flex items-center gap-3">
                    {/* No photo: these are examples, so the avatar falls back to its initials
                        rather than inventing a face for a person who does not exist. */}
                    <ExpertAvatar fullName={t(`profiles.${profile.key}.name`)} photoUrl={null} />
                    <div className="flex min-w-0 flex-col">
                      <p className="truncate font-semibold">{t(`profiles.${profile.key}.name`)}</p>
                      <p className="truncate text-muted-foreground text-sm">
                        {catalogue(`industries.${profile.industry}`)}
                      </p>
                    </div>
                  </div>
                  <dl className="flex flex-col gap-3 text-sm">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground text-xs">{t("experienceLabel")}</dt>
                      <dd>{t(`profiles.${profile.key}.experience`)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground text-xs">{t("standardsLabel")}</dt>
                      {/* The standards as their catalogue labels, so the card cannot name one the
                          product does not carry. */}
                      <dd className="text-pretty">
                        {profile.standards
                          .map((standard) => catalogue(`standards.${standard}`))
                          .join(" · ")}
                      </dd>
                    </div>
                  </dl>
                  {/* Pushed to the card's foot, so the link sits in the same place on all three
                      however long the standards above it run. It goes to the network page rather
                      than to a profile of its own: there is no per expert page, and a card that
                      pictures an example must not promise one. */}
                  <Link
                    href="/expert-network"
                    className="mt-auto w-fit font-medium text-sm underline underline-offset-4 hover:text-foreground"
                  >
                    {t("viewProfile")}
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
