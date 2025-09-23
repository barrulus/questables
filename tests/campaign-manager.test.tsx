import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Campaign } from '../components/campaign-shared';
import type { CampaignRecord, CreateCampaignRequest, UpdateCampaignRequest } from '../utils/api-client';

type CampaignManagerComponent = typeof import('../components/campaign-manager').CampaignManager;

declare const Response: typeof global.Response;

const apiFetchMock = jest.fn();
const readErrorMessageMock = jest.fn(async (_response: Response, fallback: string) => fallback);
const readJsonBodyMock = jest.fn(async (response: Response) => response.json());
const createCampaignMock = jest.fn();
const updateCampaignMock = jest.fn();
const listCampaignSpawnsMock = jest.fn();
const upsertCampaignSpawnMock = jest.fn();

const toastErrorMock = jest.fn();
const toastSuccessMock = jest.fn();

let CampaignManager: CampaignManagerComponent;

const originalBaseUrl = process.env.VITE_DATABASE_SERVER_URL;

const createJsonResponse = (payload: unknown, init?: ResponseInit) => {
  const status = init?.status ?? 200;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
};

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let campaignsPayload: { dmCampaigns: Campaign[] };
let worldMapsPayload: Array<{ id: string; name: string }>;
const mockUser = {
  id: 'user-1',
  username: 'dm-user',
  roles: ['dm'],
};

beforeAll(async () => {
  process.env.VITE_DATABASE_SERVER_URL = 'http://localhost:3001';

  campaignsPayload = { dmCampaigns: [] };
  worldMapsPayload = [{ id: 'map-1', name: 'Verdant Expanse' }];

  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/api/users/')) {
      return Promise.resolve(createJsonResponse(campaignsPayload));
    }
    if (path === '/api/maps/world') {
      return Promise.resolve(createJsonResponse(worldMapsPayload));
    }
    throw new Error(`Unexpected apiFetch call to ${path}`);
  });

  listCampaignSpawnsMock.mockResolvedValue([]);
  upsertCampaignSpawnMock.mockResolvedValue({
    id: 'spawn-override',
    campaignId: 'campaign-override',
    name: 'Default Spawn',
    note: null,
    isDefault: true,
    geometry: { type: 'Point', coordinates: [0, 0] },
    createdAt: null,
    updatedAt: null,
  });

  await jest.unstable_mockModule('../utils/api-client', () => ({
    apiFetch: apiFetchMock,
    readErrorMessage: readErrorMessageMock,
    readJsonBody: readJsonBodyMock,
    createCampaign: createCampaignMock,
    updateCampaign: updateCampaignMock,
    listCampaignSpawns: listCampaignSpawnsMock,
    upsertCampaignSpawn: upsertCampaignSpawnMock,
  }));

  await jest.unstable_mockModule('../contexts/UserContext', () => ({
    useUser: () => ({ user: mockUser }),
  }));

  await jest.unstable_mockModule('sonner', () => ({
    toast: {
      error: toastErrorMock,
      success: toastSuccessMock,
    },
  }));

  const module = await import('../components/campaign-manager');
  CampaignManager = module.CampaignManager;
});

afterAll(() => {
  process.env.VITE_DATABASE_SERVER_URL = originalBaseUrl;
});

afterEach(() => {
  apiFetchMock.mockClear();
  readErrorMessageMock.mockClear();
  readJsonBodyMock.mockClear();
  createCampaignMock.mockReset();
  updateCampaignMock.mockReset();
  listCampaignSpawnsMock.mockReset();
  upsertCampaignSpawnMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  campaignsPayload = { dmCampaigns: [] };
  worldMapsPayload = [{ id: 'map-1', name: 'Verdant Expanse' }];

  listCampaignSpawnsMock.mockResolvedValue([]);
  upsertCampaignSpawnMock.mockResolvedValue({
    id: 'spawn-override',
    campaignId: 'campaign-override',
    name: 'Default Spawn',
    note: null,
    isDefault: true,
    geometry: { type: 'Point', coordinates: [0, 0] },
    createdAt: null,
    updatedAt: null,
  });
});

