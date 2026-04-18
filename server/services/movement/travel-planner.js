import {
  DAILY_MILES_PER_MODE,
  FALLBACK_PIXELS_PER_DAY,
  SUPPORTED_MODES,
  SUPPORTED_VIA,
} from './travel-config.js';

function invalid(code, message) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function segmentLength(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1], points[i]);
  return total;
}

function pointAtDistanceAlong(points, distance) {
  if (points.length === 0) return null;
  if (distance <= 0) return { ...points[0] };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = segmentLength(points[i - 1], points[i]);
    if (acc + seg >= distance) {
      const remaining = distance - acc;
      const t = seg === 0 ? 0 : remaining / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    acc += seg;
  }
  return { ...points[points.length - 1] };
}

function resolveDailyPixels(mode, pixelsPerMile) {
  if (mode === 'teleport') return Number.POSITIVE_INFINITY;
  if (mode === 'fly')      return FALLBACK_PIXELS_PER_DAY.fly;
  if (pixelsPerMile != null && pixelsPerMile > 0) {
    return DAILY_MILES_PER_MODE[mode] * pixelsPerMile;
  }
  return FALLBACK_PIXELS_PER_DAY[mode];
}

function computeCampPoints(waypoints, dailyPixels, totalDays, distancePixels) {
  if (totalDays <= 1 || !Number.isFinite(dailyPixels) || distancePixels === 0) return [];
  const camps = [];
  for (let day = 1; day < totalDays; day++) {
    const distance = day * dailyPixels;
    if (distance >= distancePixels) break;
    const pt = pointAtDistanceAlong(waypoints, distance);
    camps.push({ x: pt.x, y: pt.y, day });
  }
  return camps;
}

async function loadWorldCalibration(client, worldId) {
  const { rows } = await client.query(
    `SELECT pixels_per_mile FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  if (rows.length === 0) throw invalid('invalid_world', `World ${worldId} not found`);
  return rows[0].pixels_per_mile;
}

export async function planTravel(client, { worldId, start, end, mode, via }) {
  if (!SUPPORTED_MODES.includes(mode)) {
    throw invalid('invalid_mode', `Unsupported mode: ${mode}`);
  }
  const viaIsRouteId = typeof via === 'string' && /^[0-9a-f-]{36}$/i.test(via);
  if (!SUPPORTED_VIA.includes(via) && !viaIsRouteId) {
    throw invalid('invalid_via', `Unsupported via: ${via}`);
  }

  const pixelsPerMile = await loadWorldCalibration(client, worldId);
  const dailyPixels = resolveDailyPixels(mode, pixelsPerMile);

  if (mode === 'teleport' || mode === 'fly' || via === 'direct') {
    const distancePixels = segmentLength(start, end);
    const waypoints = distancePixels === 0 ? [{ ...start }] : [{ ...start }, { ...end }];
    const totalDays = mode === 'teleport' || distancePixels === 0
      ? 0
      : Math.max(1, Math.ceil(distancePixels / dailyPixels));
    return {
      waypoints,
      distancePixels,
      distanceMiles: pixelsPerMile != null && pixelsPerMile > 0
        ? distancePixels / pixelsPerMile
        : null,
      totalDays,
      campPoints: computeCampPoints(waypoints, dailyPixels, totalDays, distancePixels),
      effectiveVia: 'direct',
      dailyPixels,
    };
  }

  // via === 'roads' OR via === '<route_uuid>' — implemented in Task 4.
  throw invalid('not_implemented', `road snapping not yet implemented — landed in Task 4`);
}
