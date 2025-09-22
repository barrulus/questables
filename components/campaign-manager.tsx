import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
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
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
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
} from "./campaign-shared";

export function CampaignManager() {
  const { user } = useUser();
  const [dmCampaigns, setDmCampaigns] = useState<Campaign[]>([]);
  const [playerCampaigns, setPlayerCampaigns] = useState<Campaign[]>([]);
  const [publicCampaigns, setPublicCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const [isCreating, setIsCreating] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: "",
    description: "",
    system: "D&D 5e",
    setting: "Fantasy",
    maxPlayers: 6,
    levelRange: { min: 1, max: 20 },
    isPublic: false
  });
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

  const openEditDialog = useCallback((campaign: Campaign) => {
    setEditDialogCampaign(campaign);
    setEditForm(buildEditFormState(campaign));
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditDialogCampaign(null);
    setEditForm(createEditFormDefaults());
  }, []);

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
      setPlayerCampaigns([]);
      setPublicCampaigns([]);
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
      const userCampaignsData = await readJsonBody<{ dmCampaigns?: Campaign[]; playerCampaigns?: Campaign[] }>(userCampaignsResponse);

      const dmCampaignList = userCampaignsData.dmCampaigns ?? [];
      const playerCampaignList = userCampaignsData.playerCampaigns ?? [];

      const publicResponse = await apiFetch('/api/campaigns/public', { signal });
      if (!publicResponse.ok) {
        throw new Error(await readErrorMessage(publicResponse, "Failed to load public campaigns"));
      }
      const publicData = await readJsonBody<Campaign[]>(publicResponse);

      const filteredPublicCampaigns = (publicData ?? []).filter((campaign) => {
        const alreadyDm = dmCampaignList.some((dmCampaign) => dmCampaign.id === campaign.id);
        const alreadyPlayer = playerCampaignList.some((playerCampaign) => playerCampaign.id === campaign.id);
        return !alreadyDm && !alreadyPlayer;
      });

      setDmCampaigns(dmCampaignList);
      setPlayerCampaigns(playerCampaignList);
      setPublicCampaigns(filteredPublicCampaigns);

      const combinedCampaigns = [...dmCampaignList, ...playerCampaignList];
      const lastSelectedId = lastSelectedCampaignIdRef.current;
      if (lastSelectedId) {
        const matched = combinedCampaigns.find((campaign) => campaign.id === lastSelectedId);
        if (matched) {
          handleSelectCampaign(matched);
          return;
        }
      }

      if (dmCampaignList.length > 0) {
        handleSelectCampaign(dmCampaignList[0]);
      } else if (playerCampaignList.length > 0) {
        handleSelectCampaign(playerCampaignList[0]);
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

  const handleCreateCampaign = useCallback(async () => {
    if (!user || !newCampaign.name.trim()) {
      toast.error("Please provide a campaign name");
      return;
    }

    try {
      setCreateLoading(true);

      const maxPlayers = Number(newCampaign.maxPlayers);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20) {
        toast.error("Max players must be between 1 and 20.");
        setCreateLoading(false);
        return;
      }

      const minLevel = Number(newCampaign.levelRange.min);
      const maxLevel = Number(newCampaign.levelRange.max);
      const validLevels = Number.isInteger(minLevel) && Number.isInteger(maxLevel) && minLevel >= 1 && maxLevel <= 20 && minLevel <= maxLevel;
      if (!validLevels) {
        toast.error("Provide a level range between 1 and 20 (min cannot exceed max).");
        setCreateLoading(false);
        return;
      }

      const response = await apiFetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampaign.name,
          description: newCampaign.description,
          dmUserId: user.id,
          system: newCampaign.system,
          setting: newCampaign.setting,
          status: 'recruiting',
          maxPlayers,
          levelRange: newCampaign.levelRange,
          isPublic: newCampaign.isPublic
        })
      });

      if (response.status === 401) {
        toast.error("Your session has expired. Please sign in again to create campaigns.");
        setCreateLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to create campaign'));
      }

      const { campaign } = await readJsonBody<{ campaign: Campaign }>(response);

      // Pull fresh data to ensure local state matches backend and reselect the new campaign
      lastSelectedCampaignIdRef.current = campaign.id;
      await loadCampaignData({ mode: "refresh" });
      
      // Reset form
      setNewCampaign({
        name: "",
        description: "",
        system: "D&D 5e",
        setting: "Fantasy",
        maxPlayers: 6,
        levelRange: { min: 1, max: 20 },
        isPublic: false
      });
      setIsCreating(false);
      toast.success("Campaign created successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setCreateLoading(false);
    }
  }, [user, newCampaign, loadCampaignData]);

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

    const maxPlayers = Number(editForm.maxPlayers);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20) {
      toast.error("Max players must be an integer between 1 and 20.");
      return;
    }

    const minLevel = clampLevelValue(editForm.minLevel);
    const maxLevel = clampLevelValue(editForm.maxLevel);
    if (minLevel > maxLevel) {
      toast.error("Minimum level cannot exceed maximum level.");
      return;
    }

    const defaultEditForm = createEditFormDefaults();

    const payload = {
      name: trimmedName,
      description: editForm.description,
      system: editForm.system.trim() || defaultEditForm.system,
      setting: editForm.setting,
      status: editForm.status,
      max_players: maxPlayers,
      level_range: { min: minLevel, max: maxLevel },
    };

    try {
      setEditSaving(true);
      const response = await apiFetch(`/api/campaigns/${editDialogCampaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        toast.error("Your session has expired. Please sign in again.");
        setEditSaving(false);
        return;
      }

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update campaign'));
      }

      const mergeUpdate = (campaign: Campaign): Campaign => ({
        ...campaign,
        name: payload.name,
        description: payload.description,
        system: payload.system,
        setting: payload.setting,
        status: payload.status,
        max_players: payload.max_players,
        level_range: payload.level_range,
      });

      setDmCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === editDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setPlayerCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === editDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setPublicCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === editDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setSelectedCampaign((selected) =>
        selected && selected.id === editDialogCampaign.id ? mergeUpdate(selected) : selected
      );

      lastSelectedCampaignIdRef.current = editDialogCampaign.id;
      await loadCampaignData({ mode: 'refresh' });

      toast.success("Campaign details updated.");
      closeEditDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign');
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

    const payload = {
      is_public: settingsForm.isPublic,
      allow_spectators: settingsForm.allowSpectators,
      auto_approve_join_requests: settingsForm.autoApproveJoinRequests,
      experience_type: settingsForm.experienceType,
      resting_rules: settingsForm.restingRules,
      death_save_rules: settingsForm.deathSaveRules,
    };

    try {
      setSettingsSaving(true);
      const response = await apiFetch(`/api/campaigns/${settingsDialogCampaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        toast.error("Your session has expired. Please sign in again.");
        setSettingsSaving(false);
        return;
      }

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to update campaign settings'));
      }

      const mergeUpdate = (campaign: Campaign): Campaign => ({
        ...campaign,
        is_public: payload.is_public,
        allow_spectators: payload.allow_spectators,
        auto_approve_join_requests: payload.auto_approve_join_requests,
        experience_type: payload.experience_type,
        resting_rules: payload.resting_rules,
        death_save_rules: payload.death_save_rules,
      });

      setDmCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === settingsDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setPlayerCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === settingsDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setPublicCampaigns((campaigns) => campaigns.map((campaign) =>
        campaign.id === settingsDialogCampaign.id ? mergeUpdate(campaign) : campaign
      ));
      setSelectedCampaign((selected) =>
        selected && selected.id === settingsDialogCampaign.id ? mergeUpdate(selected) : selected
      );

      lastSelectedCampaignIdRef.current = settingsDialogCampaign.id;
      await loadCampaignData({ mode: 'refresh' });

      toast.success("Campaign settings updated.");
      closeSettingsDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign settings');
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

  const handleJoinCampaign = async (campaign: Campaign, characterId?: string) => {
    if (!user) return;

    try {
      const response = await apiFetch(`/api/campaigns/${campaign.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, characterId })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to join campaign'));
      }

      // Refresh campaign data
      lastSelectedCampaignIdRef.current = campaign.id;
      await loadCampaignData({ mode: "refresh" });
      toast.success("Successfully joined campaign!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join campaign');
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
                        const value = parseInt(e.target.value, 10);
                        setNewCampaign(prev => ({
                          ...prev,
                          maxPlayers: Number.isNaN(value) ? prev.maxPlayers : value
                        }));
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
                        const value = parseInt(e.target.value, 10);
                        if (!Number.isNaN(value)) {
                          setNewCampaign(prev => ({ 
                            ...prev, 
                            levelRange: { ...prev.levelRange, min: Math.max(1, Math.min(20, value)) }
                          }));
                        }
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
                        const value = parseInt(e.target.value, 10);
                        if (!Number.isNaN(value)) {
                          setNewCampaign(prev => ({ 
                            ...prev, 
                            levelRange: { ...prev.levelRange, max: Math.max(1, Math.min(20, value)) }
                          }));
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isPublic"
                    checked={newCampaign.isPublic}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, isPublic: e.target.checked }))}
                  />
                  <Label htmlFor="isPublic">Make campaign public (others can join)</Label>
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
        <Tabs defaultValue="my-campaigns" className="w-full">
          <TabsList>
            <TabsTrigger value="my-campaigns">My Campaigns ({dmCampaigns.length})</TabsTrigger>
            <TabsTrigger value="joined-campaigns">Joined ({playerCampaigns.length})</TabsTrigger>
            <TabsTrigger value="public-campaigns">Public ({publicCampaigns.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="my-campaigns" className="mt-4">
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
          </TabsContent>

          <TabsContent value="joined-campaigns" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {playerCampaigns.map((campaign) => (
                <Card key={campaign.id} className="cursor-pointer" onClick={() => handleSelectCampaign(campaign)}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`} />
                      <h3 className="font-medium text-sm truncate">{campaign.name}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      DM: {campaign.dm_username}
                    </p>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">{campaign.system}</Badge>
                      <span className="text-xs text-muted-foreground capitalize">{campaign.status}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {playerCampaigns.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No campaigns joined yet</p>
                  <p className="text-sm">Join a public campaign or wait for an invitation</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="public-campaigns" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {publicCampaigns.map((campaign) => (
                <Card key={campaign.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`} />
                      <h3 className="font-medium text-sm truncate">{campaign.name}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      DM: {campaign.dm_username}
                    </p>
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {campaign.description || 'No description'}
                    </p>
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="text-xs">{campaign.system}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {campaign.current_players || 0}/{campaign.max_players} players
                      </span>
                    </div>
                    <Button 
                      size="sm" 
                      className="w-full"
                      onClick={() => handleJoinCampaign(campaign)}
                      disabled={campaign.current_players >= campaign.max_players}
                    >
                      {campaign.current_players >= campaign.max_players ? 'Full' : 'Join Campaign'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {publicCampaigns.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  <MapIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No public campaigns available</p>
                  <p className="text-sm">Check back later for new campaigns</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
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

          <div className="flex-1 p-4">
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
                  </div>
                </div>
              </CardContent>
            </Card>
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
                    <SelectItem value="active">Active</SelectItem>
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
                    const raw = parseInt(event.target.value, 10);
                    if (Number.isNaN(raw)) {
                      return;
                    }
                    const clamped = Math.min(20, Math.max(1, raw));
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
                    const raw = parseInt(event.target.value, 10);
                    if (Number.isNaN(raw)) {
                      return;
                    }
                    const clamped = clampLevelValue(raw);
                    setEditForm((prev) => ({
                      ...prev,
                      minLevel: clamped,
                      maxLevel: prev.maxLevel < clamped ? clamped : prev.maxLevel,
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
                    const raw = parseInt(event.target.value, 10);
                    if (Number.isNaN(raw)) {
                      return;
                    }
                    const clamped = clampLevelValue(raw);
                    setEditForm((prev) => ({
                      ...prev,
                      maxLevel: clamped < prev.minLevel ? prev.minLevel : clamped,
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
