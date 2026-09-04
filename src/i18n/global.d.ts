import type messages from "../../messages/de-CH.json";
import type { formats } from "./formats";
import type { routing } from "./routing";

// Typed next-intl (spec 0004, AC-4): an unknown key, namespace, locale or format name fails
// `pnpm typecheck`. `de-CH.json` is the authoritative catalog; the parity test keeps `en-CH.json`
// identical.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
    Formats: typeof formats;
  }
}
