/**
 * Entity resolver — single source of truth for "does this name correspond to
 * an actual entity in this campaign's world?". Used post-narration by the
 * lore- and NPC-extractors to gate writes back to the DB and stop the LLM
 * from poisoning campaign_world_lore with fabricated places.
 *
 * Exact normalised match only — no fuzzy matching, by design. "Toprak Village"
 * must NOT silently resolve to a real "Toprak" burg, or the hallucination
 * loop returns through a softer back door.
 */
import { query } from '../../db/pool.js';
import { logError } from '../../utils/logger.js';

/**
 * Normalise a name for comparison: lowercase, strip non-alphanumeric punctuation
 * (preserving spaces and apostrophes-as-empty), collapse whitespace, trim.
 * Mirrors `normaliseName` in npc-extractor.js so lookups behave consistently.
 */
export const normaliseName = (name) => {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const RESOLVERS = {
  burg: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT b.id, b.name
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND btrim(regexp_replace(lower(regexp_replace(b.name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY b.id ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.burg' },
    );
    return rows[0] ? { kind: 'burg', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  state: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT DISTINCT b.statefull AS name
         FROM public.maps_burgs b
         JOIN public.campaigns c ON c.world_map_id = b.world_id
        WHERE c.id = $1
          AND b.statefull IS NOT NULL
          AND btrim(regexp_replace(lower(regexp_replace(b.statefull, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY b.statefull ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.state' },
    );
    return rows[0] ? { kind: 'state', id: null, canonicalName: rows[0].name } : null;
  },

  region: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.campaign_map_regions
        WHERE campaign_id = $1
          AND btrim(regexp_replace(lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY id ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.region' },
    );
    return rows[0] ? { kind: 'region', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  npc: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.npcs
        WHERE campaign_id = $1
          AND btrim(regexp_replace(lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY id ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.npc' },
    );
    return rows[0] ? { kind: 'npc', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  location: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.locations
        WHERE campaign_id = $1
          AND is_discovered = true
          AND btrim(regexp_replace(lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY id ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.location' },
    );
    return rows[0] ? { kind: 'location', id: rows[0].id, canonicalName: rows[0].name } : null;
  },

  shop: async (campaignId, normalised) => {
    const { rows } = await query(
      `SELECT id, name
         FROM public.npc_shops
        WHERE campaign_id = $1
          AND btrim(regexp_replace(lower(regexp_replace(name, '[^a-zA-Z0-9 ]+', '', 'g')), '[[:space:]]+', ' ', 'g')) = $2
        ORDER BY id ASC
        LIMIT 1`,
      [campaignId, normalised],
      { label: 'entity-resolver.shop' },
    );
    return rows[0] ? { kind: 'shop', id: rows[0].id, canonicalName: rows[0].name } : null;
  },
};

const MAX_NEARBY_BURGS = 8;

/**
 * Resolve the campaign's world map id once. Used for scoping burg/state lookups.
 */
async function getWorldMapId(campaignId) {
  const { rows } = await query(
    `SELECT world_map_id FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
    { label: 'entity-resolver.world-map-id' },
  );
  return rows[0]?.world_map_id ?? null;
}

const EMPTY_INDEX = Object.freeze({
  burgs: [], states: [], regions: [], npcs: [], locations: [], shops: [],
});

/**
 * Build a scoped index of all named entities relevant to a position on the
 * world map. Used to populate the `## Known entities` block in extractor
 * prompts so the LLM has a positive list to anchor against.
 *
 * Scope mirrors geographic-context-builder: k-nearest burgs (≤ MAX_NEARBY_BURGS
 * + current), `linked_burg_id`-scoped NPCs and shops, geometry-contains regions.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {object} opts.scope
 * @param {string} [opts.scope.insideBurgId]
 * @param {number} [opts.scope.locX]
 * @param {number} [opts.scope.locY]
 * @returns {Promise<{
 *   burgs: Array<{id: string, name: string, statefull: string|null}>,
 *   states: Array<{name: string}>,
 *   regions: Array<{id: string, name: string}>,
 *   npcs: Array<{id: string, name: string}>,
 *   locations: Array<{id: string, name: string}>,
 *   shops: Array<{id: string, name: string}>,
 * }>}
 */
export async function buildEntityIndex({ campaignId, scope = {} }) {
  if (!campaignId) return { ...EMPTY_INDEX };
  const { insideBurgId = null, locX = null, locY = null } = scope;
  if (!insideBurgId && (locX == null || locY == null)) {
    return { ...EMPTY_INDEX };
  }

  try {
    const worldMapId = await getWorldMapId(campaignId);
    if (!worldMapId) return { ...EMPTY_INDEX };

    const haveCoords = typeof locX === 'number' && typeof locY === 'number';
    const pointWkt = haveCoords
      ? `ST_SetSRID(ST_MakePoint(${Number(locX)}, ${Number(locY)}), 0)`
      : null;

    // Burgs: current burg first, then k-nearest others by distance.
    // Caller passes either (insideBurgId + coords), coords only, or insideBurgId only.
    let burgsQuery;
    let burgParams;
    if (insideBurgId && pointWkt) {
      burgParams = [worldMapId, MAX_NEARBY_BURGS, insideBurgId];
      burgsQuery = `
        WITH ranked AS (
          SELECT id, name, statefull,
                 (CASE WHEN id = $3 THEN 0 ELSE 1 END) AS pri,
                 ST_Distance(geom, ${pointWkt}) AS dist
            FROM public.maps_burgs
           WHERE world_id = $1
        )
        SELECT id, name, statefull FROM ranked
         ORDER BY pri ASC, dist ASC
         LIMIT $2 + 1`;
    } else if (pointWkt) {
      burgParams = [worldMapId, MAX_NEARBY_BURGS];
      burgsQuery = `
        SELECT id, name, statefull
          FROM public.maps_burgs
         WHERE world_id = $1
         ORDER BY ST_Distance(geom, ${pointWkt})
         LIMIT $2`;
    } else {
      // insideBurgId only, no coords — return that burg alone.
      burgParams = [worldMapId, insideBurgId];
      burgsQuery = `
        SELECT id, name, statefull
          FROM public.maps_burgs
         WHERE world_id = $1 AND id = $2
         LIMIT 1`;
    }

    const { rows: burgRows } = await query(burgsQuery, burgParams, {
      label: 'entity-resolver.index-burgs',
    });

    const burgIds = burgRows.map((b) => b.id);
    const states = Array.from(
      new Map(burgRows.filter((b) => b.statefull).map((b) => [b.statefull, { name: b.statefull }])).values(),
    );

    // Regions: campaign_map_regions whose geom contains the player point.
    let regionRows = [];
    if (pointWkt) {
      const regionResult = await query(
        `SELECT id, name
           FROM public.campaign_map_regions
          WHERE campaign_id = $1
            AND ST_Contains(region, ${pointWkt})`,
        [campaignId],
        { label: 'entity-resolver.index-regions' },
      );
      regionRows = regionResult.rows;
    }

    // NPCs: linked_burg_id IN (scope burgs).
    let npcRows = [];
    if (burgIds.length > 0) {
      const npcResult = await query(
        `SELECT id, name FROM public.npcs
          WHERE campaign_id = $1 AND linked_burg_id = ANY($2::uuid[])`,
        [campaignId, burgIds],
        { label: 'entity-resolver.index-npcs' },
      );
      npcRows = npcResult.rows;
    }

    // Locations: campaign-scoped, discovered only.
    const { rows: locationRows } = await query(
      `SELECT id, name FROM public.locations
        WHERE campaign_id = $1 AND is_discovered = true`,
      [campaignId],
      { label: 'entity-resolver.index-locations' },
    );

    // Shops: npc_shops where the NPC's linked_burg_id is in scope.
    let shopRows = [];
    if (burgIds.length > 0) {
      const shopResult = await query(
        `SELECT s.id, s.name
           FROM public.npc_shops s
           JOIN public.npcs n ON n.id = s.npc_id
          WHERE s.campaign_id = $1 AND n.linked_burg_id = ANY($2::uuid[])`,
        [campaignId, burgIds],
        { label: 'entity-resolver.index-shops' },
      );
      shopRows = shopResult.rows;
    }

    return {
      burgs: burgRows.map((b) => ({ id: b.id, name: b.name, statefull: b.statefull ?? null })),
      states,
      regions: regionRows.map((r) => ({ id: r.id, name: r.name })),
      npcs: npcRows.map((n) => ({ id: n.id, name: n.name })),
      locations: locationRows.map((l) => ({ id: l.id, name: l.name })),
      shops: shopRows.map((s) => ({ id: s.id, name: s.name })),
    };
  } catch (err) {
    logError('entity-resolver: buildEntityIndex failed', { campaignId, error: err.message });
    return { ...EMPTY_INDEX };
  }
}

/**
 * Resolve a name to an entity in the campaign's world.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.name - Free-text name from narration / extracted lore.
 * @param {Array<'burg'|'state'|'region'|'npc'|'location'|'shop'>} opts.kinds
 *   Search order. First hit wins.
 * @returns {Promise<{kind: string, id: string|null, canonicalName: string}|null>}
 */
export async function resolveEntity({ campaignId, name, kinds }) {
  if (!campaignId || !name || !Array.isArray(kinds) || kinds.length === 0) {
    return null;
  }
  const normalised = normaliseName(name);
  if (!normalised) return null;

  for (const kind of kinds) {
    const resolver = RESOLVERS[kind];
    if (!resolver) continue;
    try {
      const hit = await resolver(campaignId, normalised);
      if (hit) return hit;
    } catch (err) {
      logError('entity-resolver: lookup failed', { campaignId, kind, name, error: err.message });
      // Swallow and try next kind. If every kind fails, return null.
    }
  }
  return null;
}
