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
  { key: "teamevent", src: "/campaign/teamevent.jpg" },
  { key: "firmenwagen", src: "/campaign/firmenwagen.png" },
  { key: "dresscode", src: "/campaign/dresscode.jpg" },
  { key: "jahresbonus", src: "/campaign/jahresbonus.jpg" },
  { key: "noCosmetics", src: "/campaign/no-cosmetics.jpg" },
  { key: "noOverhead", src: "/campaign/no-overhead.jpg" },
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
              <CampaignImage src="/campaign/philipp.jpg" alt={t("contrastAlt")} />
            </CampaignFrame>
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("pair")}>
        <CampaignPiece statement={t("pairStatement")}>
          <CampaignGrid>
            <CampaignFrame caption={t("pairLeft")} aspect="portrait">
              <CampaignImage src="/campaign/graue-haare.jpg" alt={t("pairLeftAlt")} />
            </CampaignFrame>
            <CampaignFrame caption={t("pairRight")} aspect="portrait">
              <CampaignImage src="/campaign/keine-haare.jpg" alt={t("pairRightAlt")} />
            </CampaignFrame>
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("strip")}>
        <CampaignPiece statement={t("stripStatement")}>
          <CampaignFrame aspect="landscape" className="max-w-3xl">
            <CampaignImage src="/campaign/eigene-wege.jpg" alt={t("stripAlt")} />
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
                <CampaignImage src={item.src} alt={t(`wallItems.${item.key}.alt`)} />
              </CampaignFrame>
            </CampaignPiece>
          ))}
        </CampaignWall>
      </Example>
    </div>
  );
}
