import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";

import { useUser } from "../contexts/UserContext";
import { useGameSession } from "../contexts/GameSessionContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import {
  Campaign,
  CampaignEditFormState,
  CampaignSettingsFormState,
  CampaignStatus,
  ExperienceType,
  RestingRules,
  DeathSaveRules,
  buildEditFormState,
  buildSettingsFormState,
  clampLevelValue,
  coerceLevelRange,
  createEditFormDefaults,
  createSettingsFormDefaults,
} from "./campaign-shared";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

interface LoadOptions {
  signal?: AbortSignal;
}

export function Settings() {
  const { user } = useUser();
  const { activeCampaignId, refreshActiveCampaign } = useGameSession();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CampaignEditFormState>(() => createEditFormDefaults());
  const [settingsForm, setSettingsForm] = useState<CampaignSettingsFormState>(() => createSettingsFormDefaults());
  const [editSaving, setEditSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadCampaign = useCallback(
    async (campaignId: string, options: LoadOptions = {}) => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}`, { signal: options.signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load campaign settings"));
        }

        const payload = await readJsonBody<{ campaign?: Campaign }>(response);
        if (!payload?.campaign) {
          throw new Error("Campaign payload missing from response.");
        }

        setCampaign(payload.campaign);
        setEditForm(buildEditFormState(payload.campaign));
        setSettingsForm(buildSettingsFormState(payload.campaign));
      } catch (err) {
        if (options.signal?.aborted) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load campaign settings";
        setError(message);
        setCampaign(null);
        setEditForm(createEditFormDefaults());
        setSettingsForm(createSettingsFormDefaults());
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeCampaignId) {
      setCampaign(null);
      setEditForm(createEditFormDefaults());
      setSettingsForm(createSettingsFormDefaults());
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadCampaign(activeCampaignId, { signal: controller.signal });
    return () => controller.abort();
  }, [activeCampaignId, loadCampaign]);

  const isDm = Boolean(user && campaign && campaign.dm_user_id === user.id);
  const levelRange = useMemo(() => coerceLevelRange(campaign?.level_range ?? null), [campaign]);

  const handleRefresh = useCallback(() => {
    if (activeCampaignId) {
      void loadCampaign(activeCampaignId);
    }
  }, [activeCampaignId, loadCampaign]);

  const handleSaveDetails = useCallback(async () => {
    if (!user || !campaign) {
      return;
    }

    if (campaign.dm_user_id !== user.id) {
      toast.error("Only the campaign DM can update these details.");
      return;
    }

    const trimmedName = editForm.name.trim();
    if (!trimmedName) {
      toast.error("Campaign name is required.");
      return;
    }

    if (editForm.maxPlayers === '') {
      toast.error("Max players must be an integer between 1 and 20.");
      return;
    }

    const maxPlayers = Number(editForm.maxPlayers);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20) {
      toast.error("Max players must be an integer between 1 and 20.");
      return;
    }

    if (editForm.minLevel === '' || editForm.maxLevel === '') {
      toast.error("Provide both minimum and maximum levels.");
      return;
    }

    const minLevel = clampLevelValue(Number(editForm.minLevel));
    const maxLevel = clampLevelValue(Number(editForm.maxLevel));
    if (minLevel > maxLevel) {
      toast.error("Minimum level cannot exceed maximum level.");
      return;
    }

    setEditForm((prev) => ({ ...prev, minLevel, maxLevel, maxPlayers }));
    const defaults = createEditFormDefaults();

    const payload = {
      name: trimmedName,
      description: editForm.description,
      system: editForm.system.trim() || defaults.system,
      setting: editForm.setting,
      status: editForm.status,
      max_players: maxPlayers,
      level_range: { min: minLevel, max: maxLevel },
    };

    try {
      setEditSaving(true);
      const response = await apiFetch(`/api/campaigns/${campaign.id}`, {
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

      const updatedCampaign: Campaign = {
        ...campaign,
        name: payload.name,
        description: payload.description,
        system: payload.system,
        setting: payload.setting,
        status: payload.status,
        max_players: payload.max_players,
        level_range: payload.level_range,
      };

      setCampaign(updatedCampaign);
      setEditForm(buildEditFormState(updatedCampaign));
      await refreshActiveCampaign();

      toast.success("Campaign details updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign');
    } finally {
      setEditSaving(false);
    }
  }, [campaign, editForm, refreshActiveCampaign, user]);

  const handleSaveSettings = useCallback(async () => {
    if (!user || !campaign) {
      return;
    }

    if (campaign.dm_user_id !== user.id) {
      toast.error("Only the campaign DM can update these settings.");
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
      const response = await apiFetch(`/api/campaigns/${campaign.id}`, {
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

      const updatedCampaign: Campaign = {
        ...campaign,
        is_public: payload.is_public,
        allow_spectators: payload.allow_spectators,
        auto_approve_join_requests: payload.auto_approve_join_requests,
        experience_type: payload.experience_type,
        resting_rules: payload.resting_rules,
        death_save_rules: payload.death_save_rules,
      };

      setCampaign(updatedCampaign);
      setSettingsForm(buildSettingsFormState(updatedCampaign));
      await refreshActiveCampaign();

      toast.success("Campaign settings updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign settings');
    } finally {
      setSettingsSaving(false);
    }
  }, [campaign, refreshActiveCampaign, settingsForm.allowSpectators, settingsForm.autoApproveJoinRequests, settingsForm.deathSaveRules, settingsForm.experienceType, settingsForm.isPublic, settingsForm.restingRules, user]);

  if (!user) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Sign in to manage campaign settings.
      </div>
    );
  }

  if (!activeCampaignId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a campaign to edit its settings.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading campaign settings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Unable to load campaign settings</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={handleRefresh} size="sm">
          Retry
        </Button>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No campaign data available. Try refreshing the selection.
      </div>
    );
  }

  const detailsDisabled = !isDm || editSaving;
  const settingsDisabled = !isDm || settingsSaving;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Campaign Settings</h3>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          Refresh
        </Button>
      </div>

      {!isDm && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            You are not the DM for this campaign. Settings are displayed for reference and cannot be modified.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge className="capitalize">{campaign.status}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">DM</span>
            <span>{campaign.dm_username || 'Unknown'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Players</span>
            <span>
              {campaign.current_players || 0}/{campaign.max_players}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Level range</span>
            <span>
              {levelRange.min} – {levelRange.max}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Campaign Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={editForm.name}
              onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
              disabled={detailsDisabled}
            />
          </div>
          <div>
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              value={editForm.description}
              onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              disabled={detailsDisabled}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="settings-system">System</Label>
              <Select
                value={editForm.system}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, system: value }))}
                disabled={detailsDisabled}
              >
                <SelectTrigger id="settings-system">
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
              <Label htmlFor="settings-setting">Setting</Label>
              <Input
                id="settings-setting"
                value={editForm.setting}
                onChange={(event) => setEditForm((prev) => ({ ...prev, setting: event.target.value }))}
                disabled={detailsDisabled}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="settings-status">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, status: value as CampaignStatus }))
                }
                disabled={detailsDisabled}
              >
                <SelectTrigger id="settings-status">
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
              <Label htmlFor="settings-max-players">Max players</Label>
              <Input
                id="settings-max-players"
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
                disabled={detailsDisabled}
              />
            </div>
            <div>
              <Label htmlFor="settings-min-level">Min level</Label>
              <Input
                id="settings-min-level"
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
                disabled={detailsDisabled}
              />
            </div>
            <div>
              <Label htmlFor="settings-max-level">Max level</Label>
              <Input
                id="settings-max-level"
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
                disabled={detailsDisabled}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveDetails} disabled={!isDm || editSaving}>
              {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save details
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Access & rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Public campaign</p>
                <p className="text-xs text-muted-foreground">
                  Allow the campaign to appear in public listings for prospective players.
                </p>
              </div>
              <Switch
                id="settings-public"
                checked={settingsForm.isPublic}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({ ...prev, isPublic: checked }))
                }
                disabled={settingsDisabled}
                className="mt-1"
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Allow spectators</p>
                <p className="text-xs text-muted-foreground">
                  Permit view-only seats so non-participants can observe live sessions.
                </p>
              </div>
              <Switch
                id="settings-spectators"
                checked={settingsForm.allowSpectators}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({ ...prev, allowSpectators: checked }))
                }
                disabled={settingsDisabled}
                className="mt-1"
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Auto-approve join requests</p>
                <p className="text-xs text-muted-foreground">
                  Automatically grant access to authenticated players who request to join.
                </p>
              </div>
              <Switch
                id="settings-auto-approve"
                checked={settingsForm.autoApproveJoinRequests}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({ ...prev, autoApproveJoinRequests: checked }))
                }
                disabled={settingsDisabled}
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
                disabled={settingsDisabled}
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
                disabled={settingsDisabled}
              >
                <SelectTrigger id="settings-resting">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="gritty">Gritty realism</SelectItem>
                  <SelectItem value="heroic">Heroic rest variant</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="settings-death">Death save rules</Label>
              <Select
                value={settingsForm.deathSaveRules}
                onValueChange={(value) =>
                  setSettingsForm((prev) => ({ ...prev, deathSaveRules: value as DeathSaveRules }))
                }
                disabled={settingsDisabled}
              >
                <SelectTrigger id="settings-death">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="hardcore">Hardcore</SelectItem>
                  <SelectItem value="forgiving">Forgiving</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveSettings} disabled={!isDm || settingsSaving}>
              {settingsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
