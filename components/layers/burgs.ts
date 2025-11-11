import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import {
  createBurgStyleFactory,
  type ZoomResolver,
} from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateBurgsLayerOptions {
  resolveZoom: ZoomResolver;
  visible: boolean;
}

export const createBurgsLayer = ({
  resolveZoom,
  visible,
}: CreateBurgsLayerOptions): GeometryLayer => {
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) =>
      createBurgStyleFactory(resolveZoom)(
        feature as Feature<Geometry>,
        resolution,
      ),
    visible,
  });
};
