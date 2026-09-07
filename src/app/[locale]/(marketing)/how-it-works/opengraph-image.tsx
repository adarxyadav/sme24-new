import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  ogImageMetadata,
  renderOgImage,
} from "@/features/marketing/og-image";

/** The social card of the how it works page (spec 0009, AC-2): the statement on the jet ground, one per locale. Build time. */
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateImageMetadata(props: { params: { locale: string } }) {
  return ogImageMetadata("howItWorks", props);
}

export default function Image(props: { params: Promise<{ locale: string }> }) {
  return renderOgImage("howItWorks", props);
}
