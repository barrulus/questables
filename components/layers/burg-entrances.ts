import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import {
  createBurgEntranceStyleFactory,
  type ZoomResolver,
} from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateBurgEntrancesLayerOptions {
  resolveZoom: ZoomResolver;
  visible: boolean;
}

export const createBurgEntrancesLayer = ({
  resolveZoom,
  visible,
}: CreateBurgEntrancesLayerOptions): GeometryLayer => {
  const factory = createBurgEntranceStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) =>
      factory(feature as Feature<Geometry>, resolution),
    visible,
  });
};
