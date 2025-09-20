/**
 * @jest-environment node
 */
/* eslint-env node */

import { beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';

let pool;
let PoolCtor;

const env = process.env ?? {};

beforeAll(async () => {
  ({ Pool: PoolCtor } = await import('../server/node_modules/pg/lib/index.js'));
  pool = new PoolCtor({
    host: env.DATABASE_HOST || 'localhost',
    port: env.DATABASE_PORT ? Number(env.DATABASE_PORT) : 5432,
    database: env.DATABASE_NAME || env.PGDATABASE || 'dnd_app',
    user: env.DATABASE_USER || env.PGUSER || env.USER,
    password: env.DATABASE_PASSWORD || env.PGPASSWORD || '',
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
});

afterAll(async () => {
  await pool?.end?.();
});

describe('LLMContextManager', () => {
  const insertedIds = {
    users: [],
    characters: [],
    campaign: null,
    campaignPlayers: [],
    session: null,
    sessionParticipants: [],
    location: null,
    npc: null,
    encounter: null,
    encounterParticipants: [],
    chatMessages: [],
  };

  const insertUser = async ({ username, email, roles = ['player'] }) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.user_profiles (id, username, email, roles)
       VALUES ($1, $2, $3, $4)`,
      [id, username, email, roles]
    );
    insertedIds.users.push(id);
    return id;
  };

  const insertCharacter = async ({ userId, name }) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.characters (
         id, user_id, name, class, level, race, background, hit_points, armor_class,
         speed, proficiency_bonus, abilities, saving_throws, skills, inventory, equipment,
         avatar_url, backstory, personality, ideals, bonds, flaws, spellcasting
       ) VALUES (
         $1, $2, $3, 'Wizard', 5, 'Human', 'Scholar', '{"current": 32, "max": 38}'::jsonb,
         14, 30, 3, '{"intelligence": 18}'::jsonb, '{}', '{}', '[]', '{}',
         NULL, NULL, 'Studious and curious.', 'Knowledge is power.', 'Protect the innocent.', 'Avoid needless harm.', '{}'
       )`,
      [id, userId, name]
    );
    insertedIds.characters.push(id);
    return id;
  };

  const cleanup = async () => {
    const tables = [
      'chat_messages',
      'encounter_participants',
      'encounters',
      'npc_relationships',
      'npcs',
      'locations',
      'session_participants',
      'sessions',
      'campaign_players',
      'campaigns',
      'characters',
      'user_profiles',
    ];

    for (const table of tables) {
      if (table === 'user_profiles') {
        if (insertedIds.users.length > 0) {
          await pool.query(`DELETE FROM public.${table} WHERE id = ANY($1::uuid[])`, [insertedIds.users]);
        }
        continue;
      }
      const key = {
        chat_messages: 'chatMessages',
        encounter_participants: 'encounterParticipants',
        encounters: 'encounter',
        npc_relationships: null,
        npcs: 'npc',
        locations: 'location',
        session_participants: 'sessionParticipants',
        sessions: 'session',
        campaign_players: 'campaignPlayers',
        campaigns: 'campaign',
        characters: 'characters',
      }[table];

      if (!key) continue;

      const ids = Array.isArray(insertedIds[key]) ? insertedIds[key] : insertedIds[key] ? [insertedIds[key]] : [];
      if (ids.length > 0) {
        await pool.query(`DELETE FROM public.${table} WHERE id = ANY($1::uuid[])`, [ids]);
      }
    }
  };

  afterAll(async () => {
    await cleanup();
  });

  it('assembles campaign context from live data and builds provider-aware prompts', async () => {
    const dmId = await insertUser({ username: 'dm_context', email: 'dm_context@example.com', roles: ['dm'] });
    const playerId = await insertUser({ username: 'player_context', email: 'player_context@example.com' });

    const campaignId = randomUUID();
    await pool.query(
      `INSERT INTO public.campaigns (
         id, name, description, dm_user_id, system, setting, status, max_players,
         level_range, is_public, allow_spectators, auto_approve_join_requests
       ) VALUES (
         $1, 'The Shattered Spire', 'High stakes intrigue in a floating city.', $2,
         'D&D 5e', 'Custom', 'active', 5,
         '{"min": 5, "max": 10}'::jsonb, true, false, false
       )`,
      [campaignId, dmId]
    );
    insertedIds.campaign = campaignId;

    const characterId = await insertCharacter({ userId: playerId, name: 'Aria Nightwind' });

    const campaignPlayerId = randomUUID();
    await pool.query(
      `INSERT INTO public.campaign_players (
         id, campaign_id, user_id, character_id, status, role
       ) VALUES ($1, $2, $3, $4, 'active', 'player')`,
      [campaignPlayerId, campaignId, playerId, characterId]
    );
    insertedIds.campaignPlayers.push(campaignPlayerId);

    const sessionId = randomUUID();
    await pool.query(
      `INSERT INTO public.sessions (
         id, campaign_id, session_number, title, summary, status,
         scheduled_at, started_at, ended_at
       ) VALUES (
         $1, $2, 3, 'Session Three: Echoes in the Spire',
         'The party confronts the spectral guardian beneath the city.',
         'active', NOW() + INTERVAL '1 hour', NOW() - INTERVAL '30 minutes', NULL
       )`,
      [sessionId, campaignId]
    );
    insertedIds.session = sessionId;

    const sessionParticipantId = randomUUID();
    await pool.query(
      `INSERT INTO public.session_participants (
         id, session_id, user_id, character_id, attendance_status, character_level_start, character_level_end
       ) VALUES (
         $1, $2, $3, $4, 'present', 5, 5
       )`,
      [sessionParticipantId, sessionId, playerId, characterId]
    );
    insertedIds.sessionParticipants.push(sessionParticipantId);

    const locationId = randomUUID();
    await pool.query(
      `INSERT INTO public.locations (
         id, campaign_id, name, description, type, is_discovered, features
       ) VALUES (
         $1, $2, 'Vault of Whispers', 'A crystalline chamber humming with arcane power.', 'dungeon', true,
         '["arcane resonance", "floating sigils"]'::jsonb
       )`,
      [locationId, campaignId]
    );
    insertedIds.location = locationId;

    const npcId = randomUUID();
    await pool.query(
      `INSERT INTO public.npcs (
         id, campaign_id, name, description, race, occupation, personality, motivations, current_location_id
       ) VALUES (
         $1, $2, 'Seren Valis', 'An enigmatic archivist bound to the spire.', 'Elf', 'Archivist',
         'Soft-spoken, precise, wary of outsiders.', 'Preserve the knowledge within the spire.', $3
       )`,
      [npcId, campaignId, locationId]
    );
    insertedIds.npc = npcId;

    const relationshipId = randomUUID();
    await pool.query(
      `INSERT INTO public.npc_relationships (
         id, npc_id, target_id, target_type, relationship_type, description, strength
       ) VALUES (
         $1, $2, $3, 'character', 'ally', 'Trusts Aria after a shared ritual.', 2
       )`,
      [relationshipId, npcId, characterId]
    );

    const encounterId = randomUUID();
    await pool.query(
      `INSERT INTO public.encounters (
         id, campaign_id, session_id, location_id, name, description, type, difficulty, status
       ) VALUES (
         $1, $2, $3, $4, 'Spectral Guardian', 'A lingering defense of the spire.', 'combat', 'hard', 'active'
       )`,
      [encounterId, campaignId, sessionId, locationId]
    );
    insertedIds.encounter = encounterId;

    const encounterParticipantId = randomUUID();
    await pool.query(
      `INSERT INTO public.encounter_participants (
         id, encounter_id, participant_id, participant_type, name, initiative, hit_points, armor_class, conditions, has_acted
       ) VALUES (
         $1, $2, $3, 'character', 'Aria Nightwind', 14, '{"current": 32, "max": 38}'::jsonb, 14, '[]'::jsonb, false
       )`,
      [encounterParticipantId, encounterId, characterId]
    );
    insertedIds.encounterParticipants.push(encounterParticipantId);

    const chatId = randomUUID();
    await pool.query(
      `INSERT INTO public.chat_messages (
         id, campaign_id, session_id, content, message_type, sender_id, sender_name, character_id, created_at
       ) VALUES (
         $1, $2, $3, 'Hold formation, the guardian is reforming!', 'text', $4, 'Aria Nightwind', $5, NOW()
       )`,
      [chatId, campaignId, sessionId, playerId, characterId]
    );
    insertedIds.chatMessages.push(chatId);

    const { LLMContextManager } = await import('../server/llm/context/context-manager.js');
    const manager = new LLMContextManager({ pool });
    const gameContext = await manager.buildGameContext({ campaignId, sessionId });

    expect(gameContext.campaign.name).toBe('The Shattered Spire');
    expect(gameContext.session.title).toBe('Session Three: Echoes in the Spire');
    expect(gameContext.party.length).toBeGreaterThanOrEqual(1);
    expect(gameContext.npcs[0].name).toBe('Seren Valis');
    expect(gameContext.locations[0].name).toBe('Vault of Whispers');
    expect(gameContext.encounters[0].name).toBe('Spectral Guardian');
    expect(gameContext.chat.recentMessages[0].content).toMatch('Hold formation');

    const providerStub = { name: 'ollama', model: 'qwen3:8b', defaultOptions: { temperature: 0.7, top_p: 0.9 } };
    const callArguments = {};

    const fakeLLMService = {
      getProvider: () => providerStub,
      async generate(options) {
        Object.assign(callArguments, options);
        return {
          content: 'stub response',
          provider: { name: providerStub.name, model: providerStub.model },
          metrics: { latencyMs: 1 },
          cache: { hit: false, key: 'stub' },
        };
      },
    };

    const { createContextualLLMService } = await import('../server/llm/contextual-service.js');
    const contextual = createContextualLLMService({ pool, llmService: fakeLLMService, providerName: 'ollama' });
    const generated = await contextual.generateFromContext({
      campaignId,
      sessionId,
      type: 'dm_narration',
      request: { focus: 'Describe the guardian\'s counter-attack.' },
      metadata: { requestId: 'integration-test' },
    });

    expect(generated.provider.model).toBe('qwen3:8b');
    expect(generated.prompt.user).toMatch('Game Context Snapshot');
    expect(callArguments.model).toBe('qwen3:8b');
    expect(callArguments.metadata.providerModel).toBe('qwen3:8b');
    expect(callArguments.metadata.campaignId).toBe(campaignId);
  }, 20000);
});
