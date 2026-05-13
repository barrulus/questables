import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useGameSession } from "./GameSessionContext";
import { useUser } from "./UserContext";
import { useWsEvent } from "./WebSocketContext";
import { useAsync } from "../hooks/useAsync";
import { apiFetch, readJsonBody, readErrorMessage } from "../utils/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GamePhase = "exploration" | "combat" | "social" | "rest";

export interface CombatTurnBudget {
  actionUsed: boolean;
  bonusActionUsed: boolean;
  movementRemaining: number;
  reactionUsed: boolean;
}

export interface GameState {
  phase: GamePhase;
  previousPhase: string | null;
  turnOrder: string[];
  activePlayerId: string | null;
  roundNumber: number;
  worldTurnPending: boolean;
  encounterId: string | null;
  phaseEnteredAt: string;
  combatTurnBudget: CombatTurnBudget | null;
  restContext: { type: "short" | "long"; startedAt: string } | null;
}

interface GameStateContextValue {
  gameState: GameState | null;
  sessionId: string | null;
  loading: boolean;
  isMyTurn: boolean;
  isEnemyTurn: boolean;
  activePlayerName: string | null;
  combatTurnBudget: CombatTurnBudget | null;
  changePhase: (phase: GamePhase, encounterId?: string) => Promise<void>;
  endTurn: () => Promise<void>;
  executeDmWorldTurn: () => Promise<void>;
  setTurnOrder: (order: string[]) => Promise<void>;
  skipTurn: (targetPlayerId: string) => Promise<void>;
  endCombat: (endCondition: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const GameStateContext = createContext<GameStateContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function GameStateProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { activeCampaignId } = useGameSession();

  // ── Fetch on mount / campaign change ────────────────────────────────
  const {
    data: gameStateData,
    loading,
    setData: setGameStateData,
  } = useAsync<{ gameState: GameState | null; sessionId: string | null }>(
    async (signal) => {
      if (!activeCampaignId) return { gameState: null, sessionId: null };
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/game-state`,
        { signal },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load game state"));
      }
      return readJsonBody<{
        gameState: GameState | null;
        sessionId: string | null;
      }>(response);
    },
    [activeCampaignId],
  );
  const gameState = gameStateData?.gameState ?? null;
  const sessionId = gameStateData?.sessionId ?? null;
  const setGameState = useCallback(
    (next: GameState | null | ((prev: GameState | null) => GameState | null)) => {
      setGameStateData((prev) => {
        const resolved = typeof next === "function" ? next(prev?.gameState ?? null) : next;
        return { gameState: resolved, sessionId: prev?.sessionId ?? null };
      });
    },
    [setGameStateData],
  );
  const setSessionId = useCallback(
    (nextSessionId: string | null) => {
      setGameStateData((prev) => ({
        gameState: prev?.gameState ?? null,
        sessionId: nextSessionId,
      }));
    },
    [setGameStateData],
  );

  // ── Load player names for the turn order ────────────────────────────
  const { data: playerNamesData } = useAsync<Record<string, string>>(
    async (signal) => {
      if (!activeCampaignId) return {};
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/characters`,
        { signal },
      );
      if (!response.ok) return {};
      const payload = await readJsonBody<{ user_id: string; name: string }[]>(response);
      const names: Record<string, string> = {};
      for (const c of payload ?? []) {
        if (c.user_id) names[c.user_id] = c.name;
      }
      return names;
    },
    [activeCampaignId],
  );
  const playerNames = playerNamesData ?? {};

  // ── Listen to WebSocket events ──────────────────────────────────────
  const applyStateUpdate = useCallback(
    (data: { gameState?: GameState; sessionId?: string } | undefined) => {
      if (data?.gameState) setGameState(data.gameState);
      if (data?.sessionId) setSessionId(data.sessionId);
    },
    [setGameState, setSessionId],
  );

  useWsEvent<{ gameState?: GameState; sessionId?: string }>(
    "game-phase-changed",
    applyStateUpdate,
  );
  useWsEvent<{ gameState?: GameState; sessionId?: string }>(
    "turn-advanced",
    applyStateUpdate,
  );
  useWsEvent<{ gameState?: GameState; sessionId?: string }>(
    "world-turn-completed",
    applyStateUpdate,
  );
  useWsEvent<{ gameState?: GameState; sessionId?: string }>(
    "turn-order-changed",
    applyStateUpdate,
  );
  useWsEvent<{ gameState?: GameState; sessionId?: string }>(
    "combat-ended",
    applyStateUpdate,
  );

