import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "../ui/button";
import { useGameSession } from "../../contexts/GameSessionContext";
import { apiFetch, readJsonBody } from "../../utils/api-client";

interface CampaignNpc {
  id: string;
  name: string;
  occupation?: string;
  appearance?: string;
}

interface NpcPickerProps {
  onSelect: (npcId: string) => void;
}

export function NpcPicker({ onSelect }: NpcPickerProps) {
  const { activeCampaignId } = useGameSession();
  const [npcs, setNpcs] = useState<CampaignNpc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCampaignId) return;

    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiFetch(
          `/api/campaigns/${activeCampaignId}/npcs`,
          { signal: controller.signal },
        );
        if (response.ok) {
          const data = await readJsonBody<CampaignNpc[]>(response);
          setNpcs(data ?? []);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("[NpcPicker] fetch failed:", e);
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [activeCampaignId]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">Loading NPCs...</div>
    );
  }

  if (npcs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No NPCs nearby to talk to.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium flex items-center gap-1.5">
        <Users className="h-4 w-4" />
        Who would you like to speak with?
      </div>
      <div className="grid grid-cols-2 gap-2">
        {npcs.map((npc) => (
          <Button
            key={npc.id}
            variant="outline"
            size="sm"
            className="justify-start h-auto py-2 px-3"
            onClick={() => onSelect(npc.id)}
          >
            <div className="text-left">
              <div className="font-medium">{npc.name}</div>
              {npc.occupation && (
                <div className="text-xs text-muted-foreground">
                  {npc.occupation}
                </div>
              )}
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
