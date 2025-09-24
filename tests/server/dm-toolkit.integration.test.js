/**
 * @jest-environment node
 */
/* eslint-env node, jest */

import supertest from 'supertest';
import { randomUUID } from 'node:crypto';

const nodeProcess = globalThis.process;
if (nodeProcess?.env) {
  nodeProcess.env.NODE_ENV = 'test';
}

const { beforeAll, afterAll, describe, test, expect } = globalThis;

let app;
let pool;
let generateToken;
let skipReason = null;

const state = {
  dmUserId: null,
  playerUserId: null,
  dmToken: null,
  playerToken: null,
  baseCampaignId: null,
  baseCampaignName: null,
  sessionId: null,
  characterId: null,
  playerMembershipId: null,
  locationId: null,
  spawnId: null,
  createdCampaignIds: new Set(),
  createdObjectiveIds: new Set(),
};

let api;
let originalContextualLLMService = null;
let originalLLMService = null;

const ensureOk = (response, expectedStatus, message) => {
  if (response.status !== expectedStatus) {
    throw new Error(`${message} (expected ${expectedStatus}, received ${response.status}): ${response.text}`);
  }
};

const safeQuery = async (sql, params) => {
  try {
    await pool.query(sql, params);
  } catch (error) {
    if (error?.code === '42P01') {
      return;
    }
    throw error;
  }
};

const isConnectionDeniedError = (error) => {
  if (!error) {
    return false;
  }
  if (error.code === 'EPERM' || error.code === 'ECONNREFUSED') {
    return true;
  }
  if (Array.isArray(error.errors)) {
    return error.errors.some((inner) => inner?.code === 'EPERM' || inner?.code === 'ECONNREFUSED');
  }
  return false;
};

const guard = () => {
  if (skipReason) {
    globalThis.console?.warn?.(`[DM Toolkit integration] ${skipReason}`);
    return true;
  }
  return false;
};

const createObjective = async (token, payload = {}) => {
  const body = {
    title: payload.title || `Objective ${Date.now()}`,
    orderIndex: payload.orderIndex ?? 1,
    ...payload,
  };

  const response = await api
    .post(`/api/campaigns/${state.baseCampaignId}/objectives`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  ensureOk(response, 201, 'Objective creation failed');
  const objective = response.body?.objective;
  if (!objective?.id) {
    throw new Error('Objective creation did not return an ID');
  }
  state.createdObjectiveIds.add(objective.id);
  return objective;
};

beforeAll(async () => {
  ({ app, pool } = await import('../../server/database-server.js'));
  ({ generateToken } = await import('../../server/auth-middleware.js'));

  if (app?.locals?.databaseUnavailable) {
    skipReason = 'Local PostgreSQL instance is unavailable in this environment.';
    return;
  }

  api = supertest(app);

  originalContextualLLMService = app.locals.contextualLLMService;
  originalLLMService = app.locals.llmService;

  // Lightweight contextual LLM stub so assists return determinate content during tests.
  const stubLLMService = {
    async generateFromContext({ request }) {
      const focus = request?.focus ?? 'No focus provided';
      return {
        result: {
          content: `Generated narrative for: ${focus}`,
          provider: { name: 'stub-provider', model: 'stub-model' },
          metrics: { totalTokens: 16 },
          cache: { hit: false },
        },
        prompt: {
          user: focus,
          system: 'stub-system-prompt',
        },
      };
    },
  };

  app.locals.contextualLLMService = stubLLMService;
  app.locals.llmService = stubLLMService;

  state.dmUserId = randomUUID();
  state.playerUserId = randomUUID();
  state.dmToken = generateToken({ userId: state.dmUserId });
  state.playerToken = generateToken({ userId: state.playerUserId });
  state.baseCampaignName = `DM Toolkit Base ${Date.now()}`;

  try {
    await pool.query(
      `INSERT INTO public.user_profiles (id, username, email, roles)
       VALUES ($1, $2, $3, $4)` ,
      [state.dmUserId, `dm_toolkit_${Date.now()}`, `dm_toolkit_${Date.now()}@example.com`, ['dm']]
    );

    await pool.query(
      `INSERT INTO public.user_profiles (id, username, email, roles)
       VALUES ($1, $2, $3, $4)` ,
      [state.playerUserId, `player_toolkit_${Date.now()}`, `player_toolkit_${Date.now()}@example.com`, ['player']]
    );

    const createCampaignResponse = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        name: state.baseCampaignName,
        description: 'Integration base campaign for DM Toolkit tests',
        maxPlayers: 6,
        levelRange: { min: 1, max: 5 },
        status: 'recruiting',
        isPublic: false,
        system: 'Integration Test System',
        setting: 'Integration Realm',
      });
    ensureOk(createCampaignResponse, 201, 'Base campaign creation failed');
    state.baseCampaignId = createCampaignResponse.body?.campaign?.id;
    if (!state.baseCampaignId) {
      throw new Error('Base campaign creation did not return an ID');
    }

    state.sessionId = randomUUID();
    await pool.query(
      `INSERT INTO public.sessions (id, campaign_id, session_number, title, status)
       VALUES ($1, $2, 1, $3, 'active')` ,
      [state.sessionId, state.baseCampaignId, 'DM Toolkit Integration Session']
    );

    state.characterId = randomUUID();
    await pool.query(
      `INSERT INTO public.characters (id, user_id, name, class, race, background)
       VALUES ($1, $2, $3, $4, $5, $6)` ,
      [state.characterId, state.playerUserId, 'Integration Rogue', 'Rogue', 'Halfling', 'Scout']
    );

    state.playerMembershipId = randomUUID();
    await pool.query(
      `INSERT INTO public.campaign_players (id, campaign_id, user_id, character_id, role, status)
       VALUES ($1, $2, $3, $4, 'player', 'active')` ,
      [state.playerMembershipId, state.baseCampaignId, state.playerUserId, state.characterId]
    );

    state.locationId = randomUUID();
    await pool.query(
      `INSERT INTO public.locations (id, campaign_id, name, type)
       VALUES ($1, $2, $3, 'landmark')` ,
      [state.locationId, state.baseCampaignId, 'Integration Waypoint']
    );
  } catch (error) {
    if (isConnectionDeniedError(error)) {
      skipReason = 'Local PostgreSQL access is blocked in this sandbox environment.';
      return;
    }
    throw error;
  }
});

