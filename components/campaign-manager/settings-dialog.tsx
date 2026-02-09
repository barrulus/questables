import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  type Campaign,
  type CampaignSettingsFormState,
  type ExperienceType,
  type RestingRules,
  type DeathSaveRules,
  buildSettingsFormState,
  createSettingsFormDefaults,
} from "../campaign-shared";
import { updateCampaign, type UpdateCampaignRequest } from "../../utils/api-client";

export interface SettingsDialogProps {
  campaign: Campaign | null;
  userId: string;
  onClose: () => void;
  onSaved: (campaignId: string) => Promise<void>;
}

export function SettingsDialog({
  campaign,
  userId,
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const [settingsForm, setSettingsForm] = useState<CampaignSettingsFormState>(
    () => createSettingsFormDefaults(),
  );
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Hydrate form when campaign changes
  useEffect(() => {
    if (campaign) {
      setSettingsForm(buildSettingsFormState(campaign));
    }
  }, [campaign]);

  const handleClose = useCallback(() => {
    onClose();
    setSettingsForm(createSettingsFormDefaults());
  }, [onClose]);

  const handleUpdateCampaignSettings = useCallback(async () => {
    if (!campaign) return;

    if (campaign.dm_user_id !== userId) {
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
      await updateCampaign(campaign.id, payload);
      await onSaved(campaign.id);
      toast.success("Campaign settings updated.");
      handleClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update campaign settings";
      toast.error(message);
    } finally {
      setSettingsSaving(false);
    }
  }, [
    handleClose,
    onSaved,
    campaign,
    settingsForm.allowSpectators,
    settingsForm.autoApproveJoinRequests,
    settingsForm.deathSaveRules,
    settingsForm.experienceType,
    settingsForm.isPublic,
    settingsForm.restingRules,
    userId,
  ]);

  return (
    <Dialog
      open={Boolean(campaign)}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
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
                  Allow players outside your roster to discover this campaign in
                  public listings.
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
                  Enables view-only seats so non-participants can watch live
                  sessions.
                </p>
              </div>
              <Switch
                id="settings-campaign-spectators"
                checked={settingsForm.allowSpectators}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    allowSpectators: checked,
                  }))
                }
                className="mt-1"
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Auto-approve join requests
                </p>
                <p className="text-xs text-muted-foreground">
                  When enabled, new requests from authenticated users are
                  approved without manual review.
                </p>
              </div>
              <Switch
                id="settings-campaign-auto-approve"
                checked={settingsForm.autoApproveJoinRequests}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    autoApproveJoinRequests: checked,
                  }))
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
                  setSettingsForm((prev) => ({
                    ...prev,
                    experienceType: value as ExperienceType,
                  }))
                }
              >
                <SelectTrigger id="settings-experience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="milestone">
                    Milestone progression
                  </SelectItem>
                  <SelectItem value="experience_points">
                    Experience points
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="settings-resting">Resting rules</Label>
              <Select
                value={settingsForm.restingRules}
                onValueChange={(value) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    restingRules: value as RestingRules,
                  }))
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
                  setSettingsForm((prev) => ({
                    ...prev,
                    deathSaveRules: value as DeathSaveRules,
                  }))
                }
              >
                <SelectTrigger id="settings-death">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="hardcore">
                    Hardcore (harder to stabilize)
                  </SelectItem>
                  <SelectItem value="forgiving">
                    Forgiving (easier stabilization)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateCampaignSettings}
            disabled={settingsSaving}
          >
            {settingsSaving && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
