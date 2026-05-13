import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { useGameSession } from "./GameSessionContext";
import { useWsEvent } from "./WebSocketContext";
import { apiFetch, readJsonBody, readErrorMessage } from "../utils/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionType =
  | "move"
  | "interact"
  | "search"
  | "use_item"
  | "cast_spell"
  | "talk_to_npc"
  | "pass"
  | "free_action"
  | "attack"
  | "dash"
  | "dodge"
  | "disengage"
  | "help"
  | "hide"
  | "ready";

export interface ActionPayload {
  [key: string]: unknown;
}

export interface RollRequest {
  actionId: string;
  requiredRolls: Array<{
    rollType: string;
    ability?: string | null;
    skill?: string | null;
    dc: number;
    description?: string;
  }>;
}

export interface RollSubmission {
  total: number;
  natural: number;
  modifier: number;
  rollType: string;
  ability?: string;
  skill?: string;
}

export interface PendingAction {
  type: ActionType;
  payload: ActionPayload;
}

interface ActionContextValue {
  pendingAction: PendingAction | null;
  processingActionId: string | null;
  awaitingRoll: RollRequest | null;
  lastNarration: string | null;
  activeNpcId: string | null;
  setActiveNpcId: (id: string | null) => void;
  levelUpAvailable: { characterId: string; newLevel: number } | null;
  setLevelUpAvailable: (data: { characterId: string; newLevel: number } | null) => void;
  declareAction: (type: ActionType, payload?: ActionPayload) => void;
  submitAction: () => Promise<void>;
  submitRollResult: (roll: RollSubmission) => Promise<void>;
  cancelAction: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ActionContext = createContext<ActionContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ActionProvider({ children }: { children: ReactNode }) {
  const { activeCampaignId } = useGameSession();

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);
  const [awaitingRoll, setAwaitingRoll] = useState<RollRequest | null>(null);
  const [lastNarration, _setLastNarration] = useState<string | null>(null);
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null);
  const [levelUpAvailable, setLevelUpAvailable] = useState<{
    characterId: string;
    newLevel: number;
  } | null>(null);

  // ── WebSocket event listeners ─────────────────────────────────────────
  // Narration is no longer a dm-narration event — it flows through chat
  // messages on the dm_broadcast channel.

  useWsEvent<RollRequest>("roll-requested", (data) => {
    if (data?.actionId) {
      setAwaitingRoll(data);
      setProcessingActionId(data.actionId);
    }
  });

  useWsEvent<{ actionId?: string }>("action-completed", (data) => {
    if (data?.actionId === processingActionId) {
      setProcessingActionId(null);
      setAwaitingRoll(null);
      setPendingAction(null);
    }
  });

  useWsEvent<{ newPhase?: string }>("game-phase-changed", (data) => {
    if (data?.newPhase !== "social") {
      setActiveNpcId(null);
    }
  });

  useWsEvent<{ characterId?: string; newLevel?: number }>(
    "level-up-available",
    (data) => {
      if (data?.characterId && data?.newLevel) {
        setLevelUpAvailable({
          characterId: data.characterId,
          newLevel: data.newLevel,
        });
      }
    },
  );

  // ── Actions ───────────────────────────────────────────────────────────
  const declareAction = useCallback(
    (type: ActionType, payload: ActionPayload = {}) => {
      setPendingAction({ type, payload });
    },
    [],
  );

  const submitAction = useCallback(async () => {
    if (!activeCampaignId || !pendingAction) return;

    try {
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionType: pendingAction.type,
            actionPayload: pendingAction.payload,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to submit action"));
      }

      const result = await readJsonBody<{ actionId: string; status: string }>(response);
      setProcessingActionId(result.actionId);
    } catch (error) {
      console.error("[ActionContext] submit failed:", error);
      throw error;
    }
  }, [activeCampaignId, pendingAction]);

  const submitRollResult = useCallback(
    async (roll: RollSubmission) => {
      if (!activeCampaignId || !awaitingRoll?.actionId) return;

      try {
        const response = await apiFetch(
          `/api/campaigns/${activeCampaignId}/actions/${awaitingRoll.actionId}/roll-result`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rollResult: roll }),
          },
        );

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to submit roll"));
        }

        setAwaitingRoll(null);
      } catch (error) {
        console.error("[ActionContext] roll submission failed:", error);
        throw error;
      }
    },
    [activeCampaignId, awaitingRoll],
  );

  const cancelAction = useCallback(() => {
    setPendingAction(null);
    setProcessingActionId(null);
    setAwaitingRoll(null);
  }, []);

  const value: ActionContextValue = {
    pendingAction,
    processingActionId,
    awaitingRoll,
    lastNarration,
    activeNpcId,
    setActiveNpcId,
    levelUpAvailable,
    setLevelUpAvailable,
    declareAction,
    submitAction,
    submitRollResult,
    cancelAction,
  };

  return (
    <ActionContext.Provider value={value}>{children}</ActionContext.Provider>
  );
}

export function useAction(): ActionContextValue {
  const context = useContext(ActionContext);
  if (!context) {
    throw new Error("useAction must be used within an ActionProvider");
  }
  return context;
}
