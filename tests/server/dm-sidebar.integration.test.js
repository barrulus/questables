/**
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';

let app;
let server;
let pool;
let generateToken;
let dmToken;
let testServer;
let baseUrl;
let skipReason = null;

const ids = {};

const createdEncounterIds = [];

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }

  return { response, payload };
};

beforeAll(async () => {
  const { randomUUID } = await import('node:crypto');

  ids.dmUserId = randomUUID();
  ids.dmEmail = `dm_sidebar_${Date.now()}@test.dev`;
  ids.playerUserId = randomUUID();
  ids.playerEmail = `player_sidebar_${Date.now()}@test.dev`;
  ids.campaignId = randomUUID();
  ids.sessionId = randomUUID();
  ids.characterId = randomUUID();
  ids.campaignPlayerId = randomUUID();
  ids.npcId = randomUUID();
  ids.locationId = randomUUID();

  const serverModule = await import('../../server/database-server.js');
  ({ app, server, pool } = serverModule);
  ({ generateToken } = await import('../../server/auth-middleware.js'));

  if (app?.locals?.databaseUnavailable) {
    skipReason = 'Local PostgreSQL access is not available in this environment.';
    return;
  }

  await new Promise((resolve) => {
    testServer = server.listen(0, resolve);
  });
  const address = testServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const dmUsername = `dm_sidebar_${Date.now()}`;
  const playerUsername = `player_sidebar_${Date.now()}`;

  await pool.query(
    `INSERT INTO public.user_profiles (id, username, email, roles)
     VALUES ($1, $2, $3, $4)` ,
    [ids.dmUserId, dmUsername, ids.dmEmail, ['dm']]
  );

  await pool.query(
    `INSERT INTO public.user_profiles (id, username, email, roles)
     VALUES ($1, $2, $3, $4)` ,
    [ids.playerUserId, playerUsername, ids.playerEmail, ['player']]
  );

  await pool.query(
    `INSERT INTO public.characters (id, user_id, name, class, race, background)
     VALUES ($1, $2, $3, $4, $5, $6)` ,
    [ids.characterId, ids.playerUserId, 'Sidebar Hero', 'Wizard', 'Human', 'Scholar']
  );

  await pool.query(
    `INSERT INTO public.campaigns (id, name, description, dm_user_id, status, max_players, level_range, is_public)
     VALUES ($1, $2, $3, $4, 'active', 6, $5, false)` ,
    [ids.campaignId, `Sidebar Campaign ${Date.now()}`, 'DM sidebar integration test campaign', ids.dmUserId, { min: 1, max: 5 }]
  );

  await pool.query(
    `INSERT INTO public.sessions (id, campaign_id, session_number, title, status)
     VALUES ($1, $2, 1, $3, 'active')` ,
    [ids.sessionId, ids.campaignId, 'Sidebar Session']
  );

  await pool.query(
    `INSERT INTO public.campaign_players (id, campaign_id, user_id, character_id, role, status)
     VALUES ($1, $2, $3, $4, 'player', 'active')` ,
    [ids.campaignPlayerId, ids.campaignId, ids.playerUserId, ids.characterId]
  );

  await pool.query(
    `INSERT INTO public.locations (id, campaign_id, name, type)
     VALUES ($1, $2, $3, 'city')` ,
    [ids.locationId, ids.campaignId, 'Sidebar City']
  );

  await pool.query(
    `INSERT INTO public.npcs (id, campaign_id, name, description, race, occupation, personality, motivations, secrets, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb)` ,
    [
      ids.npcId,
      ids.campaignId,
      'Sidebar NPC',
      'A stalwart ally for sidebar tests',
      'Elf',
      'Guardian',
      'Stoic',
      'Protect the realm',
      'Keeps an ancient secret',
    ]
  );

  dmToken = generateToken({ userId: ids.dmUserId });
});

afterAll(async () => {
  if (skipReason) {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
    return;
  }

  const cleanups = [
    ['npc_memories', 'npc_id', ids.npcId],
    ['player_movement_audit', 'campaign_id', ids.campaignId],
    ['encounters', 'id', createdEncounterIds],
    ['campaign_players', 'id', ids.campaignPlayerId],
    ['sessions', 'id', ids.sessionId],
    ['npcs', 'id', ids.npcId],
    ['locations', 'id', ids.locationId],
    ['characters', 'id', ids.characterId],
    ['campaigns', 'id', ids.campaignId],
    ['user_profiles', 'id', ids.playerUserId],
    ['user_profiles', 'id', ids.dmUserId],
  ];

  for (const [table, column, value] of cleanups) {
    try {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          await pool.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [value]);
        }
      } else {
        await pool.query(`DELETE FROM ${table} WHERE ${column} = $1`, [value]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Cleanup failed for ${table}:`, error);
    }
  }

  if (testServer) {
    await new Promise((resolve) => testServer.close(resolve));
  }
});

const guard = () => {
  if (skipReason) {
    globalThis.console?.warn?.(`[DM Sidebar API] ${skipReason}`);
    return true;
  }
  return false;
};

describe('DM Sidebar API', () => {
  it('updates session focus for the DM', async () => {
    if (guard()) {
      return;
    }
    const focusPayload = { focus: 'Track the necromancer.' };
    const { response } = await fetchJson(
      `${baseUrl}/api/sessions/${ids.sessionId}/focus`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(focusPayload),
      }
    );

    expect(response.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT dm_focus FROM public.sessions WHERE id = $1',
      [ids.sessionId]
    );
    expect(rows[0].dm_focus).toBe('Track the necromancer.');
  });

  it('replaces and appends session context markdown', async () => {
    if (guard()) {
      return;
    }
    const replacePayload = {
      context_md: '# Initial Briefing',
      mode: 'replace',
    };
    const replaceResult = await fetchJson(
      `${baseUrl}/api/sessions/${ids.sessionId}/context`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(replacePayload),
      }
    );
    expect(replaceResult.response.status).toBe(200);
    expect(replaceResult.payload?.dmContextMd).toBe('# Initial Briefing');

    const appendPayload = {
      context_md: '## Reinforcements\nTwo griffons arrive at dawn.',
      mode: 'append',
    };
    const appendResult = await fetchJson(
      `${baseUrl}/api/sessions/${ids.sessionId}/context`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(appendPayload),
      }
    );
    expect(appendResult.response.status).toBe(200);
    expect(appendResult.payload?.dmContextMd).toContain('Initial Briefing');
    expect(appendResult.payload?.dmContextMd).toContain('Two griffons arrive at dawn.');
  });

  it('creates an unplanned encounter with manual details', async () => {
    if (guard()) {
      return;
    }
    const encounterPayload = {
      type: 'combat',
      seed: 'Ambushed by spectral riders along the dusk road.',
      difficulty: 'hard',
    };

    const { response, payload } = await fetchJson(
      `${baseUrl}/api/sessions/${ids.sessionId}/unplanned-encounter`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(encounterPayload),
      }
    );

    expect(response.status).toBe(201);
    expect(payload?.encounter?.type).toBe('combat');
    expect(payload?.encounter?.status).toBe('active');

    if (payload?.encounter?.id) {
      createdEncounterIds.push(payload.encounter.id);
    }
  });

  it('records an NPC sentiment adjustment', async () => {
    if (guard()) {
      return;
    }
    const memoryPayload = {
      delta: 3,
      summary: 'The DM reassured the guardian of the party’s noble intentions.',
      sentiment: 'positive',
      tags: ['reassurance', 'trust'],
      sessionId: ids.sessionId,
    };

    const { response, payload } = await fetchJson(
      `${baseUrl}/api/npcs/${ids.npcId}/sentiment`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(memoryPayload),
      }
    );

    expect(response.status).toBe(201);
    expect(payload?.memory?.npc_id).toBe(ids.npcId);
    expect(payload?.memory?.sentiment).toBe('positive');
    expect(payload?.memory?.trust_delta).toBeGreaterThanOrEqual(1);
  });

  it('teleports a player token and writes audit history', async () => {
    if (guard()) {
      return;
    }
    const { rows: beforeAuditRows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.player_movement_audit WHERE player_id = $1',
      [ids.campaignPlayerId]
    );
    const beforeAuditCount = beforeAuditRows[0].count;

    const teleportPayload = {
      playerId: ids.campaignPlayerId,
      target: { x: 123.45, y: 678.9 },
      reason: 'DM reposition during encounter.',
    };

    const { response, payload } = await fetchJson(
      `${baseUrl}/api/campaigns/${ids.campaignId}/teleport/player`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(teleportPayload),
      }
    );

    expect(response.status).toBe(200);
    expect(payload?.geometry?.coordinates?.[0]).toBeCloseTo(123.45, 2);
    expect(payload?.geometry?.coordinates?.[1]).toBeCloseTo(678.9, 2);

    const { rows: positionRows } = await pool.query(
      `SELECT ST_AsGeoJSON(loc_current)::json AS geom
         FROM public.campaign_players
        WHERE id = $1`,
      [ids.campaignPlayerId]
    );
    const geom = positionRows[0].geom;
    expect(geom?.coordinates?.[0]).toBeCloseTo(123.45, 2);
    expect(geom?.coordinates?.[1]).toBeCloseTo(678.9, 2);

    const { rows: afterAuditRows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.player_movement_audit WHERE player_id = $1',
      [ids.campaignPlayerId]
    );
    expect(afterAuditRows[0].count).toBe(beforeAuditCount + 1);
  });

  it('teleports an NPC by location and direct coordinates', async () => {
    if (guard()) {
      return;
    }
    const locationTeleportPayload = {
      npcId: ids.npcId,
      locationId: ids.locationId,
    };

    const toLocation = await fetchJson(
      `${baseUrl}/api/campaigns/${ids.campaignId}/teleport/npc`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(locationTeleportPayload),
      }
    );

    expect(toLocation.response.status).toBe(200);
    expect(toLocation.payload?.currentLocationId).toBe(ids.locationId);
    expect(toLocation.payload?.worldPosition).toBeNull();

    const directTeleportPayload = {
      npcId: ids.npcId,
      target: { x: 42.5, y: 99.1 },
      reason: 'Relocate NPC closer to party.',
    };

    const toPoint = await fetchJson(
      `${baseUrl}/api/campaigns/${ids.campaignId}/teleport/npc`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${dmToken}` },
        body: JSON.stringify(directTeleportPayload),
      }
    );

    expect(toPoint.response.status).toBe(200);
    expect(toPoint.payload?.currentLocationId).toBeNull();
    expect(toPoint.payload?.worldPosition?.coordinates?.[0]).toBeCloseTo(42.5, 1);
    expect(toPoint.payload?.worldPosition?.coordinates?.[1]).toBeCloseTo(99.1, 1);
  });
});
