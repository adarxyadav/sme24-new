import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Link } from "@/i18n/navigation";
import type { Pathname } from "@/i18n/pathnames";
import { cn } from "@/lib/utils";

export type BreadcrumbEntry = {
  readonly label: string;
  /** Omit on the last entry: it is the current page. */
  readonly href?: Pathname;
};

export type PageHeaderProps = {
  readonly title: string;
  readonly description?: string;
  readonly breadcrumb?: readonly BreadcrumbEntry[];
  /** Right aligned actions, usually one or two `Button`s. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
};

/**
 * The one `h1` of a signed in page (spec 0003): title, optional description, breadcrumb and
 * right aligned actions. Pages must not render another `h1`. Server component.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((entry, index) => {
              const last = index === breadcrumb.length - 1;
              return (
                <Fragment key={`${entry.label}-${entry.href ?? "current"}`}>
                  <BreadcrumbItem>
                    {last || !entry.href ? (
                      <BreadcrumbPage>{entry.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={entry.href}>{entry.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {last ? null : <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-bold text-2xl tracking-headline">{title}</h1>
          {description ? (
            <p className="max-w-prose text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
