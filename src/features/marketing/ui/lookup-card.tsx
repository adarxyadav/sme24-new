import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The company name shown in the still. Illustrative, never a customer. */
const EXAMPLE_COMPANY = "Muster AG";

/**
 * A still of the client area's lookup card, drawn from that screen's own `Card`, `Field`, `Input`
 * and `Button` and its own `research.lookup.*` strings, so the page shows the product rather than
 * describing it and the picture cannot drift from the screen it pictures.
 *
 * It is the picture only, and it neither hides itself from assistive tech nor leaves the tab
 * order: both belong to whatever frames it, because only the caller knows what the whole picture
 * is of. The hero object wraps it with the panel beside it under one `img` role; the steps
 * section wraps it alone under the step's own. Rendering it bare would put three focusable
 * controls and an unlabelled form into the page.
 */
export function LookupCard({ className }: { readonly className?: string }) {
  const t = useTranslations("research");

  return (
    <Card className={cn(className)}>
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
              <Input readOnly tabIndex={-1} value="" placeholder={t("lookup.websitePlaceholder")} />
              <FieldDescription>{t("lookup.websiteHint")}</FieldDescription>
            </Field>
          </FieldGroup>
          <Button size="lg" tabIndex={-1}>
            {t("lookup.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
