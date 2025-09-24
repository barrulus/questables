/**
 * @jest-environment jsdom
 */

import React from 'react';
import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomUUID } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'util';
import type { ReactElement } from 'react';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Pool } from 'pg';
import type { Campaign } from '../../components/campaign-shared';

jest.setTimeout(60000);

// Stub WebSocket-centric modules so the UI can run against the real API without opening sockets.
await jest.unstable_mockModule('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ messages: [] }),
}));

await jest.unstable_mockModule('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  })),
}));

const { CampaignManager } = await import('../../components/campaign-manager');
const { CampaignPrep } = await import('../../components/campaign-prep');
const { ObjectivesPanel } = await import('../../components/objectives-panel');
const { DMSidebar } = await import('../../components/dm-sidebar');
const { UserProvider } = await import('../../contexts/UserContext');
const { GameSessionProvider } = await import('../../contexts/GameSessionContext');
const apiClient = await import('../../utils/api-client');
type CampaignRecord = Campaign;

type GenerateTokenFn = (_payload: Record<string, unknown>) => string;

interface SpawnSelectionButtonProps {
  onSelect: (_coords: { x: number; y: number }) => void;
}

const SpawnSelectionButton = ({ onSelect }: SpawnSelectionButtonProps) => (
  <button type="button" onClick={() => onSelect({ x: 321.45, y: -88.12 })}>
    Choose Spawn Coordinates
  </button>
);

const browserWindow = globalThis.window as unknown as Window & { ResizeObserver?: typeof ResizeObserver };
if (!browserWindow.ResizeObserver) {
  browserWindow.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const globalWithIntersection = globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver };
if (!globalWithIntersection.IntersectionObserver) {
  globalWithIntersection.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
}

const globalWithEncoding = globalThis as typeof globalThis & {
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
};
if (!globalWithEncoding.TextEncoder) {
  globalWithEncoding.TextEncoder = TextEncoder;
}
if (!globalWithEncoding.TextDecoder) {
  globalWithEncoding.TextDecoder = TextDecoder as unknown as typeof TextDecoder;
}

let app: Express;
let server: HttpServer | HttpsServer;
let pool: Pool;
let generateToken: GenerateTokenFn;
let testServer: HttpServer | HttpsServer;
let baseUrl: string;
let skipReason: string | null = null;

const createdCampaignIds: Set<string> = new Set();
const createdSessionIds: Set<string> = new Set();
const createdObjectiveIds: Set<string> = new Set();
const createdEncounterIds: Set<string> = new Set();
const createdPlayerIds: Set<string> = new Set();
const createdLocationIds: Set<string> = new Set();
const createdNpcIds: Set<string> = new Set();
const createdCharacterIds: Set<string> = new Set();

const state = {
  dmUserId: '',
  dmEmail: '',
  dmUsername: '',
  dmToken: '',
  worldMapId: '',
};

const ensureImportMetaEnv = (url: string) => {
  const meta = import.meta as { env?: Record<string, string> };
  meta.env = { ...(meta.env ?? {}), VITE_DATABASE_SERVER_URL: url };
};

const isConnectionDeniedError = (error: unknown): boolean => {
  if (!error) return false;
  const candidate = error as { code?: string; errors?: unknown[] };
  if (candidate.code === 'EPERM' || candidate.code === 'ECONNREFUSED') {
    return true;
  }
  if (Array.isArray(candidate.errors)) {
    return candidate.errors.some((inner) => {
      if (!inner || typeof inner !== 'object') return false;
      const innerCode = (inner as { code?: string }).code;
      return innerCode === 'EPERM' || innerCode === 'ECONNREFUSED';
    });
  }
  return false;
};

const seedAuthSession = (overrides: Partial<{ userId: string; username: string; email: string; token: string }>) => {
  const userId = overrides.userId ?? state.dmUserId;
  const username = overrides.username ?? state.dmUsername;
  const email = overrides.email ?? state.dmEmail;
  const token = overrides.token ?? state.dmToken;

  window.localStorage.clear();
  window.localStorage.setItem('dnd-auth-token', token);
  window.localStorage.setItem('dnd-user', JSON.stringify({
    id: userId,
    username,
    email,
    roles: ['dm'],
    role: 'dm',
  }));
};