const renderCampaignManager = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<CampaignManager />);
  await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/users/user-1/campaigns', expect.any(Object)));
  await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/maps/world', expect.any(Object)));
  await screen.findByRole('button', { name: /new campaign/i });
  return user;
};

const createCampaignRecord = (request: CreateCampaignRequest, id = 'campaign-1'): CampaignRecord => ({
  id,
  name: request.name,
  description: request.description ?? null,
  dm_user_id: 'user-1',
  dm_username: 'dm-user',
  system: request.system ?? null,
  setting: request.setting ?? null,
  status: request.status ?? 'recruiting',
  max_players: request.maxPlayers ?? null,
  level_range: request.levelRange ?? null,
  is_public: request.isPublic ?? false,
  world_map_id: request.worldMapId ?? null,
  allow_spectators: null,
  auto_approve_join_requests: null,
  experience_type: null,
  resting_rules: null,
  death_save_rules: null,
  visibility_radius: null,
  current_players: 0,
  last_activity: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('CampaignManager', () => {
  it('creates a campaign through the API client with validated payload', async () => {
    createCampaignMock.mockImplementation(async (payload: CreateCampaignRequest) => {
      const record = createCampaignRecord(payload);
      campaignsPayload.dmCampaigns = [
        {
          id: record.id,
          name: record.name,
          description: record.description ?? '',
          dm_user_id: 'user-1',
          dm_username: 'dm-user',
          system: record.system ?? '',
          setting: record.setting ?? '',
          status: record.status,
          max_players: record.max_players ?? 0,
          level_range: record.level_range,
          is_public: record.is_public ?? false,
          world_map_id: record.world_map_id,
          allow_spectators: false,
          auto_approve_join_requests: false,
          experience_type: 'milestone',
          resting_rules: 'standard',
          death_save_rules: 'standard',
          created_at: record.created_at,
          updated_at: record.updated_at,
        },
      ];
      return record;
    });

    const user = await renderCampaignManager();

    await user.click(screen.getByRole('button', { name: /new campaign/i }));
    const dialog = await screen.findByRole('dialog', { name: /Create New Campaign/i });

    await user.type(within(dialog).getByLabelText(/Campaign Name/i), 'Stormwatch  ');
    await user.type(within(dialog).getByLabelText(/Description/i), 'Guard the frontier');
    await user.click(within(dialog).getByLabelText('World Map'));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'Verdant Expanse' }));
    const maxPlayersInput = within(dialog).getByLabelText(/Max Players/i);
    await user.clear(maxPlayersInput);
    await user.type(maxPlayersInput, '7');
    const minLevelInput = within(dialog).getByLabelText(/Min Level/i);
    await user.clear(minLevelInput);
    await user.type(minLevelInput, '2');
    const maxLevelInput = within(dialog).getByLabelText(/Max Level/i);
    await user.clear(maxLevelInput);
    await user.type(maxLevelInput, '8');
    await user.click(within(dialog).getByLabelText('Toggle public campaign'));

    await user.click(within(dialog).getByRole('button', { name: /^create campaign$/i }));

    // Debugging aide: surface validation errors when the API client is not invoked.
    if (!createCampaignMock.mock.calls.length) {
      // eslint-disable-next-line no-console
      console.log('create form errors', toastErrorMock.mock.calls);
    }

    await waitFor(() => expect(createCampaignMock).toHaveBeenCalledTimes(1));

    expect(createCampaignMock).toHaveBeenCalledWith({
      name: 'Stormwatch',
      description: 'Guard the frontier',
      maxPlayers: 7,
      levelRange: { min: 2, max: 8 },
      isPublic: true,
      worldMapId: 'map-1',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Campaign created successfully!');
  });

  it('blocks activation without selecting a world map', async () => {
    campaignsPayload.dmCampaigns = [
      {
        id: 'camp-1',
        name: 'Frontier Watch',
        description: 'Protect the marches',
        dm_user_id: 'user-1',
        dm_username: 'dm-user',
        system: 'D&D 5e',
        setting: '',
        status: 'recruiting',
        max_players: 5,
        level_range: { min: 1, max: 5 },
        is_public: false,
        world_map_id: null,
        allow_spectators: false,
        auto_approve_join_requests: false,
        experience_type: 'milestone',
        resting_rules: 'standard',
        death_save_rules: 'standard',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const user = await renderCampaignManager();

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i });
    await user.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Edit Campaign/i });

    await user.click(within(dialog).getByLabelText(/Status/));
    const statusList = await screen.findByRole('listbox');
    await user.click(within(statusList).getByRole('option', { name: /Active/ }));

    await user.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    expect(updateCampaignMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Select a world map before activating the campaign.');
  });

  it('updates campaign metadata with sanitized payload', async () => {
    campaignsPayload.dmCampaigns = [
      {
        id: 'camp-1',
        name: 'Frontier Watch',
        description: 'Protect the marches',
        dm_user_id: 'user-1',
        dm_username: 'dm-user',
        system: 'D&D 5e',
        setting: '',
        status: 'recruiting',
        max_players: 5,
        level_range: { min: 1, max: 5 },
        is_public: false,
        world_map_id: null,
        allow_spectators: false,
        auto_approve_join_requests: false,
        experience_type: 'milestone',
        resting_rules: 'standard',
        death_save_rules: 'standard',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    updateCampaignMock.mockImplementation(async (_id: string, payload: UpdateCampaignRequest) => {
      const record = createCampaignRecord({
        name: payload.name ?? 'Frontier Watch',
        description: payload.description ?? undefined,
        system: payload.system ?? undefined,
        setting: payload.setting ?? undefined,
        maxPlayers: payload.maxPlayers,
        levelRange: payload.levelRange!,
        isPublic: payload.isPublic,
        worldMapId: payload.worldMapId ?? null,
        status: payload.status,
      }, 'camp-1');
      campaignsPayload.dmCampaigns = [
        {
          id: record.id,
          name: record.name,
          description: record.description ?? '',
          dm_user_id: 'user-1',
          dm_username: 'dm-user',
          system: record.system ?? '',
          setting: record.setting ?? '',
          status: record.status,
          max_players: record.max_players ?? 0,
          level_range: record.level_range,
          is_public: record.is_public ?? false,
          world_map_id: record.world_map_id,
          allow_spectators: false,
          auto_approve_join_requests: false,
          experience_type: 'milestone',
          resting_rules: 'standard',
          death_save_rules: 'standard',
          created_at: record.created_at,
          updated_at: record.updated_at,
        },
      ];
      return record;
    });

    const user = await renderCampaignManager();

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i });
    await user.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Edit Campaign/i });

    await user.clear(within(dialog).getByLabelText(/Campaign Name/));
    await user.type(within(dialog).getByLabelText(/Campaign Name/), ' Frontier Watch Redux ');
    await user.click(within(dialog).getByLabelText(/World Map/));
    const mapList = await screen.findByRole('listbox');
    await user.click(within(mapList).getByRole('option', { name: 'Verdant Expanse' }));
    await user.click(within(dialog).getByLabelText(/Status/));
    const statusList = await screen.findByRole('listbox');
    await user.click(within(statusList).getByRole('option', { name: /Active/ }));

    const maxPlayersInput = within(dialog).getByLabelText(/Max Players/);
    await user.clear(maxPlayersInput);
    await user.type(maxPlayersInput, '8');

    await user.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(updateCampaignMock).toHaveBeenCalledTimes(1));
    expect(updateCampaignMock).toHaveBeenCalledWith('camp-1', {
      name: 'Frontier Watch Redux',
      description: null,
      system: null,
      setting: null,
      status: 'active',
      maxPlayers: 8,
      levelRange: { min: 1, max: 5 },
      worldMapId: 'map-1',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Campaign details updated.');
  });
});
