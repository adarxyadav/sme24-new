import type { MetadataRoute } from "next";
import { clientEnv } from "@/lib/env";

/**
 * `robots.txt` (spec 0004, AC-10; spec 0009, AC-4): the signed in areas and the API stay out of
 * the index. Only a production deployment invites indexing at all: a preview or staging copy
 * (`VERCEL_ENV` anything but `production`, and local development) answers `disallow: /` with no
 * sitemap line, so a self canonical copy is never indexed. Server, request time.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  const base = clientEnv().NEXT_PUBLIC_APP_URL;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/*/app", "/*/expert", "/*/admin", "/api"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
