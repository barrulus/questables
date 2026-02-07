import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import {
  createRouteStyleFactory,
  type ZoomResolver,
} from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateRoutesLayerOptions {
  resolveZoom: ZoomResolver;
  visible: boolean;
}

export const createRoutesLayer = ({
  resolveZoom,
  visible,
}: CreateRoutesLayerOptions): GeometryLayer => {
  const factory = createRouteStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => factory(feature as Feature<Geometry>, resolution),
    visible,
  });
};
