import { ClockIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ProgressList } from "@/components/ui/progress-list";
import { RUN_LIMIT_PER_DAY, RUN_STEPS } from "@/features/research/catalogue";
import { cn } from "@/lib/utils";

/** The company name shown in the still. Illustrative, never a customer. */
const EXAMPLE_COMPANY = "Muster AG";

/**
 * The landing hero's object: a still of the client area's first screen, drawn from that screen's
 * own `Card`, `Field`, `Input` and `ProgressList` and its own `research.lookup.*` strings, so the
 * page shows the product rather than describing it and the picture cannot drift from the screen
 * it pictures.
 *
 * The whole block is `inert`, so nothing inside it takes focus, answers a click or reaches the
 * tab order, and it is hidden from assistive tech behind one `img` role whose `aria-label` says
 * what it is a picture of. A visitor must never mistake it for the live form; the hero's real
 * lookup field sits above it.
 */
export function HeroResearch({ className }: { readonly className?: string }) {
  const t = useTranslations("research");
  const m = useTranslations("marketing.landing.research");

  return (
    <div
      // `inert` removes the subtree from focus, hit testing and the accessibility tree; the
      // wrapper then re-announces the whole thing as the single image it is.
      inert
      role="img"
      aria-label={m("label")}
      className={cn("grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]", className)}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("lookup.title")}</CardTitle>
          <CardDescription>{t("lookup.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <FieldGroup>
              <Field>
                <FieldLabel>{t("lookup.name")}</FieldLabel>
                {/* `readOnly` and not `disabled`: the still should show the field at its resting
                    contrast, the way the real one looks before it is touched. */}
                <Input readOnly tabIndex={-1} value={EXAMPLE_COMPANY} />
              </Field>
              <Field>
                <FieldLabel>{t("lookup.website")}</FieldLabel>
                <Input
                  readOnly
                  tabIndex={-1}
                  value=""
                  placeholder={t("lookup.websitePlaceholder")}
                />
                <FieldDescription>{t("lookup.websiteHint")}</FieldDescription>
              </Field>
            </FieldGroup>
            <Button size="lg" tabIndex={-1}>
              {t("lookup.submit")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-6 rounded-lg border p-6">
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-lg">{t("lookup.nextTitle")}</p>
          <p className="max-w-prose text-muted-foreground text-sm">{t("lookup.nextBody")}</p>
        </div>
        <ProgressList
          items={RUN_STEPS.map((step) => ({
            id: step,
            label: t(`steps.${step}`),
            state: "pending" as const,
          }))}
        />
        <ul className="flex flex-col gap-2 text-muted-foreground text-sm">
          <li className="flex items-center gap-2">
            <ClockIcon className="size-4 shrink-0" aria-hidden="true" />
            {t("lookup.durationNote")}
          </li>
          <li className="flex items-center gap-2">
            <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
            {t("lookup.quotaNote", { limit: RUN_LIMIT_PER_DAY })}
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
            {t("lookup.trustNote")}
          </li>
        </ul>
      </section>
    </div>
  );
}
