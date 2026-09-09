"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export type CompanyLookupFieldProps = {
  readonly locale: Locale;
  readonly label: string;
  readonly placeholder: string;
  readonly cta: string;
  /** Renders on the jet ground when the field sits in the hero. */
  readonly inverse?: boolean;
  /**
   * `hero` grows the field and the button to 44px. The closing call to action is an anchor tier
   * too (docs/design.md, tier map), so it takes the same size and keeps its visible label.
   */
  readonly size?: "default" | "hero";
  /** Hides the label visually. The hero has its own heading above the field; the closing does not. */
  readonly hideLabel?: boolean;
  readonly className?: string;
};

/** The company name query parameter the sign up page reads (spec 0009, AC-5). */
export const COMPANY_PARAM = "company";

/**
 * The hero's lookup field (spec 0009, AC-5): a plain GET form to the sign up page, so it works
 * without JavaScript, carrying the typed company name as `?company=`; with JavaScript an empty
 * field opens the sign up page without a parameter. The labels arrive as props, so the landing
 * page needs no client side message bundle. Browser.
 */
export function CompanyLookupField({
  locale,
  label,
  placeholder,
  cta,
  inverse = false,
  size = "default",
  hideLabel = false,
  className,
}: CompanyLookupFieldProps) {
  const id = useId();
  const router = useRouter();
  const signUpPath = getPathname({ href: "/sign-up", locale });

  return (
    <form
      method="get"
      action={signUpPath}
      onSubmit={(event) => {
        const field = event.currentTarget.elements.namedItem(COMPANY_PARAM);
        const value = field instanceof HTMLInputElement ? field.value.trim() : "";
        event.preventDefault();
        router.push(
          value ? { pathname: "/sign-up", query: { [COMPANY_PARAM]: value } } : "/sign-up",
        );
      }}
      className={className ?? "flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-end"}
    >
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor={id} className={cn(inverse && "text-foreground", hideLabel && "sr-only")}>
          {label}
        </Label>
        <Input
          id={id}
          name={COMPANY_PARAM}
          autoComplete="organization"
          placeholder={placeholder}
          maxLength={200}
          className={size === "hero" ? "h-11 text-base md:text-base" : "h-9"}
        />
      </div>
      <Button type="submit" size={size === "hero" ? "xl" : "lg"}>
        {cta}
      </Button>
    </form>
  );
}
