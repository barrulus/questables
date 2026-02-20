import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useGameSession } from "./GameSessionContext";
import { useUser } from "./UserContext";
import { useWebSocket } from "../hooks/useWebSocket";
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
  const { messages: wsMessages } = useWebSocket(activeCampaignId ?? "");

  const [allLiveStates, setAllLiveStates] = useState<Record<string, LiveCharacterState>>({});
  const [loading, setLoading] = useState(false);

  const lastWsMsgCountRef = useRef(0);

  // ── Fetch live states on mount ────────────────────────────────────────
  const fetchLiveStates = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeCampaignId) {
        setAllLiveStates({});
        return;
      }

      try {
        setLoading(true);
        const response = await apiFetch(
          `/api/campaigns/${activeCampaignId}/live-states`,
          { signal },
        );
        if (!response.ok) return;

        const states = await readJsonBody<LiveCharacterState[]>(response);
        const map: Record<string, LiveCharacterState> = {};
        for (const s of states ?? []) {
          map[s.character_id] = s;
        }
        setAllLiveStates(map);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[LiveState] fetch failed:", error);
      } finally {
        setLoading(false);
      }
    },
    [activeCampaignId],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchLiveStates(controller.signal);
    return () => controller.abort();
  }, [fetchLiveStates]);

  // ── WebSocket listener ────────────────────────────────────────────────
  useEffect(() => {
    if (wsMessages.length <= lastWsMsgCountRef.current) return;

    for (let i = lastWsMsgCountRef.current; i < wsMessages.length; i++) {
      const envelope = wsMessages[i];
      if (!envelope) continue;

      if (envelope.type === "live-state-changed") {
        const data = envelope.data as {
          liveStates?: LiveCharacterState[];
        } | undefined;

        if (Array.isArray(data?.liveStates)) {
          const map: Record<string, LiveCharacterState> = {};
          for (const s of data.liveStates) {
            map[s.character_id] = s;
          }
          setAllLiveStates(map);
        }
      }
    }

    lastWsMsgCountRef.current = wsMessages.length;
  }, [wsMessages]);

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
