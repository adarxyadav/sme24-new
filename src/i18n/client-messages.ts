import type { Messages } from "next-intl";

/**
 * The namespaces every client component may read (spec 0004, AC-6): the shell, the primitives,
 * the states, the theme and the brand. Everything else is a feature namespace that a page hands
 * to its client children through a nested provider built with `clientMessages`.
 */
export const SHARED_NAMESPACES = [
  "common",
  "ui",
  "states",
  "theme",
  "shell",
  "nav",
  "brand",
  "metadata",
] as const;

export type SharedNamespace = (typeof SHARED_NAMESPACES)[number];

/**
 * Picks the shared namespaces plus `extra` from the full catalog, for `NextIntlClientProvider`.
 * A nested provider replaces, not merges, the parent's messages, which is why the shared set is
 * always included. Server components, which keep calling `getTranslations` with the full catalog.
 */
export function clientMessages<Extra extends keyof Messages = never>(
  messages: Messages,
  extra: readonly Extra[] = [],
): Pick<Messages, SharedNamespace | Extra> {
  const namespaces: ReadonlyArray<SharedNamespace | Extra> = [...SHARED_NAMESPACES, ...extra];
  return Object.fromEntries(
    namespaces.map((namespace) => [namespace, messages[namespace]]),
  ) as Pick<Messages, SharedNamespace | Extra>;
}
