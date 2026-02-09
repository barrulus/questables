import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Edit, MapIcon, Trash2 } from "lucide-react";
import { type Campaign, getStatusColor, hasCampaignDescription } from "../campaign-shared";

export interface CampaignListProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onSelect: (campaign: Campaign) => void;
  onEdit: (campaign: Campaign) => void;
  onDelete: (campaign: Campaign) => void;
}

export function CampaignList({
  campaigns,
  selectedCampaignId,
  onSelect,
  onEdit,
  onDelete,
}: CampaignListProps) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          My Campaigns
        </h3>
        <span className="text-xs text-muted-foreground">
          {campaigns.length} total
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {campaigns.map((campaign) => (
          <Card
            key={campaign.id}
            className={`cursor-pointer transition-colors ${
              selectedCampaignId === campaign.id ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => onSelect(campaign)}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`}
                />
                <h3 className="font-medium text-sm truncate">
                  {campaign.name}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                {hasCampaignDescription(campaign.description)
                  ? campaign.description
                  : "No description"}
              </p>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="text-xs">
                  {campaign.system}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {campaign.current_players || 0}/{campaign.max_players}
                </span>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(campaign);
                  }}
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(campaign);
                  }}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {campaigns.length === 0 && (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            <MapIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No campaigns created yet</p>
            <p className="text-sm">
              Create your first campaign to get started
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
