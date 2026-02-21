import { Server } from 'socket.io';
import {
  logInfo,
  logWarn,
  logError,
} from './utils/logger.js';
import { verifyToken } from './auth-middleware.js';
import { getClient } from './db/pool.js';

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
  gamePhaseChanged: 'game-phase-changed',
  turnAdvanced: 'turn-advanced',
  worldTurnCompleted: 'world-turn-completed',
  turnOrderChanged: 'turn-order-changed',
  dmNarration: 'dm-narration',
  rollRequested: 'roll-requested',
  actionCompleted: 'action-completed',
  liveStateChanged: 'live-state-changed',
  regionTriggered: 'region-triggered',
  worldTurnNarration: 'world-turn-narration',
  // WS4: Combat events
  enemyTurnStarted: 'enemy-turn-started',
  enemyTurnCompleted: 'enemy-turn-completed',
  combatEnded: 'combat-ended',
  combatBudgetChanged: 'combat-budget-changed',
  concentrationCheck: 'concentration-check',
  // WS5: Rest events
  restStarted: 'rest-started',
  hitDiceSpent: 'hit-dice-spent',
  restCompleted: 'rest-completed',
  // WS6: Death save & levelling events
  deathSaveRolled: 'death-save-rolled',
  characterDied: 'character-died',
  characterStabilized: 'character-stabilized',
  levelUpAvailable: 'level-up-available',
};

const CAMPAIGN_ROOM_PREFIX = 'campaign-';

