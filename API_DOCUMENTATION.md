# API Documentation

This document describes the REST API endpoints provided by the Questables database server.

## Base URL

- Development: `http://localhost:3001`
- All endpoints require `Content-Type: application/json` for POST/PUT requests

## Health Monitoring

### GET /api/health

Check database connection status and server health.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "database": "connected",
  "latency": 15,
  "timestamp": "2025-09-16T12:00:00.000Z",
  "pool": {
    "totalCount": 2,
    "idleCount": 1,
    "waitingCount": 0
  }
}
```

**Response (500 Error):**
```json
{
  "status": "unhealthy",
  "database": "disconnected",
  "error": "Connection timeout",
  "timestamp": "2025-09-16T12:00:00.000Z"
}
```

### GET /api/admin/metrics

Retrieve aggregate platform metrics from the live database. Requires an authenticated admin user.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{
  "generatedAt": "2025-09-20T15:32:10.123Z",
  "users": {
    "total": 42,
    "active": 38,
    "inactive": 3,
    "banned": 1,
    "newLastSevenDays": 5
  },
  "campaigns": {
    "total": 12,
    "active": 6,
    "recruiting": 3,
    "paused": 2,
    "completed": 1,
    "newLastSevenDays": 2
  },
  "sessions": {
    "total": 54,
    "completed": 30,
    "scheduled": 10,
    "active": 4,
    "cancelled": 10,
    "averageDurationMinutes": 210.5
  }
}
```

**Errors:**
- `401`: Missing or invalid authentication token
- `403`: Authenticated user is not an admin
- `500`: Unexpected database failure while aggregating metrics

## Enhanced LLM Service (Provider Abstraction)

The backend now boots an Enhanced LLM Service that routes narrative generation through provider-specific adapters. The default configuration registers the Ollama-backed provider (`qwen3:8b` hosted at `http://192.168.1.34`). While public HTTP endpoints are not yet exposed, internal services can call the provider layer with the following operations:

| Operation | Description |
|-----------|-------------|
| `generateDMNarration` | Produces dungeon master narration responses for general player actions. |
| `generateSceneDescription` | Generates atmospheric environment descriptions using live context payloads. |
| `generateNPCDialogue` | Returns NPC dialogue grounded in stored personality/memory state. |
| `generateActionNarrative` | Narrates the outcomes of discrete player or NPC actions. |
| `generateQuest` | Creates structured quest prompts with objectives and rewards. |

### Provider Metadata & Instrumentation

- Every call records provider name, host, model, and a unique request ID for traceability.
- Metrics include request latency, prompt/completion token counts (when provided by the model), and provider durations (load, prompt evaluation, generation).
- Responses are cached by provider/model/prompt/metadata hash with a configurable TTL (default 5 minutes). Cache hits are surfaced in the response payload.
- Failures raise explicit `LLMProviderError`/`LLMServiceError` exceptions; the service never falls back to canned content.

### Configuration

Environment variables documented in `.env.example`/`README.md` (prefixed with `LLM_`) control provider host, model, credentials, and cache limits. Bootstrap failures are logged and block narrative generation until resolved.

## Characters API

### GET /api/characters

Get all characters for the authenticated user.

**Query Parameters:**
- `userId` (required): User ID to filter characters

**Response:**
```json
[
  {
    "id": "uuid-string",
    "name": "Aragorn Strider",
    "class": "Ranger",
    "level": 8,
    "race": "Human",
    "background": "Folk Hero",
    "abilities": {
      "strength": 16,
      "dexterity": 17,
      "constitution": 14,
      "intelligence": 12,
      "wisdom": 18,
      "charisma": 10
    },
    "hit_points": {
      "current": 72,
      "max": 72,
      "temporary": 0
    },
    "armor_class": 16,
    "proficiency_bonus": 3,
    "speed": 30,
    "inventory": [...],
    "spellcasting": {...},
    "created_at": "2025-09-16T12:00:00.000Z",
    "updated_at": "2025-09-16T12:00:00.000Z"
  }
]
```

### GET /api/characters/:id

Get a specific character by ID.

**Parameters:**
- `id`: Character UUID

**Response:** Single character object (same structure as above)

**Errors:**
- `404`: Character not found
- `403`: User doesn't own this character

### POST /api/characters

Create a new character.

**Request Body:**
```json
{
  "name": "Aragorn Strider",
  "character_class": "Ranger",
  "race": "Human", 
  "background": "Folk Hero",
  "level": 1,
  "abilities": {
    "strength": 16,
    "dexterity": 17,
    "constitution": 14,
    "intelligence": 12,
    "wisdom": 18,
    "charisma": 10
  },
  "hit_points": {
    "current": 10,
    "max": 10,
    "temporary": 0
  },
  "user_id": "user-uuid"
}
```

**Response:** Created character object

**Errors:**
- `400`: Validation errors (missing required fields)
- `500`: Database error

### PUT /api/characters/:id

Update an existing character.

**Parameters:**
- `id`: Character UUID

**Request Body:** Partial character data (only fields to update)

**Response:** Updated character object

