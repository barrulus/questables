// FMG biome integer codes (matches Azgaar's Fantasy Map Generator ordering).
// Index = biome integer stored in maps_cells.biome.
const FMG_BIOME_NAMES = [
  'marine',                       //  0
  'hot desert',                   //  1
  'cold desert',                  //  2
  'savanna',                      //  3
  'grassland',                    //  4
  'tropical seasonal forest',     //  5
  'temperate deciduous forest',   //  6
  'tropical rainforest',          //  7
  'temperate rainforest',         //  8
  'taiga',                        //  9
  'tundra',                       // 10
  'glacier',                      // 11
  'wetland',                      // 12
];

// `maps_cells.type` comes from FMG's `isLand` field — the value `"island"` is
// a stringified boolean meaning "this cell IS LAND", NOT a landmass label.
// Treat it as a binary land/water hint only; never expose it as a noun.
const WATER_TYPES = new Set(['ocean', 'lake']);

/**
 * Format a terrain cell row from `maps_cells` into a human-readable phrase
 * suitable for an LLM prompt. Returns null when there's nothing useful to
 * say (e.g. unknown biome on a land cell with no elevation).
 *
 * @param {{ biome?: number|null, type?: string|null, height?: number|null }} cell
 * @returns {string|null}
 */
export function describeTerrainCell(cell) {
  if (!cell) return null;
  const { biome, type, height } = cell;

  // Water cells: prefer the type hint over the biome (marine biome 0 reads
  // weirdly for an inland lake, and ocean reads weirdly for a coastal cell
  // that FMG classed as marine).
  if (typeof type === 'string' && WATER_TYPES.has(type)) {
    if (type === 'ocean') return 'open ocean';
    if (type === 'lake') return 'lake water';
  }

  const parts = [];
  if (Number.isInteger(biome) && biome >= 0 && biome < FMG_BIOME_NAMES.length) {
    parts.push(FMG_BIOME_NAMES[biome]);
  }
  if (Number.isFinite(height) && height > 0) {
    parts.push(`${height}m elevation`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}
