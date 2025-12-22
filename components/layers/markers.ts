import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Text, Fill, Stroke } from 'ol/style';

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
  const fallbackStyle = new Style({
    text: new Text({
      text: '❖',
      font: '18px sans-serif',
      fill: new Fill({ color: '#000' }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
    })
  });
  const factory = createMarkerStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => {
      const style = factory(feature as Feature<Geometry>, resolution);
      return style ?? fallbackStyle;
    },
    visible,
  });
};
