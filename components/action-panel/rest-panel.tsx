import { Loader2, Moon, Heart } from "lucide-react";
import { Button } from "../ui/button";
import { useGameState } from "../../contexts/GameStateContext";
import { useLiveState } from "../../contexts/LiveStateContext";
import { useGameSession } from "../../contexts/GameSessionContext";
import { useUser } from "../../contexts/UserContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../../utils/api-client";
import { useState } from "react";
import type { GameState } from "../../contexts/GameStateContext";

interface HitDieResult {
  roll: number;
  dieSize: number;
  conMod: number;
  healing: number;
  newHp: number;
  hitDiceRemaining: number;
}

export function RestPanel() {
  const { gameState } = useGameState();
  const { allLiveStates } = useLiveState();
  const { activeCampaignId, viewerRole } = useGameSession();
  const { user } = useUser();
  const [spending, setSpending] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<HitDieResult | null>(null);
  const [completing, setCompleting] = useState(false);

  const isDm = viewerRole === "dm" || viewerRole === "co-dm";
  const restType = (gameState as GameState | null)?.restContext?.type ?? "short";

  const liveStates = Object.values(allLiveStates);

  const spendHitDie = async (characterId: string) => {
    if (!activeCampaignId) return;
    setSpending(characterId);
    try {
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/rest/spend-hit-die`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to spend hit die"));
      }
      const result = await readJsonBody<HitDieResult>(response);
      setLastResult(result);
    } catch (error) {
      console.error("[RestPanel] spend hit die failed:", error);
    } finally {
      setSpending(null);
    }
  };

  const completeRest = async () => {
    if (!activeCampaignId) return;
    setCompleting(true);
    try {
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/rest/complete`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to complete rest"));
      }
    } catch (error) {
      console.error("[RestPanel] complete rest failed:", error);
    } finally {
      setCompleting(false);
    }
  };

  if (restType === "long") {
    return (
      <div className="border-t bg-card/50 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Moon className="h-4 w-4 text-blue-400" />
          <span className="font-medium">Long Rest</span>
        </div>
        <div className="text-sm text-muted-foreground italic">
          The party settles in for a long rest. HP, spell slots, and hit dice
          will be restored when the rest completes...
        </div>
        {isDm && (
          <Button
            size="sm"
            onClick={() => void completeRest()}
            disabled={completing}
          >
            {completing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Complete Rest
          </Button>
        )}
      </div>
    );
  }

  // Short rest view
  return (
    <div className="border-t bg-card/50 px-4 py-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Moon className="h-4 w-4 text-amber-400" />
        <span className="font-medium">Short Rest</span>
      </div>

      {lastResult && (
        <div className="rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-sm">
          <Heart className="inline h-3.5 w-3.5 text-green-500 mr-1" />
          Rolled d{lastResult.dieSize}: {lastResult.roll} + {lastResult.conMod} CON ={" "}
          <span className="font-medium text-green-500">+{lastResult.healing} HP</span>
          {" "}({lastResult.hitDiceRemaining} dice remaining)
        </div>
      )}

      <div className="space-y-2">
        {liveStates.map((ls) => {
          const hd = ls.hit_dice as { die?: string; total?: number; remaining?: number } | undefined;
          const canSpend = (hd?.remaining ?? 0) > 0 && ls.hp_current < ls.hp_max;
          const isOwn = ls.user_id === user?.id;
          const canControl = isDm || isOwn;

          return (
            <div
              key={ls.character_id}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {ls.character_name ?? ls.character_id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground">
                  HP {ls.hp_current}/{ls.hp_max}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({hd?.remaining ?? 0}/{hd?.total ?? 0} {hd?.die ?? "d8"})
                </span>
              </div>
              {canControl && canSpend && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void spendHitDie(ls.character_id)}
                  disabled={spending === ls.character_id}
                >
                  {spending === ls.character_id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Spend Hit Die"
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {isDm && (
        <Button
          size="sm"
          onClick={() => void completeRest()}
          disabled={completing}
        >
          {completing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Complete Rest
        </Button>
      )}
    </div>
  );
}
