"use client";

import { CoinsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDirectoryBalance } from "./directory-context";

/**
 * The credit balance in the page header (spec 0018, AC-5), read from the shared directory state
 * so an unlock in the table moves it at once. Browser.
 */
export function BalanceBadge() {
  const t = useTranslations("directory.header");
  const { balance } = useDirectoryBalance();
  return (
    <span
      className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm tabular-nums"
      data-testid="directory-balance"
      aria-live="polite"
    >
      <CoinsIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      {t("balance", { count: balance })}
    </span>
  );
}
