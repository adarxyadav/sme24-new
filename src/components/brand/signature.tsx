import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

/**
 * The campaign sign-off: the circled badge beside "SME24. Einfach. Anders." (de) or
 * "SME24. Just. Different." (en). Closes marketing pages and campaign blocks. Server or browser.
 */
export function Signature({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span
      data-slot="signature"
      className={cn("inline-flex items-center gap-2.5 text-sm leading-none", className)}
    >
      <BrandMark variant="badge" className="size-9" />
      <span>
        <span className="font-bold">{t("common.appName")}.</span> {t("brand.signature")}
      </span>
    </span>
  );
}
