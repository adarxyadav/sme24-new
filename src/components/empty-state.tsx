import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  /** At most one action, usually a `Button`. */
  readonly action?: React.ReactNode;
  readonly className?: string;
};

/**
 * What an empty list or a not yet built area shows instead of blank space (spec 0003): icon,
 * title, one sentence, one action. Server component.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-1">
        <p className="font-medium text-base">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
