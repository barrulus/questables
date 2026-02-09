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
  DialogTrigger,
} from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import {
  createCampaignFormReducer,
  type CreateCampaignFormState,
  DEFAULT_LEVEL_RANGE,
  DEFAULT_MAX_PLAYERS,
  WORLD_MAP_NONE_SENTINEL,
  resetWorldMapSelectValue,
  fromWorldMapSelectValue,
  parseIntegerInput,
  buildLevelRange,
  CAMPAIGN_SYSTEM_OPTIONS,
} from "../campaign-shared";
import { createCampaign, type CreateCampaignRequest } from "../../utils/api-client";
import type { WorldMapSummary } from "../../utils/world-map-cache";

export interface CreateCampaignDialogProps {
  userId: string;
  worldMaps: WorldMapSummary[];
  worldMapsLoading: boolean;
  onCampaignCreated: (campaignId: string) => Promise<void>;
}

export function CreateCampaignDialog({
  userId,
  worldMaps,
  worldMapsLoading,
  onCampaignCreated,
}: CreateCampaignDialogProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const createFormDefaults = useCallback(
    (): CreateCampaignFormState => ({
      name: "",
      description: "",
      system: "",
      setting: "",
      maxPlayers: DEFAULT_MAX_PLAYERS,
      levelRange: { min: DEFAULT_LEVEL_RANGE.min, max: DEFAULT_LEVEL_RANGE.max },
      isPublic: false,
      worldMapId: resetWorldMapSelectValue(),
    }),
    [],
  );

  const [newCampaign, dispatchCreateForm] = useReducer(
    createCampaignFormReducer,
    undefined,
    () => createFormDefaults(),
  );

  useEffect(() => {
    dispatchCreateForm({
      type: "syncWorldMapOptions",
      mapIds: worldMaps.map((map) => map.id),
    });
  }, [worldMaps]);

  const handleCreateCampaign = useCallback(async () => {
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
    const worldMapId = fromWorldMapSelectValue(newCampaign.worldMapId) ?? undefined;

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
      await onCampaignCreated(createdCampaign.id);
      dispatchCreateForm({ type: "reset", payload: createFormDefaults() });
      setIsCreating(false);
      toast.success("Campaign created successfully!");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create campaign";
      toast.error(message);
    } finally {
      setCreateLoading(false);
    }
  }, [userId, newCampaign, createFormDefaults, onCampaignCreated]);

  return (
    <Dialog open={isCreating} onOpenChange={setIsCreating}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" />
          New Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Set the core details for your campaign. You can link a world map
            later, but it becomes mandatory before the campaign goes active.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Campaign Name *</Label>
            <Input
              id="name"
              value={newCampaign.name}
              onChange={(e) =>
                dispatchCreateForm({
                  type: "updateText",
                  field: "name",
                  value: e.target.value,
                })
              }
              placeholder="Enter campaign name"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={newCampaign.description}
              onChange={(e) =>
                dispatchCreateForm({
                  type: "updateText",
                  field: "description",
                  value: e.target.value,
                })
              }
              placeholder="Enter campaign description"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="system">Game System</Label>
              <Select
                value={newCampaign.system}
                onValueChange={(value) =>
                  dispatchCreateForm({
                    type: "updateText",
                    field: "system",
                    value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
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
              <Label htmlFor="setting">Setting</Label>
              <Input
                id="setting"
                value={newCampaign.setting}
                onChange={(e) =>
                  dispatchCreateForm({
                    type: "updateText",
                    field: "setting",
                    value: e.target.value,
                  })
                }
                placeholder="e.g., Fantasy, Modern, Sci-fi"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="create-world-map">World Map</Label>
            {worldMapsLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading world maps…
              </p>
            ) : worldMaps.length > 0 ? (
              <Select
                value={newCampaign.worldMapId}
                onValueChange={(value) =>
                  dispatchCreateForm({ type: "setWorldMap", value })
                }
              >
                <SelectTrigger id="create-world-map">
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
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="maxPlayers">Max Players (1-20)</Label>
              <Input
                id="maxPlayers"
                type="number"
                min="1"
                max="20"
                value={newCampaign.maxPlayers}
                onChange={(e) =>
                  dispatchCreateForm({
                    type: "setMaxPlayers",
                    value: e.target.value,
                  })
                }
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
                onChange={(e) =>
                  dispatchCreateForm({
                    type: "setLevel",
                    field: "min",
                    value: e.target.value,
                  })
                }
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
                onChange={(e) =>
                  dispatchCreateForm({
                    type: "setLevel",
                    field: "max",
                    value: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="isPublic">Public Campaign</Label>
              <p className="text-xs text-muted-foreground">
                Allow other players to discover and request to join.
              </p>
            </div>
            <Switch
              id="isPublic"
              checked={newCampaign.isPublic}
              onCheckedChange={(checked) =>
                dispatchCreateForm({
                  type: "updateBoolean",
                  field: "isPublic",
                  value: checked,
                })
              }
              aria-label="Toggle public campaign"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => setIsCreating(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateCampaign} disabled={createLoading}>
            {createLoading && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Create Campaign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
