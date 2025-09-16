import { useEffect, useRef, useState, useContext, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUser } from "../contexts/UserContext";

interface WebSocketMessage {
  id?: string;
  userId?: string;
  username?: string;
  characterId?: string;
  message?: string;
  content?: string;
  timestamp?: string;
  campaignId?: string;
  type: string;
  data?: any;
}

export const useWebSocket = (campaignId: string) => {
  const { user } = useUser();
  const socket = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<string[]>([]);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const connect = useCallback(() => {
    if (!campaignId || !user) return;

    console.log('[Socket.io] Attempting to connect to campaign:', campaignId);
    
    socket.current = io('http://localhost:3001', {
      auth: {
        token: user.id,
        userId: user.id,
        username: user.username || user.email
      },
      forceNew: true
    });

    socket.current.on('connect', () => {
      console.log('[Socket.io] Connected to server');
      setConnected(true);
      setConnectionAttempts(0);
      
      // Join the campaign room
      socket.current?.emit('join-campaign', campaignId);
    });

    socket.current.on('disconnect', () => {
      console.log('[Socket.io] Disconnected from server');
      setConnected(false);
    });

    socket.current.on('connect_error', (error) => {
      console.error('[Socket.io] Connection error:', error);
      setConnected(false);
      
      // Implement exponential backoff reconnection
      if (connectionAttempts < 5) {
        const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
        console.log(`[Socket.io] Reconnecting in ${delay}ms (attempt ${connectionAttempts + 1}/5)`);
        
        setTimeout(() => {
          setConnectionAttempts(prev => prev + 1);
          socket.current?.connect();
        }, delay);
      }
    });

    // Handle new chat messages
    socket.current.on('new-message', (messageData: WebSocketMessage) => {
      console.log('[Socket.io] Received new message:', messageData);
      setMessages(prev => [...prev, messageData]);
    });

    // Handle user joined/left events
    socket.current.on('user-joined', (data: { userId: string; username: string }) => {
      console.log('[Socket.io] User joined:', data.username);
      setPresenceUsers(prev => [...prev.filter(u => u !== data.username), data.username]);
    });

    socket.current.on('user-left', (data: { userId: string; username: string }) => {
      console.log('[Socket.io] User left:', data.username);
      setPresenceUsers(prev => prev.filter(u => u !== data.username));
      setTypingUsers(prev => prev.filter(u => u !== data.username));
    });

    // Handle typing indicators
    socket.current.on('user-typing', (data: { username: string }) => {
      setTypingUsers(prev => [...prev.filter(u => u !== data.username), data.username]);
    });

    socket.current.on('user-stopped-typing', (data: { username: string }) => {
      setTypingUsers(prev => prev.filter(u => u !== data.username));
    });

    // Handle combat updates
    socket.current.on('combat-state-update', (data) => {
      console.log('[Socket.io] Combat state update:', data);
      setMessages(prev => [...prev, { type: 'combat-update', data }]);
    });

    // Handle character updates
    socket.current.on('character-changed', (data) => {
      console.log('[Socket.io] Character update:', data);
      setMessages(prev => [...prev, { type: 'character-update', data }]);
    });

    // Handle session updates
    socket.current.on('session-changed', (data) => {
      console.log('[Socket.io] Session update:', data);
      setMessages(prev => [...prev, { type: 'session-update', data }]);
    });

    // Handle presence updates
    socket.current.on('presence-update', (data: { username: string; status: string }) => {
      console.log('[Socket.io] Presence update:', data);
    });

    // Handle errors
    socket.current.on('error', (error) => {
      console.error('[Socket.io] Server error:', error);
    });

  }, [campaignId, user, connectionAttempts]);

  useEffect(() => {
    connect();

    return () => {
      if (socket.current) {
        console.log('[Socket.io] Disconnecting...');
        socket.current.emit('leave-campaign', campaignId);
        socket.current.disconnect();
      }
    };
  }, [connect, campaignId]);

  const sendChatMessage = useCallback((
    message: string, 
    characterId?: string
  ) => {
    if (socket.current && connected) {
      console.log('[Socket.io] Sending chat message');
      socket.current.emit('chat-message', {
        campaignId,
        message,
        characterId
      });
    } else {
      console.warn('[Socket.io] Cannot send message - not connected');
    }
  }, [connected, campaignId]);

  const startTyping = useCallback(() => {
    if (socket.current && connected) {
      socket.current.emit('typing-start', campaignId);
    }
  }, [connected, campaignId]);

  const stopTyping = useCallback(() => {
    if (socket.current && connected) {
      socket.current.emit('typing-stop', campaignId);
    }
  }, [connected, campaignId]);

  const updateCombat = useCallback((
    encounterId: string, 
    update: any
  ) => {
    if (socket.current && connected) {
      console.log('[Socket.io] Sending combat update');
      socket.current.emit('combat-update', {
        campaignId,
        encounterId,
        update
      });
    }
  }, [connected, campaignId]);

  const updateCharacter = useCallback((characterId: string, update: any) => {
    if (socket.current && connected) {
      console.log('[Socket.io] Sending character update');
      socket.current.emit('character-update', {
        campaignId,
        characterId,
        update
      });
    }
  }, [connected, campaignId]);

  const updateSession = useCallback((sessionId: string, update: any) => {
    if (socket.current && connected) {
      console.log('[Socket.io] Sending session update');
      socket.current.emit('session-update', {
        campaignId,
        sessionId,
        update
      });
    }
  }, [connected, campaignId]);

  const updatePresence = useCallback((status: string) => {
    if (socket.current && connected) {
      socket.current.emit('update-presence', status);
    }
  }, [connected]);

  // Get messages by type
  const getMessagesByType = useCallback((messageType: string) => {
    return messages.filter(m => m.type === messageType);
  }, [messages]);

  // Clear messages (useful for cleanup)
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Ping server for latency check
  const ping = useCallback(() => {
    if (socket.current && connected) {
      const startTime = Date.now();
      socket.current.emit('ping');
      
      socket.current.once('pong', () => {
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
    ping
  };
};
