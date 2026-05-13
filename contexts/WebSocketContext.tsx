import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useUser } from "./UserContext";
import { useGameSession } from "./GameSessionContext";

type Handler<T = unknown> = (data: T) => void;
type SubscriberSet = Set<Handler<unknown>>;

interface OutgoingChatMessagePayload {
  content: string;
  messageId: string;
  characterId?: string | null;
  characterName?: string | null;
  messageType?: string;
  diceRoll?: unknown;
  createdAt?: string;
}

interface WebSocketAPI {
  connected: boolean;
  connectionAttempts: number;
  typingUsers: string[];
  presenceUsers: string[];
  subscribe: <T = unknown>(eventType: string, handler: Handler<T>) => () => void;
  sendChatMessage: (payload: OutgoingChatMessagePayload) => void;
  startTyping: () => void;
  stopTyping: () => void;
  updateCombat: (encounterId: string, update: unknown) => void;
  updateCharacter: (characterId: string, update: unknown) => void;
  updateSession: (sessionId: string, update: unknown) => void;
  updatePresence: (status: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;

const WebSocketContext = createContext<WebSocketAPI | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { user, authToken } = useUser();
  const { activeCampaignId } = useGameSession();

  const socketRef = useRef<Socket | null>(null);
  const subscribersRef = useRef<Map<string, SubscriberSet>>(new Map());
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<string[]>([]);

  const subscribe = useCallback(
    <T,>(eventType: string, handler: Handler<T>) => {
      let set = subscribersRef.current.get(eventType);
      if (!set) {
        set = new Set();
        subscribersRef.current.set(eventType, set);
      }
      set.add(handler as Handler<unknown>);
      return () => {
        const current = subscribersRef.current.get(eventType);
        current?.delete(handler as Handler<unknown>);
      };
    },
    [],
  );

  const dispatchEvent = useCallback((eventType: string, data: unknown) => {
    const handlers = subscribersRef.current.get(eventType);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[WebSocket] subscriber threw for ${eventType}:`, err);
      }
    }
  }, []);

  // ── Connection lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (!user || !activeCampaignId) {
      return;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    console.log("[WebSocket] Connecting", { campaignId: activeCampaignId });

    const socket = io({
      auth: {
        token: authToken || user.id,
        userId: user.id,
        username: user.username || user.email,
      },
      transports: ["polling", "websocket"],
      upgrade: true,
      withCredentials: true,
    });

    socketRef.current = socket;

    const scheduleReconnect = () => {
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("[WebSocket] Max reconnection attempts reached");
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, attemptsRef.current), 30000);
      console.log(
        `[WebSocket] Reconnecting in ${delay}ms (attempt ${attemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`,
      );
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      retryTimeoutRef.current = setTimeout(() => {
        attemptsRef.current += 1;
        setConnectionAttempts(attemptsRef.current);
        socket.connect();
      }, delay);
    };

    socket.on("connect", () => {
      console.log("[WebSocket] Connected");
      setConnected(true);
      attemptsRef.current = 0;
      setConnectionAttempts(0);
      socket.emit("join-campaign", activeCampaignId);
    });

    socket.on("disconnect", () => {
      console.log("[WebSocket] Disconnected");
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      setConnected(false);
      scheduleReconnect();
    });

    socket.on("error", (error) => {
      console.error("[WebSocket] Server error:", error);
    });

    // Track presence + typing state at the provider so consumers don't each
    // re-derive it from the event stream.
    socket.on("user-joined", (data: { userId: string; username: string }) => {
      setPresenceUsers((prev) => [
        ...prev.filter((u) => u !== data.username),
        data.username,
      ]);
    });

    socket.on("user-left", (data: { userId: string; username: string }) => {
      setPresenceUsers((prev) => prev.filter((u) => u !== data.username));
      setTypingUsers((prev) => prev.filter((u) => u !== data.username));
    });

    socket.on("user-typing", (data: { username: string }) => {
      setTypingUsers((prev) => [
        ...prev.filter((u) => u !== data.username),
        data.username,
      ]);
    });

    socket.on("user-stopped-typing", (data: { username: string }) => {
      setTypingUsers((prev) => prev.filter((u) => u !== data.username));
    });

    // Fan out every other event to subscribers. We deliberately exclude the
    // socket.io lifecycle events handled above ("connect", "disconnect",
    // "connect_error", "error", "user-joined", "user-left", "user-typing",
    // "user-stopped-typing").
    const SKIP = new Set([
      "connect",
      "disconnect",
      "connect_error",
      "error",
      "user-joined",
      "user-left",
      "user-typing",
      "user-stopped-typing",
    ]);
    socket.onAny((eventType: string, ...args: unknown[]) => {
      if (SKIP.has(eventType)) return;
      dispatchEvent(eventType, args[0]);
    });

    return () => {
      console.log("[WebSocket] Tearing down", { campaignId: activeCampaignId });
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      socket.emit("leave-campaign", activeCampaignId);
      socket.disconnect();
      socketRef.current = null;
      attemptsRef.current = 0;
      setConnectionAttempts(0);
      setConnected(false);
      setTypingUsers([]);
      setPresenceUsers([]);
    };
  }, [user, authToken, activeCampaignId, dispatchEvent]);

  const sendChatMessage = useCallback(
    (payload: OutgoingChatMessagePayload) => {
      const socket = socketRef.current;
      if (!socket || !connected || !activeCampaignId) {
        console.warn("[WebSocket] Cannot send chat message — not connected");
        return;
      }
      socket.emit("chat-message", {
        campaignId: activeCampaignId,
        message: payload,
      });
    },
    [activeCampaignId, connected],
  );

  const startTyping = useCallback(() => {
    const socket = socketRef.current;
    if (socket && connected && activeCampaignId) {
      socket.emit("typing-start", activeCampaignId);
    }
  }, [activeCampaignId, connected]);

  const stopTyping = useCallback(() => {
    const socket = socketRef.current;
    if (socket && connected && activeCampaignId) {
      socket.emit("typing-stop", activeCampaignId);
    }
  }, [activeCampaignId, connected]);

  const updateCombat = useCallback(
    (encounterId: string, update: unknown) => {
      const socket = socketRef.current;
      if (socket && connected && activeCampaignId) {
        socket.emit("combat-update", {
          campaignId: activeCampaignId,
          encounterId,
          update,
        });
      }
    },
    [activeCampaignId, connected],
  );

  const updateCharacter = useCallback(
    (characterId: string, update: unknown) => {
      const socket = socketRef.current;
      if (socket && connected && activeCampaignId) {
        socket.emit("character-update", {
          campaignId: activeCampaignId,
          characterId,
          update,
        });
      }
    },
    [activeCampaignId, connected],
  );

  const updateSession = useCallback(
    (sessionId: string, update: unknown) => {
      const socket = socketRef.current;
      if (socket && connected && activeCampaignId) {
        socket.emit("session-update", {
          campaignId: activeCampaignId,
          sessionId,
          update,
        });
      }
    },
    [activeCampaignId, connected],
  );

  const updatePresence = useCallback(
    (status: string) => {
      const socket = socketRef.current;
      if (socket && connected) {
        socket.emit("update-presence", status);
      }
    },
    [connected],
  );

  const value = useMemo<WebSocketAPI>(
    () => ({
      connected,
      connectionAttempts,
      typingUsers,
      presenceUsers,
      subscribe,
      sendChatMessage,
      startTyping,
      stopTyping,
      updateCombat,
      updateCharacter,
      updateSession,
      updatePresence,
    }),
    [
      connected,
      connectionAttempts,
      typingUsers,
      presenceUsers,
      subscribe,
      sendChatMessage,
      startTyping,
      stopTyping,
      updateCombat,
      updateCharacter,
      updateSession,
      updatePresence,
    ],
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketAPI {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used inside <WebSocketProvider>");
  }
  return ctx;
}

// Ergonomic event subscription. Captures the latest handler in a ref so the
// caller can pass closures that read fresh state without triggering
// resubscription on every render.
export function useWsEvent<T = unknown>(
  eventType: string,
  handler: (data: T) => void,
): void {
  const { subscribe } = useWebSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return subscribe<T>(eventType, (data) => handlerRef.current(data));
  }, [subscribe, eventType]);
}
