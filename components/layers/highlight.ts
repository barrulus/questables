import type Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Style from "ol/style/Style";

export interface CreateHighlightLayerOptions {
  style: Style;
  visible?: boolean;
}

export type HighlightFeature = Feature<Point>;
export type HighlightLayer = VectorLayer<VectorSource<HighlightFeature>>;

export const createHighlightLayer = ({
  style,
  visible = true,
}: CreateHighlightLayerOptions): HighlightLayer => {
  return new VectorLayer({
    source: new VectorSource<HighlightFeature>({ wrapX: false }),
    style,
    visible,
  });
};
