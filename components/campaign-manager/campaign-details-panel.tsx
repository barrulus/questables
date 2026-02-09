import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Calendar, Edit, Settings, Share } from "lucide-react";
import {
  type Campaign,
  coerceLevelRange,
  hasCampaignDescription,
} from "../campaign-shared";
import { CampaignPrep } from "../campaign-prep";
import type { WorldMapSummary } from "../../utils/world-map-cache";

export interface CampaignDetailsPanelProps {
  campaign: Campaign;
  userId: string | undefined;
  worldMaps: WorldMapSummary[];
  onEditClick: (campaign: Campaign) => void;
  onSettingsClick: (campaign: Campaign) => void;
}

export function CampaignDetailsPanel({
  campaign,
  userId,
  worldMaps,
  onEditClick,
  onSettingsClick,
}: CampaignDetailsPanelProps) {
  const selectedLevelRange = coerceLevelRange(campaign.level_range ?? null);
  const selectedWorldMapName = useMemo(() => {
    if (!campaign.world_map_id) return null;
    const match = worldMaps.find((map) => map.id === campaign.world_map_id);
    return match?.name ?? "Unknown map";
  }, [campaign.world_map_id, worldMaps]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">{campaign.name}</h2>
          <div className="flex gap-2">
            {campaign.dm_user_id === userId && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditClick(campaign)}
                >
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSettingsClick(campaign)}
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
          <span>{campaign.system}</span>
          <span>•</span>
          <span className="capitalize">{campaign.status}</span>
          <span>•</span>
          <span>
            {campaign.current_players || 0}/{campaign.max_players} players
          </span>
          <span>•</span>
          <span>
            Created: {new Date(campaign.created_at).toLocaleDateString()}
          </span>
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
                  {hasCampaignDescription(campaign.description)
                    ? campaign.description
                    : "No description provided"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">Game System</h4>
                  <p className="text-muted-foreground">{campaign.system}</p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Setting</h4>
                  <p className="text-muted-foreground">{campaign.setting}</p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Level Range</h4>
                  <p className="text-muted-foreground">
                    {selectedLevelRange.min} - {selectedLevelRange.max}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Status</h4>
                  <Badge className="capitalize">{campaign.status}</Badge>
                </div>
                <div>
                  <h4 className="font-medium mb-1">World Map</h4>
                  <p className="text-muted-foreground">
                    {selectedWorldMapName ?? "Not configured"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <CampaignPrep campaign={campaign} />
      </div>
    </div>
  );
}
