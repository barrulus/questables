import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import type { GeometryLayer } from './types';

export const createZonesLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: new Style({
      fill: new Fill({ color: 'rgba(255,200,0,0.18)' }),
      stroke: new Stroke({ color: 'rgba(180,140,0,0.7)', width: 1.5, lineDash: [4, 4] }),
    }),
    visible,
  });
