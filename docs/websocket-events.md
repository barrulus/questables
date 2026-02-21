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
| `chat-message` | `{ campaignId, content, type, channel_type?, channel_target_user_id?, ... }` | Send a chat message (channel-aware) |
| `typing-start` | `{ campaignId }` or `{ campaignId, targetUserId }` | User started typing (channel-aware) |
| `typing-stop` | `{ campaignId }` or `{ campaignId, targetUserId }` | User stopped typing (channel-aware) |
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
| `gamePhaseChanged` | `game-phase-changed` | Game phase transitioned (exploration/combat/social/rest) |
| `turnAdvanced` | `turn-advanced` | Active player turn advanced |
| `worldTurnCompleted` | `world-turn-completed` | DM world turn completed, new round begins |
| `turnOrderChanged` | `turn-order-changed` | Turn order reordered by DM |

### WS3 — Action & Live State Events

| Event Key | Socket Event | Trigger | Delivery |
|-----------|-------------|---------|----------|
| `dmNarration` | `dm-narration` | LLM produces narration for a player action | Broadcast to campaign |
| `rollRequested` | `roll-requested` | LLM requests a roll from a player | Private to rolling player (`emitToUser`) |
| `actionCompleted` | `action-completed` | Player action fully resolved | Broadcast to campaign |
| `liveStateChanged` | `live-state-changed` | HP, conditions, or other live state mutated | Broadcast to campaign |
| `regionTriggered` | `region-triggered` | Player movement enters a map region | Broadcast to campaign |
| `worldTurnNarration` | `world-turn-narration` | DM world turn LLM narration | Broadcast to campaign |

### WS4 — Combat Events

| Event Key | Socket Event | Trigger | Delivery |
|-----------|-------------|---------|----------|
| `enemyTurnStarted` | `enemy-turn-started` | Initiative advances to an NPC combatant | Broadcast to campaign |
| `enemyTurnCompleted` | `enemy-turn-completed` | LLM-controlled enemy turn finishes | Broadcast to campaign |
| `combatEnded` | `combat-ended` | DM ends combat (victory/fled/parley) | Broadcast to campaign |
| `combatBudgetChanged` | `combat-budget-changed` | Player uses combat action that consumes budget | Private to active player (`emitToUser`) |
| `concentrationCheck` | `concentration-check` | Concentrating character takes damage | Private to affected player (`emitToUser`) |

### WS5 — Rest Events

| Event Key | Socket Event | Trigger | Delivery |
|-----------|-------------|---------|----------|
| `restStarted` | `rest-started` | DM starts a short or long rest | Broadcast to campaign |
| `hitDiceSpent` | `hit-dice-spent` | Player spends a hit die during short rest | Broadcast to campaign |
| `restCompleted` | `rest-completed` | DM completes a rest, restoration applied | Broadcast to campaign |

### WS6 — Death Save & Levelling Events

| Event Key | Socket Event | Trigger | Delivery |
|-----------|-------------|---------|----------|
| `deathSaveRolled` | `death-save-rolled` | Character rolls a death saving throw | Broadcast to campaign |
| `characterDied` | `character-died` | Character accumulates 3 death save failures | Broadcast to campaign |
| `characterStabilized` | `character-stabilized` | Character accumulates 3 death save successes | Broadcast to campaign |
| `levelUpAvailable` | `level-up-available` | Character XP crosses level threshold | Private to target user (`emitToUser`) |

### Channel-Aware Message Delivery

Chat messages and typing indicators are now channel-aware:

- **party** / **dm_broadcast** messages: broadcast to entire campaign room (existing behaviour)
- **private** / **dm_whisper** messages: delivered only to sender + target via `emitToUser()` helper

The server maintains a user→socket mapping within each campaign room to enable targeted delivery.

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