const renderWithProviders = (ui: ReactElement, { activeCampaignId }: { activeCampaignId?: string } = {}) => {
  if (activeCampaignId) {
    window.localStorage.setItem('dnd-active-campaign', activeCampaignId);
  } else {
    window.localStorage.removeItem('dnd-active-campaign');
  }

  return render(
    <UserProvider>
      <GameSessionProvider>
        {ui}
      </GameSessionProvider>
    </UserProvider>
  );
};

const fetchCampaignRecord = async (campaignId: string): Promise<CampaignRecord> => {
  const { rows } = await pool.query(
    `SELECT id, name, COALESCE(description, '') AS description, dm_user_id, system,
            COALESCE(setting, '') AS setting, status, COALESCE(max_players, 0) AS max_players,
            level_range, COALESCE(is_public, false) AS is_public, world_map_id,
            allow_spectators, auto_approve_join_requests, experience_type,
            resting_rules, death_save_rules, created_at, updated_at
       FROM public.campaigns WHERE id = $1`,
    [campaignId]
  );

  if (rows.length === 0) {
    throw new Error(`Campaign ${campaignId} was not found in the database.`);
  }

  const row = rows[0];
  let levelRange: CampaignRecord['level_range'] = { min: 1, max: 20 };
  if (row.level_range) {
    if (typeof row.level_range === 'object') {
      levelRange = row.level_range;
    } else {
      try {
        levelRange = JSON.parse(row.level_range);
      } catch {
        levelRange = { min: 1, max: 20 };
      }
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    dm_user_id: row.dm_user_id,
    system: row.system ?? '',
    setting: row.setting ?? '',
    status: row.status,
    max_players: Number(row.max_players ?? 0),
    level_range: levelRange,
    is_public: Boolean(row.is_public),
    world_map_id: row.world_map_id,
    allow_spectators: row.allow_spectators ?? false,
    auto_approve_join_requests: row.auto_approve_join_requests ?? false,
    experience_type: (row.experience_type as CampaignRecord['experience_type']) ?? 'milestone',
    resting_rules: (row.resting_rules as CampaignRecord['resting_rules']) ?? 'standard',
    death_save_rules: (row.death_save_rules as CampaignRecord['death_save_rules']) ?? 'standard',
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
};

const createSessionForCampaign = async (campaignId: string): Promise<string> => {
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO public.sessions (id, campaign_id, session_number, title, status)
     VALUES ($1, $2, 1, 'Integration Session', 'active')`,
    [sessionId, campaignId]
  );
  createdSessionIds.add(sessionId);
  return sessionId;
};

const createPlayerForCampaign = async (campaignId: string, userId: string): Promise<{ campaignPlayerId: string; characterId: string }> => {
  const characterId = randomUUID();
  await pool.query(
    `INSERT INTO public.characters (id, user_id, name, class, race, background)
     VALUES ($1, $2, 'Integration Hero', 'Wizard', 'Elf', 'Scholar')`,
    [characterId, userId]
  );
  createdCharacterIds.add(characterId);

  const campaignPlayerId = randomUUID();
  await pool.query(
    `INSERT INTO public.campaign_players (id, campaign_id, user_id, character_id, role, status)
     VALUES ($1, $2, $3, $4, 'player', 'active')`,
    [campaignPlayerId, campaignId, userId, characterId]
  );
  createdPlayerIds.add(campaignPlayerId);

  return { campaignPlayerId, characterId };
};

const createNpcForCampaign = async (campaignId: string): Promise<string> => {
  const npcId = randomUUID();
  await pool.query(
    `INSERT INTO public.npcs (id, campaign_id, name, description, race, occupation, personality, motivations, secrets, stats)
     VALUES ($1, $2, 'Integration NPC', 'Test NPC for sidebar flows', 'Human', 'Guide', 'Helpful', 'Assist the heroes', 'Keeps a ledger', '{}'::jsonb)`,
    [npcId, campaignId]
  );
  createdNpcIds.add(npcId);
  return npcId;
};

const createLocationForCampaign = async (campaignId: string): Promise<string> => {
  const locationId = randomUUID();
  await pool.query(
    `INSERT INTO public.locations (id, campaign_id, name, type)
     VALUES ($1, $2, 'Integration Keep', 'city')`,
    [locationId, campaignId]
  );
  createdLocationIds.add(locationId);
  return locationId;
};

beforeAll(async () => {
  try {
    const serverModule = (await import('../../server/database-server.js')) as { app: Express; server: HttpServer | HttpsServer; pool: Pool };
    const authModule = await import('../../server/auth-middleware.js');
    app = serverModule.app;
    server = serverModule.server;
    pool = serverModule.pool;
    ({ generateToken } = authModule as { generateToken: GenerateTokenFn });

    try {
      testServer = await new Promise<HttpServer | HttpsServer>((resolve, reject) => {
        const instance = server.listen(0, () => resolve(instance));
        instance.on('error', reject);
      });
    } catch (listenError) {
      if (isConnectionDeniedError(listenError) || (listenError as NodeJS.ErrnoException)?.code === 'EPERM') {
        skipReason = 'Local PostgreSQL access is blocked in this environment.';
        return;
      }
      throw listenError;
    }

    const address = testServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    ensureImportMetaEnv(baseUrl);
    process.env.VITE_DATABASE_SERVER_URL = baseUrl;
    process.env.DATABASE_SERVER_PORT = String(port);

    // Provide deterministic LLM responses for assist flows.
    const stubLLMService = {
      async generateFromContext({ request }: { request?: { focus?: string } }) {
        const focus = request?.focus ?? 'No focus provided';
        return {
          result: {
            content: `LLM draft for: ${focus}`,
            provider: { name: 'stub-provider', model: 'stub-model' },
            metrics: { totalTokens: 42 },
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
    state.dmEmail = `dm_ui_${Date.now()}@test.dev`;
    state.dmUsername = `dm_ui_${Date.now()}`;

    await pool.query(
      `INSERT INTO public.user_profiles (id, username, email, roles)
       VALUES ($1, $2, $3, $4)` ,
      [state.dmUserId, state.dmUsername, state.dmEmail, ['dm']]
    );

    state.dmToken = generateToken({ userId: state.dmUserId });

    state.worldMapId = randomUUID();
    await pool.query(
      `INSERT INTO public.maps_world (id, name, bounds, is_active)
       VALUES ($1, $2, $3::jsonb, true)` ,
      [state.worldMapId, 'Integration World', JSON.stringify({ north: 5000, south: -5000, east: 5000, west: -5000 })]
    );
  } catch (error) {
    if (isConnectionDeniedError(error)) {
      skipReason = 'Local PostgreSQL access is blocked in this environment.';
      return;
    }
    throw error;
  }
});

afterAll(async () => {
  if (skipReason || !pool) {
    return;
  }

  try {
    if (createdObjectiveIds.size > 0) {
      await pool.query('DELETE FROM public.campaign_objectives WHERE id = ANY($1::uuid[])', [Array.from(createdObjectiveIds)]);
    }
    if (createdEncounterIds.size > 0) {
      await pool.query('DELETE FROM public.encounters WHERE id = ANY($1::uuid[])', [Array.from(createdEncounterIds)]);
    }
    if (createdSessionIds.size > 0) {
      await pool.query('DELETE FROM public.sessions WHERE id = ANY($1::uuid[])', [Array.from(createdSessionIds)]);
    }
    if (createdPlayerIds.size > 0) {
      await pool.query('DELETE FROM public.campaign_players WHERE id = ANY($1::uuid[])', [Array.from(createdPlayerIds)]);
    }
    if (createdLocationIds.size > 0) {
      await pool.query('DELETE FROM public.locations WHERE id = ANY($1::uuid[])', [Array.from(createdLocationIds)]);
    }
    if (createdNpcIds.size > 0) {
      await pool.query('DELETE FROM public.npcs WHERE id = ANY($1::uuid[])', [Array.from(createdNpcIds)]);
    }
    if (createdCharacterIds.size > 0) {
      await pool.query('DELETE FROM public.characters WHERE id = ANY($1::uuid[])', [Array.from(createdCharacterIds)]);
    }
    if (createdCampaignIds.size > 0) {
      await pool.query('DELETE FROM public.campaign_spawns WHERE campaign_id = ANY($1::uuid[])', [Array.from(createdCampaignIds)]);
      await pool.query('DELETE FROM public.campaigns WHERE id = ANY($1::uuid[])', [Array.from(createdCampaignIds)]);
    }

    await pool.query('DELETE FROM public.maps_world WHERE id = $1', [state.worldMapId]);
    await pool.query('DELETE FROM public.user_profiles WHERE id = $1', [state.dmUserId]);
  } catch (error) {
    console.error('[Cleanup] Frontend integration cleanup failed:', error);
  } finally {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
  }
});

const guard = () => {
  if (skipReason) {
    console.warn(`[DM Toolkit UI] ${skipReason}`);
    return true;
  }
  return false;
};

describe('DM Toolkit frontend integration', () => {
  it('creates a campaign and saves spawn location against the live API', async () => {
    if (guard()) {
      return;
    }

    seedAuthSession({});
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const { unmount } = render(
      <UserProvider>
        <CampaignManager />
      </UserProvider>
    );

    await screen.findByRole('button', { name: /new campaign/i });

    await user.click(screen.getByRole('button', { name: /new campaign/i }));

    const dialog = await screen.findByRole('dialog', { name: /create new campaign/i });
    const nameInput = within(dialog).getByLabelText(/campaign name/i);
    await user.clear(nameInput);
    const campaignName = `UI Campaign ${Date.now()}`;
    await user.type(nameInput, campaignName);

    const descriptionInput = within(dialog).getByLabelText(/description/i);
    await user.type(descriptionInput, 'Integration test campaign created via UI');

    const systemInput = within(dialog).getByLabelText(/system/i);
    await user.type(systemInput, '5e');

    const settingInput = within(dialog).getByLabelText(/setting/i);
    await user.type(settingInput, 'Frozen Expanse');

    const worldMapTrigger = within(dialog).getByRole('combobox', { name: /world map/i });
    await user.click(worldMapTrigger);
    const option = await screen.findByRole('option', { name: /integration world/i });
    await user.click(option);

    const createButton = within(dialog).getByRole('button', { name: /create campaign/i });
    await user.click(createButton);

    await waitFor(() => expect(screen.getByRole('heading', { name: campaignName })).toBeInTheDocument());

    const { rows } = await pool.query('SELECT id FROM public.campaigns WHERE name = $1 LIMIT 1', [campaignName]);
    expect(rows.length).toBe(1);
    const campaignId = rows[0].id as string;
    createdCampaignIds.add(campaignId);

    unmount();

    const campaignRecord = await fetchCampaignRecord(campaignId);

    seedAuthSession({});
    const { unmount: unmountPrep } = renderWithProviders(
      <CampaignPrep
        campaign={campaignRecord}
        spawnMapComponent={({ onSelectPosition }) => <SpawnSelectionButton onSelect={onSelectPosition} />}
      />
    , { activeCampaignId: campaignId });

    await screen.findByRole('heading', { name: /current spawn/i });
    await user.click(await screen.findByRole('button', { name: /choose spawn coordinates/i }));

    const spawnDialog = await screen.findByRole('dialog', { name: /save default spawn/i });
    const noteField = within(spawnDialog).getByLabelText(/scene note/i);
    await user.type(noteField, 'Landing point for adventurers');

    await user.click(within(spawnDialog).getByRole('button', { name: /save spawn/i }));

    await waitFor(async () => {
      const result = await pool.query('SELECT id, note, ST_AsText(world_position) AS wkt FROM public.campaign_spawns WHERE campaign_id = $1', [campaignId]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].note).toBe('Landing point for adventurers');
      expect(result.rows[0].wkt).toContain('POINT');
      createdCampaignIds.add(campaignId);
    });

    unmountPrep();
  });

  it('manages objectives and requests LLM assists via real endpoints', async () => {
    if (guard()) {
      return;
    }

    const campaignName = `Objectives ${Date.now()}`;
    seedAuthSession({});

    const createResponse = await apiClient.fetchJson<{ campaign: { id: string } }>(
      '/api/campaigns',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName,
          description: 'Objective integration campaign',
          system: '5e',
          setting: 'Integration Realm',
          maxPlayers: 5,
          levelRange: { min: 1, max: 5 },
          isPublic: false,
          status: 'recruiting',
          worldMapId: state.worldMapId,
        }),
      }
    );

    if (!createResponse?.campaign?.id) {
      throw new Error('Campaign creation via API failed during objective test');
    }
    createdCampaignIds.add(createResponse.campaign.id);

    const { rows } = await pool.query('SELECT id FROM public.campaigns WHERE name = $1 LIMIT 1', [campaignName]);
    const campaignId = rows[0].id as string;

    const campaignRecord = await fetchCampaignRecord(campaignId);

    seedAuthSession({});
    const { unmount } = renderWithProviders(
      <ObjectivesPanel campaign={campaignRecord} canEdit worldMap={null} />,
      { activeCampaignId: campaignId }
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /new objective/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /new objective/i }));
    const createDialog = await screen.findByRole('dialog', { name: /create objective/i });
    const titleInput = within(createDialog).getByLabelText(/title/i);
    const objectiveTitle = 'Secure the breach';
    await user.type(titleInput, objectiveTitle);
    await user.click(within(createDialog).getByRole('button', { name: /create objective/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: objectiveTitle })).toBeInTheDocument());

    const objectiveRow = await pool.query('SELECT id FROM public.campaign_objectives WHERE campaign_id = $1 AND title = $2', [campaignId, objectiveTitle]);
    const objectiveId = objectiveRow.rows[0].id as string;
    createdObjectiveIds.add(objectiveId);

    await user.click(screen.getByRole('button', { name: new RegExp(`assist.*description`, 'i') }));
    const assistDialog = await screen.findByRole('dialog', { name: /generate description assist/i });
    await user.type(within(assistDialog).getByLabelText(/focus/i), 'Explain the arcane gate.');
    await user.click(within(assistDialog).getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(screen.getByText(/LLM draft for/)).toBeInTheDocument());

    const updatedObjectiveRows = await pool.query('SELECT description_md FROM public.campaign_objectives WHERE id = $1', [objectiveId]);
    expect(updatedObjectiveRows.rows[0].description_md).toContain('LLM draft for');

    unmount();
  });

  it('updates DM sidebar focus via live API', async () => {
    if (guard()) {
      return;
    }

    const campaignId = randomUUID();
    await pool.query(
      `INSERT INTO public.campaigns (id, name, description, dm_user_id, status, max_players, level_range, is_public, world_map_id)
       VALUES ($1, $2, $3, $4, 'active', 5, $5::jsonb, false, $6)` ,
      [campaignId, `Sidebar ${Date.now()}`, 'Sidebar integration campaign', state.dmUserId, JSON.stringify({ min: 1, max: 5 }), state.worldMapId]
    );
    createdCampaignIds.add(campaignId);

    const sessionId = await createSessionForCampaign(campaignId);
    const locationId = await createLocationForCampaign(campaignId);
    const npcId = await createNpcForCampaign(campaignId);
    const playerUserId = randomUUID();
    await pool.query(
      `INSERT INTO public.user_profiles (id, username, email, roles)
       VALUES ($1, $2, $3, $4)` ,
      [playerUserId, `sidebar_player_${Date.now()}`, `sidebar_player_${Date.now()}@test.dev`, ['player']]
    );
    const { campaignPlayerId } = await createPlayerForCampaign(campaignId, playerUserId);

    seedAuthSession({});
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<DMSidebar />, { activeCampaignId: campaignId });

    await waitFor(() => expect(screen.getByRole('heading', { name: /session focus/i })).toBeInTheDocument());

    const focusTextarea = await screen.findByLabelText(/session focus/i);
    await user.clear(focusTextarea);
    await user.type(focusTextarea, 'Track the elemental incursion.');
    await user.click(screen.getByRole('button', { name: /update focus/i }));

    await waitFor(async () => {
      const { rows } = await pool.query('SELECT dm_focus FROM public.sessions WHERE id = $1', [sessionId]);
      expect(rows[0].dm_focus).toBe('Track the elemental incursion.');
    });

    unmount();

    await pool.query('DELETE FROM public.campaign_players WHERE id = $1', [campaignPlayerId]);
    await pool.query('DELETE FROM public.user_profiles WHERE id = $1', [playerUserId]);
    await pool.query('DELETE FROM public.sessions WHERE id = $1', [sessionId]);
    await pool.query('DELETE FROM public.locations WHERE id = $1', [locationId]);
    await pool.query('DELETE FROM public.npcs WHERE id = $1', [npcId]);
    createdSessionIds.delete(sessionId);
    createdLocationIds.delete(locationId);
    createdNpcIds.delete(npcId);
  });
});
