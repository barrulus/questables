import { jest } from "@jest/globals";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpawnPoint } from "../utils/api-client";
import type { CampaignSpawnMapProps } from "../components/campaign-spawn-map";

const toastSuccessMock = jest.fn();
const toastErrorMock = jest.fn();

jest.mock("sonner", () => ({
  __esModule: true,
  toast: {
    success: (message: string) => toastSuccessMock(message),
    error: (message: string) => toastErrorMock(message),
  },
}));

import { CampaignPrep } from "../components/campaign-prep";

const StubSpawnMap = ({ onSelectPosition }: CampaignSpawnMapProps) => (
  <button
    type="button"
    data-testid="mock-map"
    onClick={() => onSelectPosition({ x: 1234.56, y: 789.01 })}
  >
    Mock Map
  </button>
);

describe("CampaignPrep", () => {
  const loadSpawnsStub = jest.fn<Promise<SpawnPoint[]>, [string]>();
  const upsertSpawnStub = jest.fn<Promise<SpawnPoint>, [string, { position: { x: number; y: number }; note: string | null }]>();

  beforeEach(() => {
    jest.clearAllMocks();
    loadSpawnsStub.mockReset();
    upsertSpawnStub.mockReset();
    const spawn: SpawnPoint = {
      id: "spawn-1",
      campaignId: "campaign-1",
      name: "Default Spawn",
      note: "Meet at the tavern",
      isDefault: true,
      geometry: { type: "Point", coordinates: [500, -250] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    loadSpawnsStub.mockResolvedValue([spawn]);
    upsertSpawnStub.mockResolvedValue(spawn);
  });

  const campaign = {
    id: "campaign-1",
    name: "Verdant Watch",
    description: "Guard the northern frontier",
    dm_user_id: "dm-user",
    dm_username: "dm-user",
    system: "D&D 5e",
    setting: "Homebrew",
    status: "recruiting",
    max_players: 5,
    current_players: 3,
    level_range: { min: 1, max: 5 },
    is_public: false,
    world_map_id: "world-1",
    allow_spectators: false,
    auto_approve_join_requests: false,
    experience_type: "milestone",
    resting_rules: "standard",
    death_save_rules: "standard",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as const;

  const worldMapOverride = {
    id: "world-1",
    name: "Verdant Expanse",
    bounds: { north: 10000, south: -10000, east: 10000, west: -10000 },
  };

  it("loads world map and spawn data on mount", async () => {
    render(
      <CampaignPrep
        campaign={{ ...campaign }}
        viewerOverride={{ id: "dm-user", roles: ["dm"] }}
        worldMapOverride={worldMapOverride}
        loadSpawnsOverride={loadSpawnsStub}
        spawnMapComponent={StubSpawnMap}
      />
    );

    await waitFor(() => expect(loadSpawnsStub).toHaveBeenCalledWith(campaign.id));

    expect(screen.getByRole("button", { name: /set spawn location/i })).toBeInTheDocument();
    expect(await screen.findByText(/meet at the tavern/i)).toBeInTheDocument();
  });

  it("allows the DM to set a new spawn and saves the note", async () => {
    const existingSpawn: SpawnPoint = {
      id: "spawn-1",
      campaignId: campaign.id,
      name: "Default Spawn",
      note: "Meet at the tavern",
      isDefault: true,
      geometry: { type: "Point", coordinates: [500, -250] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newSpawn: SpawnPoint = {
      ...existingSpawn,
      note: "Rally at the gates",
      geometry: { type: "Point", coordinates: [1234.56, 789.01] },
      updatedAt: new Date().toISOString(),
    };

    loadSpawnsStub.mockResolvedValueOnce([existingSpawn]);
    upsertSpawnStub.mockResolvedValueOnce(newSpawn);

    const user = userEvent.setup();
    render(
      <CampaignPrep
        campaign={{ ...campaign }}
        viewerOverride={{ id: "dm-user", roles: ["dm"] }}
        worldMapOverride={worldMapOverride}
        loadSpawnsOverride={loadSpawnsStub}
        upsertSpawnOverride={upsertSpawnStub}
        spawnMapComponent={StubSpawnMap}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /set spawn location/i })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: /set spawn location/i }));
    const mapButton = await screen.findByTestId("mock-map");
    await user.click(mapButton);

    const dialog = await screen.findByRole("dialog", { name: /save default spawn/i });
    const textarea = within(dialog).getByLabelText(/scene note/i);
    await user.clear(textarea);
    await user.type(textarea, "Rally at the gates");

    await user.click(within(dialog).getByRole("button", { name: /save spawn/i }));

    await waitFor(() => expect(upsertSpawnStub).toHaveBeenCalledWith(campaign.id, {
      position: { x: 1234.56, y: 789.01 },
      note: "Rally at the gates",
    }));
    expect(await screen.findByText(/rally at the gates/i)).toBeInTheDocument();
  });
});
