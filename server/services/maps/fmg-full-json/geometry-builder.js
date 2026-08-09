// Pure geometry builder: turns FMG pack.cells[].v[] + pack.vertices[].p[] into
// closed WKT POLYGONs ready for ST_GeomFromText with SRID 0.
//
// COORDINATE CONVENTION: FMG pixel space is Y-down (y=0 at the north edge,
// y=height at the south edge). Every PostGIS `geom` column in this schema
// stores the QUESTABLES_PIXEL convention instead — Y-up, i.e. the FMG Y
// negated, so the world occupies y ∈ [-height, 0] and matches
// `maps_world.bounds` ({north: 0, south: -height}). The raw FMG scalars
// (maps_burgs.xpixel/ypixel, maps_markers.x_px/y_px, pole_x/pole_y, …) stay
// unflipped; only geometry is negated. See `negateY` below.
//
// Vertex lookup is built once as a Float64Array of (x, y) pairs indexed by
// vertex.i. FMG indices can be sparse (any non-negative integer), so we size
// the array to maxIndex+1 and use NaN as a sentinel for "no vertex here".

export function buildVertexLookup(vertices) {
  let maxIdx = -1;
  for (const v of vertices) if (v.i > maxIdx) maxIdx = v.i;
  const lookup = new Float64Array((maxIdx + 1) * 2);
  lookup.fill(Number.NaN);
  for (const v of vertices) {
    lookup[v.i * 2] = v.p[0];
    lookup[v.i * 2 + 1] = v.p[1];
  }
  return lookup;
}

// Flip an FMG pixel Y into QUESTABLES_PIXEL world Y. `|| 0` collapses the
// `-0` that negating 0 produces so WKT never carries a "-0" literal.
export function negateY(y) {
  if (y === null || y === undefined) return null;
  const n = -Number(y);
  return n === 0 ? 0 : n;
}

export function buildCellPolygonsWkt(cells, vertices) {
  const lookup = buildVertexLookup(vertices);
  const result = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.v) { result[i] = null; continue; }
    // Validate all vertex references first (throws on unknown vertex)
    for (let j = 0; j < c.v.length; j++) {
      const vi = c.v[j];
      const x = lookup[vi * 2];
      if (x === undefined || Number.isNaN(x)) throw new Error(`vertex ${vi} not found (cell ${c.i})`);
    }
    if (c.v.length < 3) { result[i] = null; continue; }
    const parts = [];
    for (let j = 0; j < c.v.length; j++) {
      const vi = c.v[j];
      parts.push(`${lookup[vi * 2]} ${negateY(lookup[vi * 2 + 1])}`);
    }
    // close ring
    parts.push(parts[0]);
    result[i] = `POLYGON((${parts.join(',')}))`;
  }
  return result;
}
