import type { FeatureLike } from 'ol/Feature';
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';

type GeometryFeature = Feature<Geometry>;

/**
 * Extract the feature type string from a feature's properties or nested data.
 */
export const getFeatureTypeFromProperties = (feature: FeatureLike | null): string | null => {
  if (!feature) return null;
  const rawType = (feature as GeometryFeature).get('type') ?? (feature as GeometryFeature).get('featureType');
  if (typeof rawType === 'string' && rawType.trim().length > 0) {
    return rawType.trim();
  }
  const data = (feature as GeometryFeature).get('data');
  if (data && typeof data === 'object' && 'type' in data && typeof data.type === 'string') {
    return data.type.trim();
  }
  return null;
};

/**
 * Classify a burg by its population, capital status, and port status into a
 * human-readable category label (e.g. "Capital", "Port city", "Village").
 */
export const getBurgCategoryLabel = (data: Record<string, unknown>): string => {
  const pop = Number(data.population ?? data.populationraw ?? data.populationRaw ?? 0);
  const isCapital = Boolean(data.capital);
  const isPort = Boolean(data.port);
  const size = pop >= 10000 ? 'city' : pop >= 1000 ? 'town' : pop >= 250 ? 'village' : 'hamlet';

  if (isCapital) return 'Capital';
  if (isPort && size === 'village') return 'Fishing village';
  if (isPort && size === 'hamlet') return 'Fishing hamlet';
  if (isPort) return `Port ${size}`;
  return size[0].toUpperCase() + size.slice(1);
};

/**
 * Build rich detail lines for a burg (population, elevation, temperature,
 * culture, religion).
 */
export const buildBurgDetailLines = (data: Record<string, unknown>): string[] => {
  const lines: string[] = [];
  const pop = data.population ?? data.populationraw ?? data.populationRaw;
  if (pop != null) lines.push(`Pop. ${Number(pop).toLocaleString()}`);
  if (data.elevation != null) lines.push(`Elev. ${data.elevation}`);
  if (data.temperature != null) lines.push(`Temp. ${data.temperature}`);
  if (data.culture) lines.push(String(data.culture));
  if (data.religion) lines.push(String(data.religion));
  return lines;
};

/**
 * Compute the subtitle/type label for a feature hover tooltip.
 * Handles burg categories, route subtypes, and generic feature types.
 */
export const computeFeatureSubtitle = (
  layerType: string | null,
  data: Record<string, unknown> | null,
): string | null => {
  if (!layerType && !data) return null;

  const subtype = data && typeof data === 'object' && 'type' in data && typeof data.type === 'string'
    ? data.type.trim()
    : null;

  if (layerType === 'burg' && data) {
    return getBurgCategoryLabel(data);
  }

  if (subtype && layerType && subtype !== layerType) {
    return subtype[0].toUpperCase() + subtype.slice(1) + ' ' + layerType;
  }

  const label = subtype ?? layerType;
  if (label) return label[0].toUpperCase() + label.slice(1);
  return null;
};

export interface HoverTooltipInfo {
  title: string;
  subtitle: string | null;
  details: string[] | null;
}

/**
 * Build a complete hover tooltip info object for any map feature.
 */
export const buildHoverTooltipInfo = (feature: FeatureLike): HoverTooltipInfo => {
  const gf = feature as GeometryFeature;
  const data = gf.get('data') ?? gf.getProperties();
  const layerType = getFeatureTypeFromProperties(feature);

  const title: string =
    data?.name ??
    gf.get('name') ??
    layerType ??
    'Feature';

  const subtitle = computeFeatureSubtitle(
    layerType,
    data && typeof data === 'object' ? data as Record<string, unknown> : null,
  );

  let details: string[] | null = null;
  if (layerType === 'burg' && data && typeof data === 'object') {
    const lines = buildBurgDetailLines(data as Record<string, unknown>);
    if (lines.length > 0) details = lines;
  }

  return { title, subtitle, details };
};
