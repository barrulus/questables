import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import Text from 'ol/style/Text';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { GeometryLayer } from './types';

export const createRegimentsLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feat, _resolution?: number) => {
      const f = feat as Feature<Geometry>;
      const icon = (f.get('icon') as string) || '[R]';
      const men = (f.get('total_men') as number) || 0;
      return new Style({
        text: new Text({
          text: `${icon}\n${men.toLocaleString()}`,
          font: 'bold 11px sans-serif',
          fill: new Fill({ color: '#fff' }),
          stroke: new Stroke({ color: '#000', width: 3 }),
          textAlign: 'center',
          textBaseline: 'middle',
        }),
      });
    },
    visible,
  });

