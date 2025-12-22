import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';

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
  const fallbackStyle = new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: '#ef4444' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      offsetY: -14,
      font: '12px sans-serif',
      fill: new Fill({ color: '#111827' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
    })
  });

  const factory = createBurgStyleFactory(resolveZoom);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => {
      const style = factory(feature as Feature<Geometry>, resolution);
      if (style) return style;
      const name = (feature as Feature<Geometry>).get('name') || '';
      const text = fallbackStyle.getText();
      if (text) text.setText(String(name));
      return fallbackStyle;
    },
    visible,
  });
};
