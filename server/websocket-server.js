import { Server } from 'socket.io';
import {
  logInfo,
  logWarn,
  logError,
} from './utils/logger.js';
import { verifyToken } from './auth-middleware.js';
import { getClient } from './db/pool.js';
import { stripHtmlTags } from './utils/sanitization.js';

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
  gameStateSnapshot: 'game-state-snapshot',
  rollRequested: 'roll-requested',
  actionCompleted: 'action-completed',
  liveStateChanged: 'live-state-changed',
  regionTriggered: 'region-triggered',
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
  // Shop events
  shopPurchase: 'shop-purchase',
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
        // Per-event authorisation cache. Populated by `join-campaign` once
        // membership has been verified against the database; consulted by
        // every handler that takes a campaignId.
        socket.campaignAccess = new Map();
        next();
      } catch (err) {
        logWarn('WebSocket authentication failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        next(new Error('Authentication failed'));
      }
    });
  }

  // Resolve the socket's relationship to a campaign and cache the result on
  // the socket. Returns the role ('dm' | 'player') or null if the user is
  // neither the DM nor an active player.
  async resolveCampaignRole(socket, campaignId) {
    if (!campaignId || typeof campaignId !== 'string') return null;
    if (socket.campaignAccess.has(campaignId)) {
      return socket.campaignAccess.get(campaignId);
    }
    const client = await getClient({ label: 'ws.resolveCampaignRole' });
    try {
      const { rows } = await client.query(
        `SELECT CASE
                  WHEN c.dm_user_id = $2 THEN 'dm'
                  WHEN cp.user_id IS NOT NULL THEN 'player'
                  ELSE NULL
                END AS role
           FROM campaigns c
           LEFT JOIN campaign_players cp
                  ON cp.campaign_id = c.id
                 AND cp.user_id = $2
                 AND cp.status = 'active'
          WHERE c.id = $1
          LIMIT 1`,
        [campaignId, socket.user.id],
      );
      const role = rows[0]?.role ?? null;
      socket.campaignAccess.set(campaignId, role);
      return role;
    } catch (error) {
      logError('WebSocket campaign role resolution failed', error, {
        campaignId,
        userId: socket.user.id,
      });
      return null;
    } finally {
      client.release();
    }
  }

  // Guard a callback that requires campaign membership. Reads campaignId from
  // either a string argument (legacy typing-start/stop signature) or the
  // .campaignId field of an object payload. Emits a 'error' to the client and
  // returns null when access is denied.
  async requireCampaignAccess(socket, payload, eventName) {
    const campaignId = typeof payload === 'string' ? payload : payload?.campaignId;
    if (!campaignId) {
      socket.emit('error', { type: `${eventName}-error`, message: 'campaignId required' });
      return null;
    }
    const role = await this.resolveCampaignRole(socket, campaignId);
    if (!role) {
      logWarn('WebSocket authorisation denied', {
        event: eventName,
        campaignId,
        userId: socket.user.id,
      });
      socket.emit('error', {
        type: `${eventName}-error`,
        message: 'You are not a participant in this campaign',
      });
      return null;
    }
    return { campaignId, role };
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logInfo('WebSocket client connected', {
        userId: socket.user.id,
        username: socket.user.username,
      });

      // join-campaign: verify membership against the DB BEFORE adding the
      // socket to the broadcast room. Without this, any JWT-holder (and
      // anyone can self-register via /api/auth/register) could subscribe to
      // any campaign's stream of DM-only objectives, combat state, npc
      // sentiment, etc.
      socket.on('join-campaign', async (campaignId) => {
        const access = await this.requireCampaignAccess(socket, campaignId, 'join-campaign');
        if (!access) return;

        socket.join(`${CAMPAIGN_ROOM_PREFIX}${access.campaignId}`);
        socket.campaignId = access.campaignId;
        logInfo('WebSocket campaign joined', {
          campaignId: access.campaignId,
          userId: socket.user.id,
          role: access.role,
        });

        // Send current game state to the joining socket so it doesn't need
        // to remount the campaign to get fresh turn info after a reconnect.
        try {
          const client = await getClient({ label: 'ws.snapshot' });
          try {
            const { rows } = await client.query(
              `SELECT s.id AS session_id, s.status AS session_status, s.game_state
                 FROM public.sessions s
                WHERE s.campaign_id = $1 AND s.status = 'active'
                LIMIT 1`,
              [access.campaignId],
            );
            const session = rows[0] ?? null;
            const gameState = session
              ? (typeof session.game_state === 'string'
                  ? JSON.parse(session.game_state)
                  : session.game_state)
              : null;
            socket.emit(REALTIME_EVENTS.gameStateSnapshot, {
              sessionId: session?.session_id ?? null,
              sessionStatus: session?.session_status ?? null,
              gameState,
              emittedAt: new Date().toISOString(),
            });
          } finally {
            client.release();
          }
        } catch (err) {
          logError('Failed to emit game-state-snapshot on join', {
            campaignId: access.campaignId,
            error: err.message,
          });
        }

        socket.to(`${CAMPAIGN_ROOM_PREFIX}${access.campaignId}`).emit('user-joined', {
          userId: socket.user.id,
          username: socket.user.username,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('leave-campaign', (campaignId) => {
        if (typeof campaignId !== 'string') return;
        // Leaving a room you are not in is a no-op; safe to allow without a
        // membership check.
        socket.leave(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`);
        socket.campaignAccess.delete(campaignId);
        logInfo('WebSocket campaign left', {
          campaignId,
          userId: socket.user.id,
        });

        socket.to(`${CAMPAIGN_ROOM_PREFIX}${campaignId}`).emit('user-left', {
          userId: socket.user.id,
          username: socket.user.username,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('chat-message', async (payload) => {
        try {
          const access = await this.requireCampaignAccess(socket, payload, 'chat-message');
          if (!access) return;
          const { campaignId, role } = access;

          const incoming = payload?.message || {};
          const now = new Date().toISOString();

          // Channel-type authorisation. dm_whisper messages may only be
          // initiated by the campaign DM. Without this gate, any participant
          // could whisper any other participant pretending to be a DM-only
          // channel.
          const channelType = incoming.channelType ?? 'party';
          const channelTargetUserId = incoming.channelTargetUserId ?? null;
          if (channelType === 'dm_whisper' && role !== 'dm') {
            socket.emit('error', {
              type: 'chat-message-error',
              message: 'Only the DM can send dm_whisper messages',
            });
            return;
          }
          if (channelType === 'dm_broadcast' && role !== 'dm') {
            socket.emit('error', {
              type: 'chat-message-error',
              message: 'Only the DM can broadcast as the DM',
            });
            return;
          }

          // Resolve character_name from DB to prevent spoofing and confirm
          // that the character belongs to the sender.
          const characterId = incoming.characterId ?? null;
          let characterName = null;
          if (characterId) {
            const client = await getClient({ label: 'ws-character-name' });
            try {
              const { rows } = await client.query(
                'SELECT name, user_id FROM characters WHERE id = $1',
                [characterId],
              );
              if (rows[0] && rows[0].user_id === socket.user.id) {
                characterName = rows[0].name ?? null;
              }
              // If the character is not owned by the sender we silently drop
              // the character_name attribution rather than fail the message.
            } finally {
              client.release();
            }
          }

          const sanitizedContent = stripHtmlTags(incoming.content || incoming.message || '');

          const messageData = {
            type: 'new_message',
            data: {
              id: incoming.messageId || incoming.id || Date.now().toString(),
              campaign_id: campaignId,
              content: sanitizedContent,
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
            },
          };

          if (channelType === 'private' || channelType === 'dm_whisper') {
            this.emitToUser(campaignId, socket.user.id, 'new-message', messageData);
            if (channelTargetUserId && channelTargetUserId !== socket.user.id) {
              this.emitToUser(campaignId, channelTargetUserId, 'new-message', messageData);
            }
          } else {
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
          socket.emit('error', { type: 'chat-message-error', message: 'Failed to send message' });
        }
      });

      socket.on('typing-start', async (campaignIdOrPayload) => {
        const access = await this.requireCampaignAccess(socket, campaignIdOrPayload, 'typing-start');
        if (!access) return;
        const { campaignId } = access;
        const targetUserId = typeof campaignIdOrPayload === 'object'
          ? campaignIdOrPayload?.targetUserId
          : null;

        if (targetUserId) {
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

      socket.on('typing-stop', async (campaignIdOrPayload) => {
        const access = await this.requireCampaignAccess(socket, campaignIdOrPayload, 'typing-stop');
        if (!access) return;
        const { campaignId } = access;
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

      // combat-update / character-update / session-update were client-emit
      // mirrors of server-side state. With per-event auth in place, the
      // canonical events for these flows are already emitted server-side by
      // dedicated services (action-completed, live-state-changed, combat-*,
      // session-focus-updated, etc.). The client-emit surface has been
      // dropped to prevent forged HP/character/session events from reaching
      // every connected client. Frontend hook methods are no-ops now.

      socket.on('update-presence', async (status) => {
        if (!socket.campaignId) return;
        const access = await this.requireCampaignAccess(socket, socket.campaignId, 'update-presence');
        if (!access) return;

        socket.to(`${CAMPAIGN_ROOM_PREFIX}${access.campaignId}`).emit('presence-update', {
          userId: socket.user.id,
          username: socket.user.username,
          status,
          timestamp: new Date().toISOString(),
        });
      });

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
            timestamp: new Date().toISOString(),
          });
        }
      });

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
  // Note: DM narration now flows through chat messages via dm-narrator.js → postNarrationToChat()

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
