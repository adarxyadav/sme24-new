import { cn } from "@/lib/utils";

export type RuledFieldProps = {
  /** The content that sits on the ruled ground. */
  readonly children: React.ReactNode;
  readonly className?: string;
  /**
   * Marks this block as the page's dark hero (`data-hero`), which the sticky header measures to
   * know how long to hold its inversion. Set it on the first section of a `DARK_HERO_ROUTES`
   * page; the header falls back to the first section of `main` when nothing carries it.
   *
   * It also picks the field's weight and mask: the hero is several screens tall, so the faintest
   * rules still read across it, while an off-hero section is a third of that height and needs
   * both to be stronger to register at all.
   */
  readonly hero?: boolean;
  /** Where the content sits, so the rules are held back from the type: the left column or the middle. */
  readonly align?: "start" | "center";
  /**
   * Clips the rules with `overflow-clip` instead of `overflow-hidden`, so a `position: sticky`
   * child of this field actually sticks. `hidden` gives the element a scrolling mechanism, and a
   * sticky descendant anchors to that nearest scrolling ancestor rather than to the viewport, so
   * it never moves (MDN, `position`); `clip` is deliberately excluded from that list and clips
   * exactly the same. It is not the default only because every other field on the site has no
   * sticky child and the two behave identically for them.
   */
  readonly stickyChildren?: boolean;
};

/**
 * The ruled ground (spec 0003, brand amendment of 2026-09-07): evenly spaced vertical hairlines
 * behind a section, drawn as a repeating gradient in `--color-border` so the rules follow the
 * theme, cost no request and never compete with a real hairline. The measure is industrial rather
 * than ornamental: it reads as ruled paper or a plotted grid, which is why the lines stop short of
 * the type instead of running under it. Purely decorative, so the layer is `aria-hidden` and the
 * content keeps its own stacking context above it. Server component.
 */
export function RuledField({
  children,
  className,
  hero = false,
  align = "start",
  stickyChildren = false,
}: RuledFieldProps) {
  return (
    <div
      data-hero={hero || undefined}
      className={cn(
        "relative isolate",
        stickyChildren ? "overflow-clip" : "overflow-hidden",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "-z-10 pointer-events-none absolute inset-0",
          // 5rem between rules, one hairline wide: the rules are background texture, so they have
          // to stay under the hairlines that carry meaning (section dividers, input outlines) or
          // they compete with them. Even at the full token they do, because those hairlines are
          // `border` drawn as a solid edge while this is 1px in every 5rem of empty ground.
          "bg-[repeating-linear-gradient(to_right,var(--color-border)_0,var(--color-border)_1px,transparent_1px,transparent_5rem)]",
          // The field fades at its edges so it has no hard end, and the type is held back from the
          // rules, because a rule crossing a headline reads as a printing fault rather than as
          // texture. `mask-image` is composited, not painted, so the hairlines keep their exact
          // colour where they do show.
          "[mask-composite:intersect]",
          hero
            ? // The hero is tall, so a third of the border token still reads over its whole width
              // and the type is cleared by an ellipse centred on the statement and the field.
              cn(
                "opacity-35",
                align === "start"
                  ? "[mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent),radial-gradient(150%_115%_at_26%_50%,transparent_0%,transparent_30%,black_92%)]"
                  : "[mask-image:linear-gradient(to_bottom,transparent,black_18%,black_62%,transparent_86%),radial-gradient(90%_70%_at_50%_42%,transparent_0%,transparent_32%,black_88%)]",
              )
            : // Off the hero the section is a third of that height, and the hero's ellipse -- 150%
              // wide, 115% tall -- would clear the whole of it. So the rules run at the full token
              // and the clearance becomes a vertical band through the middle, held open for the
              // eyebrow, the headline and the card grid: the field survives as two ruled margins
              // that mark the section as ground without ever crossing the type.
              cn(
                "opacity-100",
                "[mask-image:linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent),linear-gradient(to_right,black_0%,black_6%,transparent_22%,transparent_74%,black_94%,black_100%)]",
              ),
        )}
      />
      {children}
    </div>
  );
}
