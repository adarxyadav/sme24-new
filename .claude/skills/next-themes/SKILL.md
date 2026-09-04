---
name: next-themes
description: >-
  Add, configure, debug, or refactor theme switching with the `next-themes`
  package in React and Next.js apps. Trigger WHENEVER the user installs or
  imports `next-themes`; uses `ThemeProvider`, `useTheme`, `setTheme`,
  `resolvedTheme`, `forcedTheme`, `systemTheme`, `attribute`, `themes`,
  `defaultTheme`, `enableSystem`, `disableTransitionOnChange`, `storageKey`,
  `value`, `nonce`, or `scriptProps`; implements dark mode, light mode, system
  theme preference, Tailwind dark mode, CSS variables, data/class theme
  selectors, page-specific forced themes, hydration-safe theme toggles, themed
  images, CSP-safe scripts, or fixes flashing, SSR/SSG hydration mismatch, or
  Cloudflare Rocket Loader issues.
---

# next-themes

Use `next-themes` when a React or Next.js app needs persisted theme switching,
system preference support, no-flash initial rendering, tab/window sync, or
theme values exposed on the `<html>` element.

```bash
npm install next-themes
```

## Default Workflow

1. Detect the router style: App Router (`app/`) or Pages Router (`pages/`).
2. Add `ThemeProvider` at the root, as high as possible around application UI.
3. For App Router, put the provider in a client component and add
   `suppressHydrationWarning` to `<html>`.
4. Choose the DOM selector strategy before styling:
   `data-theme` by default, `class` for ordinary Tailwind dark mode, or a
   custom `data-*` attribute for custom selectors.
5. Build theme controls with `useTheme`, but render UI that depends on
   `theme`, `resolvedTheme`, or `systemTheme` only after client mount.
6. Verify production behavior when investigating flash issues; dev mode can
   still flash.

## Root Provider

### App Router

`ThemeProvider` is a client component. Prefer a small wrapper rather than
marking the whole `app/layout.tsx` as client-side.

```tsx
// app/providers.tsx
"use client";

import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
```

```tsx
// app/layout.tsx
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Add `suppressHydrationWarning` because `next-themes` updates the `<html>`
element before hydration. It applies only one level deep.

### Pages Router

```tsx
// pages/_app.tsx
import type { AppProps } from "next/app";
import { ThemeProvider } from "next-themes";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <Component {...pageProps} />
    </ThemeProvider>
  );
}
```

For forced per-page themes, read a static page property and pass it as
`forcedTheme`.

```tsx
type PageWithTheme = AppProps["Component"] & { theme?: string };

export default function App({ Component, pageProps }: AppProps) {
  const Page = Component as PageWithTheme;

  return (
    <ThemeProvider forcedTheme={Page.theme || null}>
      <Page {...pageProps} />
    </ThemeProvider>
  );
}
```

## Styling Strategy

By default, `next-themes` writes `data-theme="<theme>"` on `<html>`.

```css
:root {
  --background: white;
  --foreground: black;
}

[data-theme="dark"] {
  --background: black;
  --foreground: white;
}
```

Use `attribute="class"` when the app relies on class-based selectors, especially
Tailwind's standard dark mode.

```tsx
<ThemeProvider attribute="class">
```

For Tailwind 3.4.1+, use `darkMode: "selector"` with `attribute="class"`, or a
custom selector with a matching `data-*` attribute.

```js
// tailwind.config.js
module.exports = {
  darkMode: ["selector", '[data-mode="dark"]'],
};
```

```tsx
<ThemeProvider attribute="data-mode">
```

If using `value` with Tailwind, ensure the dark theme maps to the DOM value
`dark`; Tailwind's dark selector depends on that value.

## Hydration-Safe Theme UI

Values from `useTheme()` that depend on browser APIs are not known during SSR.
Do not render theme-dependent controls until mounted.

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeSwitch() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, forcedTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <select
      value={theme}
      disabled={!!forcedTheme}
      onChange={(event) => setTheme(event.target.value)}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
```

Use `theme` to show the user's selected mode (`system`, `light`, `dark`, or a
custom theme). Use `resolvedTheme` when runtime styling or behavior needs the
actual active light/dark result while `theme === "system"`.

## Provider Options

- `storageKey = "theme"`: localStorage key.
- `defaultTheme = "system"`: default theme when system mode is enabled.
- `enableSystem = true`: include and resolve the `system` option.
- `enableColorScheme = true`: update browser UI color scheme for form controls.
- `disableTransitionOnChange = false`: temporarily disable CSS transitions while
  switching themes.
- `themes = ["light", "dark"]`: allowed theme names. Passing this replaces the
  default list, so include `light` and `dark` if still needed.
- `attribute = "data-theme"`: `class` or any `data-*` attribute on `<html>`.
- `value`: map internal theme names to DOM attribute values only; it does not
  change the localStorage value.
- `forcedTheme`: lock the current page to a theme without changing saved user
  preference. Disable theme switching UI when this is set.
- `nonce`: pass a CSP nonce to the injected no-flash script.
- `scriptProps`: pass props to the injected script, e.g. Cloudflare Rocket
  Loader opt-out.

```tsx
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
  {children}
</ThemeProvider>
```

## Advanced Patterns

### More Than Light And Dark

```tsx
<ThemeProvider themes={["light", "dark", "pink", "red", "blue"]}>
```

When using custom theme names with different DOM selectors, map them with
`value`.

```tsx
<ThemeProvider value={{ pink: "my-pink-theme" }}>
```

### Themed Images

For `next/image`, avoid hydration mismatch by rendering a placeholder until
`resolvedTheme` is known, or render both variants and hide one with CSS.

```tsx
import Image from "next/image";
import { useTheme } from "next-themes";

const emptyGif =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function ThemedImage() {
  const { resolvedTheme } = useTheme();
  const src =
    resolvedTheme === "dark"
      ? "/dark.png"
      : resolvedTheme === "light"
        ? "/light.png"
        : emptyGif;

  return <Image src={src} width={400} height={400} alt="" />;
}
```

### CSP And Cloudflare

Use `nonce` when a Content Security Policy allow-lists inline scripts by nonce.
If Cloudflare Rocket Loader is enabled, opt out the injected script or the
no-flash behavior can break.

```tsx
<ThemeProvider
  nonce={nonce}
  scriptProps={{ "data-cfasync": "false" }}
>
```

## Pitfalls

- Do not read `theme` during SSR-rendered output without a mounted guard.
- Do not put the theme attribute on `<body>`; `next-themes` targets `<html>`.
- Do not assume `resolvedTheme` and `theme` mean the same thing when system mode
  is enabled.
- Do not pass `themes={...}` and forget to include `light` / `dark` if the app
  still exposes those choices.
- Do not debug production no-flash behavior only in `next dev`; build and run
  production mode before concluding the setup is broken.
- Do not leave theme controls enabled when `forcedTheme` is active; `setTheme`
  becomes ineffective for that page.