afterAll(async () => {
  if (skipReason) {
    return;
  }

  if (app) {
    app.locals.contextualLLMService = originalContextualLLMService;
    app.locals.llmService = originalLLMService;
  }

  const campaignIds = [state.baseCampaignId, ...state.createdCampaignIds];

  try {
    if (campaignIds.length > 0) {
      await safeQuery('DELETE FROM public.narratives WHERE requested_by = ANY($1::uuid[])', [[state.dmUserId, state.playerUserId]]);
      await safeQuery('DELETE FROM public.campaign_objectives WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.campaign_spawns WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.encounters WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.sessions WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.campaign_players WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.locations WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
      await safeQuery('DELETE FROM public.campaigns WHERE id = ANY($1::uuid[])', [campaignIds]);
    }

    if (state.characterId) {
      await safeQuery('DELETE FROM public.characters WHERE id = $1', [state.characterId]);
    }

    await safeQuery('DELETE FROM public.user_profiles WHERE id = ANY($1::uuid[])', [[state.dmUserId, state.playerUserId]]);
  } catch (error) {
    globalThis.console?.error?.('[Cleanup] Failed to remove integration fixtures:', error);
  }
});

describe('DM Toolkit integration tests', () => {
  test('creates a campaign for the authenticated DM', async () => {
    if (guard()) {
      return;
    }

    const name = `Campaign ${Date.now()}`;
    const response = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        name,
        description: 'Supertest-created campaign',
        maxPlayers: 4,
        levelRange: { min: 1, max: 10 },
        status: 'recruiting',
        isPublic: true,
      });

    ensureOk(response, 201, 'Campaign creation did not succeed');
    const createdId = response.body?.campaign?.id;
    expect(createdId).toBeDefined();
    state.createdCampaignIds.add(createdId);

    const { rows } = await pool.query('SELECT dm_user_id FROM public.campaigns WHERE id = $1', [createdId]);
    expect(rows[0]?.dm_user_id).toBe(state.dmUserId);
  });

  test('rejects campaigns with out-of-range maxPlayers input', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        name: `Invalid Campaign ${Date.now()}`,
        maxPlayers: 42,
        levelRange: { min: 1, max: 5 },
        status: 'recruiting',
      });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('invalid_max_players');
  });

  test('enforces per-DM unique campaign names', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        name: state.baseCampaignName,
        status: 'recruiting',
      });

    expect(response.status).toBe(409);
    expect(response.body?.error).toBe('campaign_name_conflict');
  });

  test('upserts the campaign spawn with SRID 0 geometry', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .put(`/api/campaigns/${state.baseCampaignId}/spawn`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        name: 'Primary Spawn',
        note: 'Bridgehead into the valley',
        worldPosition: { x: 128.125, y: -54.75 },
      });

    ensureOk(response, 200, 'Spawn upsert failed');
    const spawn = response.body?.spawn;
    expect(spawn?.geometry?.type).toBe('Point');
    expect(Array.isArray(spawn?.geometry?.coordinates)).toBe(true);
    expect(spawn.geometry.coordinates[0]).toBeCloseTo(128.125, 3);
    expect(spawn.geometry.coordinates[1]).toBeCloseTo(-54.75, 3);

    state.spawnId = spawn?.id;
    const { rows } = await pool.query(
      'SELECT ST_SRID(world_position) AS srid FROM public.campaign_spawns WHERE id = $1',
      [spawn.id]
    );
    expect(rows[0]?.srid).toBe(0);
  });

  test('rejects spawn updates without numeric coordinates', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .put(`/api/campaigns/${state.baseCampaignId}/spawn`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        worldPosition: { x: 'invalid', y: 15 },
      });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('invalid_target');
  });

  test('prevents non-DM campaign members from updating the spawn', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .put(`/api/campaigns/${state.baseCampaignId}/spawn`)
      .set('Authorization', `Bearer ${state.playerToken}`)
      .send({ worldPosition: { x: 12, y: 18 } });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe('spawn_forbidden');
  });

  test('creates objectives with markdown and pin locations', async () => {
    if (guard()) {
      return;
    }

    const objective = await createObjective(state.dmToken, {
      description_md: 'Scout the ruined keep.',
      locationType: 'pin',
      locationPin: { x: 44.5, y: 91.25 },
    });

    expect(objective.campaignId).toBe(state.baseCampaignId);
    expect(objective.descriptionMd).toContain('ruined keep');
    expect(objective.location?.type).toBe('pin');
    expect(objective.location?.pin?.x).toBeCloseTo(44.5, 2);
  });

  test('rejects objectives with incomplete location payloads', async () => {
    if (guard()) {
      return;
    }

    const response = await api
      .post(`/api/campaigns/${state.baseCampaignId}/objectives`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        title: 'Investigate the anomaly',
        locationType: 'pin',
        locationPin: { x: 12 },
      });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('invalid_location');
  });

  test('updates objective fields and markdown content', async () => {
    if (guard()) {
      return;
    }

    const objective = await createObjective(state.dmToken, {
      description_md: 'Initial description',
    });

    const response = await api
      .put(`/api/objectives/${objective.id}`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({
        title: 'Updated Objective Title',
        combat_md: 'Expect heavy resistance.',
        locationType: 'pin',
        locationPin: { x: 70, y: -12 },
      });

    ensureOk(response, 200, 'Objective update failed');
    expect(response.body?.objective?.title).toBe('Updated Objective Title');
    expect(response.body?.objective?.combatMd).toContain('heavy resistance');
    expect(response.body?.objective?.location?.pin?.x).toBeCloseTo(70, 1);
  });

  test('prevents players from modifying objectives', async () => {
    if (guard()) {
      return;
    }

    const objective = await createObjective(state.dmToken);
    const response = await api
      .put(`/api/objectives/${objective.id}`)
      .set('Authorization', `Bearer ${state.playerToken}`)
      .send({ title: 'Player Attempt' });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe('objective_forbidden');
  });

  test('deletes objectives and their descendants', async () => {
    if (guard()) {
      return;
    }

    const parent = await createObjective(state.dmToken, { title: 'Parent Objective' });
    const child = await createObjective(state.dmToken, { title: 'Child Objective', parentId: parent.id });

    const response = await api
      .delete(`/api/objectives/${parent.id}`)
      .set('Authorization', `Bearer ${state.dmToken}`);

    ensureOk(response, 200, 'Objective delete failed');
    expect(response.body?.deletedObjectiveIds).toEqual(expect.arrayContaining([parent.id, child.id]));
    state.createdObjectiveIds.delete(parent.id);
    state.createdObjectiveIds.delete(child.id);
  });

  test('generates assists for DMs when the LLM service responds', async () => {
    if (guard()) {
      return;
    }

    const objective = await createObjective(state.dmToken, { title: 'Assist Objective' });

    const response = await api
      .post(`/api/objectives/${objective.id}/assist/description`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({ focus: 'Explain the ancient wards.' });

    ensureOk(response, 200, 'Objective assist failed');
    expect(response.body?.assist?.field).toBe('description_md');
    expect(response.body?.assist?.content).toContain('Explain the ancient wards');
  });

  test('blocks players from invoking objective assists', async () => {
    if (guard()) {
      return;
    }

    const objective = await createObjective(state.dmToken, { title: 'Restricted Assist' });

    const response = await api
      .post(`/api/objectives/${objective.id}/assist/description`)
      .set('Authorization', `Bearer ${state.playerToken}`)
      .send({ focus: 'Attempt player assist' });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe('objective_forbidden');
  });

  test('updates session focus for the DM and rejects players', async () => {
    if (guard()) {
      return;
    }

    const focusResponse = await api
      .put(`/api/sessions/${state.sessionId}/focus`)
      .set('Authorization', `Bearer ${state.dmToken}`)
      .send({ focus: 'Track the lich across the tundra.' });

    ensureOk(focusResponse, 200, 'DM focus update failed');
    expect(focusResponse.body?.dmFocus).toBe('Track the lich across the tundra.');

    const playerResponse = await api
      .put(`/api/sessions/${state.sessionId}/focus`)
      .set('Authorization', `Bearer ${state.playerToken}`)
      .send({ focus: 'Player takeover' });

    expect(playerResponse.status).toBe(403);
    expect(playerResponse.body?.error).toBe('dm_action_forbidden');
  });
});
