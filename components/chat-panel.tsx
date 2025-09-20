import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { useUser } from "../contexts/UserContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { handleAsyncError } from "../utils/error-handling";
import { ChatSystem } from "./chat-system";
import { useGameSession } from "../contexts/GameSessionContext";

interface ApiCampaignSummary {
  id: string;
  name: string;
  status: string;
}

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  role: "dm" | "player";
}

export function ChatPanel() {
  const { user } = useUser();
  const { activeCampaignId, selectCampaign, loading: activeCampaignLoading } = useGameSession();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === activeCampaignId) ?? null,
    [campaigns, activeCampaignId]
  );

  const loadCampaigns = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        setCampaigns([]);
        void selectCampaign(null);
        return;
      }

      try {
        setError(null);
        setLoading(true);

        const response = await apiFetch(`/api/users/${user.id}/campaigns`, { signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load campaigns"));
        }

        const payload = await readJsonBody<{
          dmCampaigns?: unknown;
          playerCampaigns?: unknown;
        }>(response);

        if (payload && !Array.isArray(payload.dmCampaigns) && payload.dmCampaigns !== undefined) {
          throw new Error("Unexpected dmCampaigns payload format");
        }

        if (payload && !Array.isArray(payload.playerCampaigns) && payload.playerCampaigns !== undefined) {
          throw new Error("Unexpected playerCampaigns payload format");
        }

        const dmCampaigns = (payload?.dmCampaigns as ApiCampaignSummary[] | undefined) ?? [];
        const playerCampaigns = (payload?.playerCampaigns as ApiCampaignSummary[] | undefined) ?? [];

        const deduped = new Map<string, CampaignSummary>();

        dmCampaigns.forEach((campaign) => {
          deduped.set(campaign.id, {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            role: "dm",
          });
        });

        playerCampaigns.forEach((campaign) => {
          if (deduped.has(campaign.id)) {
            return;
          }
          deduped.set(campaign.id, {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            role: "player",
          });
        });

        const campaignList = Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
        setCampaigns(campaignList);

        if (campaignList.length === 0) {
          if (activeCampaignId) {
            void selectCampaign(null);
          }
          return;
        }

        const hasCurrentSelection = activeCampaignId && campaignList.some((campaign) => campaign.id === activeCampaignId);
        if (!hasCurrentSelection) {
          const defaultCampaign = campaignList.find((campaign) => campaign.status === "active") ?? campaignList[0];
          if (defaultCampaign) {
            void selectCampaign(defaultCampaign.id).catch((selectionError) => {
              console.error("Failed to activate campaign from chat panel list:", selectionError);
            });
          }
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        const message = handleAsyncError(loadError);
        setError(message);
        console.error("Failed to load chat campaigns:", loadError);
      } finally {
        setLoading(false);
      }
    },
    [activeCampaignId, selectCampaign, user]
  );

  useEffect(() => {
    if (!user) {
      setCampaigns([]);
      void selectCampaign(null);
      return;
    }

    const controller = new AbortController();
    loadCampaigns(controller.signal);
    return () => controller.abort();
  }, [loadCampaigns, user]);

  const handleCampaignChange = useCallback(
    (value: string) => {
      void selectCampaign(value).catch((selectionError) => {
        console.error("Failed to activate selected campaign:", selectionError);
      });
    },
    [selectCampaign]
  );

  return (
    <Card className="flex h-full flex-col rounded-none border-0">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Campaign Chat</CardTitle>
          {selectedCampaign && (
            <Badge variant="outline" className="text-xs capitalize">
              {selectedCampaign.role}
            </Badge>
          )}
        </div>
        {user ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Campaign</span>
            <Select
              value={activeCampaignId ?? ""}
              onValueChange={handleCampaignChange}
              disabled={loading || activeCampaignLoading || campaigns.length === 0}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={loading || activeCampaignLoading ? "Loading..." : "Select a campaign"} />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id || campaign.name}>
                    {campaign.name}
                    {campaign.status === "active" ? " (Active)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                void loadCampaigns();
              }}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        ) : (
          <CardDescription>Sign in to access campaign chat.</CardDescription>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {loading ? (
          <div className="flex h-full flex-col gap-4 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : !user ? (
          <div className="py-8 text-center text-muted-foreground">
            <p>Please sign in to join the conversation.</p>
          </div>
        ) : campaigns.length === 0 || !selectedCampaign ? (
          <div className="py-8 text-center text-muted-foreground">
            <p>No campaigns available.</p>
            <p className="text-sm">Create or join a campaign to enable chat.</p>
          </div>
        ) : (
          <ChatSystem campaignId={selectedCampaign.id} campaignName={selectedCampaign.name} />
        )}
      </CardContent>
    </Card>
  );
}
