import { useCallback, useState, memo } from "react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import {
  Users,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useUser } from "../../contexts/UserContext";
import { apiFetch, readErrorMessage } from "../../utils/api-client";
import type { Campaign } from "../campaign-shared";
import { useCampaignData } from "./use-campaign-data";
import { useWorldMaps } from "./use-world-maps";
import { CreateCampaignDialog } from "./create-campaign-dialog";
import { EditCampaignDialog } from "./edit-campaign-dialog";
import { SettingsDialog } from "./settings-dialog";
import { DeleteCampaignDialog } from "./delete-campaign-dialog";
import { CampaignList } from "./campaign-list";
import { CampaignDetailsPanel } from "./campaign-details-panel";

export function CampaignManager() {
  const { user } = useUser();
  const {
    dmCampaigns,
    selectedCampaign,
    loading,
    error,
    refreshing,
    selectCampaign,
    loadCampaignData,
    lastSelectedCampaignIdRef,
  } = useCampaignData(user?.id);

  const { worldMaps, worldMapsLoading } = useWorldMaps();

  // Dialog identity state
  const [editTarget, setEditTarget] = useState<Campaign | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const handleCampaignCreated = useCallback(
    async (campaignId: string) => {
      lastSelectedCampaignIdRef.current = campaignId;
      await loadCampaignData({ mode: "refresh" });
    },
    [lastSelectedCampaignIdRef, loadCampaignData],
  );

  const handleEditSaved = useCallback(
    async (campaignId: string) => {
      lastSelectedCampaignIdRef.current = campaignId;
      await loadCampaignData({ mode: "refresh" });
    },
    [lastSelectedCampaignIdRef, loadCampaignData],
  );

  const handleSettingsSaved = useCallback(
    async (campaignId: string) => {
      lastSelectedCampaignIdRef.current = campaignId;
      await loadCampaignData({ mode: "refresh" });
    },
    [lastSelectedCampaignIdRef, loadCampaignData],
  );

  const handleDeleteCampaign = useCallback(
    async (campaign: Campaign) => {
      if (!user || campaign.dm_user_id !== user.id) {
        toast.error("You can only delete campaigns you created");
        return;
      }

      try {
        const response = await apiFetch(`/api/campaigns/${campaign.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dmUserId: user.id }),
        });

        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, "Failed to delete campaign"),
          );
        }

        if (lastSelectedCampaignIdRef.current === campaign.id) {
          lastSelectedCampaignIdRef.current = null;
        }

        await loadCampaignData({ mode: "refresh" });
        toast.success("Campaign deleted successfully");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete campaign",
        );
      }
    },
    [user, lastSelectedCampaignIdRef, loadCampaignData],
  );

  // Auth gate
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
          <Button
            onClick={() => loadCampaignData({ mode: "refresh" })}
            className="mt-2"
          >
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
            <CreateCampaignDialog
              userId={user.id}
              worldMaps={worldMaps}
              worldMapsLoading={worldMapsLoading}
              onCampaignCreated={handleCampaignCreated}
            />
          </div>
        </div>

        <CampaignList
          campaigns={dmCampaigns}
          selectedCampaignId={selectedCampaign?.id ?? null}
          onSelect={selectCampaign}
          onEdit={setEditTarget}
          onDelete={setDeleteTarget}
        />
      </div>

      {selectedCampaign && (
        <CampaignDetailsPanel
          campaign={selectedCampaign}
          userId={user?.id}
          worldMaps={worldMaps}
          onEditClick={setEditTarget}
          onSettingsClick={setSettingsTarget}
        />
      )}

      <EditCampaignDialog
        campaign={editTarget}
        userId={user.id}
        worldMaps={worldMaps}
        worldMapsLoading={worldMapsLoading}
        onClose={() => setEditTarget(null)}
        onSaved={handleEditSaved}
      />

      <SettingsDialog
        campaign={settingsTarget}
        userId={user.id}
        onClose={() => setSettingsTarget(null)}
        onSaved={handleSettingsSaved}
      />

      <DeleteCampaignDialog
        campaign={deleteTarget}
        onConfirm={(campaign) => {
          handleDeleteCampaign(campaign);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default memo(CampaignManager);
