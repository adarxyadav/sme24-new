import { ClockIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProgressList } from "@/components/ui/progress-list";
import { FactsCard } from "@/features/marketing/ui/facts-card";
import { RUN_LIMIT_PER_DAY, RUN_STEPS } from "@/features/research/catalogue";
import { cn } from "@/lib/utils";

/**
 * The step the still is caught on: two searches done, the extraction running. The third of five,
 * so the picture reads as a run underway rather than one about to start or about to finish.
 */
const RUNNING_INDEX = 2;

/**
 * The landing hero's object: a still of the client area -- the `FactsCard` beside the panel that
 * says what a research run does, both drawn from the product's own components and its own strings,
 * so the page shows the product rather than describing it and the picture cannot drift from the
 * screens it pictures.

 * The card was the `LookupCard` until 2026-09-10 (owner decision). That still pictured the same
 * screen the hero's own live lookup field already is, so the hero asked for a company name twice,
 * once for real and once in a photograph. The facts card pictures what happens after the name is
 * in: the reader corrects what the research found. The lookup card is still the steps section's
 * first step, where it illustrates that step rather than doubling a live control.
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
      <FactsCard />

      <section className="flex flex-col gap-6 rounded-lg border p-6">
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-lg">{t("lookup.nextTitle")}</p>
          <p className="max-w-prose text-muted-foreground text-sm">{t("lookup.nextBody")}</p>
        </div>
        {/*
          Caught mid run rather than all pending: a list of five identical empty rings pictures a
          run that has not started, which is the one moment of this screen that shows nothing
          happening. Two done, one spinning and the rest waiting is what the reader would actually
          see, and it is the gallery's own `running` state (`/admin/design`) rather than a shape
          invented here. The index is fixed, so the still never animates through the sequence --
          only the current ring spins, and `ProgressList` already drops that under reduced motion.
        */}
        <ProgressList
          items={RUN_STEPS.map((step, index) => ({
            id: step,
            label: t(`steps.${step}`),
            state: index < RUNNING_INDEX ? "done" : index === RUNNING_INDEX ? "current" : "pending",
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
