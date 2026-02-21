import { Loader2, Send, X } from "lucide-react";
import { Button } from "../ui/button";
import { useAction } from "../../contexts/ActionContext";
import { useGameState } from "../../contexts/GameStateContext";
import { ActionGrid } from "./action-grid";
import { RollPrompt } from "./roll-prompt";
import { CombatBudgetBar } from "./combat-budget-bar";

export function ActionPanel() {
  const { isMyTurn, isEnemyTurn, gameState, combatTurnBudget } = useGameState();
  const {
    pendingAction,
    processingActionId,
    awaitingRoll,
    lastNarration,
    declareAction,
    submitAction,
    submitRollResult,
    cancelAction,
  } = useAction();

  // Don't render during rest phase or when not in a game
  if (!gameState || gameState.phase === "rest") return null;

  const isCombat = gameState.phase === "combat";

  // Show enemy turn indicator during combat even when it's not the player's turn
  if (isCombat && isEnemyTurn) {
    return (
      <div className="border-t bg-card/50 px-4 py-3 space-y-3">
        {lastNarration && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm italic text-muted-foreground">
            {lastNarration}
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Enemy is taking their turn...</span>
        </div>
      </div>
    );
  }

  // Only show the panel when it's the player's turn
  if (!isMyTurn) return null;

  const isProcessing = !!processingActionId && !awaitingRoll;

  return (
    <div className="border-t bg-card/50 px-4 py-3 space-y-3">
      {/* Combat budget bar */}
      {isCombat && combatTurnBudget && (
        <CombatBudgetBar budget={combatTurnBudget} />
      )}

      {/* Last narration */}
      {lastNarration && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm italic text-muted-foreground">
          {lastNarration}
        </div>
      )}

      {/* Roll prompt overlay */}
      {awaitingRoll && (
        <RollPrompt
          rollRequest={awaitingRoll}
          onSubmit={(roll) => void submitRollResult(roll)}
          disabled={isProcessing}
        />
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>The DM is considering your action...</span>
        </div>
      )}

      {/* Action selection (only when not processing/rolling) */}
      {!processingActionId && !awaitingRoll && (
        <>
          {!pendingAction ? (
            <ActionGrid
              onSelect={(type) => declareAction(type)}
              phase={gameState.phase}
              combatBudget={combatTurnBudget}
            />
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm">
                <span className="font-medium capitalize">
                  {pendingAction.type.replace(/_/g, " ")}
                </span>
                {Object.keys(pendingAction.payload).length > 0 && (
                  <span className="text-muted-foreground ml-2">
                    ({JSON.stringify(pendingAction.payload)})
                  </span>
                )}
              </div>
              <Button size="sm" onClick={() => void submitAction()}>
                <Send className="mr-1 h-3 w-3" />
                Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelAction}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
