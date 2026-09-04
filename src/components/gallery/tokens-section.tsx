"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { contrastRatio, formatRatio, parseColor } from "@/lib/contrast";
import { BOUNDARY_MINIMUM, CONTRAST_PAIRS, type ContrastPair } from "@/lib/design-tokens";

type Measured = { readonly ratio: number; readonly pass: boolean };

/**
 * Every guaranteed color pair as a swatch with its live contrast ratio (spec 0003, AC-1). Values
 * come from the browser after mount, so the section reflects the active theme. Runs in the browser.
 */
export function TokensSection() {
  const theme = useThemeTick();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {CONTRAST_PAIRS.map((pair) => (
        <Swatch key={`${pair.foreground}-${pair.background}`} pair={pair} theme={theme} />
      ))}
    </ul>
  );
}

/**
 * A counter that advances whenever the `class` attribute of `html` changes (next-themes toggles
 * `dark` there), so one observer serves every swatch instead of one per swatch.
 */
function useThemeTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setTick((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return tick;
}

function Swatch({ pair, theme }: { pair: ContrastPair; theme: number }) {
  const t = useTranslations("gallery.tokens");
  const sample = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);

  // Re-measured after mount and on every theme tick: the computed colors change with the theme.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` is the trigger, not an input
  useEffect(() => {
    const element = sample.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const foreground = parseColor(style.color);
    const background = parseColor(style.backgroundColor);
    if (!foreground || !background) return;
    const ratio = contrastRatio(foreground, background);
    setMeasured({ ratio, pass: ratio >= pair.minimum });
  }, [pair.minimum, theme]);

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      {pair.minimum === BOUNDARY_MINIMUM ? (
        <span
          aria-hidden="true"
          className="flex h-14 items-center justify-center rounded-md border"
          style={{ backgroundColor: `var(--${pair.background})` }}
        >
          {/* A boundary token is measured as a border, the way it renders; text would be judged at 4.5:1. */}
          <span
            ref={sample}
            className="block size-8 rounded-md border-2"
            style={{
              color: `var(--${pair.foreground})`,
              borderColor: `var(--${pair.foreground})`,
              backgroundColor: `var(--${pair.background})`,
            }}
          />
        </span>
      ) : (
        <span
          ref={sample}
          aria-hidden="true"
          className="flex h-14 items-center justify-center rounded-md border font-semibold text-xl"
          style={{
            color: `var(--${pair.foreground})`,
            backgroundColor: `var(--${pair.background})`,
          }}
        >
          Aa
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <code className="min-w-0 break-words font-mono text-xs">
          --{pair.foreground}
          <span className="text-muted-foreground"> {t("on")} </span>--{pair.background}
        </code>
        {measured ? (
          <Badge variant={measured.pass ? "success" : "destructive"} className="shrink-0">
            {formatRatio(measured.ratio)}
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            …
          </Badge>
        )}
      </div>
      <span className="text-muted-foreground text-xs">
        {t("minimum", { ratio: `${pair.minimum}:1` })}
      </span>
    </li>
  );
}
