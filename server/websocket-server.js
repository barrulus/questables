import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

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
    
    console.log('WebSocket server initialized');
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // For development, we'll use a simple user ID validation
        // In production, you would verify JWT tokens here
        const user = { id: socket.handshake.auth.userId, username: socket.handshake.auth.username };
        socket.user = user;
        next();
      } catch (err) {
        next(new Error('Authentication failed'));
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.user.username} (${socket.user.id})`);
      
      // Handle joining campaign rooms
      socket.on('join-campaign', (campaignId) => {
        socket.join(`campaign-${campaignId}`);
        socket.campaignId = campaignId;
        console.log(`User ${socket.user.username} joined campaign ${campaignId}`);
        
        // Notify other users in the campaign
        socket.to(`campaign-${campaignId}`).emit('user-joined', {
          userId: socket.user.id,
          username: socket.user.username,
          timestamp: new Date().toISOString()
        });
      });

      // Handle leaving campaign rooms
      socket.on('leave-campaign', (campaignId) => {
        socket.leave(`campaign-${campaignId}`);
        console.log(`User ${socket.user.username} left campaign ${campaignId}`);
        
        // Notify other users in the campaign
        socket.to(`campaign-${campaignId}`).emit('user-left', {
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

          this.io.to(`campaign-${campaignId}`).emit('new-message', messageData);
          console.log(`Chat message from ${messageData.data.sender_name} in campaign ${campaignId}`);
        } catch (error) {
          console.error('[Socket.io] Failed to broadcast chat message:', error);
          socket.emit('error', { type: 'chat-error', message: 'Failed to send message' });
        }
      });

      // Handle typing indicators
      socket.on('typing-start', (campaignId) => {
        socket.to(`campaign-${campaignId}`).emit('user-typing', {
          userId: socket.user.id,
          username: socket.user.username
        });
      });

      socket.on('typing-stop', (campaignId) => {
        socket.to(`campaign-${campaignId}`).emit('user-stopped-typing', {
          userId: socket.user.id,
          username: socket.user.username
        });
      });

      // Handle combat updates
      socket.on('combat-update', (data) => {
        try {
          const { campaignId, encounterId, update } = data;
          
          // Broadcast combat state to all campaign participants
          socket.to(`campaign-${campaignId}`).emit('combat-state-update', {
            encounterId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          console.log(`Combat update from ${socket.user.username} in campaign ${campaignId}`);
        } catch (error) {
          socket.emit('error', { type: 'combat-error', message: 'Failed to update combat state' });
        }
      });

      // Handle character updates
      socket.on('character-update', (data) => {
        try {
          const { campaignId, characterId, update } = data;
          
          // Broadcast character changes to campaign participants
          socket.to(`campaign-${campaignId}`).emit('character-changed', {
            characterId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          console.log(`Character update from ${socket.user.username} in campaign ${campaignId}`);
        } catch (error) {
          socket.emit('error', { type: 'character-error', message: 'Failed to update character' });
        }
      });

      // Handle session updates
      socket.on('session-update', (data) => {
        try {
          const { campaignId, sessionId, update } = data;
          
          // Broadcast session changes to campaign participants
          socket.to(`campaign-${campaignId}`).emit('session-changed', {
            sessionId,
            update,
            timestamp: new Date().toISOString(),
            updatedBy: socket.user.id
          });
          
          console.log(`Session update from ${socket.user.username} in campaign ${campaignId}`);
        } catch (error) {
          socket.emit('error', { type: 'session-error', message: 'Failed to update session' });
        }
      });

      // Handle user presence
      socket.on('update-presence', (status) => {
        if (socket.campaignId) {
          socket.to(`campaign-${socket.campaignId}`).emit('presence-update', {
            userId: socket.user.id,
            username: socket.user.username,
            status,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.user.username} (${socket.user.id})`);
        
        if (socket.campaignId) {
          socket.to(`campaign-${socket.campaignId}`).emit('user-left', {
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
  broadcastToCampaign(campaignId, event, data) {
    this.io.to(`campaign-${campaignId}`).emit(event, data);
  }

  // Get connected users in a campaign
  getCampaignUsers(campaignId) {
    const room = this.io.sockets.adapter.rooms.get(`campaign-${campaignId}`);
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
