import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Style from "ol/style/Style";

import type {
  CampaignRegion,
  CampaignRegionCategory,
} from "../../utils/api-client";
import type { GeometryLayer } from "./types";

export interface CreateRegionLayerOptions {
  worldMapId: string;
  getRegionStyle: (_region: CampaignRegion) => Style;
  visible?: boolean;
}

const FALLBACK_CATEGORY: CampaignRegionCategory = "custom";

const getFallbackRegion = (
  feature: Feature<Geometry>,
  worldMapId: string,
): CampaignRegion => {
  const rawName = feature.get("name");
  const rawColor = feature.get("color");
  return {
    id: "placeholder",
    campaignId: "",
    worldMapId,
    name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Region",
    description: null,
    category: FALLBACK_CATEGORY,
    color: typeof rawColor === "string" ? rawColor : null,
    metadata: {},
    geometry: {},
    createdAt: "",
    updatedAt: "",
  };
};

const resolveRegion = (
  feature: Feature<Geometry>,
  worldMapId: string,
): CampaignRegion => {
  const rawData = feature.get("data");
  if (rawData && typeof rawData === "object") {
    const candidate = rawData as Partial<CampaignRegion>;
    if (typeof candidate.id === "string" && candidate.id.trim()) {
      const campaignId =
        typeof candidate.campaignId === "string" && candidate.campaignId.trim()
          ? candidate.campaignId
          : "";
      const worldId =
        typeof candidate.worldMapId === "string" && candidate.worldMapId.trim()
          ? candidate.worldMapId
          : worldMapId;
      const name =
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name
          : "Region";
      const description =
        typeof candidate.description === "string" || candidate.description === null
          ? candidate.description
          : null;
      const category = candidate.category ?? FALLBACK_CATEGORY;
      const color =
        typeof candidate.color === "string" && candidate.color.trim()
          ? candidate.color
          : null;
      const metadata =
        candidate.metadata && typeof candidate.metadata === "object"
          ? (candidate.metadata as Record<string, unknown>)
          : {};
      const geometry =
        candidate.geometry && typeof candidate.geometry === "object"
          ? (candidate.geometry as Record<string, unknown>)
          : {};
      const createdAt =
        typeof candidate.createdAt === "string" ? candidate.createdAt : "";
      const updatedAt =
        typeof candidate.updatedAt === "string" ? candidate.updatedAt : "";

      return {
        ...candidate,
        id: candidate.id,
        campaignId,
        worldMapId: worldId,
        name,
        description,
        category,
        color,
        metadata,
        geometry,
        createdAt,
        updatedAt,
      };
    }
  }

  return getFallbackRegion(feature, worldMapId);
};

export const createRegionLayer = ({
  worldMapId,
  getRegionStyle,
  visible = true,
}: CreateRegionLayerOptions): GeometryLayer => {
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature) => getRegionStyle(resolveRegion(feature as Feature<Geometry>, worldMapId)),
    visible,
  });
};
