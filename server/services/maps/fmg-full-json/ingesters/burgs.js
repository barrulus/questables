import { upsertCoa } from './coats.js';
import { negateY } from '../geometry-builder.js';

const PORT_THRESHOLD = 0.4;

function entityById(arr, id) {
  if (id == null) return null;
  const entity = Array.isArray(arr) ? arr[id] : null;
  if (!entity || typeof entity !== 'object') return null;
  return entity;
}

function nameById(arr, id) {
  return entityById(arr, id)?.name ?? null;
}

// fullName falls back to name when the export omits it (e.g. unnamed/neutral
// entries), matching the fallback the legacy GeoJSON pipeline baked into its
// stateFull/provinceFull properties.
function fullNameById(arr, id) {
  const entity = entityById(arr, id);
  if (!entity) return null;
  return entity.fullName ?? entity.name ?? null;
}

function intOrNull(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Math.round(Number(v));
}

export async function ingestBurgs(client, worldId, parsed, log) {
  log(0, 'Burgs');
  const burgs = (parsed.pack?.burgs || []).filter((b, i) => b && typeof b === 'object' && i > 0);
  if (burgs.length === 0) { log(100, 'No burgs'); return { rowCount: 0 }; }

  const states = parsed.pack?.states || [];
  const provinces = parsed.pack?.provinces || [];
  const cultures = parsed.pack?.cultures || [];
  const religions = parsed.pack?.religions || [];
  const cells = parsed.pack?.cells || [];

  for (let idx = 0; idx < burgs.length; idx++) {
    const b = burgs[idx];
    // Real FMG full-JSON exports don't always carry province/religion
    // directly on the burg — they're per-cell attributes. Prefer the burg's
    // own field when present (e.g. test fixtures), otherwise fall back to
    // the owning cell's province/religion id.
    const cell = b.cell != null ? cells[b.cell] : null;
    const provinceId = b.province ?? cell?.province ?? null;
    const religionId = b.religion ?? cell?.religion ?? null;

    await client.query(
      `INSERT INTO public.maps_burgs
        (world_id, burg_id, name, state, statefull, province, provincefull, culture, religion,
         population, elevation, capital, port, citadel, walls, plaza,
         temple, shanty, xpixel, ypixel, cell, type, is_large_port,
         is_regional_center, settlement_type, base_population, "group", feature, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
               ST_SetSRID(ST_MakePoint($19, $29), 0))
       ON CONFLICT (world_id, burg_id) DO UPDATE SET
         name=EXCLUDED.name, state=EXCLUDED.state, statefull=EXCLUDED.statefull,
         province=EXCLUDED.province, provincefull=EXCLUDED.provincefull,
         culture=EXCLUDED.culture, religion=EXCLUDED.religion,
         population=EXCLUDED.population, elevation=EXCLUDED.elevation,
         capital=EXCLUDED.capital, port=EXCLUDED.port, citadel=EXCLUDED.citadel,
         walls=EXCLUDED.walls, plaza=EXCLUDED.plaza, temple=EXCLUDED.temple,
         shanty=EXCLUDED.shanty, xpixel=EXCLUDED.xpixel, ypixel=EXCLUDED.ypixel,
         cell=EXCLUDED.cell, type=EXCLUDED.type, is_large_port=EXCLUDED.is_large_port,
         is_regional_center=EXCLUDED.is_regional_center,
         settlement_type=EXCLUDED.settlement_type,
         base_population=EXCLUDED.base_population, "group"=EXCLUDED."group",
         feature=EXCLUDED.feature, geom=EXCLUDED.geom`,
      [
        worldId, b.i, b.name ?? null,
        nameById(states, b.state),
        fullNameById(states, b.state),
        nameById(provinces, provinceId),
        fullNameById(provinces, provinceId),
        nameById(cultures, b.culture),
        nameById(religions, religionId),
        intOrNull(b.population),
        intOrNull(b.elevation),
        Boolean(b.capital),
        Boolean(b.port),
        Boolean(b.citadel),
        Boolean(b.walls),
        Boolean(b.plaza),
        Boolean(b.temple),
        Boolean(b.shanty),
        b.x ?? null, b.y ?? null,
        b.cell ?? null, b.type ?? null,
        b.port > PORT_THRESHOLD,
        Boolean(b.capital),
        b.settlementType ?? null, b.basePopulation ?? null,
        b.group ?? null, b.feature ?? null,
        // $29: geom Y only. xpixel/ypixel ($19/$20) stay raw FMG pixels — the
        // settlemaker/entrance stack reads those; geom is Y-up per
        // QUESTABLES_PIXEL.
        negateY(b.y ?? null),
      ],
    );
    if (b.coa) await upsertCoa(client, worldId, 'burg', b.i, b.coa);
    if (idx % 200 === 0) log(Math.floor((idx / burgs.length) * 100), `burgs ${idx}/${burgs.length}`);
  }
  log(100, `${burgs.length} burgs`);
  return { rowCount: burgs.length };
}
