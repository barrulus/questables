import {
  WORLD_MAP_NONE_SENTINEL,
  CAMPAIGN_SYSTEM_OPTIONS,
  buildEditFormState,
  createCampaignFormReducer,
  editCampaignFormReducer,
  createEditFormDefaults,
  DEFAULT_LEVEL_RANGE,
  DEFAULT_MAX_PLAYERS,
  fromWorldMapSelectValue,
  toWorldMapSelectValue,
  buildCampaignUpdatePayload,
  type CreateCampaignFormState,
  type CampaignEditFormState,
  type CampaignEditSnapshot,
  type Campaign,
  normalizeWorldMapId,
  hasCampaignDescription,
  resolveWorldMapIdForUpdate,
} from "../components/campaign-shared";

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  const now = new Date().toISOString();
  return {
    id: "campaign-1",
    name: "Test Campaign",
    description: null,
    dm_user_id: "dm-1",
    system: "",
    setting: "",
    status: "recruiting",
    max_players: 6,
    level_range: { min: 1, max: 20 },
    is_public: false,
    world_map_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildCreateForm(overrides: Partial<CreateCampaignFormState> = {}): CreateCampaignFormState {
  return {
    name: "",
    description: "",
    system: "",
    setting: "",
    maxPlayers: DEFAULT_MAX_PLAYERS,
    levelRange: { min: DEFAULT_LEVEL_RANGE.min, max: DEFAULT_LEVEL_RANGE.max },
    isPublic: false,
    worldMapId: WORLD_MAP_NONE_SENTINEL,
    ...overrides,
  };
}

function buildEditForm(overrides: Partial<CampaignEditFormState> = {}): CampaignEditFormState {
  return {
    ...createEditFormDefaults(),
    ...overrides,
  };
}

describe("campaign world map sentinel helpers", () => {
  it("uses the sentinel value in edit form defaults", () => {
    const defaults = createEditFormDefaults();
    expect(defaults.worldMapId).toBe(WORLD_MAP_NONE_SENTINEL);
  });

  it("maps missing world map id to the sentinel for select controls", () => {
    const campaign = buildCampaign({ world_map_id: null });
    const formState = buildEditFormState(campaign);
    expect(formState.worldMapId).toBe(WORLD_MAP_NONE_SENTINEL);
  });

  it("preserves world map id strings in form state", () => {
    const campaign = buildCampaign({ world_map_id: "map-123" });
    const formState = buildEditFormState(campaign);
    expect(formState.worldMapId).toBe("map-123");
  });

  it("translates sentinel values out of the payload", () => {
    expect(fromWorldMapSelectValue(WORLD_MAP_NONE_SENTINEL)).toBeNull();
    expect(fromWorldMapSelectValue("map-456")).toBe("map-456");
  });

  it("produces the sentinel when no value is selected", () => {
    expect(toWorldMapSelectValue(null)).toBe(WORLD_MAP_NONE_SENTINEL);
    expect(toWorldMapSelectValue(undefined)).toBe(WORLD_MAP_NONE_SENTINEL);
    expect(toWorldMapSelectValue("map-789")).toBe("map-789");
    expect(toWorldMapSelectValue(42)).toBe("42");
  });
});

describe("normalizeWorldMapId", () => {
  it("trims string identifiers", () => {
    expect(normalizeWorldMapId("  map-123  ")).toBe("map-123");
  });

  it("returns null for empty strings", () => {
    expect(normalizeWorldMapId("   ")).toBeNull();
  });

  it("coerces finite numbers to strings", () => {
    expect(normalizeWorldMapId(101)).toBe("101");
  });

  it("drops non-finite numbers", () => {
    expect(normalizeWorldMapId(Number.NaN)).toBeNull();
  });
});

describe("hasCampaignDescription", () => {
  it("returns true for non-empty strings", () => {
    expect(hasCampaignDescription("Quest hooks")).toBe(true);
  });

  it("returns false for null", () => {
    expect(hasCampaignDescription(null)).toBe(false);
  });

  it("returns false for whitespace-only strings", () => {
    expect(hasCampaignDescription("   ")).toBe(false);
  });
});

describe("buildEditFormState", () => {
  it("exposes shared system options sorted as configured", () => {
    expect(CAMPAIGN_SYSTEM_OPTIONS).toMatchInlineSnapshot(`
      [
        {
          "label": "D&D 5e",
          "value": "D&D 5e",
        },
        {
          "label": "Pathfinder 2e",
          "value": "Pathfinder 2e",
        },
        {
          "label": "Call of Cthulhu",
          "value": "Call of Cthulhu",
        },
        {
          "label": "Vampire: The Masquerade",
          "value": "Vampire: The Masquerade",
        },
        {
          "label": "Other",
          "value": "Other",
        },
      ]
    `);
  });

  it("preserves optional text fields from the campaign", () => {
    const campaign = buildCampaign({
      description: "Session zero recap",
      system: "Pathfinder 2e",
      setting: "Absalom Station",
    });

    const formState = buildEditFormState(campaign);
    expect(formState.description).toBe("Session zero recap");
    expect(formState.system).toBe("Pathfinder 2e");
    expect(formState.setting).toBe("Absalom Station");
  });

  it("normalises null description to an empty string", () => {
    const campaign = buildCampaign({ description: null });
    const formState = buildEditFormState(campaign);
    expect(formState.description).toBe("");
  });
});

describe("buildCampaignUpdatePayload", () => {
  const baseCampaign = buildCampaign({
    description: "Lore dump",
    system: "D&D 5e",
    setting: "Neverwinter",
    level_range: { min: 3, max: 7 },
  });

  const snapshotFrom = (overrides: Partial<CampaignEditSnapshot> = {}): CampaignEditSnapshot => ({
    name: baseCampaign.name,
    description: baseCampaign.description ?? "",
    system: baseCampaign.system,
    setting: baseCampaign.setting,
    status: baseCampaign.status,
    maxPlayers: baseCampaign.max_players,
    levelRange: { min: 3, max: 7 },
    worldMapId: baseCampaign.world_map_id,
    ...overrides,
  });

  it("returns an empty payload when nothing changed", () => {
    const payload = buildCampaignUpdatePayload(baseCampaign, snapshotFrom());
    expect(payload).toEqual({});
  });

  it("normalises cleared description to null", () => {
    const payload = buildCampaignUpdatePayload(
      baseCampaign,
      snapshotFrom({ description: "   " }),
    );
    expect(payload).toEqual({ description: null });
  });

  it("captures multiple field updates", () => {
    const payload = buildCampaignUpdatePayload(
      baseCampaign,
      snapshotFrom({
        name: "Lore dump v2",
        system: "Call of Cthulhu",
        levelRange: { min: 5, max: 9 },
        worldMapId: "map-123",
      }),
    );

    expect(payload).toEqual({
      name: "Lore dump v2",
      system: "Call of Cthulhu",
      levelRange: { min: 5, max: 9 },
      worldMapId: "map-123",
    });
  });

  it("treats numeric baseline map ids as unchanged", () => {
    const campaignWithNumericId = buildCampaign();
    (campaignWithNumericId as unknown as { world_map_id: number }).world_map_id = 77;
    const payload = buildCampaignUpdatePayload(
      campaignWithNumericId,
      snapshotFrom({ worldMapId: "77" }),
    );

    expect(payload.worldMapId).toBeUndefined();
  });
});

describe("createCampaignFormReducer", () => {
  it("updates text fields", () => {
    const initial = buildCreateForm();
    const updated = createCampaignFormReducer(initial, {
      type: 'updateText',
      field: 'name',
      value: "New Campaign",
    });

    expect(updated.name).toBe("New Campaign");
    expect(initial.name).toBe("");
  });

  it("clamps max players within allowed range", () => {
    const initial = buildCreateForm();
    const updated = createCampaignFormReducer(initial, {
      type: 'setMaxPlayers',
      value: "999",
    });

    expect(updated.maxPlayers).toBe(20);
  });

  it("ensures max level never drops below min level", () => {
    const initial = buildCreateForm({ levelRange: { min: 8, max: 12 } });
    const updated = createCampaignFormReducer(initial, {
      type: 'setLevel',
      field: 'min',
      value: "15",
    });

    expect(updated.levelRange.min).toBe(15);
    expect(updated.levelRange.max).toBe(15);
  });

  it("resets world map selection to sentinel when options are empty", () => {
    const initial = buildCreateForm({ worldMapId: "map-123" });
    const updated = createCampaignFormReducer(initial, {
      type: 'syncWorldMapOptions',
      mapIds: [],
    });

    expect(updated.worldMapId).toBe(WORLD_MAP_NONE_SENTINEL);
  });

  it("replaces state when reset action is dispatched", () => {
    const initial = buildCreateForm({ name: "Stale Name" });
    const defaults = buildCreateForm();
    const updated = createCampaignFormReducer(initial, {
      type: 'reset',
      payload: defaults,
    });

    expect(updated).toEqual(defaults);
  });
});

describe("editCampaignFormReducer", () => {
  it("hydrates form state from payload", () => {
    const snapshot = buildEditForm({ name: "Loaded Campaign" });
    const result = editCampaignFormReducer(buildEditForm(), {
      type: 'hydrate',
      payload: snapshot,
    });

    expect(result).toEqual(snapshot);
  });

  it("prevents max players from dropping below 1 when cleared and re-entered", () => {
    const initial = buildEditForm({ maxPlayers: 6 });
    const cleared = editCampaignFormReducer(initial, { type: 'setMaxPlayers', value: '' });
    expect(cleared.maxPlayers).toBe('');

    const restored = editCampaignFormReducer(cleared, { type: 'setMaxPlayers', value: "0" });
    expect(restored.maxPlayers).toBe(1);
  });

  it("clamps level boundaries when min exceeds max", () => {
    const initial = buildEditForm({ minLevel: 5, maxLevel: 9 });
    const updated = editCampaignFormReducer(initial, {
      type: 'setLevel',
      field: 'max',
      value: "2",
    });

    expect(updated.maxLevel).toBe(5);
  });

  it("updates campaign status", () => {
    const initial = buildEditForm({ status: 'recruiting' });
    const updated = editCampaignFormReducer(initial, { type: 'setStatus', value: 'paused' });
    expect(updated.status).toBe('paused');
  });
});

describe("resolveWorldMapIdForUpdate", () => {
  it("returns the baseline map id when the field was not touched", () => {
    const result = resolveWorldMapIdForUpdate({
      selectedValue: WORLD_MAP_NONE_SENTINEL,
      baselineValue: "map-001",
      touched: false,
    });

    expect(result).toBe("map-001");
  });

  it("returns null when the user clears the world map selection", () => {
    const result = resolveWorldMapIdForUpdate({
      selectedValue: WORLD_MAP_NONE_SENTINEL,
      baselineValue: "map-001",
      touched: true,
    });

    expect(result).toBeNull();
  });

  it("returns the newly selected map id when changed", () => {
    const result = resolveWorldMapIdForUpdate({
      selectedValue: "map-777",
      baselineValue: "map-001",
      touched: true,
    });

    expect(result).toBe("map-777");
  });
});
