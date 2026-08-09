import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { createPolityStyle } from '../maps/questables-style-factory';
import type { GeometryLayer } from './types';

export const createCulturesLayer = ({ visible }: { visible: boolean }): GeometryLayer => {
  const factory = createPolityStyle(0.25, 'rgba(40,40,40,0.4)', 0.5);
  return new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feature, resolution) => factory(feature as Feature<Geometry>, resolution),
    visible,
  });
};
