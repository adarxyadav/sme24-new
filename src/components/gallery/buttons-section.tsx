import { DownloadIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const SIZES = ["xs", "sm", "default", "lg"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "success",
  "warning",
  "info",
  "destructive",
] as const;
const LEVELS = ["critical", "high", "medium", "low"] as const;

/** Every button variant and size, the icon forms, and every badge variant (AC-6). Server. */
export function ButtonsSection() {
  const t = useTranslations("gallery.buttons");
  return (
    <div className="flex flex-col gap-12">
      <Example label={t("variants")}>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {t(`variant.${variant}`)}
          </Button>
        ))}
        <Button disabled>{t("disabled")}</Button>
      </Example>
      <Example label={t("sizes")}>
        {SIZES.map((size) => (
          <Button key={size} size={size} variant="outline">
            {t(`size.${size}`)}
          </Button>
        ))}
      </Example>
      <Example label={t("withIcon")}>
        <Button>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          {t("create")}
        </Button>
        <Button variant="outline">
          {t("export")}
          <DownloadIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("settings")}>
          <SettingsIcon aria-hidden="true" />
        </Button>
      </Example>
      <Example label={t("badges")}>
        {BADGE_VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant}>
            {t(`badge.${variant}`)}
          </Badge>
        ))}
      </Example>
      <Example label={t("levels")}>
        {LEVELS.map((level) => (
          <Badge key={level} variant={level}>
            {t(`badge.${level}`)}
          </Badge>
        ))}
      </Example>
    </div>
  );
}
