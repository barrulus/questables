import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import { getRiverStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateRiversLayerOptions {
  visible: boolean;
}

export const createRiversLayer = ({
  visible,
}: CreateRiversLayerOptions): GeometryLayer => {
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature) => getRiverStyle(feature as Feature<Geometry>),
    visible,
  });
};