  useWsEvent<{ combatTurnBudget?: CombatTurnBudget }>(
    "combat-budget-changed",
    (data) => {
      if (data?.combatTurnBudget) {
        setGameState((prev) =>
          prev ? { ...prev, combatTurnBudget: data.combatTurnBudget! } : prev,
        );
      }
    },
  );

  // ── Derived state ───────────────────────────────────────────────────
  const isMyTurn = useMemo(() => {
    if (!gameState || !user) return false;
    return gameState.activePlayerId === user.id;
  }, [gameState, user]);

  const isEnemyTurn = useMemo(() => {
    if (!gameState?.activePlayerId) return false;
    return gameState.activePlayerId.startsWith("npc:");
  }, [gameState?.activePlayerId]);

  const activePlayerName = useMemo(() => {
    if (!gameState?.activePlayerId) return null;
    // For NPC turns, show the NPC participant ID prefix
    if (gameState.activePlayerId.startsWith("npc:")) return null;
    return playerNames[gameState.activePlayerId] ?? null;
  }, [gameState?.activePlayerId, playerNames]);

  const combatTurnBudget = gameState?.combatTurnBudget ?? null;

  // ── API actions ─────────────────────────────────────────────────────
  const changePhase = useCallback(
    async (phase: GamePhase, encounterId?: string) => {
      if (!activeCampaignId) return;
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/game-state/phase`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase, encounterId: encounterId ?? null }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to change phase"));
      }
      const payload = await readJsonBody<{ gameState: GameState }>(response);
      setGameState(payload.gameState);
    },
    [activeCampaignId],
  );

  const endTurn = useCallback(async () => {
    if (!activeCampaignId) return;
    const response = await apiFetch(
      `/api/campaigns/${activeCampaignId}/game-state/end-turn`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Failed to end turn"));
    }
    const payload = await readJsonBody<{ gameState: GameState }>(response);
    setGameState(payload.gameState);
  }, [activeCampaignId]);

  const executeDmWorldTurn = useCallback(async () => {
    if (!activeCampaignId) return;
    const response = await apiFetch(
      `/api/campaigns/${activeCampaignId}/game-state/dm-world-turn`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Failed to execute world turn"));
    }
    const payload = await readJsonBody<{ gameState: GameState }>(response);
    setGameState(payload.gameState);
  }, [activeCampaignId]);

  const setTurnOrderAction = useCallback(
    async (order: string[]) => {
      if (!activeCampaignId) return;
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/game-state/turn-order`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnOrder: order }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to set turn order"));
      }
      const payload = await readJsonBody<{ gameState: GameState }>(response);
      setGameState(payload.gameState);
    },
    [activeCampaignId],
  );

  const endCombat = useCallback(
    async (endCondition: string) => {
      if (!activeCampaignId) return;
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/combat/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endCondition }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to end combat"));
      }
      const payload = await readJsonBody<{ gameState: GameState }>(response);
      setGameState(payload.gameState);
    },
    [activeCampaignId],
  );

  const skipTurn = useCallback(
    async (targetPlayerId: string) => {
      if (!activeCampaignId) return;
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/game-state/skip-turn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlayerId }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to skip turn"));
      }
      const payload = await readJsonBody<{ gameState: GameState }>(response);
      setGameState(payload.gameState);
    },
    [activeCampaignId],
  );

  const value: GameStateContextValue = {
    gameState,
    sessionId,
    loading,
    isMyTurn,
    isEnemyTurn,
    activePlayerName,
    combatTurnBudget,
    changePhase,
    endTurn,
    executeDmWorldTurn,
    setTurnOrder: setTurnOrderAction,
    skipTurn,
    endCombat,
  };

  return (
    <GameStateContext.Provider value={value}>
      {children}
    </GameStateContext.Provider>
  );
}

export function useGameState(): GameStateContextValue {
  const context = useContext(GameStateContext);
  if (!context) {
    throw new Error("useGameState must be used within a GameStateProvider");
  }
  return context;
}
