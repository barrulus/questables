import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import {
  createMarkerStyleFactory,
  type ZoomResolver,
} from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateMarkersLayerOptions {
  resolveZoom: ZoomResolver;
  visible: boolean;
}

export const createMarkersLayer = ({
  resolveZoom,
  visible,
}: CreateMarkersLayerOptions): GeometryLayer => {
  const factory = createMarkerStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => factory(feature as Feature<Geometry>, resolution),
    visible,
  });
};