**Errors:**
- `404`: Character not found
- `403`: User doesn't own this character
- `400`: Validation errors

### DELETE /api/characters/:id

Delete a character.

**Parameters:**
- `id`: Character UUID

**Request Body:**
```json
{
  "userId": "user-uuid"
}
```

**Response:**
```json
{
  "message": "Character deleted successfully"
}
```

**Errors:**
- `404`: Character not found
- `403`: User doesn't own this character

## Campaigns API

### GET /api/campaigns

Get campaigns for the authenticated user (as DM and as player).

**Query Parameters:**
- `userId` (required): User ID
- `type` (optional): "dm" or "player" to filter by role

**Response:**
```json
{
  "dmCampaigns": [
    {
      "id": "uuid-string",
      "name": "The Fellowship Campaign",
      "description": "An epic journey...",
      "dm_user_id": "user-uuid",
      "dm_username": "dungeon_master",
      "system": "D&D 5e",
      "setting": "Fantasy",
      "status": "active",
      "max_players": 6,
      "current_players": 4,
      "level_range": { "min": 1, "max": 10 },
      "is_public": true,
      "created_at": "2025-09-16T12:00:00.000Z",
      "updated_at": "2025-09-16T12:00:00.000Z"
    }
  ],
  "playerCampaigns": [...],
  "publicCampaigns": [...]
}
```

### GET /api/campaigns/:id

Get a specific campaign with player information.

**Parameters:**
- `id`: Campaign UUID

**Response:**
```json
{
  "campaign": {
    "id": "uuid-string",
    "name": "The Fellowship Campaign",
    // ... campaign fields
  },
  "players": [
    {
      "user_id": "uuid-string",
      "username": "player1",
      "character_id": "uuid-string",
      "character_name": "Aragorn",
      "joined_at": "2025-09-16T12:00:00.000Z"
    }
  ]
}
```

### POST /api/campaigns

Create a new campaign.

**Request Body:**
```json
{
  "name": "New Campaign",
  "description": "Campaign description",
  "system": "D&D 5e",
  "setting": "Fantasy",
  "max_players": 6,
  "level_range": { "min": 1, "max": 10 },
  "is_public": true,
  "dm_user_id": "user-uuid"
}
```

**Response:** Created campaign object

### PUT /api/campaigns/:id

Update a campaign (DM only).

**Parameters:**
- `id`: Campaign UUID

**Request Body:** Partial campaign data

**Response:** Updated campaign object

**Errors:**
- `403`: Only the DM can update the campaign

### DELETE /api/campaigns/:id

Delete a campaign (DM only).

**Parameters:**
- `id`: Campaign UUID

**Request Body:**
```json
{
  "userId": "dm-user-uuid"
}
```

### POST /api/campaigns/:id/join

Join a campaign as a player.

**Parameters:**
- `id`: Campaign UUID

**Request Body:**
```json
{
  "userId": "user-uuid",
  "characterId": "character-uuid" // optional
}
```

**Response:**
```json
{
  "message": "Successfully joined campaign"
}
```

**Errors:**
- `400`: Campaign full, user already in campaign
- `404`: Campaign not found

### POST /api/campaigns/:id/leave

Leave a campaign.

**Parameters:**
- `id`: Campaign UUID

**Request Body:**
```json
{
  "userId": "user-uuid"
}
```

**Response:**
```json
{
  "message": "Successfully left campaign"
}
```

## Chat Messages API

### GET /api/campaigns/:id/messages

Get all messages for a campaign.

**Parameters:**
- `id`: Campaign UUID

**Response:**
```json
[
  {
    "id": "uuid-string",
    "campaign_id": "campaign-uuid",
    "content": "Hello everyone!",
    "message_type": "text",
    "sender_id": "user-uuid",
    "sender_name": "Player Name",
    "username": "player_username",
    "character_id": "character-uuid",
    "character_name": "Aragorn",
    "dice_roll": null,
    "created_at": "2025-09-16T12:00:00.000Z"
  }
]
```

### GET /api/campaigns/:id/messages/recent

Get recent messages since a timestamp (for polling).

**Parameters:**
- `id`: Campaign UUID

**Query Parameters:**
- `since`: ISO timestamp to get messages after

**Response:** Array of message objects (same structure as above)

### POST /api/campaigns/:id/messages

Send a message to a campaign.

**Parameters:**
- `id`: Campaign UUID

**Request Body:**
```json
{
  "content": "Hello everyone!",
  "type": "text", // "text", "dice_roll", "ooc"
  "sender_id": "user-uuid",
  "sender_name": "Player Name",
  "character_id": "character-uuid", // optional
  "dice_roll": { // optional, for dice_roll type
    "expression": "1d20+5",
    "rolls": [15],
    "modifier": 5,
    "total": 20,
    "details": "15 + 5 = 20"
  }
}
```

**Response:** Created message object

### DELETE /api/campaigns/:campaignId/messages/:messageId

Delete a message (only by sender).

**Parameters:**
- `campaignId`: Campaign UUID
- `messageId`: Message UUID

**Request Body:**
```json
{
  "userId": "sender-user-uuid"
}
```

