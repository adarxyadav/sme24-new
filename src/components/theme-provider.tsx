"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useSyncExternalStore } from "react";

// A `[locale]` switch remounts the root layout on the client, so next-themes creates its no-flash
// script again; React neuters client created scripts and warns unless the type is a data block.
// The class is already on `html` by then, so the remounted script only needs to be inert.
const INERT_SCRIPT = { type: "text/plain" } as const;
const subscribeNever = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * Theme root (spec 0003): `class` attribute on `html`, system default, no transition flash. Its
 * inline script writes the class before first paint. Runs in the browser; children stay server
 * rendered because they arrive as a prop. Used once in `src/app/[locale]/layout.tsx`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // False while hydrating the server HTML (the script must stay executable there), true afterwards.
  const mountedOnClient = useSyncExternalStore(subscribeNever, clientSnapshot, serverSnapshot);
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={mountedOnClient ? INERT_SCRIPT : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
