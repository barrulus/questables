import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Stroke } from 'ol/style';

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
  const fallbackStyle = new Style({
    stroke: new Stroke({ color: '#8b5cf6', width: 2 })
  });
  const factory = createRouteStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => {
      const style = factory(feature as Feature<Geometry>, resolution);
      return style ?? fallbackStyle;
    },
    visible,
  });
};
