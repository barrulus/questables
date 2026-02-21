import { useState } from "react";
import { Skull, Heart, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { useLiveState } from "../../contexts/LiveStateContext";
import { useGameSession } from "../../contexts/GameSessionContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../../utils/api-client";

interface DeathSaveResult {
  roll: number;
  outcome: "success" | "fail" | "stabilized" | "dead" | "conscious";
  deathSaves: { successes: number; failures: number };
}

export function DeathSavePanel() {
  const { myLiveState } = useLiveState();
  const { activeCampaignId } = useGameSession();
  const [rolling, setRolling] = useState(false);
  const [lastResult, setLastResult] = useState<DeathSaveResult | null>(null);

  const deathSaves = myLiveState?.death_saves ?? { successes: 0, failures: 0 };
  const isStabilized = deathSaves.successes >= 3;

  const rollDeathSave = async () => {
    if (!activeCampaignId || !myLiveState) return;
    setRolling(true);

    // Roll d20 client-side
    const roll = Math.floor(Math.random() * 20) + 1;

    try {
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/death-save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: myLiveState.character_id,
            roll,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to roll death save"),
        );
      }

      const result = await readJsonBody<DeathSaveResult>(response);
      setLastResult(result);
    } catch (error) {
      console.error("[DeathSavePanel] death save failed:", error);
    } finally {
      setRolling(false);
    }
  };

  if (isStabilized) {
    return (
      <div className="border-t bg-card/50 px-4 py-3 space-y-2">
        <div className="text-sm font-medium text-amber-400">
          You are stable
        </div>
        <div className="text-sm text-muted-foreground">
          You are unconscious but no longer dying. You need healing to regain
          consciousness.
        </div>
      </div>
    );
  }

  return (
    <div className="border-t bg-card/50 px-4 py-3 space-y-3">
      <div className="text-sm font-medium text-red-400">You are dying!</div>

      {/* Save counters */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Successes:</span>
          {[0, 1, 2].map((i) => (
            <Heart
              key={i}
              className={`h-4 w-4 ${
                i < deathSaves.successes
                  ? "text-green-500 fill-green-500"
                  : "text-muted-foreground/30"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Failures:</span>
          {[0, 1, 2].map((i) => (
            <Skull
              key={i}
              className={`h-4 w-4 ${
                i < deathSaves.failures
                  ? "text-red-500"
                  : "text-muted-foreground/30"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Last result */}
      {lastResult && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            lastResult.outcome === "conscious"
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : lastResult.outcome === "stabilized"
                ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                : lastResult.outcome === "dead"
                  ? "bg-red-500/10 border border-red-500/20 text-red-400"
                  : lastResult.outcome === "success"
                    ? "bg-green-500/10 border border-green-500/20"
                    : "bg-red-500/10 border border-red-500/20"
          }`}
        >
          Rolled: {lastResult.roll}
          {lastResult.roll === 20 && " — Natural 20! You regain consciousness!"}
          {lastResult.roll === 1 && " — Critical fail! Two failures!"}
          {lastResult.outcome === "stabilized" && " — You are stabilized!"}
          {lastResult.outcome === "dead" && " — You have died..."}
        </div>
      )}

      <Button
        size="sm"
        variant="destructive"
        onClick={() => void rollDeathSave()}
        disabled={rolling}
      >
        {rolling ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Skull className="mr-1 h-3 w-3" />
        )}
        Roll Death Save
      </Button>
    </div>
  );
}
