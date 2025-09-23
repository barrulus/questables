import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Switch } from "./ui/switch";
import { toast } from "sonner";
import { 
  MapIcon,
  Plus,
  Edit,
  Trash2,
  Users,
  Calendar,
  Loader2,
  AlertCircle,
  Settings,
  Share,
  RefreshCw
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import {
  apiFetch,
  readErrorMessage,
  readJsonBody,
  createCampaign,
  updateCampaign,
  type CampaignLevelRange,
  type CreateCampaignRequest,
  type UpdateCampaignRequest,
} from "../utils/api-client";
import {
  Campaign,
  CampaignEditFormState,
  CampaignSettingsFormState,
  CampaignStatus,
  ExperienceType,
  RestingRules,
  DeathSaveRules,
  clampLevelValue,
  coerceLevelRange,
  buildEditFormState,
  buildSettingsFormState,
  createEditFormDefaults,
  createSettingsFormDefaults,
  DEFAULT_LEVEL_RANGE,
} from "./campaign-shared";
import { CampaignPrep } from "./campaign-prep";

interface WorldMapSummary {
  id: string;
  name: string;
  description?: string | null;
}

type NumericInputValue = number | '';

interface LevelRangeInputState {
  min: NumericInputValue;
  max: NumericInputValue;
}

interface CreateCampaignFormState {
  name: string;
  description: string;
  system: string;
  setting: string;
  maxPlayers: NumericInputValue;
  levelRange: LevelRangeInputState;
  isPublic: boolean;
  worldMapId: string;
}

const parseIntegerInput = (value: NumericInputValue): number | null => {
  if (value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

export function CampaignManager() {
  const { user } = useUser();
  const [dmCampaigns, setDmCampaigns] = useState<Campaign[]>([]);
  const [worldMaps, setWorldMaps] = useState<WorldMapSummary[]>([]);
  const [worldMapsLoading, setWorldMapsLoading] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const [isCreating, setIsCreating] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const NO_WORLD_MAP_VALUE = "__none";

  const createFormDefaults = useCallback((): CreateCampaignFormState => ({
    name: "",
    description: "",
    system: "",
    setting: "",
    maxPlayers: 6,
    levelRange: { min: DEFAULT_LEVEL_RANGE.min, max: DEFAULT_LEVEL_RANGE.max },
    isPublic: false,
    worldMapId: NO_WORLD_MAP_VALUE,
  }), [NO_WORLD_MAP_VALUE]);

  const [newCampaign, setNewCampaign] = useState<CreateCampaignFormState>(createFormDefaults);
  const [editDialogCampaign, setEditDialogCampaign] = useState<Campaign | null>(null);
  const [editForm, setEditForm] = useState<CampaignEditFormState>(() => createEditFormDefaults());
  const [editSaving, setEditSaving] = useState(false);
  const [settingsDialogCampaign, setSettingsDialogCampaign] = useState<Campaign | null>(null);
  const [settingsForm, setSettingsForm] = useState<CampaignSettingsFormState>(() => createSettingsFormDefaults());
  const [settingsSaving, setSettingsSaving] = useState(false);

  const lastSelectedCampaignIdRef = useRef<string | null>(null);

  const handleSelectCampaign = useCallback((campaign: Campaign | null) => {
    if (campaign) {
      lastSelectedCampaignIdRef.current = campaign.id;
      setSelectedCampaign(campaign);
    } else {
      lastSelectedCampaignIdRef.current = null;
      setSelectedCampaign(null);
    }
  }, []);

  const loadWorldMaps = useCallback(async ({ signal }: { signal?: AbortSignal } = {}) => {
    try {
      setWorldMapsLoading(true);
      const response = await apiFetch('/api/maps/world', { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load world maps'));
      }
      const payload = await readJsonBody<unknown>(response);
      if (!Array.isArray(payload)) {
        setWorldMaps([]);
        return;
      }
      const maps = payload
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const record = item as Record<string, unknown>;
          const id = typeof record.id === 'string' ? record.id : null;
          const name = typeof record.name === 'string' && record.name.trim() ? record.name : null;
          if (!id || !name) return null;
          return {
            id,
            name,
            description: typeof record.description === 'string' ? record.description : null,
          } satisfies WorldMapSummary;
        })
        .filter((value): value is WorldMapSummary => Boolean(value));
      setWorldMaps(maps);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load world maps';
      toast.error(message);
    } finally {
      setWorldMapsLoading(false);
    }
  }, []);

  const openEditDialog = useCallback((campaign: Campaign) => {
    const nextForm = buildEditFormState(campaign);
    setEditDialogCampaign(campaign);
    setEditForm({
      ...nextForm,
      description: '',
      system: '',
      setting: '',
      worldMapId: nextForm.worldMapId || NO_WORLD_MAP_VALUE,
    });
  }, [NO_WORLD_MAP_VALUE]);

  const closeEditDialog = useCallback(() => {
    setEditDialogCampaign(null);
    const defaults = createEditFormDefaults();
    setEditForm({ ...defaults, worldMapId: NO_WORLD_MAP_VALUE });
  }, [NO_WORLD_MAP_VALUE, createEditFormDefaults]);

  const openSettingsDialog = useCallback((campaign: Campaign) => {
    setSettingsDialogCampaign(campaign);
    setSettingsForm(buildSettingsFormState(campaign));
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setSettingsDialogCampaign(null);
    setSettingsForm(createSettingsFormDefaults());
  }, []);

  // Load all campaign data
  const loadCampaignData = useCallback(async ({ signal, mode = "initial" }: { signal?: AbortSignal; mode?: "initial" | "refresh" } = {}) => {
    if (!user) {
      handleSelectCampaign(null);
      setDmCampaigns([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const setSpinner = (value: boolean) => {
      if (mode === "initial") {
        setLoading(value);
      } else {
        setRefreshing(value);
      }
    };

    try {
      setSpinner(true);
      setError(null);

      const userCampaignsResponse = await apiFetch(`/api/users/${user.id}/campaigns`, { signal });
      if (!userCampaignsResponse.ok) {
        throw new Error(await readErrorMessage(userCampaignsResponse, "Failed to load user campaigns"));
      }
      const userCampaignsData = await readJsonBody<{ dmCampaigns?: Campaign[] }>(userCampaignsResponse);

      const dmCampaignList = userCampaignsData.dmCampaigns ?? [];

      setDmCampaigns(dmCampaignList);

      const lastSelectedId = lastSelectedCampaignIdRef.current;
      if (lastSelectedId) {
        const matched = dmCampaignList.find((campaign) => campaign.id === lastSelectedId);
        if (matched) {
          handleSelectCampaign(matched);
          return;
        }
      }

      if (dmCampaignList.length > 0) {
        handleSelectCampaign(dmCampaignList[0]);
      } else {
        handleSelectCampaign(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load campaigns';
      setError(message);
      if (mode === "refresh") {
        toast.error(message);
      }
    } finally {
      setSpinner(false);
    }
  }, [user, handleSelectCampaign]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const controller = new AbortController();
    loadCampaignData({ signal: controller.signal, mode: "initial" });
    return () => controller.abort();
  }, [user, loadCampaignData]);

  useEffect(() => {
    const controller = new AbortController();
    loadWorldMaps({ signal: controller.signal });
    return () => controller.abort();
  }, [loadWorldMaps]);

  useEffect(() => {
    setNewCampaign((prev) => {
      if (worldMaps.length === 0) {
        return prev.worldMapId === NO_WORLD_MAP_VALUE ? prev : { ...prev, worldMapId: NO_WORLD_MAP_VALUE };
      }

      const hasMatch = worldMaps.some((map) => map.id === prev.worldMapId);
      if (hasMatch || prev.worldMapId === NO_WORLD_MAP_VALUE) {
        return prev;
      }

      return { ...prev, worldMapId: NO_WORLD_MAP_VALUE };
    });
  }, [worldMaps, NO_WORLD_MAP_VALUE]);

  const buildLevelRange = useCallback((range: LevelRangeInputState): CampaignLevelRange | null => {
    if (range.min === '' || range.max === '') {
      return null;
    }

    const minValue = Number(range.min);
    const maxValue = Number(range.max);

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return null;
    }

    const min = clampLevelValue(minValue);
    const max = clampLevelValue(maxValue);

    return { min, max };
  }, []);

  const handleCreateCampaign = useCallback(async () => {
    if (!user) {
      toast.error("You need to be signed in to create a campaign.");
      return;
    }

    const trimmedName = newCampaign.name.trim();
    if (!trimmedName) {
      toast.error("Campaign name is required.");
      return;
    }

    const maxPlayersValue = parseIntegerInput(newCampaign.maxPlayers);
    if (
      maxPlayersValue === null ||
      !Number.isInteger(maxPlayersValue) ||
      maxPlayersValue < 1 ||
      maxPlayersValue > 20
    ) {
      toast.error("Max players must be between 1 and 20.");
      return;
    }

    const levelRange = buildLevelRange(newCampaign.levelRange);
    if (!levelRange) {
      toast.error("Provide both minimum and maximum levels.");
      return;
    }

    if (
      levelRange.min < 1 ||
      levelRange.min > 20 ||
      levelRange.max < 1 ||
      levelRange.max > 20
    ) {
      toast.error("Levels must be between 1 and 20.");
      return;
    }

    if (levelRange.min > levelRange.max) {
      toast.error("Minimum level cannot exceed maximum level.");
      return;
    }

    const description = newCampaign.description.trim();
    const system = newCampaign.system.trim();
    const setting = newCampaign.setting.trim();
    const worldMapId = newCampaign.worldMapId === NO_WORLD_MAP_VALUE ? undefined : newCampaign.worldMapId;

    const payload: CreateCampaignRequest = {
      name: trimmedName,
      maxPlayers: maxPlayersValue,
      levelRange,
      isPublic: newCampaign.isPublic,
      ...(description ? { description } : {}),
      ...(system ? { system } : {}),
      ...(setting ? { setting } : {}),
      ...(worldMapId ? { worldMapId } : {}),
    };

    try {
      setCreateLoading(true);
      const createdCampaign = await createCampaign(payload);
      lastSelectedCampaignIdRef.current = createdCampaign.id;
      await loadCampaignData({ mode: "refresh" });
      setNewCampaign(createFormDefaults());
      setIsCreating(false);
      toast.success("Campaign created successfully!");
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create campaign';
      toast.error(message);
    } finally {
      setCreateLoading(false);
    }
  }, [
    user,
    newCampaign,
    buildLevelRange,
    NO_WORLD_MAP_VALUE,
    createFormDefaults,
    loadCampaignData,
  ]);

  const handleUpdateCampaign = useCallback(async () => {
    if (!editDialogCampaign) {
      return;
    }

    if (!user || editDialogCampaign.dm_user_id !== user.id) {
      toast.error("Only the campaign DM can update these details.");
      return;
    }

    const trimmedName = editForm.name.trim();
    if (!trimmedName) {
      toast.error("Campaign name is required.");
      return;
    }

    const maxPlayersValue = parseIntegerInput(editForm.maxPlayers);
    if (
      maxPlayersValue === null ||
      !Number.isInteger(maxPlayersValue) ||
      maxPlayersValue < 1 ||
      maxPlayersValue > 20
    ) {
      toast.error("Max players must be an integer between 1 and 20.");
      return;
    }

    const levelRange = buildLevelRange({ min: editForm.minLevel, max: editForm.maxLevel });
    if (!levelRange) {
      toast.error("Provide both minimum and maximum levels.");
      return;
    }

    if (
      levelRange.min < 1 ||
      levelRange.min > 20 ||
      levelRange.max < 1 ||
      levelRange.max > 20
    ) {
      toast.error("Levels must be between 1 and 20.");
      return;
    }

    if (levelRange.min > levelRange.max) {
      toast.error("Minimum level cannot exceed maximum level.");
      return;
    }

    const worldMapId = editForm.worldMapId === NO_WORLD_MAP_VALUE ? null : editForm.worldMapId || null;
    if (editForm.status === 'active' && !worldMapId) {
      toast.error('Select a world map before activating the campaign.');
      return;
    }

    const payload: UpdateCampaignRequest = {
      name: trimmedName,
      description: editForm.description.trim() ? editForm.description.trim() : null,
      system: editForm.system.trim() || null,
      setting: editForm.setting.trim() || null,
      status: editForm.status,
      maxPlayers: maxPlayersValue,
      levelRange,
      worldMapId,
    };

    try {
      setEditSaving(true);
      await updateCampaign(editDialogCampaign.id, payload);
      lastSelectedCampaignIdRef.current = editDialogCampaign.id;
      await loadCampaignData({ mode: 'refresh' });
      toast.success("Campaign details updated.");
      closeEditDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update campaign';
      toast.error(message);
    } finally {
      setEditSaving(false);
    }
  }, [
    editDialogCampaign,
    editForm.description,
    editForm.maxLevel,
    editForm.maxPlayers,
    editForm.minLevel,
    editForm.name,
    editForm.setting,
    editForm.status,
    editForm.system,
    editForm.worldMapId,
    buildLevelRange,
    NO_WORLD_MAP_VALUE,
    user,
    loadCampaignData,
    closeEditDialog,
  ]);

  const handleUpdateCampaignSettings = useCallback(async () => {
    if (!settingsDialogCampaign) {
      return;
    }

    if (!user || settingsDialogCampaign.dm_user_id !== user.id) {
      toast.error("Only the campaign DM can update settings.");
      return;
    }

    const payload: UpdateCampaignRequest = {
      isPublic: settingsForm.isPublic,
      allowSpectators: settingsForm.allowSpectators,
      autoApproveJoinRequests: settingsForm.autoApproveJoinRequests,
      experienceType: settingsForm.experienceType,
      restingRules: settingsForm.restingRules,
      deathSaveRules: settingsForm.deathSaveRules,
    };

    try {
      setSettingsSaving(true);
      await updateCampaign(settingsDialogCampaign.id, payload);
      lastSelectedCampaignIdRef.current = settingsDialogCampaign.id;
      await loadCampaignData({ mode: 'refresh' });
      toast.success("Campaign settings updated.");
      closeSettingsDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update campaign settings';
      toast.error(message);
    } finally {
      setSettingsSaving(false);
    }
  }, [
    closeSettingsDialog,
    loadCampaignData,
    settingsDialogCampaign,
    settingsForm.allowSpectators,
    settingsForm.autoApproveJoinRequests,
    settingsForm.deathSaveRules,
    settingsForm.experienceType,
    settingsForm.isPublic,
    settingsForm.restingRules,
    user,
  ]);

  const handleDeleteCampaign = async (campaign: Campaign) => {
    if (!user || campaign.dm_user_id !== user.id) {
      toast.error("You can only delete campaigns you created");
      return;
    }

    try {
      const response = await apiFetch(`/api/campaigns/${campaign.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dmUserId: user.id })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to delete campaign'));
      }

      if (lastSelectedCampaignIdRef.current === campaign.id) {
        lastSelectedCampaignIdRef.current = null;
      }

      await loadCampaignData({ mode: "refresh" });
      toast.success("Campaign deleted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "paused": return "bg-yellow-500";
      case "completed": return "bg-blue-500";
      case "recruiting": return "bg-purple-500";
      default: return "bg-gray-500";
    }
  }, []);

  const selectedLevelRange = coerceLevelRange(selectedCampaign?.level_range ?? null);
  const selectedWorldMapName = useMemo(() => {
    if (!selectedCampaign?.world_map_id) {
      return null;
    }
    const match = worldMaps.find((map) => map.id === selectedCampaign.world_map_id);
    return match?.name ?? 'Unknown map';
  }, [selectedCampaign?.world_map_id, worldMaps]);

  // Memoized computed values for better performance
  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Please log in to manage campaigns</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading campaigns...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-destructive">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <p>Error: {error}</p>
          <Button onClick={() => loadCampaignData({ mode: "refresh" })} className="mt-2">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Campaign Manager</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadCampaignData({ mode: "refresh" })}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-2" />
              )}
              Refresh Data
            </Button>
            <Dialog open={isCreating} onOpenChange={setIsCreating}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  New Campaign
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
              <DialogTitle>Create New Campaign</DialogTitle>
              <DialogDescription>
                Set the core details for your campaign. You can link a world map later, but it becomes mandatory before the campaign goes active.
              </DialogDescription>
            </DialogHeader>
                <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Campaign Name *</Label>
                  <Input
                    id="name"
                    value={newCampaign.name}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter campaign name"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={newCampaign.description}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter campaign description"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="system">Game System</Label>
                    <Select 
                      value={newCampaign.system} 
                      onValueChange={(value) => setNewCampaign(prev => ({ ...prev, system: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="D&D 5e">D&D 5e</SelectItem>
                        <SelectItem value="Pathfinder 2e">Pathfinder 2e</SelectItem>
                        <SelectItem value="Call of Cthulhu">Call of Cthulhu</SelectItem>
                        <SelectItem value="Vampire: The Masquerade">Vampire: The Masquerade</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="setting">Setting</Label>
                    <Input
                      id="setting"
                      value={newCampaign.setting}
                      onChange={(e) => setNewCampaign(prev => ({ ...prev, setting: e.target.value }))}
                      placeholder="e.g., Fantasy, Modern, Sci-fi"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="create-world-map">World Map</Label>
                  {worldMapsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading world maps…</p>
                  ) : worldMaps.length > 0 ? (
                    <Select
                      value={newCampaign.worldMapId}
                      onValueChange={(value) =>
                        setNewCampaign((prev) => ({ ...prev, worldMapId: value }))
                      }
                    >
                      <SelectTrigger id="create-world-map">
                        <SelectValue placeholder="Select a world map" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_WORLD_MAP_VALUE}>No world map (set later)</SelectItem>
                        {worldMaps.map((map) => (
                          <SelectItem key={map.id} value={map.id}>
                            {map.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No world maps available. Upload one from the Map Manager before activating this campaign.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="maxPlayers">Max Players (1-20)</Label>
                    <Input
                      id="maxPlayers"
                      type="number"
                      min="1"
                      max="20"
                      value={newCampaign.maxPlayers}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setNewCampaign((prev) => ({ ...prev, maxPlayers: '' }));
                          return;
                        }

                        const parsed = Number.parseInt(raw, 10);
                        if (Number.isNaN(parsed)) {
                          return;
                        }

                        const clamped = Math.min(20, Math.max(1, parsed));
                        setNewCampaign((prev) => ({ ...prev, maxPlayers: clamped }));
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="minLevel">Min Level</Label>
                    <Input
                      id="minLevel"
                      type="number"
                      min="1"
                      max="20"
                      value={newCampaign.levelRange.min}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setNewCampaign((prev) => ({
                            ...prev,
                            levelRange: { ...prev.levelRange, min: '' },
                          }));
                          return;
                        }

                        const parsed = Number.parseInt(raw, 10);
                        if (Number.isNaN(parsed)) {
                          return;
                        }

                        const clamped = Math.max(1, Math.min(20, parsed));
                        setNewCampaign((prev) => ({
                          ...prev,
                          levelRange: { ...prev.levelRange, min: clamped },
                        }));
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxLevel">Max Level</Label>
                    <Input
                      id="maxLevel"
                      type="number"
                      min="1"
                      max="20"
                      value={newCampaign.levelRange.max}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setNewCampaign((prev) => ({
                            ...prev,
                            levelRange: { ...prev.levelRange, max: '' },
                          }));
                          return;
                        }

                        const parsed = Number.parseInt(raw, 10);
                        if (Number.isNaN(parsed)) {
                          return;
                        }

                        const clamped = Math.max(1, Math.min(20, parsed));
                        setNewCampaign((prev) => ({
                          ...prev,
                          levelRange: { ...prev.levelRange, max: clamped },
                        }));
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label htmlFor="isPublic">Public Campaign</Label>
                    <p className="text-xs text-muted-foreground">Allow other players to discover and request to join.</p>
                  </div>
                  <Switch
                    id="isPublic"
                    checked={newCampaign.isPublic}
                    onCheckedChange={(checked) => setNewCampaign((prev) => ({ ...prev, isPublic: checked }))}
                    aria-label="Toggle public campaign"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCampaign} disabled={createLoading}>
                  {createLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Campaign
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Campaign Tabs */}
                <section className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground">My Campaigns</h3>
            <span className="text-xs text-muted-foreground">{dmCampaigns.length} total</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dmCampaigns.map((campaign) => (
              <Card
                key={campaign.id}
                className={`cursor-pointer transition-colors ${
                  selectedCampaign?.id === campaign.id ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => handleSelectCampaign(campaign)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`} />
                    <h3 className="font-medium text-sm truncate">{campaign.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {campaign.description || 'No description'}
                  </p>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs">{campaign.system}</Badge>
                    <span className="text-xs text-muted-foreground">{campaign.current_players || 0}/{campaign.max_players}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditDialog(campaign);
                      }}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive">
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{campaign.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteCampaign(campaign)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
            {dmCampaigns.length === 0 && (
              <div className="col-span-full text-center py-8 text-muted-foreground">
                <MapIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No campaigns created yet</p>
                <p className="text-sm">Create your first campaign to get started</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Campaign Details */}
      {selectedCampaign && (
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">{selectedCampaign.name}</h2>
              <div className="flex gap-2">
                {selectedCampaign.dm_user_id === user?.id && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectedCampaign && openEditDialog(selectedCampaign)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectedCampaign && openSettingsDialog(selectedCampaign)}
                    >
                      <Settings className="w-4 h-4 mr-1" />
                      Settings
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm">
                  <Share className="w-4 h-4 mr-1" />
                  Share
                </Button>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{selectedCampaign.system}</span>
              <span>•</span>
              <span className="capitalize">{selectedCampaign.status}</span>
              <span>•</span>
              <span>{selectedCampaign.current_players || 0}/{selectedCampaign.max_players} players</span>
              <span>•</span>
              <span>Created: {new Date(selectedCampaign.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="flex-1 p-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Campaign Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Description</h4>
                    <p className="text-muted-foreground">
                      {selectedCampaign.description || 'No description provided'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-1">Game System</h4>
                      <p className="text-muted-foreground">{selectedCampaign.system}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Setting</h4>
                      <p className="text-muted-foreground">{selectedCampaign.setting}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Level Range</h4>
                      <p className="text-muted-foreground">
                        {selectedLevelRange.min} - {selectedLevelRange.max}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Status</h4>
                      <Badge className="capitalize">{selectedCampaign.status}</Badge>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">World Map</h4>
                      <p className="text-muted-foreground">
                        {selectedWorldMapName ?? 'Not configured'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <CampaignPrep campaign={selectedCampaign} />
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(editDialogCampaign)}
        onOpenChange={(open) => {
          if (!open) {
            closeEditDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>
              Update the campaign metadata players see across dashboards and discovery surfaces.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-campaign-name">Campaign Name *</Label>
              <Input
                id="edit-campaign-name"
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Enter campaign name"
              />
            </div>
            <div>
              <Label htmlFor="edit-campaign-description">Description</Label>
              <Textarea
                id="edit-campaign-description"
                value={editForm.description}
                onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="What should players know about this campaign?"
                rows={4}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="edit-campaign-system">Game System</Label>
                <Select
                  value={editForm.system}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, system: value }))}
                >
                  <SelectTrigger id="edit-campaign-system">
                    <SelectValue placeholder="Select a ruleset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="D&D 5e">D&D 5e</SelectItem>
                    <SelectItem value="Pathfinder 2e">Pathfinder 2e</SelectItem>
                    <SelectItem value="Call of Cthulhu">Call of Cthulhu</SelectItem>
                    <SelectItem value="Vampire: The Masquerade">Vampire: The Masquerade</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-campaign-setting">Setting</Label>
                <Input
                  id="edit-campaign-setting"
                  value={editForm.setting}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, setting: event.target.value }))}
                  placeholder="e.g., Homebrew, Eberron, Sci-Fi"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit-campaign-world-map">World Map</Label>
              {worldMapsLoading ? (
                <p className="text-sm text-muted-foreground">Loading world maps…</p>
              ) : worldMaps.length > 0 ? (
                <Select
                  value={editForm.worldMapId || NO_WORLD_MAP_VALUE}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, worldMapId: value }))
                  }
                >
                  <SelectTrigger id="edit-campaign-world-map">
                    <SelectValue placeholder="Select a world map" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_WORLD_MAP_VALUE}>No world map (set later)</SelectItem>
                    {worldMaps.map((map) => (
                      <SelectItem key={map.id} value={map.id}>
                        {map.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No world maps available. Upload one from the Map Manager before activating this campaign.
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <Label htmlFor="edit-campaign-status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, status: value as CampaignStatus }))
                  }
                >
                  <SelectTrigger id="edit-campaign-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recruiting">Recruiting</SelectItem>
                    <SelectItem value="active" disabled={worldMaps.length === 0}>
                      Active (requires world map)
                    </SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-campaign-max-players">Max Players</Label>
                <Input
                  id="edit-campaign-max-players"
                  type="number"
                  min="1"
                  max="20"
                  value={editForm.maxPlayers}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === '') {
                      setEditForm((prev) => ({ ...prev, maxPlayers: '' }));
                      return;
                    }

                    const parsed = Number.parseInt(raw, 10);
                    if (Number.isNaN(parsed)) {
                      return;
                    }

                    const clamped = Math.min(20, Math.max(1, parsed));
                    setEditForm((prev) => ({ ...prev, maxPlayers: clamped }));
                  }}
                />
              </div>
              <div>
                <Label htmlFor="edit-campaign-min-level">Min Level</Label>
                <Input
                  id="edit-campaign-min-level"
                  type="number"
                  min="1"
                  max="20"
                  value={editForm.minLevel}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === '') {
                      setEditForm((prev) => ({
                        ...prev,
                        minLevel: '',
                        maxLevel: prev.maxLevel,
                      }));
                      return;
                    }

                    const parsed = Number.parseInt(raw, 10);
                    if (Number.isNaN(parsed)) {
                      return;
                    }

                    const clamped = clampLevelValue(parsed);
                    setEditForm((prev) => ({
                      ...prev,
                      minLevel: clamped,
                      maxLevel:
                        prev.maxLevel !== '' && prev.maxLevel < clamped ? clamped : prev.maxLevel,
                    }));
                  }}
                />
              </div>
              <div>
                <Label htmlFor="edit-campaign-max-level">Max Level</Label>
                <Input
                  id="edit-campaign-max-level"
                  type="number"
                  min="1"
                  max="20"
                  value={editForm.maxLevel}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === '') {
                      setEditForm((prev) => ({
                        ...prev,
                        maxLevel: '',
                      }));
                      return;
                    }

                    const parsed = Number.parseInt(raw, 10);
                    if (Number.isNaN(parsed)) {
                      return;
                    }

                    const clamped = clampLevelValue(parsed);
                    setEditForm((prev) => ({
                      ...prev,
                      maxLevel:
                        prev.minLevel !== '' && clamped < prev.minLevel ? prev.minLevel : clamped,
                    }));
                  }}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeEditDialog}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCampaign} disabled={editSaving}>
              {editSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(settingsDialogCampaign)}
        onOpenChange={(open) => {
          if (!open) {
            closeSettingsDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Campaign Settings</DialogTitle>
            <DialogDescription>
              Control how players discover and interact with this campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Public campaign</p>
                  <p className="text-xs text-muted-foreground">
                    Allow players outside your roster to discover this campaign in public listings.
                  </p>
                </div>
                <Switch
                  id="settings-campaign-public"
                  checked={settingsForm.isPublic}
                  onCheckedChange={(checked) =>
                    setSettingsForm((prev) => ({ ...prev, isPublic: checked }))
                  }
                  className="mt-1"
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Allow spectators</p>
                  <p className="text-xs text-muted-foreground">
                    Enables view-only seats so non-participants can watch live sessions.
                  </p>
                </div>
                <Switch
                  id="settings-campaign-spectators"
                  checked={settingsForm.allowSpectators}
                  onCheckedChange={(checked) =>
                    setSettingsForm((prev) => ({ ...prev, allowSpectators: checked }))
                  }
                  className="mt-1"
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Auto-approve join requests</p>
                  <p className="text-xs text-muted-foreground">
                    When enabled, new requests from authenticated users are approved without manual review.
                  </p>
                </div>
                <Switch
                  id="settings-campaign-auto-approve"
                  checked={settingsForm.autoApproveJoinRequests}
                  onCheckedChange={(checked) =>
                    setSettingsForm((prev) => ({ ...prev, autoApproveJoinRequests: checked }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-experience">Experience model</Label>
                <Select
                  value={settingsForm.experienceType}
                  onValueChange={(value) =>
                    setSettingsForm((prev) => ({ ...prev, experienceType: value as ExperienceType }))
                  }
                >
                  <SelectTrigger id="settings-experience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="milestone">Milestone progression</SelectItem>
                    <SelectItem value="experience_points">Experience points</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="settings-resting">Resting rules</Label>
                <Select
                  value={settingsForm.restingRules}
                  onValueChange={(value) =>
                    setSettingsForm((prev) => ({ ...prev, restingRules: value as RestingRules }))
                  }
                >
                  <SelectTrigger id="settings-resting">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard (PHB)</SelectItem>
                    <SelectItem value="gritty">Gritty realism</SelectItem>
                    <SelectItem value="heroic">Heroic rest variant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="settings-death">Death save difficulty</Label>
                <Select
                  value={settingsForm.deathSaveRules}
                  onValueChange={(value) =>
                    setSettingsForm((prev) => ({ ...prev, deathSaveRules: value as DeathSaveRules }))
                  }
                >
                  <SelectTrigger id="settings-death">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="hardcore">Hardcore (harder to stabilize)</SelectItem>
                    <SelectItem value="forgiving">Forgiving (easier stabilization)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeSettingsDialog}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCampaignSettings} disabled={settingsSaving}>
              {settingsSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Memoized component for better performance
export default memo(CampaignManager);
