# WebSocket Events

Questables uses Socket.io for real-time communication between the server and connected clients.

## Connection

```typescript
// Client connects to the WebSocket server
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');
```

Status endpoint: `GET /api/websocket/status` — Returns connection count and server status.

## Room Structure

Clients join campaign-specific rooms:

```
Room format: campaign-{campaignId}
```

Events are broadcast to all clients in the same campaign room.

## Client → Server Events

Events sent from the browser to the server:

| Event | Payload | Description |
|-------|---------|-------------|
| `join-campaign` | `{ campaignId }` | Join a campaign room |
| `leave-campaign` | `{ campaignId }` | Leave a campaign room |
| `chat-message` | `{ campaignId, content, type, ... }` | Send a chat message |
| `typing-start` | `{ campaignId }` | User started typing |
| `typing-stop` | `{ campaignId }` | User stopped typing |
| `combat-update` | `{ campaignId, combatState }` | Update combat tracker state |
| `character-update` | `{ campaignId, characterId, data }` | Update character data |
| `session-update` | `{ campaignId, sessionData }` | Update session state |
| `update-presence` | `{ campaignId, position, status }` | Update user presence/position |
| `ping` | — | Health check |

## Server → Client Events

Events broadcast from the server to clients:

| Event | Payload | Description |
|-------|---------|-------------|
| `user-joined` | `{ userId, username }` | A user joined the campaign room |
| `user-left` | `{ userId, username }` | A user left the campaign room |
| `new-message` | `{ message }` | New chat message received |
| `user-typing` | `{ userId, username }` | A user is typing |
| `user-stopped-typing` | `{ userId }` | A user stopped typing |
| `combat-state-update` | `{ combatState }` | Combat tracker state changed |
| `character-changed` | `{ characterId, data }` | A character was updated |
| `session-changed` | `{ sessionData }` | Session state changed |
| `presence-update` | `{ userId, position, status }` | User presence updated |
| `error` | `{ message }` | Error notification |
| `pong` | — | Health check response |

## Real-Time Events (Server-Originated)

These events are emitted by server-side operations (not triggered by client socket events):

| Event Key | Socket Event | Trigger |
|-----------|-------------|---------|
| `spawnUpdated` | `spawn-updated` | Campaign spawn point created/moved |
| `spawnDeleted` | `spawn-deleted` | Campaign spawn point removed |
| `objectiveCreated` | `objective-created` | New campaign objective added |
| `objectiveUpdated` | `objective-updated` | Objective status/text changed |
| `objectiveDeleted` | `objective-deleted` | Objective removed |
| `sessionFocusUpdated` | `session-focus-updated` | DM changed session focus/location |
| `sessionContextUpdated` | `session-context-updated` | Session context data changed |
| `unplannedEncounterCreated` | `unplanned-encounter-created` | Ad-hoc encounter started |
| `npcSentimentAdjusted` | `npc-sentiment-adjusted` | NPC trust/sentiment changed |
| `npcTeleported` | `npc-teleported` | NPC moved to new location |

## Usage Example

```typescript
// Join campaign on game start
socket.emit('join-campaign', { campaignId: activeCampaignId });

// Listen for messages
socket.on('new-message', (data) => {
  addMessageToChat(data.message);
});

// Listen for combat updates
socket.on('combat-state-update', (data) => {
  updateCombatTracker(data.combatState);
});

// Send a chat message
socket.emit('chat-message', {
  campaignId: activeCampaignId,
  content: 'I attack the goblin!',
  type: 'message',
});

// Clean up on unmount
socket.emit('leave-campaign', { campaignId: activeCampaignId });
```

## Disconnect Handling

When a client disconnects, the server:
1. Removes the client from all campaign rooms
2. Broadcasts `user-left` to remaining room members
3. Cleans up presence data
