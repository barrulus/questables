import { useCallback, useEffect, useReducer, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  type CampaignEditSnapshot,
  type CampaignStatus,
  editCampaignFormReducer,
  createEditFormDefaults,
  buildEditFormState,
  buildCampaignUpdatePayload,
  resolveWorldMapIdForUpdate,
  toWorldMapSelectValue,
  WORLD_MAP_NONE_SENTINEL,
  CAMPAIGN_SYSTEM_OPTIONS,
  parseIntegerInput,
  buildLevelRange,
} from "../campaign-shared";
import type { Campaign } from "../campaign-shared";
import { updateCampaign } from "../../utils/api-client";
import type { WorldMapSummary } from "../../utils/world-map-cache";

export interface EditCampaignDialogProps {
  campaign: Campaign | null;
  userId: string;
  worldMaps: WorldMapSummary[];
  worldMapsLoading: boolean;
  onClose: () => void;
  onSaved: (campaignId: string) => Promise<void>;
}

export function EditCampaignDialog({
  campaign,
  userId,
  worldMaps,
  worldMapsLoading,
  onClose,
  onSaved,
}: EditCampaignDialogProps) {
  const [editForm, dispatchEditForm] = useReducer(
    editCampaignFormReducer,
    undefined,
    () => createEditFormDefaults(),
  );
  const [editWorldMapTouched, setEditWorldMapTouched] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Hydrate form when campaign changes
  useEffect(() => {
    if (campaign) {
      dispatchEditForm({ type: "hydrate", payload: buildEditFormState(campaign) });
      setEditWorldMapTouched(false);
    }
  }, [campaign]);

  const handleClose = useCallback(() => {
    onClose();
    setEditWorldMapTouched(false);
    dispatchEditForm({ type: "reset", payload: createEditFormDefaults() });
  }, [onClose]);

  const handleUpdateCampaign = useCallback(async () => {
    if (!campaign) return;

    if (campaign.dm_user_id !== userId) {
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

    const levelRange = buildLevelRange({
      min: editForm.minLevel,
      max: editForm.maxLevel,
    });
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

    const worldMapId = resolveWorldMapIdForUpdate({
      selectedValue: editForm.worldMapId,
      baselineValue: campaign.world_map_id,
      touched: editWorldMapTouched,
    });
    if (editForm.status === "active" && !worldMapId) {
      toast.error("Select a world map before activating the campaign.");
      return;
    }

    const snapshot: CampaignEditSnapshot = {
      name: trimmedName,
      description: editForm.description,
      system: editForm.system,
      setting: editForm.setting,
      status: editForm.status,
      maxPlayers: maxPlayersValue,
      levelRange,
      worldMapId,
    };

    const payload = buildCampaignUpdatePayload(campaign, snapshot);
    if (Object.keys(payload).length === 0) {
      toast.info("No changes to update.");
      return;
    }

    try {
      setEditSaving(true);
      await updateCampaign(campaign.id, payload);
      await onSaved(campaign.id);
      toast.success("Campaign details updated.");
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update campaign";
      toast.error(message);
    } finally {
      setEditSaving(false);
    }
  }, [
    campaign,
    editForm.description,
    editForm.maxLevel,
    editForm.maxPlayers,
    editForm.minLevel,
    editForm.name,
    editForm.setting,
    editForm.status,
    editForm.system,
    editForm.worldMapId,
    editWorldMapTouched,
    userId,
    onSaved,
    handleClose,
  ]);

  return (
    <Dialog
      open={Boolean(campaign)}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
          <DialogDescription>
            Update the campaign metadata players see across dashboards and
            discovery surfaces.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-campaign-name">Campaign Name *</Label>
            <Input
              id="edit-campaign-name"
              value={editForm.name}
              onChange={(event) =>
                dispatchEditForm({
                  type: "updateText",
                  field: "name",
                  value: event.target.value,
                })
              }
              placeholder="Enter campaign name"
            />
          </div>
          <div>
            <Label htmlFor="edit-campaign-description">Description</Label>
            <Textarea
              id="edit-campaign-description"
              value={editForm.description}
              onChange={(event) =>
                dispatchEditForm({
                  type: "updateText",
                  field: "description",
                  value: event.target.value,
                })
              }
              placeholder="What should players know about this campaign?"
              rows={4}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="edit-campaign-system">Game System</Label>
              <Select
                value={editForm.system}
                onValueChange={(value) =>
                  dispatchEditForm({
                    type: "updateText",
                    field: "system",
                    value,
                  })
                }
              >
                <SelectTrigger id="edit-campaign-system">
                  <SelectValue placeholder="Select a ruleset" />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_SYSTEM_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-campaign-setting">Setting</Label>
              <Input
                id="edit-campaign-setting"
                value={editForm.setting}
                onChange={(event) =>
                  dispatchEditForm({
                    type: "updateText",
                    field: "setting",
                    value: event.target.value,
                  })
                }
                placeholder="e.g., Homebrew, Eberron, Sci-Fi"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-campaign-world-map">World Map</Label>
            {worldMapsLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading world maps…
              </p>
            ) : worldMaps.length > 0 ? (
              <Select
                value={toWorldMapSelectValue(editForm.worldMapId)}
                onValueChange={(value) => {
                  setEditWorldMapTouched(true);
                  dispatchEditForm({ type: "setWorldMap", value });
                }}
              >
                <SelectTrigger id="edit-campaign-world-map">
                  <SelectValue placeholder="Select a world map" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WORLD_MAP_NONE_SENTINEL}>
                    No world map (set later)
                  </SelectItem>
                  {worldMaps.map((map) => (
                    <SelectItem key={map.id} value={map.id}>
                      {map.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No world maps available. Upload one from the Map Manager before
                activating this campaign.
              </p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="edit-campaign-status">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) =>
                  dispatchEditForm({
                    type: "setStatus",
                    value: value as CampaignStatus,
                  })
                }
              >
                <SelectTrigger id="edit-campaign-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recruiting">Recruiting</SelectItem>
                  <SelectItem
                    value="active"
                    disabled={worldMaps.length === 0}
                  >
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
                onChange={(event) =>
                  dispatchEditForm({
                    type: "setMaxPlayers",
                    value: event.target.value,
                  })
                }
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
                onChange={(event) =>
                  dispatchEditForm({
                    type: "setLevel",
                    field: "min",
                    value: event.target.value,
                  })
                }
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
                onChange={(event) =>
                  dispatchEditForm({
                    type: "setLevel",
                    field: "max",
                    value: event.target.value,
                  })
                }
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleUpdateCampaign} disabled={editSaving}>
            {editSaving && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
