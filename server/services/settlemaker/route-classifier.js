const SEA_TYPES = new Set(['searoute', 'sea', 'ship']);
const FOOT_TYPES = new Set(['trail', 'footpath']);

/**
 * Map maps_routes.type to settlemaker's RouteKind.
 * Unknown or missing types default to 'road' — the most permissive option.
 */
export function classifyRouteKind(routeType) {
  if (typeof routeType !== 'string') return 'road';
  const t = routeType.toLowerCase();
  if (SEA_TYPES.has(t)) return 'sea';
  if (FOOT_TYPES.has(t)) return 'foot';
  return 'road';
}
