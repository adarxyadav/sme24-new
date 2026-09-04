import { getTranslations } from "next-intl/server";
import { BrandSection } from "@/components/gallery/brand-section";
import { ButtonsSection } from "@/components/gallery/buttons-section";
import { CampaignSection } from "@/components/gallery/campaign-section";
import { ChartsSection } from "@/components/gallery/charts-section";
import { FeedbackSection } from "@/components/gallery/feedback-section";
import { FormsSection } from "@/components/gallery/forms-section";
import { GallerySection } from "@/components/gallery/gallery-section";
import { OverlaysSection } from "@/components/gallery/overlays-section";
import { StatesSection } from "@/components/gallery/states-section";
import { TableSection } from "@/components/gallery/table-section";
import { TokensSection } from "@/components/gallery/tokens-section";
import { TypeSection } from "@/components/gallery/type-section";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { ThemeToggle } from "@/components/theme-toggle";

const SECTIONS = [
  ["brand", BrandSection],
  ["campaign", CampaignSection],
  ["tokens", TokensSection],
  ["type", TypeSection],
  ["buttons", ButtonsSection],
  ["forms", FormsSection],
  ["table", TableSection],
  ["overlays", OverlaysSection],
  ["feedback", FeedbackSection],
  ["states", StatesSection],
  ["charts", ChartsSection],
] as const;

/**
 * The design gallery (spec 0003): every primitive in every state, ops only through the proxy.
 * A development aid that ships behind the ops role and shows no customer data.
 */
export default async function DesignGalleryPage() {
  const t = await getTranslations("gallery");
  const nav = await getTranslations("nav.admin");

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[{ label: nav("overview"), href: "/admin" }, { label: nav("design") }]}
        actions={<ThemeToggle />}
      />
      <nav aria-label={t("sectionsNav")} className="flex flex-wrap gap-2">
        {SECTIONS.map(([id]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t(`sections.${id}.title`)}
          </a>
        ))}
      </nav>
      {SECTIONS.map(([id, Section]) => (
        <GallerySection
          key={id}
          id={id}
          title={t(`sections.${id}.title`)}
          description={t(`sections.${id}.description`)}
        >
          <Section />
        </GallerySection>
      ))}
    </PageStack>
  );
}
