import { Server } from 'socket.io';
import {
  logInfo,
  logWarn,
  logError,
} from './utils/logger.js';

export const REALTIME_EVENTS = {
  spawnUpdated: 'spawn-updated',
  spawnDeleted: 'spawn-deleted',
  objectiveCreated: 'objective-created',
  objectiveUpdated: 'objective-updated',
  objectiveDeleted: 'objective-deleted',
  sessionFocusUpdated: 'session-focus-updated',
  sessionContextUpdated: 'session-context-updated',
  unplannedEncounterCreated: 'unplanned-encounter-created',
  npcSentimentAdjusted: 'npc-sentiment-adjusted',
  npcTeleported: 'npc-teleported',
};

const CAMPAIGN_ROOM_PREFIX = 'campaign-';

class WebSocketServer {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();

    logInfo('WebSocket server initialized', {
      transports: Array.isArray(this.io.engine.opts?.transports)
        ? this.io.engine.opts.transports
        : undefined,
    });
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          logWarn('WebSocket authentication rejected: missing token');
          return next(new Error('Authentication token required'));
        }

        // For development, we'll use a simple user ID validation
        // In production, you would verify JWT tokens here
        const user = { id: socket.handshake.auth.userId, username: socket.handshake.auth.username };
        socket.user = user;
        next();
      } catch (err) {
        logWarn('WebSocket authentication failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        next(new Error('Authentication failed'));
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logInfo('WebSocket client connected', {
        userId: socket.user.id,
        username: socket.user.username,
      });
      
      // Handle joining campaign rooms
      socket.on('join-campaign', (campaignId) => {
        socket.join(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`);
        socket.campaignId = campaignId;
        logInfo('WebSocket campaign joined', {
          campaignId,
          userId: socket.user.id,
        });
        
        // Notify other users in the campaign
        socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-joined', {
          userId: socket.user.id,
          username: socket.user.username,
          timestamp: new Date().toISOString()
        });
      });

      // Handle leaving campaign rooms
      socket.on('leave-campaign', (campaignId) => {
        socket.leave(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`);
        logInfo('WebSocket campaign left', {
          campaignId,
          userId: socket.user.id,
        });
        
        // Notify other users in the campaign
        socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-left', {
          userId: socket.user.id,
          username: socket.user.username,
          timestamp: new Date().toISOString()
        });
      });

      // Handle chat messages
      socket.on('chat-message', (payload) => {
        try {
          const { campaignId } = payload;
          if (!campaignId) {
            throw new Error('Campaign ID missing for chat message');
          }

          const incoming = payload?.message || {};
          const now = new Date().toISOString();

          const messageData = {
            type: 'new_message',
            data: {
              id: incoming.messageId || incoming.id || Date.now().toString(),
              campaign_id: campaignId,
              content: incoming.content || incoming.message || '',
              message_type: incoming.messageType || 'text',
              sender_id: incoming.senderId || socket.user.id,
              sender_name: incoming.senderName || socket.user.username,
              username: incoming.username || incoming.senderName || socket.user.username,
              character_id: incoming.characterId ?? null,
              character_name: incoming.characterName || incoming.character_name || null,
              dice_roll: incoming.diceRoll ?? null,
              created_at: incoming.createdAt || now,
            }
          };

          this.io.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('new-message', messageData);
          logInfo('WebSocket chat message broadcast', {
            campaignId,
            messageId: messageData.data.id,
            messageType: messageData.data.message_type,
            senderId: messageData.data.sender_id,
          });
        } catch (error) {
          logError('WebSocket chat broadcast failed', error, {
            campaignId: payload?.campaignId,
            userId: socket.user.id,
          });
          socket.emit('error', { type: 'chat-error', message: 'Failed to send message' });
        }
      });

      // Handle typing indicators
      socket.on('typing-start', (campaignId) => {
        socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-typing', {
          userId: socket.user.id,
          username: socket.user.username
        });
      });

      socket.on('typing-stop', (campaignId) => {
        socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-stopped-typing', {
          userId: socket.user.id,
          username: socket.user.username
        });
      });

      // Handle combat updates
      socket.on('combat-update', (data) => {
        try {
          const { campaignId, encounterId, update } = data;
          
          // Broadcast combat state to all campaign participants
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('combat-state-update', {
            encounterId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          logInfo('WebSocket combat update emitted', {
            campaignId,
            encounterId,
            userId: socket.user.id,
          });
        } catch (error) {
          logError('WebSocket combat update failed', error, {
            campaignId: data?.campaignId,
            userId: socket.user.id,
          });
          socket.emit('error', { type: 'combat-error', message: 'Failed to update combat state' });
        }
      });

      // Handle character updates
      socket.on('character-update', (data) => {
        try {
          const { campaignId, characterId, update } = data;
          
          // Broadcast character changes to campaign participants
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('character-changed', {
            characterId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          logInfo('WebSocket character update emitted', {
            campaignId,
            characterId,
            userId: socket.user.id,
          });
        } catch (error) {
          logError('WebSocket character update failed', error, {
            campaignId: data?.campaignId,
            userId: socket.user.id,
          });
          socket.emit('error', { type: 'character-error', message: 'Failed to update character' });
        }
      });

      // Handle session updates
      socket.on('session-update', (data) => {
        try {
          const { campaignId, sessionId, update } = data;
          
          // Broadcast session changes to campaign participants
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('session-changed', {
            sessionId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          logInfo('WebSocket session update emitted', {
            campaignId,
            sessionId,
            userId: socket.user.id,
          });
        } catch (error) {
          logError('WebSocket session update failed', error, {
            campaignId: data?.campaignId,
            userId: socket.user.id,
          });
          socket.emit('error', { type: 'session-error', message: 'Failed to update session' });
        }
      });

      // Handle user presence
      socket.on('update-presence', (status) => {
        if (socket.campaignId) {
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${socket.campaignId}`).emit('presence-update', {
            userId: socket.user.id,
            username: socket.user.username,
            status,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logInfo('WebSocket client disconnected', {
          userId: socket.user.id,
          username: socket.user.username,
          campaignId: socket.campaignId,
        });
        
        if (socket.campaignId) {
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${socket.campaignId}`).emit('user-left', {
            userId: socket.user.id,
            username: socket.user.username,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Health check
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });
    });
  }

  // Utility method to broadcast to a specific campaign
  broadcastToCampaign(campaignId, event, data, logContext) {
    if (!campaignId) {
      logWarn('Attempted to broadcast without campaignId', { event });
      return;
    }

    this.io.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit(event, data);

    if (logContext) {
      const payloadShape = data && typeof data === 'object'
        ? Array.isArray(data)
          ? 'array'
          : Object.keys(data)
        : typeof data;

      logInfo('Realtime campaign event emitted', {
        event,
        campaignId,
        payloadShape,
        ...logContext,
      });
    }
  }

  emitSpawnUpdated(campaignId, spawn, { action = 'updated', actorId } = {}) {
    const payload = {
      action,
      spawn,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.spawnUpdated, payload, {
      category: 'spawn',
      action,
      actorId: actorId ?? null,
      spawnId: spawn?.id ?? null,
    });
  }

  emitObjectiveCreated(campaignId, objective, { actorId } = {}) {
    const payload = {
      objective,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.objectiveCreated, payload, {
      category: 'objective',
      action: 'created',
      actorId: actorId ?? null,
      objectiveId: objective?.id ?? null,
    });
  }

  emitObjectiveUpdated(campaignId, objective, { actorId } = {}) {
    const payload = {
      objective,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.objectiveUpdated, payload, {
      category: 'objective',
      action: 'updated',
      actorId: actorId ?? null,
      objectiveId: objective?.id ?? null,
    });
  }

  emitObjectiveDeleted(campaignId, deletedObjectiveIds, { actorId } = {}) {
    const normalizedIds = Array.isArray(deletedObjectiveIds)
      ? deletedObjectiveIds.filter(Boolean)
      : [];
    const payload = {
      deletedObjectiveIds: normalizedIds,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.objectiveDeleted, payload, {
      category: 'objective',
      action: 'deleted',
      actorId: actorId ?? null,
      count: normalizedIds.length,
    });
  }

  emitSessionFocusUpdated(campaignId, { sessionId, dmFocus, updatedAt, actorId }) {
    const payload = {
      sessionId,
      dmFocus: dmFocus ?? null,
      actorId: actorId ?? null,
      updatedAt: updatedAt ?? new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.sessionFocusUpdated, payload, {
      category: 'sidebar',
      event: 'session-focus',
      actorId: actorId ?? null,
      sessionId,
      hasFocus: Boolean(dmFocus),
    });
  }

  emitSessionContextUpdated(campaignId, { sessionId, mode, hasContext, contextLength, actorId, updatedAt }) {
    const payload = {
      sessionId,
      mode,
      hasContext: Boolean(hasContext),
      contextLength: typeof contextLength === 'number' ? contextLength : undefined,
      actorId: actorId ?? null,
      updatedAt: updatedAt ?? new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.sessionContextUpdated, payload, {
      category: 'sidebar',
      event: 'session-context',
      actorId: actorId ?? null,
      sessionId,
      mode,
      hasContext: Boolean(hasContext),
    });
  }

  emitUnplannedEncounterCreated(campaignId, encounter, { actorId } = {}) {
    const payload = {
      encounter,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.unplannedEncounterCreated, payload, {
      category: 'sidebar',
      event: 'unplanned-encounter',
      actorId: actorId ?? null,
      encounterId: encounter?.id ?? null,
      sessionId: encounter?.session_id ?? null,
    });
  }

  emitNpcSentimentAdjusted(campaignId, memory, { actorId } = {}) {
    const payload = {
      memory,
      actorId: actorId ?? null,
      emittedAt: new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.npcSentimentAdjusted, payload, {
      category: 'sidebar',
      event: 'npc-sentiment',
      actorId: actorId ?? null,
      npcId: memory?.npc_id ?? null,
      memoryId: memory?.id ?? null,
    });
  }

  emitNpcTeleported(campaignId, npc, { actorId, mode } = {}) {
    const payload = {
      npc,
      actorId: actorId ?? null,
      mode: mode ?? null,
      emittedAt: new Date().toISOString(),
    };

    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.npcTeleported, payload, {
      category: 'sidebar',
      event: 'npc-teleport',
      actorId: actorId ?? null,
      npcId: npc?.npcId ?? npc?.id ?? null,
      mode: mode ?? null,
    });
  }

  // Get connected users in a campaign
  getCampaignUsers(campaignId) {
    const room = this.io.sockets.adapter.rooms.get(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`);
    return room ? Array.from(room) : [];
  }

  // Health check method
  getStatus() {
    return {
      connected: this.io.sockets.sockets.size,
      rooms: Array.from(this.io.sockets.adapter.rooms.keys()),
      uptime: process.uptime()
    };
  }
}

export default WebSocketServer;
