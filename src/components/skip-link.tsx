import { useTranslations } from "next-intl";

/**
 * First focusable element on every page: jumps keyboard and screen reader users to `#main`.
 * Visible only while focused. Server component; used by the area shell and the marketing layout.
 */
export function SkipLink() {
  const t = useTranslations("shell");
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {t("skipToContent")}
    </a>
  );
}
