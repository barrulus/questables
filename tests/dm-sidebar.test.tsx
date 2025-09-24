import { jest, describe, beforeAll, beforeEach, it, expect } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpawnPoint } from "../utils/api-client";

const fetchJsonMock = jest.fn();
const listCampaignSpawnsMock = jest.fn();
const updateSessionFocusMock = jest.fn();
const updateSessionContextMock = jest.fn();
const createUnplannedEncounterMock = jest.fn();
const adjustNpcSentimentMock = jest.fn();
const teleportPlayerMock = jest.fn();
const teleportNpcMock = jest.fn();

let DMSidebar: typeof import("../components/dm-sidebar").DMSidebar;
let useGameSessionMock: jest.Mock;
let useUserMock: jest.Mock;

beforeAll(async () => {
  await jest.unstable_mockModule("../contexts/GameSessionContext", () => ({
    useGameSession: jest.fn(),
  }));

  await jest.unstable_mockModule("../contexts/UserContext", () => ({
    useUser: jest.fn(),
  }));

  await jest.unstable_mockModule("sonner", () => ({
    toast: {
      success: jest.fn(),
      error: jest.fn(),
    },
  }));

  await jest.unstable_mockModule("../utils/api-client", () => ({
    __esModule: true,
    fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
    listCampaignSpawns: (...args: unknown[]) => listCampaignSpawnsMock(...args),
    updateSessionFocus: (...args: unknown[]) => updateSessionFocusMock(...args),
    updateSessionContext: (...args: unknown[]) => updateSessionContextMock(...args),
    createUnplannedEncounter: (...args: unknown[]) => createUnplannedEncounterMock(...args),
    adjustNpcSentiment: (...args: unknown[]) => adjustNpcSentimentMock(...args),
    teleportPlayer: (...args: unknown[]) => teleportPlayerMock(...args),
    teleportNpc: (...args: unknown[]) => teleportNpcMock(...args),
    HttpError: class HttpError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
  }));

  ({ DMSidebar } = await import("../components/dm-sidebar"));
  ({ useGameSession: useGameSessionMock } = await import("../contexts/GameSessionContext"));
  ({ useUser: useUserMock } = await import("../contexts/UserContext"));
});

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => false,
      configurable: true,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      configurable: true,
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: () => {},
      configurable: true,
    });
  }
});

const baseSessionRow = {
  id: "session-1",
  session_number: 1,
  title: "Opening Gambit",
  status: "active",
  dm_focus: "Initial focus",
  dm_context_md: "## Context\nOpening scene",
};

const baseLocationRow = {
  id: "location-1",
  name: "River Keep",
  type: "stronghold",
};

const baseNpcRow = {
  id: "npc-1",
  name: "Guardian",
  role: "Sentinel",
  location_name: "River Keep",
};

const basePlayerRow = {
  campaign_player_id: "player-1",
  id: "character-1",
  name: "Aria Storm",
  role: "player",
  visibility_state: "visible",
};

const baseSpawn: SpawnPoint = {
  id: "spawn-1",
  campaignId: "campaign-1",
  name: "Base Camp",
  note: null,
  isDefault: true,
  geometry: { type: "Point", coordinates: [12.34, 56.78] },
  createdAt: null,
  updatedAt: null,
};

function arrangeDefaults() {
  useUserMock.mockReturnValue({
    user: { id: "user-1", username: "DungeonMaster", roles: ["dm"] },
  });

  useGameSessionMock.mockReturnValue({
    activeCampaignId: "campaign-1",
    activeCampaign: { id: "campaign-1", name: "Crownfall", dmUserId: "user-1" },
    latestSession: { id: "session-1", sessionNumber: 1, title: "Opening Gambit", status: "active" },
    loading: false,
    error: null,
    selectCampaign: jest.fn(),
    refreshActiveCampaign: jest.fn(),
    playerVisibilityRadius: null,
    viewerRole: "dm",
    updateVisibilityMetadata: jest.fn(),
  });

  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path.endsWith("/sessions")) {
      return [baseSessionRow];
    }
    if (path.endsWith("/locations")) {
      return [baseLocationRow];
    }
    if (path.endsWith("/npcs")) {
      return [baseNpcRow];
    }
    if (path.endsWith("/characters")) {
      return [basePlayerRow];
    }
    return [];
  });

  listCampaignSpawnsMock.mockResolvedValue([baseSpawn]);

  updateSessionFocusMock.mockResolvedValue({ sessionId: "session-1", dmFocus: "Updated focus" });
  updateSessionContextMock.mockResolvedValue({ sessionId: "session-1", mode: "replace", dmContextMd: "New context" });
  createUnplannedEncounterMock.mockResolvedValue({
    id: "encounter-1",
    campaign_id: "campaign-1",
    session_id: "session-1",
    location_id: null,
    name: "Spectral riders",
    description: "Spectral riders ambush the caravan.",
    type: "combat",
    difficulty: "medium",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  adjustNpcSentimentMock.mockResolvedValue({
    id: "memory-1",
    npc_id: "npc-1",
    campaign_id: "campaign-1",
    session_id: "session-1",
    memory_summary: "Trust increased",
    sentiment: "positive",
    trust_delta: 3,
    tags: ["trust"],
    created_at: new Date().toISOString(),
  });
  teleportPlayerMock.mockResolvedValue({
    playerId: "player-1",
    geometry: { type: "Point", coordinates: [12.34, 56.78] },
    visibilityState: "visible",
    lastLocatedAt: new Date().toISOString(),
    mode: "teleport",
    reason: null,
    spawn: baseSpawn,
  });
  teleportNpcMock.mockResolvedValue({
    npcId: "npc-1",
    campaignId: "campaign-1",
    currentLocationId: null,
    worldPosition: { type: "Point", coordinates: [10, 20] },
  });
}

describe("DMSidebar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    arrangeDefaults();
  });

  it("updates the session focus via the live endpoint", async () => {
    render(<DMSidebar />);

    await screen.findByRole("heading", { name: /Session Focus/i });

    const focusField = await screen.findByRole("textbox", { name: /current focus/i });
    await waitFor(() => expect(focusField).toHaveValue("Initial focus"));
    await userEvent.clear(focusField);
    await userEvent.type(focusField, "Updated focus");

    await userEvent.click(screen.getByRole("button", { name: /save focus/i }));

    await waitFor(() => {
      expect(updateSessionFocusMock).toHaveBeenCalledWith("session-1", { focus: "Updated focus" });
    });

    await waitFor(() => expect(focusField).toHaveValue("Updated focus"));
  });

  it("rejects unplanned encounter submissions without a description", async () => {
    render(<DMSidebar />);

    await userEvent.click(await screen.findByRole("button", { name: /record encounter/i }));

    await screen.findByText(/Encounter creation failed/i);
    expect(createUnplannedEncounterMock).not.toHaveBeenCalled();
  });

  it("teleports a player using the default spawn point", async () => {
    render(<DMSidebar />);

    const playerSelect = await screen.findByRole("combobox", { name: /campaign player/i });
    await userEvent.click(playerSelect);
    await userEvent.click(await screen.findByRole("option", { name: /Aria Storm/ }));

    await userEvent.click(screen.getByRole("button", { name: /teleport player/i }));

    await waitFor(() => {
      expect(teleportPlayerMock).toHaveBeenCalledWith("campaign-1", {
        playerId: "player-1",
        spawnId: "spawn-1",
      });
    });

    await screen.findByText(/Player teleported/i);
  });
});