**Response:**
```json
{
  "message": "Message deleted successfully"
}
```

**Errors:**
- `403`: Only the sender can delete their messages
- `404`: Message not found

## Users API

### GET /api/users/profile

Get current user profile.

**Query Parameters:**
- `userId` (required): User ID

**Response:**
```json
{
  "id": "uuid-string",
  "username": "player_name",
  "email": "player@example.com",
  "roles": ["player", "dm"],
  "role": "player", // Primary role for backward compatibility
  "created_at": "2025-09-16T12:00:00.000Z",
  "updated_at": "2025-09-16T12:00:00.000Z"
}
```

### PUT /api/users/profile

Update user profile.

**Request Body:**
```json
{
  "username": "new_username",
  "email": "new_email@example.com",
  "userId": "user-uuid"
}
```

**Response:** Updated user object

## Error Responses

All endpoints may return these standard error responses:

### 400 Bad Request
```json
{
  "error": "Validation error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "error": "Access denied"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "details": "Optional error details"
}
```

## Data Types and Validation

### Character Validation
- `name`: Required, non-empty string
- `character_class`: Required string
- `race`: Required string  
- `background`: Required string
- `level`: Integer, 1-20
- `abilities`: Object with strength, dexterity, constitution, intelligence, wisdom, charisma (all integers 1-30)

### Campaign Validation
- `name`: Required, non-empty string
- `description`: Optional string
- `system`: String (default: "D&D 5e")
- `setting`: String (default: "Fantasy")
- `max_players`: Integer, 1-20 (default: 6)
- `level_range`: Object with min/max integers 1-20
- `is_public`: Boolean (default: false)

### Message Validation
- `content`: Required, non-empty string
- `type`: Enum: "text", "dice_roll", "ooc"
- `sender_id`: Required UUID
- `sender_name`: Required string

## Rate Limiting

Currently no rate limiting is implemented, but recommended limits:

- Health checks: 60/minute
- Character operations: 100/minute
- Campaign operations: 60/minute  
- Chat messages: 120/minute

## Authentication

The current implementation uses user IDs passed in request bodies/query parameters. In production, implement proper JWT or session-based authentication.

## Campaign Character Roster

### GET /api/campaigns/:campaignId/characters

Returns every character currently attached to a campaign through `campaign_players`. Useful for initiative selection and encounter setup.

**Parameters:**
- `campaignId` (path): Campaign UUID

**Response (200 OK):**
```json
[
  {
    "id": "character-uuid",
    "name": "Elowen",
    "class": "Wizard",
    "level": 6,
    "hit_points": { "max": 38, "current": 24, "temporary": 0 },
    "armor_class": 15,
    "role": "player",
    "status": "active"
  }
]
```

**Errors:**
- `404`: Campaign not found
- `500`: Database error while fetching roster

## Encounter API

### GET /api/encounters/:encounterId

Fetch a single encounter record, including current round and stored initiative order.

**Parameters:**
- `encounterId` (path): Encounter UUID

**Response (200 OK):**
```json
{
  "id": "encounter-uuid",
  "campaign_id": "campaign-uuid",
  "name": "Ambush at the Ford",
  "description": "Six goblins ambush the party at the river crossing.",
  "type": "combat",
  "difficulty": "medium",
  "status": "active",
  "current_round": 2,
  "initiative_order": [
    { "participantId": "participant-1", "initiative": 18, "hasActed": false },
    { "participantId": "participant-2", "initiative": 14, "hasActed": true }
  ],
  "created_at": "2025-09-19T14:20:00.000Z",
  "updated_at": "2025-09-19T14:33:10.000Z"
}
```

**Errors:**
- `404`: Encounter not found
- `500`: Unexpected database failure

### POST /api/encounters/:encounterId/initiative

Roll or assign initiative for every participant in an encounter. When no overrides are provided the backend performs a server-side `random()` d20 roll per participant, resets `has_acted`, and marks the encounter as `active`.

**Parameters:**
- `encounterId` (path): Encounter UUID

**Request Body (optional overrides):**
```json
{
  "overrides": [
    { "participantId": "participant-1", "initiative": 22 },
    { "participant_id": "participant-3", "initiative": 18 }
  ]
}
```

**Response (200 OK):**
```json
{
  "encounter": {
    "id": "encounter-uuid",
    "status": "active",
    "current_round": 1,
    "initiative_order": [
      { "participantId": "participant-1", "initiative": 22, "hasActed": false },
      { "participantId": "participant-2", "initiative": 16, "hasActed": false }
    ]
  },
  "participants": [
    {
      "id": "participant-1",
      "participant_type": "character",
      "initiative": 22,
      "has_acted": false,
      "hit_points": { "max": 38, "current": 38, "temporary": 0 }
    },
    {
      "id": "participant-2",
      "participant_type": "npc",
      "initiative": 16,
      "has_acted": false,
      "hit_points": { "max": 20, "current": 20, "temporary": 0 }
    }
  ]
}
```

**Errors:**
- `404`: Encounter not found
- `400`: Encounter has no participants to roll initiative for
- `500`: Database error while updating initiative
