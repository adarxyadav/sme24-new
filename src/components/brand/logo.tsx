import { useTranslations } from "next-intl";
import { BrandMark, type BrandMarkVariant } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

export type LogoProps = {
  /** `bare` is the primary lockup, `badge` the alternate (brand guidelines, section 02). */
  readonly variant?: Extract<BrandMarkVariant, "bare" | "badge">;
  /** Sets the wordmark size; the mark and the gap scale with it in `em`. */
  readonly size?: "sm" | "md" | "lg";
  /** Adds the tracked "EHS Consulting" descriptor under the wordmark. */
  readonly descriptor?: boolean;
  readonly className?: string;
};

const SIZE = { sm: "text-base", md: "text-2xl", lg: "text-4xl" } as const;

/**
 * The lockup: mark beside the wordmark, in the brand proportions (mark height 1.6 × the cap
 * height, gap 0.5 × the mark width, 0.35 × for the badge). The wordmark is real text, so the
 * lockup is the accessible name and the mark stays decorative. Server or browser.
 */
export function Logo({ variant = "bare", size = "sm", descriptor = false, className }: LogoProps) {
  const t = useTranslations();
  const badge = variant === "badge";

  return (
    <span
      data-slot="logo"
      className={cn(
        "inline-flex shrink-0 items-center leading-none",
        badge ? "gap-[0.4em]" : "gap-[0.45em]",
        SIZE[size],
        className,
      )}
    >
      <BrandMark variant={variant} className={badge ? "size-[1.5em]" : "h-[1.15em]"} />
      <span className="flex flex-col gap-[0.12em]">
        <span className="font-extrabold tracking-display">{t("common.appName")}</span>
        {descriptor ? (
          <span className="font-medium text-[0.36em] uppercase leading-none tracking-lockup">
            {t("brand.descriptor")}
          </span>
        ) : null}
      </span>
    </span>
  );
}
