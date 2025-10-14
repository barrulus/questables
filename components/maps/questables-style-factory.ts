import type FeatureLike from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Feature from 'ol/Feature';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';

const ROUTE_BASE_COLOR = '#8B5CF6';

const DEFAULT_ROUTE_STYLE = new Style({
  stroke: new Stroke({
    color: ROUTE_BASE_COLOR,
    width: 2.5,
    lineCap: 'round',
    lineJoin: 'round'
  })
});

const ROUTE_STYLE_CONFIG: Record<string, { minZoom: number; styles: Style[] }> = {
  trade: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#C084FC',
          width: 3,
          lineCap: 'round',
          lineJoin: 'round'
        })
      }),
      new Style({
        stroke: new Stroke({
          color: '#8B5CF6',
          width: 1.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [14, 6]
        })
      })
    ]
  },
  pilgrimage: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#10B981',
          width: 2.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [6, 8]
        })
      })
    ]
  },
  naval: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#38BDF8',
          width: 2.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [4, 6]
        })
      })
    ]
  },
  footpath: {
    minZoom: 7,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#D2B48C',
          width: 2.0,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [1, 8]
        })
      })
    ]
  }
};

const DEFAULT_ROUTE_STYLES = [DEFAULT_ROUTE_STYLE];

const MARKER_TYPE_ICONS: Record<string, string> = {
  circuses: '🎪',
  mirage: '💦',
  caves: '🦇',
  jousts: '🤺',
  waterfalls: '⟱',
  inns: '🍻',
  'hot-springs': '♨️',
  dungeons: '🗝️',
  'hill-monsters': '👹',
  'water-sources': '💧',
  bridges: '🌉',
  'sea-monsters': '🦑',
  canoes: '🛶',
  'disturbed-burials': '💀',
  volcanoes: '🌋',
  libraries: '📚',
  pirates: '🏴‍☠️',
  rifts: '🎆',
  'sacred-pineries': '🌲',
  'lake-monsters': '🐉',
  battlefields: '⚔️',
  'sacred-forests': '🌳',
  brigands: '💰',
  lighthouses: '🚨',
  encounters: '🧙',
  statues: '🗿',
  necropolises: '🪦',
  migration: '🐗',
  ruins: '🏺',
  fairs: '🎠',
  mines: '⛏️',
  portals: '🌀'
};

export const LABEL_VISIBILITY = {
  burgs: 3,
  markers: 6,
  campaignLocations: 7,
  pins: 6
} as const;

const BURG_ZOOM_RULES = [
  { minZoom: 6, minPopulation: 0 },
  { minZoom: 5, minPopulation: 250 },
  { minZoom: 4, minPopulation: 1000 },
  { minZoom: 3, minPopulation: 10000 }
] as const;

const BURG_CATEGORY_THRESHOLDS = [
  { minPopulation: 10000, category: 'city' },
  { minPopulation: 1000, category: 'town' },
  { minPopulation: 250, category: 'village' },
  { minPopulation: 0, category: 'hamlet' }
] as const;

type BurgCategory = typeof BURG_CATEGORY_THRESHOLDS[number]['category'];

const BURG_STYLE_CONFIG: Record<BurgCategory, { radius: number; fill: string; stroke: string; font: string }> = {
  city: { radius: 9, fill: '#1f78ff', stroke: '#ffffff', font: 'bold 13px "Inter", sans-serif' },
  town: { radius: 7, fill: '#4c9c2d', stroke: '#ffffff', font: 'bold 12px "Inter", sans-serif' },
  village: { radius: 6, fill: '#c17d25', stroke: '#ffffff', font: '12px "Inter", sans-serif' },
  hamlet: { radius: 5, fill: '#7b7f8c', stroke: '#ffffff', font: '12px "Inter", sans-serif' }
};

const asGeometryFeature = (feature: FeatureLike): Feature<Geometry> => feature as Feature<Geometry>;

const getMinPopulationForZoom = (zoom: number): number => {
  const rule = BURG_ZOOM_RULES.find(({ minZoom }) => zoom >= minZoom);
  return rule ? rule.minPopulation : Number.POSITIVE_INFINITY;
};

const getBurgCategory = (population: number): BurgCategory => {
  const match = BURG_CATEGORY_THRESHOLDS.find(({ minPopulation }) => population >= minPopulation);
  return match ? match.category : 'hamlet';
};

export type ZoomResolver = (_resolution: number) => number;

