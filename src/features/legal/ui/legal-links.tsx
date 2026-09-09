"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import type { StaticPathname } from "@/i18n/pathnames";

/**
 * The rich text tags every consent label uses (spec 0015, AC-9): `<terms>` and `<privacy>` become
 * typed links to the real pages, opening in a new tab so a half filled sign up form is never lost
 * to reading the policy.
 *
 * `rel="noreferrer"` rides with `target="_blank"` because the new tab would otherwise get a
 * `window.opener` handle back to this one. Browser; the auth forms are client components.
 */
function legalLink(href: StaticPathname) {
  return (chunks: ReactNode) => (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-4 hover:no-underline"
    >
      {chunks}
    </Link>
  );
}

/** The `<terms>` and `<privacy>` tags, spread into a `t.rich` call. Browser. */
export const LEGAL_LINK_TAGS = {
  terms: legalLink("/terms"),
  privacy: legalLink("/privacy"),
} as const;
