import { cn } from "@/lib/utils";

/**
 * The brand mark: a teal tile with the initials until real brand assets exist (spec 0003
 * follow-up). Decorative; the visible product name sits next to it. Server or browser.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={cn("size-8 shrink-0 rounded-md", className)}
    >
      <rect width="32" height="32" rx="6" className="fill-primary" />
      <path
        d="M9 21.5c1.2 1 2.7 1.5 4.2 1.5 2.6 0 4.3-1.3 4.3-3.4 0-1.9-1.2-2.8-3.6-3.3l-1.4-.3c-1.3-.3-1.8-.7-1.8-1.5 0-.9.9-1.5 2.2-1.5 1.2 0 2.3.4 3.3 1.2l1.3-2c-1.3-1-2.9-1.5-4.6-1.5-2.7 0-4.5 1.5-4.5 3.6 0 1.9 1.2 2.9 3.6 3.4l1.4.3c1.3.3 1.8.7 1.8 1.4 0 .9-.9 1.4-2.3 1.4-1.4 0-2.6-.5-3.6-1.4L9 21.5Z"
        className="fill-primary-foreground"
      />
    </svg>
  );
}