class WebSocketServer {
  constructor(server) {
    const clientOrigin = process.env.CLIENT_URL || process.env.FRONTEND_URL;

    this.io = new Server(server, {
      cors: {
        origin: clientOrigin || true,
        methods: ["GET", "POST"],
        allowedHeaders: ['Authorization'],
        credentials: Boolean(clientOrigin)
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
    // Authentication middleware - verify JWT token on handshake
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          logWarn('WebSocket authentication rejected: missing token');
          return next(new Error('Authentication token required'));
        }

        const decoded = verifyToken(token);
        socket.user = {
          id: decoded.userId,
          username: decoded.username ?? socket.handshake.auth.username ?? 'unknown',
        };
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

      // Handle chat messages (channel-aware)
      socket.on('chat-message', async (payload) => {
        try {
          const { campaignId } = payload;
          if (!campaignId) {
            throw new Error('Campaign ID missing for chat message');
          }

          const incoming = payload?.message || {};
          const now = new Date().toISOString();

          // Resolve character_name from DB to prevent spoofing
          const characterId = incoming.characterId ?? null;
          let characterName = null;
          if (characterId) {
            const client = await getClient({ label: 'ws-character-name' });
            try {
              const { rows } = await client.query('SELECT name FROM characters WHERE id = $1', [characterId]);
              characterName = rows[0]?.name ?? null;
            } finally {
              client.release();
            }
          }

          const channelType = incoming.channelType ?? 'party';
          const channelTargetUserId = incoming.channelTargetUserId ?? null;

          const messageData = {
            type: 'new_message',
            data: {
              id: incoming.messageId || incoming.id || Date.now().toString(),
              campaign_id: campaignId,
              content: incoming.content || incoming.message || '',
              message_type: incoming.messageType || 'text',
              sender_id: socket.user.id,
              sender_name: socket.user.username,
              username: socket.user.username,
              character_id: characterId,
              character_name: characterName,
              dice_roll: incoming.diceRoll ?? null,
              channel_type: channelType,
              channel_target_user_id: channelTargetUserId,
              created_at: incoming.createdAt || now,
            }
          };

          // Channel-aware delivery
          if (channelType === 'private' || channelType === 'dm_whisper') {
            // Only emit to sender + target
            this.emitToUser(campaignId, socket.user.id, 'new-message', messageData);
            if (channelTargetUserId && channelTargetUserId !== socket.user.id) {
              this.emitToUser(campaignId, channelTargetUserId, 'new-message', messageData);
            }
          } else {
            // party / dm_broadcast → broadcast to whole campaign room
            this.io.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('new-message', messageData);
          }

          logInfo('WebSocket chat message broadcast', {
            campaignId,
            messageId: messageData.data.id,
            messageType: messageData.data.message_type,
            senderId: messageData.data.sender_id,
            channelType,
          });
        } catch (error) {
          logError('WebSocket chat broadcast failed', error, {
            campaignId: payload?.campaignId,
            userId: socket.user.id,
          });
          socket.emit('error', { type: 'chat-error', message: 'Failed to send message' });
        }
      });

      // Handle typing indicators (channel-aware)
      socket.on('typing-start', (campaignIdOrPayload) => {
        const campaignId = typeof campaignIdOrPayload === 'string'
          ? campaignIdOrPayload
          : campaignIdOrPayload?.campaignId;
        const targetUserId = typeof campaignIdOrPayload === 'object'
          ? campaignIdOrPayload?.targetUserId
          : null;

        if (targetUserId) {
          // Private typing: only tell the target
          this.emitToUser(campaignId, targetUserId, 'user-typing', {
            userId: socket.user.id,
            username: socket.user.username,
          });
        } else {
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-typing', {
            userId: socket.user.id,
            username: socket.user.username,
          });
        }
      });

      socket.on('typing-stop', (campaignIdOrPayload) => {
        const campaignId = typeof campaignIdOrPayload === 'string'
          ? campaignIdOrPayload
          : campaignIdOrPayload?.campaignId;
        const targetUserId = typeof campaignIdOrPayload === 'object'
          ? campaignIdOrPayload?.targetUserId
          : null;

        if (targetUserId) {
          this.emitToUser(campaignId, targetUserId, 'user-stopped-typing', {
            userId: socket.user.id,
            username: socket.user.username,
          });
        } else {
          socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-stopped-typing', {
            userId: socket.user.id,
            username: socket.user.username,
          });
        }
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

  // ── Game State Events ──────────────────────────────────────────────────

  emitGamePhaseChanged(campaignId, { sessionId, previousPhase, newPhase, gameState }) {
    const payload = {
      sessionId,
      previousPhase,
      newPhase,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.gamePhaseChanged, payload, {
      category: 'game-state',
      event: 'phase-changed',
      sessionId,
      previousPhase,
      newPhase,
    });
  }

  emitTurnAdvanced(campaignId, { sessionId, gameState }) {
    const payload = {
      sessionId,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.turnAdvanced, payload, {
      category: 'game-state',
      event: 'turn-advanced',
      sessionId,
      activePlayerId: gameState?.activePlayerId ?? null,
    });
  }

  emitWorldTurnCompleted(campaignId, { sessionId, gameState }) {
    const payload = {
      sessionId,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.worldTurnCompleted, payload, {
      category: 'game-state',
      event: 'world-turn-completed',
      sessionId,
    });
  }

  emitTurnOrderChanged(campaignId, { sessionId, gameState }) {
    const payload = {
      sessionId,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.turnOrderChanged, payload, {
      category: 'game-state',
      event: 'turn-order-changed',
      sessionId,
    });
  }

  // ── Action Processing Events (WS3) ─────────────────────────────────────

  emitDmNarration(campaignId, { actionId, narration, characterId, actionType }) {
    const payload = {
      actionId,
      narration,
      characterId: characterId ?? null,
      actionType: actionType ?? null,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.dmNarration, payload, {
      category: 'action',
      event: 'dm-narration',
      actionId,
    });
  }

  emitRollRequested(campaignId, targetUserId, { actionId, requiredRolls }) {
    const payload = {
      actionId,
      requiredRolls,
      emittedAt: new Date().toISOString(),
    };
    this.emitToUser(campaignId, targetUserId, REALTIME_EVENTS.rollRequested, payload);
    logInfo('Roll request sent to player', {
      event: 'roll-requested',
      campaignId,
      targetUserId,
      actionId,
    });
  }

  emitActionCompleted(campaignId, { actionId, characterId, actionType, outcome }) {
    const payload = {
      actionId,
      characterId,
      actionType,
      outcome,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.actionCompleted, payload, {
      category: 'action',
      event: 'action-completed',
      actionId,
    });
  }

  emitLiveStateChanged(campaignId, { sessionId, liveStates, reason }) {
    const payload = {
      sessionId,
      liveStates,
      reason: reason ?? null,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.liveStateChanged, payload, {
      category: 'live-state',
      event: 'live-state-changed',
      sessionId,
      count: Array.isArray(liveStates) ? liveStates.length : 0,
    });
  }

  emitRegionTriggered(campaignId, { playerId, region }) {
    const payload = {
      playerId,
      region,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.regionTriggered, payload, {
      category: 'region',
      event: 'region-triggered',
      regionId: region?.id ?? null,
      regionCategory: region?.category ?? null,
    });
  }

  emitWorldTurnNarration(campaignId, { sessionId, narration, stateChanges }) {
    const payload = {
      sessionId,
      narration,
      stateChanges: stateChanges ?? null,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.worldTurnNarration, payload, {
      category: 'game-state',
      event: 'world-turn-narration',
      sessionId,
    });
  }

  // ── WS4: Combat Events ────────────────────────────────────────────────

  emitEnemyTurnStarted(campaignId, { sessionId, participantId, gameState }) {
    const payload = {
      sessionId,
      participantId,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.enemyTurnStarted, payload, {
      category: 'combat',
      event: 'enemy-turn-started',
      sessionId,
      participantId,
    });
  }

  emitEnemyTurnCompleted(campaignId, { sessionId, participantId, enemyName, outcome }) {
    const payload = {
      sessionId,
      participantId,
      enemyName,
      outcome,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.enemyTurnCompleted, payload, {
      category: 'combat',
      event: 'enemy-turn-completed',
      sessionId,
      participantId,
    });
  }

  emitCombatEnded(campaignId, { sessionId, endCondition, xpAwarded, gameState }) {
    const payload = {
      sessionId,
      endCondition,
      xpAwarded,
      gameState,
      emittedAt: new Date().toISOString(),
    };
    this.broadcastToCampaign(campaignId, REALTIME_EVENTS.combatEnded, payload, {
      category: 'combat',
      event: 'combat-ended',
      sessionId,
      endCondition,
    });
  }

  emitCombatBudgetChanged(campaignId, targetUserId, { sessionId, combatTurnBudget }) {
    const payload = {
      sessionId,
      combatTurnBudget,
      emittedAt: new Date().toISOString(),
    };
    this.emitToUser(campaignId, targetUserId, REALTIME_EVENTS.combatBudgetChanged, payload);
  }

  emitConcentrationCheck(campaignId, targetUserId, { sessionId, characterId, rollRequest, concentration }) {
    const payload = {
      sessionId,
      characterId,
      rollRequest,
      concentration,
      emittedAt: new Date().toISOString(),
    };
    this.emitToUser(campaignId, targetUserId, REALTIME_EVENTS.concentrationCheck, payload);
  }

  // ── Channel-aware Messaging ─────────────────────────────────────────────

  /**
   * Send to a specific user within a campaign (for private/whisper messages).
   * Emits to all sockets in the campaign room that belong to `targetUserId`.
   */
  emitToUser(campaignId, targetUserId, event, data) {
    const roomName = `${CAMPAIGN_ROOM_PREFIX}${campaignId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    if (!room) return;

    for (const socketId of room) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.user?.id === targetUserId) {
        socket.emit(event, data);
      }
    }
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
