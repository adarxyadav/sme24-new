import { cn } from "@/lib/utils";

export type RuledFieldProps = {
  /** The content that sits on the ruled ground. */
  readonly children: React.ReactNode;
  readonly className?: string;
  /**
   * Marks this block as the page's dark hero (`data-hero`), which the sticky header measures to
   * know how long to hold its inversion. Set it on the first section of a `DARK_HERO_ROUTES`
   * page; the header falls back to the first section of `main` when nothing carries it.
   */
  readonly hero?: boolean;
  /** Where the content sits, so the rules are held back from the type: the left column or the middle. */
  readonly align?: "start" | "center";
};

/**
 * The ruled ground (spec 0003, brand amendment of 2026-09-07): evenly spaced vertical hairlines
 * behind a section, drawn as a repeating gradient in `--color-border` at a third of its weight
 * so the rules follow the theme, cost no request and never compete with a real hairline. The measure is industrial rather than ornamental: it reads as ruled
 * paper or a plotted grid, which is why the lines stop short of the type instead of running
 * under it. Purely decorative, so the layer is `aria-hidden` and the content keeps its own
 * stacking context above it. Server component.
 */
export function RuledField({
  children,
  className,
  hero = false,
  align = "start",
}: RuledFieldProps) {
  return (
    <div
      data-hero={hero || undefined}
      className={cn("relative isolate overflow-hidden", className)}
    >
      <div
        aria-hidden="true"
        className={cn(
          "-z-10 pointer-events-none absolute inset-0",
          // 5rem between rules, one hairline wide, at a third of the border token: the rules are
          // background texture, so they have to stay well under the hairlines that carry meaning
          // (section dividers, input outlines) or they compete with them.
          "bg-[repeating-linear-gradient(to_right,var(--color-border)_0,var(--color-border)_1px,transparent_1px,transparent_5rem)]",
          "opacity-35",
          // The field fades at all four edges so it has no hard end, and the centre column is
          // held back further, because that is where the headline and the lookup field sit and a
          // rule crossing type reads as a printing fault rather than as texture. `mask-image` is
          // composited, not painted, so the hairlines keep their exact colour where they do show.
          "[mask-composite:intersect]",
          align === "start"
            ? "[mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent),radial-gradient(150%_115%_at_26%_50%,transparent_0%,transparent_30%,black_92%)]"
            : "[mask-image:linear-gradient(to_bottom,transparent,black_18%,black_62%,transparent_86%),radial-gradient(90%_70%_at_50%_42%,transparent_0%,transparent_32%,black_88%)]",
        )}
      />
      {children}
    </div>
  );
}
