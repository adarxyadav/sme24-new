"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type StepsRailProps = {
  /** The step keys in order, the same ids the panels carry as `data-step`. */
  readonly keys: readonly string[];
  /** The short rail label per key, in the same order. */
  readonly labels: readonly string[];
  /** The `aria-label` of the rail's navigation landmark. */
  readonly navLabel: string;
  readonly className?: string;
};

/**
 * The sticky rail beside the steps: the list of step names, the one the reader is currently level
 * with set in the foreground colour, the rest muted. Purely a position indicator for a sequence
 * the page has already rendered in full, so it adds no content and hides from assistive tech --
 * the panels themselves are the real headings, and a screen reader reads them in order without
 * needing to know which one a sighted reader's viewport happens to be crossing.
 *
 * It degrades to the first item highlighted whenever the measuring never runs -- no JavaScript, no
 * `IntersectionObserver` -- because the panels it indexes are server rendered either way. Browser.
 */
export function StepsRail({ keys, labels, navLabel, className }: StepsRailProps) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // The rail is an enhancement over content the server already rendered, so anything missing
    // here leaves the first step highlighted rather than breaking the section. `IntersectionObserver`
    // is checked rather than assumed: jsdom has none, and neither does an old browser.
    if (typeof IntersectionObserver === "undefined") return;
    const root = ref.current?.closest("[data-steps]");
    if (!root) return;
    const panels = keys
      .map((key) => root.querySelector(`[data-step="${key}"]`))
      .filter((node): node is Element => node !== null);
    if (panels.length === 0) return;

    // The active step is the last panel whose top has passed the reading line, so the rail
    // changes as a panel arrives rather than when it is centred: the reader's eye is at the top
    // of the block they have just reached, not its middle. The observer is only the trigger --
    // it says "something crossed, look again" -- and the tops decide, because with four short
    // panels several are on screen at once and "which one is intersecting" has no single answer.
    const measure = () => {
      const line = window.innerHeight * 0.4;
      let passed = 0;
      panels.forEach((panel, index) => {
        if (panel.getBoundingClientRect().top <= line) passed = index;
      });
      setActive(passed);
    };

    // Coalesced to one measurement per frame: a scroll event can fire several times between
    // paints, and every call reads four rects, so an unthrottled handler does the layout work
    // repeatedly for a highlight that can only change once per frame anyway.
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const observer = new IntersectionObserver(onScroll, {
      // A band of thresholds, so a panel taller than the viewport still reports as it travels
      // rather than only at its two edges.
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const panel of panels) observer.observe(panel);
    // The observer fires on its own at mount, but not on a plain scroll that crosses no
    // threshold, which is exactly the case between two tall panels.
    window.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [keys]);

  return (
    <nav ref={ref} aria-label={navLabel} className={className}>
      {/*
        Hidden from assistive tech: it duplicates the panel headings below it and says nothing a
        screen reader user can act on. The landmark keeps its name for the same reason every
        landmark does -- so a sighted keyboard user landing here in the tab order is not in an
        unnamed region -- but nothing inside is focusable, so it never receives focus.
      */}
      <ol aria-hidden="true" className="flex flex-col gap-4">
        {keys.map((key, index) => (
          <li key={key} className="flex items-baseline gap-3">
            <span
              className={cn(
                "font-mono text-xs tabular-nums transition-colors duration-200",
                index === active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "text-sm tracking-headline transition-colors duration-200",
                index === active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {labels[index]}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
