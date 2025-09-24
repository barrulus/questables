import { jest } from "@jest/globals";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ObjectiveRecord } from "../utils/api-client";
import type { Campaign } from "../components/campaign-shared";
import type { ComponentType } from "react";
import type { ObjectivesPanelProps } from "../components/objectives-panel";

const listCampaignObjectivesMock = jest.fn();
const createObjectiveMock = jest.fn();
const updateObjectiveMock = jest.fn();
const deleteObjectiveMock = jest.fn();
const apiFetchMock = jest.fn();
const readJsonBodyMock = jest.fn();
const readErrorMessageMock = jest.fn();
const requestObjectiveAssistMock = jest.fn();

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let ObjectivesPanel: ComponentType<ObjectivesPanelProps>;

beforeAll(async () => {
  await jest.unstable_mockModule("../hooks/useWebSocket", () => ({
    useWebSocket: () => ({ messages: [] }),
  }));

  await jest.unstable_mockModule("../contexts/UserContext", () => ({
    useUser: () => ({
      user: {
        id: "user-1",
        username: "dm",
        email: "dm@example.com",
        roles: ["dm"],
        role: "dm",
      },
      authToken: "token",
      login: jest.fn(),
      logout: jest.fn(),
      loading: false,
      error: null,
      updateProfile: jest.fn(),
    }),
  }));

  await jest.unstable_mockModule("socket.io-client", () => ({
    io: jest.fn(() => ({
      on: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      connect: jest.fn(),
    })),
  }));

  await jest.unstable_mockModule("../components/objective-pin-map", () => ({
    ObjectivePinMap: ({ onSelect }: { onSelect: (_coords: { x: number; y: number }) => void }) => (
      <button type="button" onClick={() => onSelect({ x: 111, y: 222 })}>
        Select point
      </button>
    ),
  }));

  await jest.unstable_mockModule("../utils/api-client", () => ({
    __esModule: true,
    listCampaignObjectives: (...args: unknown[]) => listCampaignObjectivesMock(...args),
    createObjective: (...args: unknown[]) => createObjectiveMock(...args),
    updateObjective: (...args: unknown[]) => updateObjectiveMock(...args),
    deleteObjective: (...args: unknown[]) => deleteObjectiveMock(...args),
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    readJsonBody: (...args: unknown[]) => readJsonBodyMock(...args),
    readErrorMessage: (...args: unknown[]) => readErrorMessageMock(...args),
    requestObjectiveAssist: (...args: unknown[]) => requestObjectiveAssistMock(...args),
    HttpError,
  }));

  const module = await import("../components/objectives-panel");
  ObjectivesPanel = module.ObjectivesPanel;
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
});

