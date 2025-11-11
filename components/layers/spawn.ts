import type Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

export type SpawnFeature = Feature<Point>;
export type SpawnLayer = VectorLayer<VectorSource<SpawnFeature>>;

export const createSpawnLayer = (): SpawnLayer => {
  return new VectorLayer({
    source: new VectorSource<SpawnFeature>({ wrapX: false }),
  });
};
