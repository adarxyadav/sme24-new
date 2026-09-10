"use client";

import { useEffect } from "react";

export type StepsRailProps = {
  /** The step keys in order, the same ids the rows carry as `data-step`. */
  readonly keys: readonly string[];
};

/** Below this width the section is not pinned, so every step stands open. */
const PINNED = "(min-width: 1024px)";

/**
 * The scroll driver behind the steps. It renders nothing: it reads the reader's progress through
 * the pinned track and writes `data-active` onto the step rows and the stills opposite them, which
 * is what opens one step and closes the rest.
 *
 * It was a visible rail until 2026-09-10 (owner decision): the rail named every step and the step's
 * own title named it again below, so the reader met one step under two names in two components.
 * The list is now one object per step -- number, title and body in one row -- and what is left of
 * this component is only the measuring, which still has to happen in the browser.
 *
 * Deliberately headless rather than deleted: the measurement is the one piece of this section that
 * cannot be a server component, and keeping it in its own file is what lets the section itself stay
 * one. When it never runs -- no JavaScript, no `matchMedia` -- every row keeps the
 * `data-active="true"` the server rendered and the section is the plain open column it is below
 * `lg`, rather than four collapsed rows. Browser.
 */
export function StepsRail({ keys }: StepsRailProps) {
  useEffect(() => {
    const root = document.querySelector("[data-steps]");
    const track = root?.querySelector("[data-steps-track]");
    if (!root || !track) return;
    const rows = keys
      .map((key) => root.querySelector(`[data-step="${key}"]`))
      .filter((node): node is HTMLElement => node !== null);
    if (rows.length === 0) return;
    // The stills live in their own column, keyed the same way. A step without one simply has none
    // -- `/how-it-works` passes no visuals at all.
    const visuals = keys
      .map((key) => root.querySelector(`[data-step-visual="${key}"]`))
      .filter((node): node is HTMLElement => node !== null);

    const pinned = window.matchMedia(PINNED);

    // The active step is the reader's progress through the track, not any row's position: the rows
    // are pinned and never move, so there is nothing about them left to measure. The track is
    // `steps.length` viewports tall and its top passes the viewport top as the section pins, so the
    // distance travelled divided by one viewport is the index, clamped to the last step for the
    // final viewport of travel that scrolls the section away.
    const measure = () => {
      if (!pinned.matches) {
        for (const row of rows) row.dataset.active = "true";
        for (const visual of visuals) visual.dataset.active = "true";
        return;
      }
      const travelled = -track.getBoundingClientRect().top;
      const index = Math.min(
        keys.length - 1,
        Math.max(0, Math.floor(travelled / window.innerHeight)),
      );
      rows.forEach((row, rowIndex) => {
        row.dataset.active = String(rowIndex === index);
      });
      visuals.forEach((visual, visualIndex) => {
        visual.dataset.active = String(visualIndex === index);
      });
    };

    // Coalesced to one measurement per frame: a scroll event can fire several times between paints,
    // and the open step can only change once per frame anyway.
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    pinned.addEventListener("change", onScroll);
    measure();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      pinned.removeEventListener("change", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
      // The rows outlive this effect, so hand them back open: an unmounted driver must never leave
      // three steps collapsed behind it.
      for (const row of rows) row.dataset.active = "true";
      for (const visual of visuals) visual.dataset.active = "true";
    };
  }, [keys]);

  return null;
}