export const createBurgStyleFactory = (getZoomForResolution: ZoomResolver) => {
  const cache: Record<string, Style> = {};

  return (featureLike: FeatureLike, resolution: number): Style | undefined => {
    const feature = asGeometryFeature(featureLike);
    const data = feature.get('data');
    const zoom = getZoomForResolution(resolution);
    if (!Number.isFinite(zoom)) return undefined;

    const effectiveZoom = Math.floor(zoom);
    const population = Number(
      data?.population ?? data?.populationraw ?? data?.populationRaw ?? 0
    );
    const minPopulation = getMinPopulationForZoom(effectiveZoom);

    if (population < minPopulation || effectiveZoom < 3) {
      return undefined;
    }

    const category = getBurgCategory(population);
    const cacheKey = `${category}-${data?.capital ? 'capital' : 'standard'}`;
    const showLabel = effectiveZoom >= LABEL_VISIBILITY.burgs;

    let style = cache[cacheKey];
    if (!style) {
      const config = BURG_STYLE_CONFIG[category];
      const radius = config.radius + (data?.capital ? 2 : 0);

      style = new Style({
        image: new CircleStyle({
          radius,
          fill: new Fill({ color: data?.capital ? '#FFD700' : config.fill }),
          stroke: new Stroke({ color: config.stroke, width: 2 })
        }),
        text: new Text({
          offsetY: -radius - 10,
          font: config.font,
          fill: new Fill({ color: '#1f2933' }),
          stroke: new Stroke({ color: '#ffffff', width: 3 }),
          placement: 'point'
        })
      });

      cache[cacheKey] = style;
    }

    const text = style.getText();
    if (text) {
      text.setText(showLabel ? data?.name || feature.get('name') || '' : '');
    }

    return style;
  };
};

export const createRouteStyleFactory = (getZoomForResolution: ZoomResolver) => {
  return (featureLike: FeatureLike, resolution: number): Style[] | Style | undefined => {
    const feature = asGeometryFeature(featureLike);
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom)) {
      return undefined;
    }

    const routeType = String(data?.type ?? feature.get('type') ?? '');
    const config = ROUTE_STYLE_CONFIG[routeType];
    if (config) {
      if ((zoom as number) < config.minZoom) {
        return undefined;
      }
      return config.styles;
    }

    return (zoom as number) >= 3 ? DEFAULT_ROUTE_STYLES : undefined;
  };
};

export const createMarkerStyleFactory = (getZoomForResolution: ZoomResolver) => {
  const markerIconCache: Record<string, Style> = {};

  return (featureLike: FeatureLike, resolution: number): Style | Style[] | undefined => {
    const feature = asGeometryFeature(featureLike);
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom) || (zoom as number) < LABEL_VISIBILITY.markers) {
      return undefined;
    }

    const type = String(data?.type ?? feature.get('type') ?? '');
    const icon = MARKER_TYPE_ICONS[type] ?? '?';

    let iconStyle = markerIconCache[type];
    if (!iconStyle) {
      iconStyle = new Style({
        text: new Text({
          text: icon,
          font: '20px sans-serif',
          textBaseline: 'middle',
          textAlign: 'center',
          fill: new Fill({ color: '#000' }),
          stroke: new Stroke({ color: '#FFF', width: 3 }),
          placement: 'point'
        })
      });
      markerIconCache[type] = iconStyle;
    }

    const showLabel = (zoom as number) >= LABEL_VISIBILITY.markers;
    const labelText = showLabel ? data?.name || '' : '';
    if (!labelText) {
      return iconStyle;
    }

    const labelStyle = new Style({
      text: new Text({
        text: labelText,
        offsetY: -24,
        font: '10px sans-serif',
        fill: new Fill({ color: '#111827' }),
        stroke: new Stroke({ color: '#FFF', width: 3 }),
        textAlign: 'center',
        textBaseline: 'bottom',
        placement: 'point'
      })
    });

    return [iconStyle, labelStyle];
  };
};

export const getRiverStyle = (featureLike: FeatureLike): Style => {
  const feature = asGeometryFeature(featureLike);
  const data = feature.get('data');
  return new Style({
    stroke: new Stroke({
      color: '#4FC3F7',
      width: Math.max(2, (data?.width || 1) * 2)
    })
  });
};

const getBiomeColor = (biome: number): string => {
  switch (biome) {
    case 1: return 'rgba(34,139,34,0.3)';
    case 2: return 'rgba(218,165,32,0.3)';
    case 3: return 'rgba(70,130,180,0.3)';
    case 4: return 'rgba(128,128,128,0.3)';
    default: return 'rgba(144,238,144,0.3)';
  }
};

export const getCellStyle = (featureLike: FeatureLike): Style => {
  const feature = asGeometryFeature(featureLike);
  const data = feature.get('data');
  return new Style({
    fill: new Fill({
      color: getBiomeColor(Number(data?.biome))
    }),
    stroke: new Stroke({
      color: 'rgba(0,0,0,0.1)',
      width: 0.5
    })
  });
};
