import { useTranslations } from "next-intl";
import {
  CampaignFrame,
  CampaignGrid,
  CampaignPiece,
  CampaignWall,
} from "@/components/brand/campaign";
import { Example } from "@/components/gallery/gallery-section";

/**
 * The campaign format as marketing blocks: single object, pair and contrast, four panel strip,
 * type only piece and the wall. Placeholders stand in for the photography feature 13 brings.
 * Server.
 */
export function CampaignSection() {
  const t = useTranslations("gallery.campaign");
  return (
    <div className="flex flex-col gap-8">
      <Example label={t("single")}>
        <CampaignPiece statement={t("singleStatement")} subline={t("singleSubline")}>
          <CampaignFrame aspect="landscape" placeholder={t("singleObject")} className="max-w-xl" />
        </CampaignPiece>
      </Example>

      <Example label={t("contrast")}>
        <CampaignPiece statement={t("contrastStatement")}>
          <CampaignGrid>
            <CampaignFrame caption={t("contrastLeft")} aspect="portrait" empty />
            <CampaignFrame
              caption={t("contrastRight")}
              aspect="portrait"
              placeholder={t("contrastObject")}
            />
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("pair")}>
        <CampaignPiece statement={t("pairStatement")}>
          <CampaignGrid>
            <CampaignFrame
              caption={t("pairLeft")}
              aspect="portrait"
              placeholder={t("pairObject")}
            />
            <CampaignFrame
              caption={t("pairRight")}
              aspect="portrait"
              placeholder={t("pairObject")}
            />
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("strip")}>
        <CampaignPiece statement={t("stripStatement")}>
          <CampaignGrid>
            {[1, 2, 3, 4].map((panel) => (
              <CampaignFrame
                key={panel}
                aspect="wide"
                placeholder={t("panel", { number: panel })}
              />
            ))}
          </CampaignGrid>
        </CampaignPiece>
      </Example>

      <Example label={t("type")}>
        <CampaignPiece statement={t("typeStatement")} />
      </Example>

      <Example label={t("wall")}>
        <CampaignWall>
          <CampaignPiece statement={t("wallOne")} signature={false} as="h3">
            <CampaignFrame placeholder={t("wallObjectOne")} className="max-w-xs" />
          </CampaignPiece>
          <CampaignPiece statement={t("wallTwo")} signature={false} as="h3">
            <CampaignFrame placeholder={t("wallObjectTwo")} className="max-w-xs" />
          </CampaignPiece>
          <CampaignPiece statement={t("wallThree")} signature={false} as="h3">
            <CampaignFrame placeholder={t("wallObjectThree")} className="max-w-xs" />
          </CampaignPiece>
          <CampaignPiece statement={t("wallFour")} signature={false} as="h3">
            <CampaignFrame placeholder={t("wallObjectFour")} className="max-w-xs" />
          </CampaignPiece>
        </CampaignWall>
      </Example>
    </div>
  );
}
