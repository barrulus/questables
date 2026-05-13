import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
} from "react";
import { useGameSession } from "./GameSessionContext";
import { useUser } from "./UserContext";
import { useWsEvent } from "./WebSocketContext";
import { useAsync } from "../hooks/useAsync";
import { apiFetch, readJsonBody, readErrorMessage } from "../utils/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveCharacterState {
  id: string;
  session_id: string;
  campaign_id: string;
  user_id: string;
  character_id: string;
  character_name?: string;
  username?: string;
  hp_current: number;
  hp_max: number;
  hp_temporary: number;
  conditions: string[];
  spell_slots: Record<string, unknown>;
  hit_dice: Record<string, unknown>;
  class_resources: Record<string, unknown>;
  inspiration: boolean;
  death_saves: { successes: number; failures: number };
  xp_gained: number;
  concentration: { spellName: string; startedRound?: number } | null;
}

export interface LiveStateChanges {
  hp_current?: number;
  hp_temporary?: number;
  conditions?: string[];
  inspiration?: boolean;
  spell_slots?: Record<string, unknown>;
  death_saves?: { successes: number; failures: number };
  xp_gained?: number;
}

interface LiveStateContextValue {
  myLiveState: LiveCharacterState | null;
  allLiveStates: Record<string, LiveCharacterState>;
  loading: boolean;
  patchLiveState: (
    characterId: string,
    changes: Partial<LiveStateChanges>,
    reason: string,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LiveStateContext = createContext<LiveStateContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LiveStateProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { activeCampaignId } = useGameSession();

  // ── Fetch live states on mount ────────────────────────────────────────
  const {
    data: liveStatesData,
    loading,
    setData: setAllLiveStatesData,
  } = useAsync<Record<string, LiveCharacterState>>(
    async (signal) => {
      if (!activeCampaignId) return {};
      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/live-states`,
        { signal },
      );
      if (!response.ok) return undefined;

      const states = await readJsonBody<LiveCharacterState[]>(response);
      const map: Record<string, LiveCharacterState> = {};
      for (const s of states ?? []) {
        map[s.character_id] = s;
      }
      return map;
    },
    [activeCampaignId],
  );
  const allLiveStates = liveStatesData ?? {};
  const setAllLiveStates = setAllLiveStatesData;

  // ── WebSocket listener ────────────────────────────────────────────────
  useWsEvent<{ liveStates?: LiveCharacterState[] }>(
    "live-state-changed",
    (data) => {
      if (Array.isArray(data?.liveStates)) {
        const map: Record<string, LiveCharacterState> = {};
        for (const s of data.liveStates) {
          map[s.character_id] = s;
        }
        setAllLiveStates(map);
      }
    },
  );

  // ── Derived state ─────────────────────────────────────────────────────
  const myLiveState =
    user
      ? Object.values(allLiveStates).find((s) => s.user_id === user.id) ?? null
      : null;

  // ── Patch API ─────────────────────────────────────────────────────────
  const patchLiveState = useCallback(
    async (
      characterId: string,
      changes: Partial<LiveStateChanges>,
      reason: string,
    ) => {
      if (!activeCampaignId) return;

      const response = await apiFetch(
        `/api/campaigns/${activeCampaignId}/live-state`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, changes, reason }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to patch live state"),
        );
      }
    },
    [activeCampaignId],
  );

  const value: LiveStateContextValue = {
    myLiveState,
    allLiveStates,
    loading,
    patchLiveState,
  };

  return (
    <LiveStateContext.Provider value={value}>
      {children}
    </LiveStateContext.Provider>
  );
}

export function useLiveState(): LiveStateContextValue {
  const context = useContext(LiveStateContext);
  if (!context) {
    throw new Error("useLiveState must be used within a LiveStateProvider");
  }
  return context;
}
