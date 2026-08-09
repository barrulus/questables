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

export type PolityFeatureKind =
  | 'regiment'
  | 'state'
  | 'province'
  | 'culture'
  | 'religion'
  | 'zone';

/**
 * Identify one of the six polity/military feature kinds loaded by
 * `MapDataLoader.loadPolity` (states, provinces, cultures, religions, zones,
 * regiments). These features are parsed straight from GeoJSON and never get a
 * `type`/`featureType` tag (see `featuresFromGeoJson` in map-data-loader.tsx),
 * so — unlike burgs/markers/routes/players — they can't be classified via
 * `getFeatureTypeFromProperties`. A GeoJSON `type` property does exist on
 * zone features (the zone's own kind, e.g. "mystical"), which would collide
 * with the generic dispatcher if it were consulted, so polity kind is
 * resolved from distinguishing id properties instead.
 *
 * Order matters: a regiment feature also carries `state_id` (the owning
 * state), so `regiment_id` MUST be checked first. Likewise, every province
 * feature from `GET /:worldId/provinces` also carries a non-null `state_id`
 * (the owning state), so `province_id` MUST be checked before `state_id`.
 */
export const getPolityFeatureKind = (feature: FeatureLike | null): PolityFeatureKind | null => {
  if (!feature) return null;
  const gf = feature as GeometryFeature;
  if (gf.get('regiment_id') != null) return 'regiment';
  if (gf.get('province_id') != null) return 'province';
  if (gf.get('state_id') != null) return 'state';
  if (gf.get('culture_id') != null) return 'culture';
  if (gf.get('religion_id') != null) return 'religion';
  if (gf.get('zone_id') != null) return 'zone';
  return null;
};

/**
 * Build the hover tooltip info for a polity/military feature (state,
 * province, culture, religion, zone, or regiment).
 */
const buildPolityTooltipInfo = (gf: GeometryFeature, kind: PolityFeatureKind): HoverTooltipInfo => {
  switch (kind) {
    case 'state': {
      const name = gf.get('full_name') ?? gf.get('name') ?? 'Unnamed state';
      const form = gf.get('form');
      return { title: String(name), subtitle: form ? String(form) : 'State', details: null };
    }
    case 'province': {
      const name = gf.get('full_name') ?? gf.get('name') ?? 'Unnamed province';
      const form = gf.get('form_name') ?? gf.get('form');
      return { title: String(name), subtitle: form ? String(form) : 'Province', details: null };
    }
    case 'culture': {
      const name = gf.get('name') ?? 'Unnamed culture';
      return { title: String(name), subtitle: 'Culture', details: null };
    }
    case 'religion': {
      const name = gf.get('name') ?? 'Unnamed religion';
      const deity = gf.get('deity');
      return {
        title: String(name),
        subtitle: 'Religion',
        details: deity ? [String(deity)] : null,
      };
    }
    case 'zone': {
      const name = gf.get('name') ?? 'Unnamed zone';
      const zoneType = gf.get('type');
      return {
        title: String(name),
        subtitle: zoneType ? String(zoneType) : 'Zone',
        details: null,
      };
    }
    case 'regiment': {
      const name = gf.get('name') ?? 'Regiment';
      const unitLabels: Array<[string, string]> = [
        ['u_infantry', 'Infantry'],
        ['u_archers', 'Archers'],
        ['u_cavalry', 'Cavalry'],
        ['u_artillery', 'Artillery'],
        ['u_fleet', 'Fleet'],
      ];
      const details = unitLabels
        .map(([key, label]) => [label, gf.get(key)] as const)
        .filter(([, value]) => typeof value === 'number' && value > 0)
        .map(([label, value]) => `${label}: ${(value as number).toLocaleString()}`);
      const totalMen = gf.get('total_men');
      if (typeof totalMen === 'number' && totalMen > 0) {
        details.unshift(`Total: ${totalMen.toLocaleString()}`);
      }
      return {
        title: String(name),
        subtitle: 'Regiment',
        details: details.length > 0 ? details : null,
      };
    }
  }
};

/**
 * Build a complete hover tooltip info object for any map feature.
 */
export const buildHoverTooltipInfo = (feature: FeatureLike): HoverTooltipInfo => {
  const gf = feature as GeometryFeature;

  const polityKind = getPolityFeatureKind(feature);
  if (polityKind) {
    return buildPolityTooltipInfo(gf, polityKind);
  }

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
