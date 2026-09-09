"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

/** Row density (spec 0003): `compact` for ops lists, read by cells through `data-density`. */
type TableDensity = "default" | "compact";

function Table({
  className,
  density = "default",
  scrollLabel,
  ...props
}: React.ComponentProps<"table"> & {
  density?: TableDensity;
  /**
   * Names the horizontal scroll box and makes it keyboard reachable (spec 0015, AC-6). A
   * scrollable region whose content holds nothing focusable can only be scrolled with a mouse
   * otherwise, which axe reports as `scrollable-region-focusable` (WCAG 2.1.1). Pass it on a
   * table of plain text; a table whose rows carry links or buttons is already reachable and does
   * not need it.
   */
  scrollLabel?: string;
}) {
  return (
    <div
      data-slot="table-container"
      data-density={density}
      className="group/table relative w-full overflow-x-auto"
      // Spread together so `aria-label` never appears without the `role` that supports it: a bare
      // `div` does not accept one, which is what `useAriaPropsSupportedByRole` checks for.
      {...(scrollLabel ? { tabIndex: 0, role: "group", "aria-label": scrollLabel } : {})}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-foreground group-data-[density=compact]/table:h-8 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-3 align-middle whitespace-nowrap group-data-[density=compact]/table:py-1.5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
