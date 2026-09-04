import { cn } from "@/lib/utils";

/**
 * The content column of a signed in page (spec 0003): shared max width, page gutter and the
 * vertical rhythm between sections. Server component.
 */
export function PageStack({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-stack"
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:py-8",
        className,
      )}
      {...props}
    />
  );
}
