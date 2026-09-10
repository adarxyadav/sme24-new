import { useTranslations } from "next-intl";
import {
  CampaignFrame,
  CampaignGrid,
  CampaignImage,
  CampaignPiece,
  CampaignWall,
} from "@/components/brand/campaign";
import { Example } from "@/components/gallery/gallery-section";

/** The campaign deck's objects, converted to web sizes under `public/campaign/`. */
const WALL = [
  { key: "teamevent", src: "/campaign/teamevent.jpg", grayscale: false },
  { key: "firmenwagen", src: "/campaign/firmenwagen.webp", grayscale: false },
  { key: "dresscode", src: "/campaign/dresscode.jpg", grayscale: false },
  { key: "jahresbonus", src: "/campaign/jahresbonus.webp", grayscale: true },
  { key: "noCosmetics", src: "/campaign/graue-haare.jpg", grayscale: true },
  { key: "noOverhead", src: "/campaign/keine-haare.jpg", grayscale: true },
] as const;

/**
 * The campaign format as marketing blocks with the deck's own imagery: single object, the AI
 * contrast, the pair, the four panel strip, the type only piece and the wall. Server.
 */
export function CampaignSection() {
  const t = useTranslations("gallery.campaign");
  return (
    <div className="flex flex-col gap-12">
      <Example label={t("single")}>
        <CampaignPiece statement={t("singleStatement")} subline={t("singleSubline")}>
          <CampaignFrame aspect="landscape" className="max-w-xl">
            <CampaignImage src="/campaign/geschaeftsessen.jpg" alt={t("singleAlt")} />
          </CampaignFrame>
        </CampaignPiece>
      </Example>

      <Example label={t("contrast")}>
        <CampaignPiece statement={t("contrastStatement")}>
          <CampaignGrid>
            <CampaignFrame caption={t("contrastLeft")} aspect="portrait" empty />
            <CampaignFrame caption={t("contrastRight")} aspect="portrait">
              <CampaignImage src="/campaign/philipp.webp" alt={t("contrastAlt")} grayscale />
            </CampaignFrame>
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("pair")}>
        <CampaignPiece statement={t("pairStatement")}>
          <CampaignGrid>
            <CampaignFrame caption={t("pairLeft")} aspect="portrait">
              <CampaignImage src="/campaign/graue-haare.jpg" alt={t("pairLeftAlt")} grayscale />
            </CampaignFrame>
            <CampaignFrame caption={t("pairRight")} aspect="portrait">
              <CampaignImage src="/campaign/keine-haare.jpg" alt={t("pairRightAlt")} grayscale />
            </CampaignFrame>
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("strip")}>
        <CampaignPiece statement={t("stripStatement")}>
          <CampaignFrame aspect="landscape" className="max-w-3xl">
            <CampaignImage src="/campaign/eigene-wege.webp" alt={t("stripAlt")} grayscale />
          </CampaignFrame>
        </CampaignPiece>
      </Example>

      <Example label={t("type")}>
        <CampaignPiece statement={t("typeStatement")} />
      </Example>

      <Example label={t("wall")}>
        <CampaignWall>
          {WALL.map((item) => (
            <CampaignPiece
              key={item.key}
              statement={t(`wallItems.${item.key}.statement`)}
              signature={false}
              as="h3"
            >
              <CampaignFrame className="max-w-xs">
                <CampaignImage
                  src={item.src}
                  alt={t(`wallItems.${item.key}.alt`)}
                  grayscale={item.grayscale}
                />
              </CampaignFrame>
            </CampaignPiece>
          ))}
        </CampaignWall>
      </Example>
    </div>
  );
}
