import { useState } from "react";
import { Loader2, Star, ArrowUp } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useAction } from "../contexts/ActionContext";
import { useGameSession } from "../contexts/GameSessionContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";

interface LevelUpResult {
  characterName: string;
  newLevel: number;
  hpIncrease: number;
  newMaxHp: number;
  newSpellSlots: Record<string, unknown> | null;
  isAsiLevel: boolean;
  hitDie: string;
}

export function LevelUpModal() {
  const { levelUpAvailable, setLevelUpAvailable } = useAction();
  const { activeCampaignId } = useGameSession();
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<LevelUpResult | null>(null);

  if (!levelUpAvailable) return null;

  const confirmLevelUp = async (hpChoice: "roll" | "average") => {
    if (!activeCampaignId) return;
    setApplying(true);

    try {
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/characters/${levelUpAvailable.characterId}/level-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hpChoice }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to level up"),
        );
      }

      const data = await readJsonBody<LevelUpResult>(response);
      setResult(data);
    } catch (error) {
      console.error("[LevelUpModal] level up failed:", error);
    } finally {
      setApplying(false);
    }
  };

  const close = () => {
    setLevelUpAvailable(null);
    setResult(null);
  };

  return (
    <Dialog open={!!levelUpAvailable} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Level Up!
          </DialogTitle>
          <DialogDescription>
            {result
              ? `${result.characterName} is now Level ${result.newLevel}!`
              : `Your character is ready to advance to Level ${levelUpAvailable.newLevel}!`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-green-500">
                <ArrowUp className="h-4 w-4" />
                Level {result.newLevel}
              </div>
              <div className="text-sm">
                HP increased by{" "}
                <span className="font-medium text-green-500">
                  +{result.hpIncrease}
                </span>{" "}
                (new max: {result.newMaxHp})
              </div>
              {result.newSpellSlots && (
                <div className="text-sm text-muted-foreground">
                  Spell slots updated
                </div>
              )}
              {result.isAsiLevel && (
                <div className="text-sm text-amber-500 font-medium">
                  Ability Score Improvement or Feat available!
                </div>
              )}
            </div>
            <Button onClick={close} className="w-full">
              Continue
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Choose how to determine your HP increase:
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => void confirmLevelUp("roll")}
                disabled={applying}
              >
                {applying && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                Roll Hit Die
              </Button>
              <Button
                variant="outline"
                onClick={() => void confirmLevelUp("average")}
                disabled={applying}
              >
                {applying && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                Take Average
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
