/**
 * Scene Tracker — applies sceneTransition payloads from DM responses.
 *
 * When the LLM returns a sceneTransition like:
 *   { newScene: "inside Kael's cottage", npcsInScene: ["young Kael"] }
 *
 * we:
 *   1. Update the player's `current_scene`
 *   2. Tag the named NPCs with `scene_tag = newScene` so future proximity
 *      lookups know who is physically inside that sub-location.
 *
 * Subsequent calls to `buildActionContext` filter visible NPCs by the
 * player's current scene, so the herder outside the cottage stays outside.
 */

import { logInfo, logError } from '../../utils/logger.js';

const normaliseName = (name) => name.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();

/**
 * Apply a sceneTransition from a DM response.
 *
 * @param {import('pg').PoolClient} client
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.userId - the acting player whose scene is changing
 * @param {{ newScene: string, npcsInScene?: string[] }} opts.sceneTransition
 */
export async function applySceneTransition(client, { campaignId, userId, sceneTransition }) {
  if (!sceneTransition?.newScene) return;
  const newScene = sceneTransition.newScene.trim();
  if (!newScene) return;

  try {
    // 1. Update the acting player's current_scene
    await client.query(
      `UPDATE public.campaign_players
          SET current_scene = $1
        WHERE campaign_id = $2 AND user_id = $3`,
      [newScene, campaignId, userId],
    );

    // 2. Tag any named NPCs as being in this scene
    const npcNames = Array.isArray(sceneTransition.npcsInScene) ? sceneTransition.npcsInScene : [];
    let taggedCount = 0;

    if (npcNames.length > 0) {
      // Load all campaign NPCs once and match by token overlap
      const { rows: allNpcs } = await client.query(
        `SELECT id, name FROM public.npcs WHERE campaign_id = $1`,
        [campaignId],
      );

      for (const wantedName of npcNames) {
        const wantedNorm = normaliseName(wantedName);
        if (!wantedNorm) continue;
        const wantedTokens = new Set(wantedNorm.split(/\s+/).filter(Boolean));

        let bestMatch = null;
        let bestScore = 0;
        for (const npc of allNpcs) {
          const npcNorm = normaliseName(npc.name);
          const npcTokens = new Set(npcNorm.split(/\s+/).filter(Boolean));
          const overlap = [...wantedTokens].filter((t) => npcTokens.has(t)).length;
          if (overlap > bestScore) {
            bestScore = overlap;
            bestMatch = npc;
          }
        }

        if (bestMatch && bestScore > 0) {
          await client.query(
            `UPDATE public.npcs SET scene_tag = $1 WHERE id = $2`,
            [newScene, bestMatch.id],
          );
          taggedCount += 1;
        }
      }
    }

    logInfo('Scene transition applied', {
      campaignId,
      userId,
      newScene,
      npcsRequested: npcNames.length,
      npcsTagged: taggedCount,
    });
  } catch (err) {
    logError('Failed to apply scene transition', {
      campaignId,
      userId,
      sceneTransition,
      error: err.message,
    });
  }
}
