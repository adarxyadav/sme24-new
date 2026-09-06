import type { Thing, WithContext } from "schema-dts";
import { serializeJsonLd } from "@/features/marketing/json-ld";

/**
 * One `<script type="application/ld+json">` per structured data object (spec 0009, AC-3). The
 * body is serialized by `serializeJsonLd`, which escapes every `<`, so the inner HTML can never
 * close the script tag. Server component.
 */
export function JsonLd({ data }: { readonly data: WithContext<Thing> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw text inside the script element; React would entity encode the quotes, and serializeJsonLd escapes every `<`
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