const baseCampaign: Campaign = {
  id: "campaign-1",
  name: "Verdant Watch",
  description: "",
  dm_user_id: "dm-1",
  system: "5e",
  setting: "Homebrew",
  status: "recruiting",
  max_players: 5,
  level_range: { min: 1, max: 5 },
  is_public: false,
  world_map_id: null,
  allow_spectators: false,
  auto_approve_join_requests: false,
  experience_type: "milestone",
  resting_rules: "standard",
  death_save_rules: "standard",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const createObjectiveRecord = (id: string, overrides: Partial<ObjectiveRecord> = {}): ObjectiveRecord => ({
  id,
  campaignId: baseCampaign.id,
  parentId: null,
  title: `Objective ${id}`,
  descriptionMd: null,
  treasureMd: null,
  combatMd: null,
  npcsMd: null,
  rumoursMd: null,
  location: null,
  orderIndex: 0,
  isMajor: false,
  slug: null,
  createdAt: null,
  updatedAt: null,
  createdBy: null,
  updatedBy: null,
  ...overrides,
});

const renderPanel = (props: Record<string, unknown> = {}) => {
  return render(
    <ObjectivesPanel
      campaign={baseCampaign}
      canEdit
      worldMap={null}
      {...props}
    />
  );
};

describe("ObjectivesPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiFetchMock.mockReset();
    readJsonBodyMock.mockReset();
    readErrorMessageMock.mockReset();
    readErrorMessageMock.mockResolvedValue("Request failed");
    requestObjectiveAssistMock.mockReset();
  });

  it("loads objectives and displays them", async () => {
    const objectives = [
      createObjectiveRecord("root-1", { title: "Secure the outpost" }),
      createObjectiveRecord("root-2", { title: "Scout the ruins", orderIndex: 1 }),
    ];
    listCampaignObjectivesMock.mockResolvedValue(objectives);

    renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalledWith(baseCampaign.id));

    expect(await screen.findByText("Secure the outpost")).toBeInTheDocument();
    expect(await screen.findByText("Scout the ruins")).toBeInTheDocument();
  });

  it("creates a new objective with the next order index", async () => {
    const objective = createObjectiveRecord("root-1", { title: "Existing", orderIndex: 0 });
    listCampaignObjectivesMock.mockResolvedValue([objective]);
    createObjectiveMock.mockResolvedValue(createObjectiveRecord("root-2", { title: "New objective", orderIndex: 1 }));

    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    await screen.findByText("Existing");

    await user.click(screen.getByRole("button", { name: /new objective/i }));
    const dialog = await screen.findByRole("dialog", { name: /create objective/i });
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "New objective");

    await user.click(within(dialog).getByRole("button", { name: /create objective/i }));

    await waitFor(() => expect(createObjectiveMock).toHaveBeenCalled());
    const [, payload] = createObjectiveMock.mock.calls[0];
    expect(payload).toMatchObject({
      title: "New objective",
      parentId: null,
      orderIndex: 1,
    });

    expect(await screen.findByTestId("objective-root-2")).toBeInTheDocument();
  });

  it("reorders sibling objectives and persists new order", async () => {
    const first = createObjectiveRecord("obj-a", { title: "First", orderIndex: 0 });
    const second = createObjectiveRecord("obj-b", { title: "Second", orderIndex: 1 });
    listCampaignObjectivesMock.mockResolvedValue([first, second]);
    updateObjectiveMock.mockResolvedValue(second);

    const { container } = renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    await screen.findByText("First");
    await screen.findByText("Second");

    const dragged = await screen.findByTestId("objective-obj-b");
    const dropBefore = container.querySelector('[data-testid="drop-before-obj-a"]');
    expect(dropBefore).not.toBeNull();

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
      effectAllowed: "move",
      dropEffect: "move",
    };

    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragOver(dropBefore!, { dataTransfer });
    fireEvent.drop(dropBefore!, { dataTransfer });

    await waitFor(() => expect(updateObjectiveMock).toHaveBeenCalledTimes(2));
    expect(updateObjectiveMock).toHaveBeenCalledWith("obj-b", expect.objectContaining({ orderIndex: 0 }));
    expect(updateObjectiveMock).toHaveBeenCalledWith("obj-a", expect.objectContaining({ orderIndex: 1 }));
  });

  it("shows marker gating when marker endpoint is missing", async () => {
    const objectives = [createObjectiveRecord("root-1", { title: "Root" })];
    listCampaignObjectivesMock.mockResolvedValue(objectives);

    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    readJsonBodyMock.mockResolvedValueOnce([]);
    apiFetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    renderPanel({
      worldMap: {
        id: "world-1",
        name: "World",
        bounds: { north: 10, south: 0, east: 10, west: 0 },
      },
    });

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    await screen.findByText("Root");
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/api/maps/world-1/markers"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new objective/i }));
    const dialog = await screen.findByRole("dialog", { name: /create objective/i });

    expect(await within(dialog).findByText(/markers endpoint unavailable/i)).toBeInTheDocument();
  });

  it("deletes an objective after confirmation", async () => {
    const objective = createObjectiveRecord("root-1", { title: "Delete me" });
    listCampaignObjectivesMock.mockResolvedValue([objective]);
    deleteObjectiveMock.mockResolvedValue([objective.id]);
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    const deleteButton = await screen.findByRole("button", { name: /delete/i });

    await user.click(deleteButton);

    await waitFor(() => expect(deleteObjectiveMock).toHaveBeenCalledWith("root-1"));

    confirmSpy.mockRestore();
  });

  it("requests description assists against the live endpoint and updates the form", async () => {
    const objective = createObjectiveRecord("obj-1", { title: "Existing", descriptionMd: "Initial copy" });
    listCampaignObjectivesMock.mockResolvedValue([objective]);
    requestObjectiveAssistMock.mockResolvedValue({
      objective: createObjectiveRecord("obj-1", { descriptionMd: "## Assisted content" }),
      assist: {
        field: "description_md",
        content: "## Assisted content",
        provider: { name: "ollama", model: "qwen3:8b" },
        metrics: null,
        cache: null,
      },
    });

    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    const editButton = await screen.findByRole("button", { name: /^Edit$/ });
    await user.click(editButton);
    const dialog = await screen.findByRole("dialog", { name: /edit objective/i });

    const assistButton = within(dialog).getByRole("button", { name: /assist description/i });
    await user.click(assistButton);

    await waitFor(() => expect(requestObjectiveAssistMock).toHaveBeenCalledWith("obj-1", "description"));

    const descriptionInput = within(dialog).getByRole("textbox", { name: /description/i });
    await waitFor(() => expect(descriptionInput).toHaveValue("## Assisted content"));
    expect(await within(dialog).findByText(/Generated with ollama · qwen3:8b\./i)).toBeInTheDocument();
  });

  it("surfaces throttling feedback when the assist endpoint rate limits the request", async () => {
    const objective = createObjectiveRecord("obj-2", { title: "Existing" });
    listCampaignObjectivesMock.mockResolvedValue([objective]);
    requestObjectiveAssistMock.mockRejectedValue(new HttpError("Too many requests", 429));

    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(listCampaignObjectivesMock).toHaveBeenCalled());
    const editButton = await screen.findByRole("button", { name: /^Edit$/ });
    await user.click(editButton);
    const dialog = await screen.findByRole("dialog", { name: /edit objective/i });

    const assistButton = within(dialog).getByRole("button", { name: /assist description/i });
    await user.click(assistButton);

    await waitFor(() => expect(requestObjectiveAssistMock).toHaveBeenCalledWith("obj-2", "description"));
    expect(await within(dialog).findByText(/assist request throttled/i)).toBeInTheDocument();
    await waitFor(() => expect(assistButton).not.toBeDisabled());
  });
});
