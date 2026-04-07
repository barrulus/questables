// Reset all session history for a campaign so the next session starts fresh.
//
// Wipes:
//   - chat_messages       (entire transcript — what the DM reads as recentNarrations)
//   - session_player_actions (the action queue / history)
//   - npcs                (and their npc_memories / npc_relationships via cascade)
//   - encounters          (and encounter_participants via cascade)
//   - llm_narratives      (the prompt/response cache history)
//   - game_state_log      (the per-session state log)
//   - campaign_world_lore WHERE generated_by = 'llm'  (keeps manually-seeded lore)
//   - campaign_players.current_scene := NULL          (so players are not anchored to a sub-scene)
//
// Does NOT touch:
//   - characters / campaign_players (membership stays)
//   - sessions rows themselves      (status/title/summary preserved)
//   - session_live_states           (HP/conditions preserved per user request)
//   - campaign_spawns               (seed-intro.mjs handles spawn placement)
//   - campaign_world_lore generated_by = 'manual'
//
// Usage: node scripts/reset-session.mjs [--campaign <uuid>] [--dry-run]
//        Defaults to the same CAMPAIGN_ID as seed-intro.mjs.

import { query } from '../server/db/pool.js';

const DEFAULT_CAMPAIGN_ID = '259d40d6-4ad7-4950-8f45-a30ab9f31d8d';

function parseArgs() {
  const args = process.argv.slice(2);
  let campaignId = DEFAULT_CAMPAIGN_ID;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--campaign' && args[i + 1]) {
      campaignId = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { campaignId, dryRun };
}

async function counts(campaignId) {
  const c = async (sql, params) => Number((await query(sql, params)).rows[0].n);
  return {
    chat_messages:           await c('SELECT COUNT(*)::int AS n FROM chat_messages WHERE campaign_id = $1', [campaignId]),
    session_player_actions:  await c('SELECT COUNT(*)::int AS n FROM session_player_actions WHERE campaign_id = $1', [campaignId]),
    npcs:                    await c('SELECT COUNT(*)::int AS n FROM npcs WHERE campaign_id = $1', [campaignId]),
    npc_memories:            await c('SELECT COUNT(*)::int AS n FROM npc_memories WHERE campaign_id = $1', [campaignId]),
    encounters:              await c('SELECT COUNT(*)::int AS n FROM encounters WHERE campaign_id = $1', [campaignId]),
    llm_narratives:          await c('SELECT COUNT(*)::int AS n FROM llm_narratives WHERE campaign_id = $1', [campaignId]),
    game_state_log:          await c(
      `SELECT COUNT(*)::int AS n FROM game_state_log
         WHERE session_id IN (SELECT id FROM sessions WHERE campaign_id = $1)`,
      [campaignId],
    ),
    llm_world_lore:          await c(
      `SELECT COUNT(*)::int AS n FROM campaign_world_lore
         WHERE campaign_id = $1 AND generated_by = 'llm'`,
      [campaignId],
    ),
    players_with_scene:      await c(
      `SELECT COUNT(*)::int AS n FROM campaign_players
         WHERE campaign_id = $1 AND current_scene IS NOT NULL`,
      [campaignId],
    ),
  };
}

async function main() {
  const { campaignId, dryRun } = parseArgs();

  const campaignRow = (await query('SELECT name FROM campaigns WHERE id = $1', [campaignId])).rows[0];
  if (!campaignRow) {
    console.error(`Campaign ${campaignId} not found.`);
    process.exit(1);
  }

  console.log(`Resetting campaign: ${campaignRow.name} (${campaignId})`);
  if (dryRun) console.log('[DRY RUN — no changes will be written]');

  const before = await counts(campaignId);
  console.log('\nBefore:');
  for (const [k, v] of Object.entries(before)) console.log(`  ${k.padEnd(24)} ${v}`);

  if (dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to delete.');
    process.exit(0);
  }

  await query('BEGIN');
  try {
    // Order is mostly cosmetic since FKs are ON DELETE CASCADE / SET NULL,
    // but we delete leaf history first so the row counts log meaningfully.
    await query('DELETE FROM game_state_log WHERE session_id IN (SELECT id FROM sessions WHERE campaign_id = $1)', [campaignId]);
    await query('DELETE FROM llm_narratives WHERE campaign_id = $1', [campaignId]);
    await query('DELETE FROM session_player_actions WHERE campaign_id = $1', [campaignId]);
    await query('DELETE FROM chat_messages WHERE campaign_id = $1', [campaignId]);
    await query('DELETE FROM encounters WHERE campaign_id = $1', [campaignId]);  // cascades encounter_participants
    await query('DELETE FROM npcs WHERE campaign_id = $1', [campaignId]);        // cascades npc_memories, npc_relationships
    await query("DELETE FROM campaign_world_lore WHERE campaign_id = $1 AND generated_by = 'llm'", [campaignId]);
    await query('UPDATE campaign_players SET current_scene = NULL WHERE campaign_id = $1', [campaignId]);
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    console.error('\nReset failed, rolled back:', err);
    process.exit(1);
  }

  const after = await counts(campaignId);
  console.log('\nAfter:');
  for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(24)} ${v}`);

  console.log('\nDone. Run `node scripts/seed-intro.mjs` next to post a fresh opening.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
