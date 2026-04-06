// One-off script: reset spawn, reposition players, and post an opening narration.
//
// Usage: node scripts/seed-intro.mjs

import Anthropic from '../server/node_modules/@anthropic-ai/sdk/index.mjs';
import { query } from '../server/db/pool.js';
import { extractAndPersistNpcs } from '../server/services/world-building/npc-extractor.js';

const CAMPAIGN_ID = '259d40d6-4ad7-4950-8f45-a30ab9f31d8d';
const DURE_X = 10153000;
const DURE_Y = -11619000;
const SPAWN_NOTE = "On the muddy track at the edge of Dure, a fifty-soul herder village in Turk Parish, a forgotten frontier of the Imamah of Bovazobyurt. Low wooden huts, a sagging shrine to Yel, sheep pens, and the scent of woodsmoke. Hills rise to the west.";

async function main() {
  // 1. Look up campaign + session + spawn + players
  const campaignRow = (await query('SELECT name, description, setting FROM campaigns WHERE id = $1', [CAMPAIGN_ID])).rows[0];
  const sessionRow = (await query("SELECT id, title, summary, dm_focus, dm_notes FROM sessions WHERE campaign_id = $1 AND status = 'active' LIMIT 1", [CAMPAIGN_ID])).rows[0];

  if (!campaignRow || !sessionRow) {
    console.error('Campaign or active session not found');
    process.exit(1);
  }

  // 2. Update the spawn point to Dure with the new note
  await query(
    `UPDATE campaign_spawns
        SET world_position = ST_SetSRID(ST_MakePoint($1, $2), 0),
            note = $3,
            name = 'Outside Dure'
      WHERE campaign_id = $4 AND is_default = true`,
    [DURE_X, DURE_Y, SPAWN_NOTE, CAMPAIGN_ID]
  );
  console.log('Spawn updated.');

  // 3. Move all active players back to the spawn point
  await query(
    `UPDATE campaign_players
        SET loc_current = ST_SetSRID(ST_MakePoint($1, $2), 0),
            inside_burg_id = NULL,
            current_map_level = 'world',
            last_located_at = NOW()
      WHERE campaign_id = $3 AND status = 'active'`,
    [DURE_X, DURE_Y, CAMPAIGN_ID]
  );
  console.log('Players repositioned to spawn.');

  // 4. Get the active party for the prompt
  const partyRows = (await query(
    `SELECT ch.name, ch.race, ch.class, ch.level, up.username
       FROM campaign_players cp
       JOIN characters ch ON cp.character_id = ch.id
       JOIN user_profiles up ON cp.user_id = up.id
      WHERE cp.campaign_id = $1 AND cp.status = 'active'
      ORDER BY cp.joined_at ASC`,
    [CAMPAIGN_ID]
  )).rows;

  const partyDescription = partyRows
    .map((p) => `${p.name} (${p.race} ${p.class}, Level ${p.level}, played by ${p.username})`)
    .join('\n');

  // 5. Build the opening narration prompt
  const systemPrompt = `You are the Dungeon Master opening the first scene of a D&D 5e campaign session. This is the ONLY time you may set the scene. Players need a vivid but tight opening that grounds them in where they are, who is around, and what trouble has brought them here.

RULES:
- Plain prose. NO JSON. NO markdown.
- 4-6 sentences. Short paragraphs. No purple prose.
- Ground EVERY detail in the campaign brief and spawn description provided below. Do NOT invent new locations, gods, factions, or NPCs not implied by the brief.
- End with a clear question or hook that invites the players to act ("What do you do?" or similar).
- Address the party by their character names.`;

  const userPrompt = `## Campaign Brief
Name: ${campaignRow.name}
Setting: ${campaignRow.setting}

${campaignRow.description}

## Session Brief
Title: ${sessionRow.title}
Summary: ${sessionRow.summary}
Current focus: ${sessionRow.dm_focus}

## Spawn Location
${SPAWN_NOTE}

## The Party
${partyDescription}

## Task
Write the opening narration for the first scene of this session. The party has just arrived at the spawn location. Set the immediate scene, introduce one minor detail or NPC that creates a hook, and invite them to act.`;

  console.log('Calling Anthropic for opening narration...');

  const apiKey = (await query("SELECT api_key FROM llm_providers WHERE name = 'anthropic'")).rows[0]?.api_key
    || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('No Anthropic API key found in DB or env');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const narration = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  console.log('\n--- OPENING NARRATION ---\n');
  console.log(narration);
  console.log('\n--- END ---\n');

  // 6. Get the DM user id for the chat message
  const dmUserId = (await query('SELECT dm_user_id FROM campaigns WHERE id = $1', [CAMPAIGN_ID])).rows[0]?.dm_user_id;
  if (!dmUserId) {
    console.error('Could not find dm_user_id for campaign');
    process.exit(1);
  }

  // 7. Insert as a DM broadcast message in the chat
  const dmName = (await query('SELECT username FROM user_profiles WHERE id = $1', [dmUserId])).rows[0]?.username || 'DM';
  await query(
    `INSERT INTO chat_messages
        (campaign_id, session_id, content, message_type, sender_id, sender_name, channel_type, loc_x, loc_y)
     VALUES ($1, $2, $3, 'narration', $4, $5, 'dm_broadcast', $6, $7)`,
    [CAMPAIGN_ID, sessionRow.id, narration, dmUserId, dmName, DURE_X, DURE_Y]
  );
  console.log('Posted opening narration to chat as dm_broadcast.');

  // 8. Run the NPC extractor on the opening so any NPCs introduced become canonical
  const llmService = {
    async generate({ prompt, systemPrompt, schema }) {
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        temperature: 0.3,
        system: (systemPrompt || '') + (schema ? `\n\nRespond with a single valid JSON object matching this schema. No prose. No markdown.\n${JSON.stringify(schema)}` : ''),
        messages: [{ role: 'user', content: prompt }],
      });
      const content = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      let parsed = null;
      try {
        const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        parsed = JSON.parse(fenced ? fenced[1] : content);
      } catch {}
      return { content, parsed };
    },
  };

  // Pick the first active player as the "acting" character so the first-meeting memory has a target
  const firstActive = (await query(
    "SELECT character_id FROM campaign_players WHERE campaign_id = $1 AND status = 'active' ORDER BY joined_at ASC LIMIT 1",
    [CAMPAIGN_ID]
  )).rows[0];

  console.log('Running NPC extractor on opening narration...');
  const extracted = await extractAndPersistNpcs({
    campaignId: CAMPAIGN_ID,
    narrationContent: narration,
    llmService,
    sessionId: sessionRow.id,
    actingCharacterId: firstActive?.character_id ?? null,
    locX: DURE_X,
    locY: DURE_Y,
  });
  console.log('NPCs persisted from opening:', extracted.map((n) => n.name));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
