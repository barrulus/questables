import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import { getCellStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export interface CreateCellsLayerOptions {
  visible: boolean;
}

export const createCellsLayer = ({
  visible,
}: CreateCellsLayerOptions): GeometryLayer => {
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature) => getCellStyle(feature as Feature<Geometry>),
    visible,
  });
};
