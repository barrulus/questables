import {
  DAILY_MILES_PER_MODE,
  FALLBACK_PIXELS_PER_DAY,
  SUPPORTED_MODES,
  SUPPORTED_VIA,
} from './travel-config.js';
import { logWarn } from '../../utils/logger.js';

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

async function snapPointToNearestRoute(client, worldId, point, via) {
  const viaIsRouteId = typeof via === 'string' && /^[0-9a-f-]{36}$/i.test(via);
  const params = [worldId, point.x, point.y];
  let where = `mr.world_id = $1`;
  if (viaIsRouteId) {
    params.push(via);
    where += ` AND mr.id = $4::uuid`;
  }
  const { rows } = await client.query(
    `WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 0) AS geom)
     SELECT mr.id AS route_id,
            ST_X(ST_ClosestPoint(mr.geom, pt.geom)) AS snap_x,
            ST_Y(ST_ClosestPoint(mr.geom, pt.geom)) AS snap_y,
            ST_LineLocatePoint(ST_LineMerge(mr.geom), pt.geom) AS loc_fraction,
            ST_Distance(mr.geom, pt.geom) AS distance
       FROM public.maps_routes mr, pt
      WHERE ${where}
      ORDER BY distance ASC
      LIMIT 1`,
    params,
  );
  if (rows.length === 0) return { snap: null };
  return { snap: rows[0] };
}

async function extractRouteSubstring(client, routeId, fracA, fracB) {
  const { rows } = await client.query(
    `WITH segment AS (
       SELECT ST_LineSubstring(ST_LineMerge(mr.geom), $2, $3) AS geom
         FROM public.maps_routes mr
        WHERE mr.id = $1::uuid
     )
     SELECT json_agg(
              json_build_object('x', ST_X((dp).geom), 'y', ST_Y((dp).geom))
              ORDER BY (dp).path
            ) AS points
       FROM (SELECT ST_DumpPoints(geom) AS dp FROM segment) s`,
    [routeId, fracA, fracB],
  );
  return rows[0]?.points ?? [];
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

  // via === 'roads' OR via === '<route_uuid>'
  const { snap: startSnap } = await snapPointToNearestRoute(client, worldId, start, via);
  const { snap: endSnap }   = await snapPointToNearestRoute(client, worldId, end,   via);

  let waypoints;
  let effectiveVia;

  if (startSnap && endSnap && startSnap.route_id === endSnap.route_id) {
    const [fracA, fracB] = startSnap.loc_fraction <= endSnap.loc_fraction
      ? [startSnap.loc_fraction, endSnap.loc_fraction]
      : [endSnap.loc_fraction, startSnap.loc_fraction];
    const routeMiddle = await extractRouteSubstring(client, startSnap.route_id, fracA, fracB);

    // When the snap-start fraction is larger, the substring we fetched runs
    // from end→start direction. Reverse so the middle flows start→end.
    const middle = startSnap.loc_fraction <= endSnap.loc_fraction
      ? routeMiddle
      : [...routeMiddle].reverse();

    waypoints = [{ ...start }, ...middle, { ...end }];
    effectiveVia = viaIsRouteId ? via : 'roads';
  } else {
    logWarn('travel-planner: road snap failed, falling back to direct line', {
      worldId,
      startSnap: startSnap ? { routeId: startSnap.route_id, distance: startSnap.distance } : null,
      endSnap: endSnap ? { routeId: endSnap.route_id, distance: endSnap.distance } : null,
    });
    waypoints = segmentLength(start, end) === 0 ? [{ ...start }] : [{ ...start }, { ...end }];
    effectiveVia = 'direct';
  }

  const distancePixels = polylineLength(waypoints);
  const totalDays = distancePixels === 0
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
    effectiveVia,
    dailyPixels,
  };
}
