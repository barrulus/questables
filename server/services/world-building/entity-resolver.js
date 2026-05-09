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
    .replace(/[[:space:]]+/g, ' ')
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
