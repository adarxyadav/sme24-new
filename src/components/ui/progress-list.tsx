import { CheckIcon, CircleIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type ProgressItemState = "done" | "current" | "pending" | "failed";

export type ProgressItem = {
  readonly id: string;
  readonly label: string;
  readonly state: ProgressItemState;
  /** A short line under the label: a counter, a time, a reason. */
  readonly detail?: string;
};

export type ProgressListProps = React.ComponentProps<"ol"> & {
  readonly items: readonly ProgressItem[];
  /** Read to assistive tech before each item's label ("Step 2"); the visible list carries no numbers. */
  readonly stepLabel?: (index: number) => string;
};

const ICONS: Record<ProgressItemState, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  done: CheckIcon,
  current: LoaderCircleIcon,
  pending: CircleIcon,
  failed: XIcon,
};

/**
 * A vertical list of steps in order (spec 0007, AC-7): done, current (spinning, still when motion
 * is reduced), pending and failed, each with a label and an optional detail line. The current
 * item carries `aria-current="step"`; states are conveyed by icon and text, never by colour
 * alone. Server or client.
 */
export function ProgressList({ items, stepLabel, className, ...props }: ProgressListProps) {
  return (
    <ol data-slot="progress-list" className={cn("flex flex-col", className)} {...props}>
      {items.map((item, index) => {
        const Icon = ICONS[item.state];
        const last = index === items.length - 1;
        return (
          <li
            key={item.id}
            data-state={item.state}
            aria-current={item.state === "current" ? "step" : undefined}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {last ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-6 bottom-0 left-2.5 w-px",
                  item.state === "done" ? "bg-foreground" : "bg-border",
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border",
                item.state === "done" && "border-foreground bg-foreground text-background",
                item.state === "current" && "border-foreground bg-background text-foreground",
                item.state === "pending" && "border-border bg-background text-muted-foreground",
                item.state === "failed" &&
                  "border-destructive bg-destructive-subtle text-destructive",
              )}
            >
              <Icon
                className={cn("size-3", item.state === "current" && "motion-safe:animate-spin")}
              />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-px">
              <span
                className={cn(
                  "text-sm",
                  item.state === "current" && "font-medium",
                  item.state === "pending" && "text-muted-foreground",
                  item.state === "failed" && "text-destructive",
                )}
              >
                {stepLabel ? <span className="sr-only">{stepLabel(index)} </span> : null}
                {item.label}
              </span>
              {item.detail ? (
                <span className="text-muted-foreground text-xs">{item.detail}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
