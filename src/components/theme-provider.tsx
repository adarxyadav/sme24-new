"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme root (spec 0003): `class` attribute on `html`, system default, no transition flash. Its
 * inline script writes the class before first paint. Runs in the browser; children stay server
 * rendered because they arrive as a prop. Used once in `src/app/[locale]/layout.tsx`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
