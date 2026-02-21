import { query, withClient } from '../../db/pool.js';
import { getViewerContextOrThrow, ensureDmControl } from '../campaigns/service.js';
import { fetchSessionWithCampaign } from '../sessions/service.js';

const serializeValue = (value) => (typeof value === 'object' && value !== null
  ? JSON.stringify(value)
  : value);

export const createNpc = async ({
  campaignId,
  name,
  description,
  race,
  occupation,
  personality,
  appearance,
  motivations,
  secrets,
  currentLocationId,
  stats,
}) => {
  const { rows } = await query(
    `INSERT INTO public.npcs (
        campaign_id,
        name,
        description,
        race,
        occupation,
        personality,
        appearance,
        motivations,
        secrets,
        current_location_id,
        stats
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      campaignId,
      name,
      description ?? null,
      race ?? null,
      occupation ?? null,
      personality ?? null,
      appearance ?? null,
      motivations ?? null,
      secrets ?? null,
      currentLocationId ?? null,
      stats ? JSON.stringify(stats) : null,
    ],
    { label: 'npcs.create' },
  );

  return rows[0] ?? null;
};

export const listNpcs = async (campaignId) => {
  const { rows } = await query(
    `SELECT n.*, l.name AS location_name
       FROM public.npcs n
       LEFT JOIN public.locations l ON n.current_location_id = l.id
      WHERE n.campaign_id = $1
      ORDER BY n.name`,
    [campaignId],
    { label: 'npcs.list' },
  );
  return rows;
};

export const updateNpc = async (npcId, updates) => {
  const entries = Object.entries(updates)
    .filter(([key]) => !['id', 'created_at'].includes(key));

  if (entries.length === 0) {
    const error = new Error('No valid fields to update');
    error.status = 400;
    error.code = 'no_updates_provided';
    throw error;
  }

  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`);
  const values = entries.map(([, value]) => serializeValue(value));
  assignments.push('updated_at = NOW()');
  values.push(npcId);

  const { rows } = await query(
    `UPDATE public.npcs
        SET ${assignments.join(', ')}
      WHERE id = $${values.length}
      RETURNING *`,
    values,
    { label: 'npcs.update' },
  );

  return rows[0] ?? null;
};

export const deleteNpc = async (npcId) => {
  const { rows } = await query(
    'DELETE FROM public.npcs WHERE id = $1 RETURNING name',
    [npcId],
    { label: 'npcs.delete' },
  );
  return rows[0] ?? null;
};

export const upsertNpcRelationship = async ({
  npcId,
  targetId,
  targetType,
  relationshipType,
  description,
  strength,
}) => {
  const { rows } = await query(
    `INSERT INTO public.npc_relationships (
        npc_id,
        target_id,
        target_type,
        relationship_type,
        description,
        strength
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (npc_id, target_type, target_id) DO UPDATE SET
       relationship_type = EXCLUDED.relationship_type,
       description = EXCLUDED.description,
       strength = EXCLUDED.strength
     RETURNING *`,
    [
      npcId,
      targetId,
      targetType,
      relationshipType,
      description ?? null,
      strength ?? null,
    ],
    { label: 'npcs.relationships.upsert' },
  );

  return rows[0] ?? null;
};

export const listNpcRelationships = async (npcId) => {
  const { rows } = await query(
    `SELECT nr.*,
            CASE
              WHEN nr.target_type = 'npc' THEN n.name
              WHEN nr.target_type = 'character' THEN c.name
              ELSE nr.target_id
            END AS target_name
       FROM public.npc_relationships nr
       LEFT JOIN public.npcs n ON nr.target_type = 'npc' AND nr.target_id = n.id
       LEFT JOIN public.characters c ON nr.target_type = 'character' AND nr.target_id = c.id
      WHERE nr.npc_id = $1
      ORDER BY nr.strength DESC NULLS LAST`,
    [npcId],
    { label: 'npcs.relationships.list' },
  );

  return rows;
};

/**
 * Write an NPC memory internally (server-side, no DM auth check).
 * Used by automated systems like social dialogue auto-memory.
 */
export const writeNpcMemoryInternal = async (client, {
  npcId,
  campaignId,
  sessionId,
  summary,
  sentiment,
  trustDelta,
  tags,
  characterId,
}) => {
  // Insert memory
  const { rows } = await client.query(
    `INSERT INTO public.npc_memories (
        npc_id, campaign_id, session_id, narrative_id,
        memory_summary, sentiment, trust_delta, tags
     ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
     RETURNING id, npc_id, campaign_id, session_id, memory_summary, sentiment, trust_delta, tags, created_at`,
    [
      npcId,
      campaignId,
      sessionId ?? null,
      summary,
      sentiment,
      trustDelta,
      tags && tags.length > 0 ? tags : null,
    ],
  );

  // Upsert trust delta total on the relationship
  if (characterId) {
    await client.query(
      `INSERT INTO public.npc_relationships (npc_id, target_id, target_type, relationship_type, strength)
       VALUES ($1, $2, 'character', 'acquaintance', $3)
       ON CONFLICT (npc_id, target_type, target_id) DO UPDATE
         SET strength = COALESCE(npc_relationships.strength, 0) + $3`,
      [npcId, characterId, trustDelta],
    );
  }

  return rows[0];
};

export const createNpcSentimentMemory = async ({
  npcId,
  user,
  sessionId,
  summary,
  sentiment,
  trustDelta,
  tags,
}) => withClient(async (client) => {
  await client.query('BEGIN');

  try {
    const npcResult = await client.query(
      'SELECT id, campaign_id FROM public.npcs WHERE id = $1 FOR UPDATE',
      [npcId],
    );

    if (npcResult.rowCount === 0) {
      const error = new Error('NPC not found.');
      error.status = 404;
      error.code = 'npc_not_found';
      throw error;
    }

    const campaignId = npcResult.rows[0].campaign_id;

    const viewer = await getViewerContextOrThrow(client, campaignId, user);
    ensureDmControl(viewer, 'Only the campaign DM or co-DM may adjust NPC sentiment.');

    if (sessionId) {
      const sessionRow = await fetchSessionWithCampaign(client, sessionId, { forUpdate: false });
      if (!sessionRow || sessionRow.campaign_id !== campaignId) {
        const error = new Error('Session not found for this campaign.');
        error.status = 404;
        error.code = 'session_not_found';
        throw error;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO public.npc_memories (
          npc_id,
          campaign_id,
          session_id,
          narrative_id,
          memory_summary,
          sentiment,
          trust_delta,
          tags
       ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
       RETURNING id, npc_id, campaign_id, session_id, memory_summary, sentiment, trust_delta, tags, created_at`,
      [
        npcId,
        campaignId,
        sessionId ?? null,
        summary,
        sentiment,
        trustDelta,
        tags && tags.length > 0 ? tags : null,
      ],
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}, { label: 'npcs.sentiment.create' });
