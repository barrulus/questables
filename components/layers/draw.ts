import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";

import type { GeometryFeature, GeometryLayer } from "./types";

export interface CreateDrawLayerResult {
  layer: GeometryLayer;
  source: VectorSource<GeometryFeature>;
}

export const createDrawLayer = (): CreateDrawLayerResult => {
  const source = new VectorSource<GeometryFeature>({ wrapX: false });
  const layer = new VectorLayer({
    source,
    style: new Style({
      fill: new Fill({ color: "rgba(16,185,129,0.2)" }),
      stroke: new Stroke({ color: "#0f766e", width: 2, lineDash: [6, 4] }),
    }),
    visible: true,
  });

  return { layer, source };
};
