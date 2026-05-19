import { useMemo } from "react";
import { computeActionability, type ActionabilityResult } from "../shared/actionability";
import { useGameState } from "../contexts/GameStateContext";
import { useUser } from "../contexts/UserContext";

/**
 * Returns the current user's actionability for the active campaign session.
 *
 * Pass `hasActiveCharacter` so the hook stays UI-agnostic — chat-system.tsx
 * already manages `campaignCharacter` and passes `!!campaignCharacter`.
 */
export function useActionability(hasActiveCharacter: boolean): ActionabilityResult {
  const { gameState } = useGameState();
  const { user } = useUser();

  return useMemo(
    () =>
      computeActionability({
        gameState: gameState
          ? {
              phase: gameState.phase,
              turnOrder: gameState.turnOrder,
              activePlayerId: gameState.activePlayerId,
            }
          : null,
        userId: user?.id ?? "",
        hasActiveCharacter,
      }),
    [gameState, user?.id, hasActiveCharacter],
  );
}
