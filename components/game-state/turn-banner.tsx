import { useGameState } from "../../contexts/GameStateContext";
import { Button } from "../ui/button";
import { Clock } from "lucide-react";

export function TurnBanner() {
  const { gameState, isMyTurn, activePlayerName, endTurn, executeDmWorldTurn } = useGameState();

  if (!gameState) return null;

  // Rest phase — no turns
  if (gameState.phase === "rest") return null;

  // No turn order
  if (gameState.turnOrder.length === 0) return null;

  const showWorldTurn = gameState.worldTurnPending;

  return (
    <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        {showWorldTurn ? (
          <span className="font-medium text-amber-700">
            Waiting for DM world turn...
          </span>
        ) : isMyTurn ? (
          <span className="font-semibold text-primary">Your turn!</span>
        ) : (
          <span className="text-muted-foreground">
            {activePlayerName
              ? `${activePlayerName}'s turn`
              : "Waiting for turn..."}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          Round {gameState.roundNumber}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {showWorldTurn && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => void executeDmWorldTurn()}
          >
            Complete World Turn
          </Button>
        )}
        {isMyTurn && !showWorldTurn && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => void endTurn()}
          >
            End Turn
          </Button>
        )}
      </div>
    </div>
  );
}
