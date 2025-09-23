import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUser } from "../contexts/UserContext";
import { getApiBaseUrl } from "../utils/api-client";

interface SocketEnvelope<T = unknown> {
  type: string;
  data?: T;
}

interface OutgoingChatMessagePayload {
  content: string;
  messageId: string;
  senderId: string;
  senderName: string;
  characterId?: string | null;
  characterName?: string | null | undefined;
  messageType?: string;
  diceRoll?: unknown;
  createdAt?: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;

export const useWebSocket = (campaignId: string) => {
  const { user, authToken } = useUser();

  const socketRef = useRef<Socket | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const baseUrlRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<SocketEnvelope[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<string[]>([]);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      if (campaignId) {
        socketRef.current.emit('leave-campaign', campaignId);
      }
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    attemptsRef.current = 0;
    setConnectionAttempts(0);
    setConnected(false);
    setTypingUsers([]);
    setPresenceUsers([]);
    setMessages([]);
  }, [campaignId]);

  const scheduleReconnect = useCallback(() => {
    if (!socketRef.current) {
      return;
    }

    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[Socket.io] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attemptsRef.current), 30000);
    console.log(`[Socket.io] Reconnecting in ${delay}ms (attempt ${attemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    retryTimeoutRef.current = setTimeout(() => {
      attemptsRef.current += 1;
      setConnectionAttempts(attemptsRef.current);
      socketRef.current?.connect();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!campaignId || !user) {
      return;
    }

    if (!baseUrlRef.current) {
      try {
        baseUrlRef.current = getApiBaseUrl();
      } catch (error) {
        console.error('[Socket.io] Unable to resolve API base URL', error);
        return;
      }
    }

    if (socketRef.current?.connected) {
      return;
    }

    console.log('[Socket.io] Attempting to connect to campaign:', campaignId);

    socketRef.current = io(baseUrlRef.current!, {
      auth: {
        token: authToken || user.id,
        userId: user.id,
        username: user.username || user.email,
      },
      transports: ['websocket'],
      withCredentials: true,
      forceNew: true,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('[Socket.io] Connected to server');
      setConnected(true);
      attemptsRef.current = 0;
      setConnectionAttempts(0);
      socket.emit('join-campaign', campaignId);
    });

    socket.on('disconnect', () => {
      console.log('[Socket.io] Disconnected from server');
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket.io] Connection error:', error);
      setConnected(false);
      scheduleReconnect();
    });

    socket.on('new-message', (payload) => {
      const envelope: SocketEnvelope = payload?.type
        ? payload
        : { type: 'new_message', data: payload };

      console.log('[Socket.io] Received new message:', envelope);
      setMessages((prev) => [...prev, envelope]);
    });

    socket.on('user-joined', (data: { userId: string; username: string }) => {
      setPresenceUsers((prev) => [...prev.filter((u) => u !== data.username), data.username]);
    });

    socket.on('user-left', (data: { userId: string; username: string }) => {
      setPresenceUsers((prev) => prev.filter((u) => u !== data.username));
      setTypingUsers((prev) => prev.filter((u) => u !== data.username));
    });

    socket.on('user-typing', (data: { username: string }) => {
      setTypingUsers((prev) => [...prev.filter((u) => u !== data.username), data.username]);
    });

    socket.on('user-stopped-typing', (data: { username: string }) => {
      setTypingUsers((prev) => prev.filter((u) => u !== data.username));
    });

    socket.on('combat-state-update', (data) => {
      setMessages((prev) => [...prev, { type: 'combat-update', data }]);
    });

    socket.on('character-changed', (data) => {
      setMessages((prev) => [...prev, { type: 'character-update', data }]);
    });

    socket.on('session-changed', (data) => {
      setMessages((prev) => [...prev, { type: 'session-update', data }]);
    });

    socket.on('presence-update', (data: { username: string; status: string }) => {
      console.log('[Socket.io] Presence update:', data);
    });

    socket.on('player-moved', (data) => {
      setMessages((prev) => [...prev, { type: 'player-moved', data }]);
    });

    socket.on('player-teleported', (data) => {
      setMessages((prev) => [...prev, { type: 'player-teleported', data }]);
    });

    socket.on('spawn-updated', (data) => {
      setMessages((prev) => [...prev, { type: 'spawn-updated', data }]);
    });

    socket.on('spawn-deleted', (data) => {
      setMessages((prev) => [...prev, { type: 'spawn-deleted', data }]);
    });

    socket.on('objective-created', (data) => {
      setMessages((prev) => [...prev, { type: 'objective-created', data }]);
    });

    socket.on('objective-updated', (data) => {
      setMessages((prev) => [...prev, { type: 'objective-updated', data }]);
    });

    socket.on('objective-deleted', (data) => {
      setMessages((prev) => [...prev, { type: 'objective-deleted', data }]);
    });

    socket.on('session-focus-updated', (data) => {
      setMessages((prev) => [...prev, { type: 'session-focus-updated', data }]);
    });

    socket.on('session-context-updated', (data) => {
      setMessages((prev) => [...prev, { type: 'session-context-updated', data }]);
    });

    socket.on('unplanned-encounter-created', (data) => {
      setMessages((prev) => [...prev, { type: 'unplanned-encounter-created', data }]);
    });

    socket.on('npc-sentiment-adjusted', (data) => {
      setMessages((prev) => [...prev, { type: 'npc-sentiment-adjusted', data }]);
    });

    socket.on('npc-teleported', (data) => {
      setMessages((prev) => [...prev, { type: 'npc-teleported', data }]);
    });

    socket.on('error', (error) => {
      console.error('[Socket.io] Server error:', error);
    });
  }, [authToken, campaignId, scheduleReconnect, user]);

  useEffect(() => {
    connect();

    return () => {
      cleanupSocket();
    };
  }, [cleanupSocket, connect]);

  const sendChatMessage = useCallback((payload: OutgoingChatMessagePayload) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('chat-message', {
        campaignId,
        message: payload,
      });
    } else {
      console.warn('[Socket.io] Cannot send message - not connected');
    }
  }, [campaignId, connected]);

  const startTyping = useCallback(() => {
    if (socketRef.current && connected) {
      socketRef.current.emit('typing-start', campaignId);
    }
  }, [campaignId, connected]);

  const stopTyping = useCallback(() => {
    if (socketRef.current && connected) {
      socketRef.current.emit('typing-stop', campaignId);
    }
  }, [campaignId, connected]);

  const updateCombat = useCallback((encounterId: string, update: unknown) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('combat-update', {
        campaignId,
        encounterId,
        update,
      });
    }
  }, [campaignId, connected]);

  const updateCharacter = useCallback((characterId: string, update: unknown) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('character-update', {
        campaignId,
        characterId,
        update,
      });
    }
  }, [campaignId, connected]);

  const updateSession = useCallback((sessionId: string, update: unknown) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('session-update', {
        campaignId,
        sessionId,
        update,
      });
    }
  }, [campaignId, connected]);

  const updatePresence = useCallback((status: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('update-presence', status);
    }
  }, [connected]);

  const getMessagesByType = useCallback((messageType: string) => {
    return messages.filter((message) => message.type === messageType);
  }, [messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const ping = useCallback(() => {
    if (socketRef.current && connected) {
      const startTime = Date.now();
      socketRef.current.emit('ping');
      socketRef.current.once('pong', () => {
        const latency = Date.now() - startTime;
        console.log(`[Socket.io] Latency: ${latency}ms`);
      });
    }
  }, [connected]);

  return {
    connected,
    messages,
    typingUsers,
    presenceUsers,
    connectionAttempts,
    sendChatMessage,
    startTyping,
    stopTyping,
    updateCombat,
    updateCharacter,
    updateSession,
    updatePresence,
    getMessagesByType,
    clearMessages,
    ping,
  };
};
