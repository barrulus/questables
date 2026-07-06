// Coastline geometry loader for settlemaker 0.4.0+.
//
// Returns water polygons around a burg in settlement-local coordinates
// (origin = burg centre, +x east, +y south, scale = R_LOCAL / R_WORLD_PX).
// Settlemaker uses point-in-polygon classification against these rings to
// place harbours and erase farmland on water-side patches.
//
// Coord conversions:
//   maps_cells.geom and maps_burgs.geom both store xpixel/ypixel multiplied
//   by 10000 with y negated (PostGIS y-up). pixel-space is y-down. Local
//   space is y-down (SVG convention) per the settlemaker contract, so the
//   only flip happens when leaving geom-space.

const GEOM_TO_PIXEL = 1 / 10000;

// Pixel-space radius around the burg from which we collect water cells.
//
// Continental lakes in FMG can span hundreds of px; we want to hand
// settlemaker the full contiguous water body near the burg, not just a
// thin slice, so the rendered settlement sees a lake and not a puddle.
//
// - Floor (60 px) handles fine-scale worlds where 60 px is already a few
//   km out.
// - Target (3000 km) captures continental water bodies on coarse worlds
//   like Snoopia (10 km/px → 300 px).
// - Ceiling (500 px) caps cell-count on ultra-fine worlds where the meters
//   target would balloon into thousands of cells.
const MIN_R_WORLD_PX = 60;
const MAX_R_WORLD_PX = 500;
const TARGET_R_WORLD_METERS = 3_000_000;

// Settlement-local diameter target. Matches settlemaker's `scale.diameter_local`
// default; on re-ingest we substitute the previous sidecar's value.
const DEFAULT_R_LOCAL = 100;

async function loadMetersPerPixel(client, worldId) {
  const { rows } = await client.query(
    `SELECT meters_per_pixel FROM public.maps_world WHERE id = $1 LIMIT 1`,
    [worldId],
  );
  return rows[0]?.meters_per_pixel ? Number(rows[0].meters_per_pixel) : null;
}

function parsePolygonRings(geojsonStr) {
  const g = JSON.parse(geojsonStr);
  if (g?.type !== 'Polygon') return [];
  const rings = [];
  // Emit the exterior ring AND every interior ring (island holes).
  // Settlemaker classifies water by even-odd ring parity, so a centroid
  // inside lake-outer + island-hole counts twice → land. Dropping holes
  // here would flood islands.
  for (const ring of g.coordinates ?? []) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    // GeoJSON closes the ring (last == first); settlemaker's contract is
    // "Don't repeat the first vertex at the end" — strip it.
    rings.push(ring.slice(0, -1));
  }
  return rings;
}

export async function loadCoastlineGeometry(client, burg, opts = {}) {
  let rWorldPx;
  if (Number.isFinite(opts.rWorldPx)) {
    rWorldPx = opts.rWorldPx;
  } else {
    const mpp = await loadMetersPerPixel(client, burg.world_id);
    const target = mpp ? TARGET_R_WORLD_METERS / mpp : MIN_R_WORLD_PX;
    rWorldPx = Math.min(MAX_R_WORLD_PX, Math.max(MIN_R_WORLD_PX, target));
  }
  const rLocal = Number.isFinite(opts.rLocal) ? opts.rLocal : DEFAULT_R_LOCAL;
  const rWorldGeom = rWorldPx / GEOM_TO_PIXEL; // pixel → geom units

  // ST_Union merges adjacent water cells into contiguous water bodies before
  // dumping. Without it every FMG Voronoi cell arrives as its own tiny ring
  // and settlemaker's point-in-polygon classification produces scattered
  // water patches instead of a coherent shoreline (e.g. burg 15953
  // "Ertelenlik": 772 lake cells → water confetti around the town).
  const { rows } = await client.query(
    `WITH b AS (SELECT geom FROM public.maps_burgs WHERE id = $1)
     SELECT ST_AsGeoJSON((ST_Dump(ST_Union(c.geom))).geom) AS poly
       FROM public.maps_cells c, b
      WHERE c.world_id = $2
        AND c.type IN ('ocean','lake')
        AND ST_DWithin(c.geom, b.geom, $3)`,
    [burg.id, burg.world_id, rWorldGeom],
  );

  if (rows.length === 0) return [];

  const burgPxX = Number(burg.x_px);
  const burgPxY = Number(burg.y_px);
  const scale = rLocal / rWorldPx;

  const polygons = [];
  for (const r of rows) {
    for (const ring of parsePolygonRings(r.poly)) {
      const local = ring.map(([gx, gy]) => {
        // geom → pixel (y un-flip from PostGIS y-up to pixel y-down)
        const cellPxX = gx * GEOM_TO_PIXEL;
        const cellPxY = -gy * GEOM_TO_PIXEL;
        // burg-local pixel offset (y-down)
        const dxPx = cellPxX - burgPxX;
        const dyPx = cellPxY - burgPxY;
        // settlement-local scale
        return { x: dxPx * scale, y: dyPx * scale };
      });
      polygons.push(local);
    }
  }
  return polygons;
}

// Compass bearing (0 = N, clockwise) from burg to the centroid of the
// nearest water polygon in settlement-local coords. Used as the
// `oceanBearing` fallback when settlemaker can't infer one from the
// coastline alone.
export function bearingToNearestWaterCentroid(coastlineLocal) {
  let best = null;
  let bestDist = Infinity;
  for (const ring of coastlineLocal) {
    if (ring.length === 0) continue;
    let cx = 0;
    let cy = 0;
    for (const p of ring) { cx += p.x; cy += p.y; }
    cx /= ring.length;
    cy /= ring.length;
    const d2 = cx * cx + cy * cy;
    if (d2 < bestDist) {
      bestDist = d2;
      best = { x: cx, y: cy };
    }
  }
  if (!best) return undefined;
  // y-down: bearing = atan2(dx, -dy)
  return ((Math.atan2(best.x, -best.y) * 180 / Math.PI) + 360) % 360;
}
