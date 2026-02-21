import { Loader2, Send, X } from "lucide-react";
import { Button } from "../ui/button";
import { useAction } from "../../contexts/ActionContext";
import { useGameState } from "../../contexts/GameStateContext";
import { useLiveState } from "../../contexts/LiveStateContext";
import { ActionGrid } from "./action-grid";
import { RollPrompt } from "./roll-prompt";
import { CombatBudgetBar } from "./combat-budget-bar";
import { NpcPicker } from "./npc-picker";
import { SocialActionGrid } from "./social-action-grid";
import { RestPanel } from "./rest-panel";
import { DeathSavePanel } from "./death-save-panel";

export function ActionPanel() {
  const { isMyTurn, isEnemyTurn, gameState, combatTurnBudget } = useGameState();
  const { myLiveState } = useLiveState();
  const {
    pendingAction,
    processingActionId,
    awaitingRoll,
    lastNarration,
    activeNpcId,
    setActiveNpcId,
    declareAction,
    submitAction,
    submitRollResult,
    cancelAction,
  } = useAction();

  if (!gameState) return null;

  // Rest phase: show rest panel instead
  if (gameState.phase === "rest") {
    return <RestPanel />;
  }

  // Death/unconscious checks
  const isUnconscious = myLiveState?.conditions?.includes("unconscious");
  const isDead = myLiveState?.conditions?.includes("dead");

  if (isDead) {
    return (
      <div className="border-t bg-card/50 px-4 py-3">
        <div className="text-sm text-muted-foreground italic">
          Your character has fallen. May they find peace beyond the veil...
        </div>
      </div>
    );
  }

  if (isUnconscious && isMyTurn) {
    return <DeathSavePanel />;
  }

  // Social phase handling
  if (gameState.phase === "social") {
    return (
      <div className="border-t bg-card/50 px-4 py-3 space-y-3">
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
            disabled={!!processingActionId && !awaitingRoll}
          />
        )}

        {/* Processing indicator */}
        {processingActionId && !awaitingRoll && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>The NPC is considering their response...</span>
          </div>
        )}

        {!processingActionId && !awaitingRoll && (
          <>
            {!activeNpcId ? (
              <NpcPicker onSelect={setActiveNpcId} />
            ) : (
              <SocialActionGrid
                npcId={activeNpcId}
                onAction={(payload) => {
                  declareAction("talk_to_npc", payload);
                  // Auto-submit social actions
                  setTimeout(() => void submitAction(), 0);
                }}
                onLeave={() => {
                  setActiveNpcId(null);
                  declareAction("pass", { socialExit: true });
                  setTimeout(() => void submitAction(), 0);
                }}
              />
            )}
          </>
        )}
      </div>
    );
  }

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
