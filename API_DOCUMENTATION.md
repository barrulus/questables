# API Documentation

This document describes the REST API endpoints provided by the Questables database server.

## Documentation Governance
- DM Toolkit work tracked in `dmtoolkit_tasks_2.md` requires verifying this document for every shipped slice. Record the observed contract (or an explicit "no change" confirmation) alongside the clearance log so this file always mirrors the live backend.
- Schema updates are authored directly in `database/schema.sql`; reference that file when documenting new or updated fields so definitions stay synchronized.

## DM Toolkit Status
- DM Toolkit endpoints are being implemented incrementally. Until new routes land, the sections below represent the currently available API surface. Add the new endpoints here only after they are live and verified against the production-aligned database.

## Base URL

- Development: `http://localhost:3001`
- All endpoints require `Content-Type: application/json` for POST/PUT requests

## Maps API

### GET /api/maps/:worldId/markers

Return the live marker catalog for a given world map. Results reflect the persisted
`maps_markers` table—no placeholder data is returned.

**Parameters:**
- `worldId` (path): UUID of the world map.

**Query Parameters:**
- `bounds` (optional): JSON-encoded bounding box string formatted as
  `{"north": 0, "south": 0, "east": 0, "west": 0}`. All values must be numeric. The
  server responds with `400 invalid_bounds` when parsing fails or a value is not a number.

**Response (200 OK):**
```json
[
  {
    "id": "3c950b83-9a5a-4dce-9222-64eb4c9694f2",
    "world_id": "c8a2d2b1-6e8c-4c99-9f96-3d5243e13d0d",
    "marker_id": 42,
    "type": "waypoint",
    "icon": "waypoint",
    "x_px": 10234.12,
    "y_px": 8745.88,
    "note": "Ruined watchtower",
    "geometry": {
      "type": "Point",
      "coordinates": [10234.12, 8745.88]
    }
  }
]
```

**Errors:**
- `400 invalid_bounds`: `bounds` query parameter missing or not parseable as numeric north/south/east/west values.
- `500`: Unexpected database failure while reading markers.

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

### GET /api/admin/llm/providers

Return the currently registered LLM providers with their health summaries.

**Headers:**
- `Authorization: Bearer <jwt>` (admin only)

**Response (200 OK):**
```json
{
  "defaultProvider": "ollama",
  "providers": [
    {
      "name": "ollama",
      "adapter": "ollama",
      "default": true,
      "enabled": true,
      "host": "http://192.168.1.34",
      "model": "qwen3:8b",
      "timeoutMs": 60000,
      "options": { "temperature": 0.7, "top_p": 0.9 },
      "health": {
        "healthy": false,
        "error": "fetch failed"
      }
    }
  ]
}
```

**Errors:**
- `401`: Missing/invalid token.
- `403`: Caller is not an admin.
- `503`: LLM service has not been initialized.

### GET /api/admin/llm/metrics

Return live LLM workload metrics. Requires admin authentication.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{
  "generatedAt": "2025-09-21T07:49:45.552Z",
  "totals": {
    "requests": 12,
    "cacheHits": 7,
    "cacheMisses": 5,
    "errors": 1,
    "cacheEvictions": 2,
    "cacheSize": 4,
    "cacheTtlMs": 300000,
    "maxCacheEntries": 500
  },
  "providers": [
    {
      "providerName": "ollama",
      "providerModel": "qwen3:8b",
      "requests": 12,
      "cacheHits": 7,
      "cacheMisses": 5,
      "errors": 1,
      "averageLatencyMs": 10450.12,
      "averageTimeToFirstByteMs": 230.5,
      "totalTokens": 4821,
      "lastRequestAt": "2025-09-21T07:49:45.552Z"
    }
  ],
  "recentRequests": [
    {
      "id": "ef940c99-b881-43c8-b311-8d31d4af60b4",
      "occurredAt": "2025-09-21T07:49:16.115Z",
      "providerName": "ollama",
      "providerModel": "qwen3:8b",
      "type": "dm_narration",
      "cacheHit": false,
      "latencyMs": 10699,
      "ttfbMs": 210,
      "totalTokens": 406,
      "error": false
    }
  ]
}
```

**Errors:**
- `401`: Missing/invalid token.
- `403`: Caller is not an admin.
- `503`: LLM service has not been initialized.

### GET /api/admin/llm/cache

Inspect the current Enhanced LLM cache. Requires admin authentication.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{
  "generatedAt": "2025-09-21T07:49:50.000Z",
  "size": 4,
  "maxEntries": 500,
  "defaultTtlMs": 300000,
  "entries": [
    {
      "key": "1c4735ef46673da405a628dc5c3169d44d4bcf72113e01fd5e4210c0052c923a",
      "type": "action_narrative",
      "providerName": "ollama",
      "providerModel": "qwen3:8b",
      "createdAt": "2025-09-21T07:49:37.149Z",
      "lastAccessedAt": "2025-09-21T07:49:37.150Z",
      "expiresAt": "2025-09-21T07:54:37.149Z",
      "ttlRemainingMs": 300000
    }
  ]
}
```

**Errors:**
- `401`: Missing/invalid token.
- `403`: Caller is not an admin.
- `503`: LLM service has not been initialized.

### DELETE /api/admin/llm/cache

Flush the entire LLM cache. Requires admin authentication.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{ "cleared": 4 }
```

**Errors:**
- `401`: Missing/invalid token.
- `403`: Caller is not an admin.
- `503`: LLM service has not been initialized.

### DELETE /api/admin/llm/cache/:cacheKey

Remove a single cache entry. Requires admin authentication.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{ "removed": true }
```

**Errors:**
- `401`: Missing/invalid token.
- `403`: Caller is not an admin.
- `404`: Cache key not found.
- `503`: LLM service has not been initialized.

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

## Narrative Generation API

Authenticated endpoints that invoke the Enhanced LLM Service. All routes require a bearer token; DM-only endpoints also demand that the caller is the campaign DM, a co-DM, or holds the `admin` role.

| Method | Path | Description | Access |
|--------|------|-------------|--------|
| POST | `/api/campaigns/:campaignId/narratives/dm` | Produces DM narration grounded in live campaign context. | DM / co-DM / admin |
| POST | `/api/campaigns/:campaignId/narratives/scene` | Generates atmospheric scene descriptions. | DM / co-DM / admin |
| POST | `/api/campaigns/:campaignId/narratives/npc` | Returns NPC dialogue and records memory/relationship updates. | DM / co-DM / admin |
| POST | `/api/campaigns/:campaignId/narratives/action` | Narrates the outcome of a specific action. | Any authenticated participant |
| POST | `/api/campaigns/:campaignId/narratives/quest` | Drafts a quest outline aligned with campaign state. | DM / co-DM / admin |

### Common Request Fields

```json
{
  "sessionId": "optional-session-uuid",
  "focus": "Optional guidance for the model",
  "provider": { "name": "ollama", "model": "qwen3:8b" },
  "parameters": { "temperature": 0.6 },
  "metadata": { "trigger": "end_of_round" }
}
```

- `sessionId` (optional) must belong to the campaign.
- `focus` is trimmed to 500 characters within prompt construction.
- `provider` overrides the default model when multiple providers are registered.
- `parameters` are passed verbatim to the provider adapter (subject to provider support).
- `metadata` is persisted in `llm_narratives.metadata` for auditability.

### Response Structure (201 Created)

```json
{
  "narrativeId": "uuid",
  "content": "Generated narrative",
  "provider": { "name": "ollama", "model": "qwen3:8b", "requestId": "uuid" },
  "metrics": { "latencyMs": 1234, "promptTokens": 512, "completionTokens": 180 },
  "cache": { "hit": false, "key": "hash", "expiresAt": 1737072000000 },
  "request": { "id": "uuid", "metadata": { ... } },
  "prompt": { "system": "...", "user": "..." },
  "contextGeneratedAt": "ISO timestamp",
  "recordedAt": "ISO timestamp"
}
```

### NPC Dialogue Extras

`POST /api/campaigns/:campaignId/narratives/npc` accepts an `interaction` object:

```json
{
  "npcId": "npc-uuid",
  "interaction": {
    "summary": "Players reassured the nervous scholar.",
    "sentiment": "positive",
    "trustDelta": 1,
    "tags": ["research", "trust"],
    "relationshipChanges": [
      {
        "targetId": "character-uuid",
        "targetType": "character",
        "relationshipType": "ally",
        "delta": 1,
        "description": "Shared valuable research notes."
      }
    ]
  }
}
```

- Inserts a record into `npc_memories` with the supplied summary, sentiment, trust delta, and tags.
- Applies each relationship delta via an upsert into `npc_relationships` (clamped between -5 and 5, with `trust_delta_total` tracking cumulative changes).
- When no summary is provided, the service derives one from the generated response and estimates sentiment using keyword heuristics (default trust delta of +1/-1/0 for positive/negative/neutral output).
- If `interaction` is omitted, the narrative is still recorded but no memory/relationship adjustments occur.

### Error Handling

- `400` – Validation failure (missing required fields, invalid sentiment/relationship values).
- `401` – Missing or invalid authentication token.
- `403` – Caller lacks campaign privileges (non-participant or not a DM/co-DM/admin for restricted routes).
- `404` – Campaign, session, or NPC not found.
- `502` – Provider failure (`error: "narrative_provider_error"`).
- `503` – Enhanced LLM service unavailable (`error: "narrative_service_error"`).

All failures surface factual messages; no canned fallback narratives are returned.

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

Create a campaign for the authenticated DM. The server derives `dm_user_id` from the bearer token; providing a conflicting ID results in a 403 error.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "name": "New Campaign",
  "description": "Campaign description",
  "system": "D&D 5e",          // optional – omit to use the backend default
  "setting": "Eberron",         // optional – null clears any previous value
  "maxPlayers": 6,               // required integer between 1 and 20
  "levelRange": { "min": 1, "max": 10 },
  "status": "recruiting",       // optional; must be recruiting|active|paused|completed
  "isPublic": true,
  "worldMapId": "world-map-uuid" // optional, required when status is "active"
}
```

**Response (201 Created):**
```json
{
  "campaign": {
    "id": "campaign-uuid",
    "name": "New Campaign",
    "dm_user_id": "dm-user-uuid",
    "status": "recruiting",
    "max_players": 6,
    "level_range": { "min": 1, "max": 10 },
    "is_public": true,
    "world_map_id": null,
    "created_at": "2025-09-23T18:45:00.000Z",
    "updated_at": "2025-09-23T18:45:00.000Z"
  }
}
```

**Errors:**
- `400 invalid_*`: Validation failure (empty name, invalid max players, malformed level range, etc.)
- `401 authentication_required`: Missing/invalid bearer token
- `403 dm_mismatch`: Attempted to create a campaign for a different DM
- `409 world_map_required`: Requested `status` of `active` without a `worldMapId`
- `409 campaign_name_conflict`: Campaign name already exists for this DM

### PUT /api/campaigns/:id

Update an existing campaign. Only the owning DM (or an authenticated admin) may perform this action.

**Headers:**
- `Authorization: Bearer <jwt>`

**Parameters:**
- `id`: Campaign UUID

**Request Body:** Partial campaign data. CamelCase and snake_case keys are accepted; the examples below use snake_case to align with the persisted columns.

Optional string fields (`description`, `system`, `setting`) accept either a trimmed string or `null` to clear the stored value.

```json
{
  "name": "Even Greater Campaign",
  "description": "Revised session outline",
  "max_players": 5,
  "level_range": { "min": 3, "max": 7 },
  "status": "active",
  "world_map_id": "world-map-uuid",
  "is_public": false,
  "allow_spectators": true,
  "experience_type": "milestone",
  "resting_rules": "standard",
  "death_save_rules": "hardcore"
}
```

**Response (200 OK):**
```json
{
  "campaign": {
    "id": "campaign-uuid",
    "name": "Even Greater Campaign",
    "description": "Revised session outline",
    "status": "active",
    "max_players": 5,
    "level_range": { "min": 3, "max": 7 },
    "world_map_id": "world-map-uuid",
    "is_public": false,
    "allow_spectators": true,
    "auto_approve_join_requests": false,
    "experience_type": "milestone",
    "resting_rules": "standard",
    "death_save_rules": "hardcore",
    "updated_at": "2025-09-23T19:05:14.000Z"
  }
}
```

**Errors:**
- `400 invalid_*` / `no_changes`: Payload failed validation or contained no recognised fields
- `401 authentication_required`: Missing/invalid bearer token
- `403 Access denied`: Authenticated user is not the campaign DM
- `409 world_map_required`: Cannot set status to `active` without a world map
- `409 campaign_name_conflict`: Campaign name already exists for this DM

### GET /api/campaigns/:campaignId/spawns

Return the current spawn configuration for a campaign. Only the campaign DM or co-DM may access this endpoint.

**Headers:**
- `Authorization: Bearer <jwt>`

**Parameters:**
- `campaignId`: Campaign UUID

**Response (200 OK):**
```json
{
  "spawns": [
    {
      "id": "spawn-uuid",
      "campaignId": "campaign-uuid",
      "name": "Default Spawn",
      "note": "Start outside the tavern",
      "isDefault": true,
      "geometry": {
        "type": "Point",
        "coordinates": [1234.5, 5678.9]
      },
      "createdAt": "2025-09-23T18:45:00.000Z",
      "updatedAt": "2025-09-23T19:10:12.000Z"
    }
  ]
}
```

**Errors:**
- `401 authentication_required`: Missing/invalid bearer token
- `403 spawn_access_forbidden`: Viewer is not a DM/co-DM for the campaign
- `500`: Unexpected database failure

### PUT /api/campaigns/:campaignId/spawn

Upsert (create or replace) the campaign’s default spawn location. The request overwrites the previous spawn if one exists.

> This endpoint powers the campaign prep map in the DM dashboard. The UI surfaces the latest spawn coordinates and note directly from this route so DMs always work against the live database contract.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "name": "Default Spawn",
  "note": "Party arrives via spelljammer",
  "worldPosition": { "x": 1234.5, "y": 5678.9 }
}
```

You may also send `{ "x": 1234.5, "y": 5678.9 }` at the top level or provide `target`, `position`, or `worldPosition` objects with `x`/`y` members. Coordinates are always interpreted in SRID-0 space.

**Response (200 OK):**
```json
{
  "spawn": {
    "id": "spawn-uuid",
    "campaignId": "campaign-uuid",
    "name": "Default Spawn",
    "note": "Party arrives via spelljammer",
    "isDefault": true,
    "geometry": {
      "type": "Point",
      "coordinates": [1234.5, 5678.9]
    },
    "createdAt": "2025-09-23T18:45:00.000Z",
    "updatedAt": "2025-09-23T19:15:22.000Z"
  }
}
```

**Errors:**
- `400 invalid_target`: Payload lacked numeric coordinates
- `401 authentication_required`: Missing/invalid bearer token
- `403 spawn_forbidden`: Viewer is not the campaign’s DM/co-DM (or an admin)
- `500 spawn_upsert_failed`: Unexpected database failure while writing the spawn

### GET /api/campaigns/:campaignId/objectives

Return the objectives defined for a campaign. Only the DM/co-DM (or an admin) may access this list.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{
  "objectives": [
    {
      "id": "objective-uuid",
      "campaignId": "campaign-uuid",
      "parentId": null,
      "title": "Secure the outpost",
      "descriptionMd": "Scout the palisade and disable alarms.",
      "treasureMd": null,
      "combatMd": null,
      "npcsMd": "Captain Ilyra (friendly)",
      "rumoursMd": "Bandits expect reinforcements",
      "location": {
        "type": "pin",
        "pin": { "type": "Point", "coordinates": [1234.5, 678.9] },
        "burgId": null,
        "markerId": null
      },
      "orderIndex": 0,
      "isMajor": true,
      "slug": null,
      "createdAt": "2025-09-23T18:00:00.000Z",
      "updatedAt": "2025-09-23T18:00:00.000Z"
    }
  ]
}
```

**Errors:**
- `401 authentication_required`: Missing/invalid bearer token
- `403 objective_access_forbidden`: Viewer is not a DM/co-DM for the campaign
- `500`: Unexpected database failure

### POST /api/campaigns/:campaignId/objectives

Create a new objective for the campaign.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "title": "Rescue the prisoners",
  "descriptionMd": "Free the villagers before dawn.",
  "parentId": null,
  "locationType": "burg",
  "locationBurgId": "burg-uuid",
  "orderIndex": 0,
  "isMajor": true
}
```

**Response (201 Created):**
```json
{
  "objective": {
    "id": "objective-uuid",
    "campaignId": "campaign-uuid",
    "parentId": null,
    "title": "Rescue the prisoners",
    "descriptionMd": "Free the villagers before dawn.",
    "location": {
      "type": "burg",
      "pin": null,
      "burgId": "burg-uuid",
      "markerId": null
    },
    "orderIndex": 0,
    "isMajor": true,
    "createdAt": "2025-09-23T18:15:00.000Z",
    "updatedAt": "2025-09-23T18:15:00.000Z"
  }
}
```

**Errors:**
- `400 invalid_*`: Payload failed validation (missing title, invalid location, cycle detected, etc.)
- `401 authentication_required`: Missing/invalid bearer token
- `403 objective_forbidden`: Viewer is not a DM/co-DM
- `404 parent_not_found`: Provided parent objective does not exist in the campaign
- `500 objective_create_failed`: Unexpected failure while writing to the database

### PUT /api/objectives/:objectiveId

Update an existing objective. Payload is partial; omit fields you do not wish to change.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (example):**
```json
{
  "title": "Secure the outpost",
  "orderIndex": 1,
  "locationType": "pin",
  "location": { "x": 2345.6, "y": 789.1 },
  "descriptionMd": "Reinforce the barricades before nightfall."
}
```

**Response (200 OK):**
```json
{
  "objective": {
    "id": "objective-uuid",
    "campaignId": "campaign-uuid",
    "parentId": null,
    "title": "Secure the outpost",
    "descriptionMd": "Reinforce the barricades before nightfall.",
    "location": {
      "type": "pin",
      "pin": { "type": "Point", "coordinates": [2345.6, 789.1] },
      "burgId": null,
      "markerId": null
    },
    "orderIndex": 1,
    "isMajor": false,
    "updatedAt": "2025-09-23T18:45:00.000Z"
  }
}
```

**Errors:**
- `400 invalid_*` / `no_changes`: Validation failure or no recognised fields supplied
- `401 authentication_required`: Missing/invalid bearer token
- `403 objective_forbidden`: Viewer is not a DM/co-DM
- `404 parent_not_found`: Provided parent objective does not exist in the campaign
- `404 Objective not found`: Objective ID does not exist
- `500 objective_update_failed`: Unexpected database failure during update

### DELETE /api/objectives/:objectiveId

Delete an objective and all of its descendants.

**Headers:**
- `Authorization: Bearer <jwt>`

**Response (200 OK):**
```json
{
  "deletedObjectiveIds": [
    "objective-uuid",
    "child-objective-uuid"
  ]
}
```

**Errors:**
- `401 authentication_required`: Missing/invalid bearer token
- `403 objective_forbidden`: Viewer is not a DM/co-DM
- `404 Objective not found`: Objective ID does not exist
- `500 objective_delete_failed`: Unexpected database failure during deletion

### POST /api/objectives/:objectiveId/assist/:assistType

Generate narrative support for an objective and persist the resulting markdown field. The `assistType` path parameter must be one of: `description`, `treasure`, `combat`, `npcs`, or `rumours`.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (example):**
```json
{
  "focus": "The party negotiates with the river king",
  "provider": {
    "name": "ollama",
    "model": "qwen3:8b"
  },
  "parameters": {
    "temperature": 0.7
  }
}
```

- `focus` (optional) supplies a short prompt override (≤ 400 characters).
- `provider` (optional) lets you request a specific LLM provider/model configuration.
- `parameters` (optional) forwards provider-specific tuning arguments.

**Response (200 OK):**
```json
{
  "objective": {
    "id": "objective-uuid",
    "campaignId": "campaign-uuid",
    "title": "Secure the outpost",
    "descriptionMd": "## Mission Brief\nHold the bridge until dawn.",
    "treasureMd": null,
    "combatMd": null,
    "npcsMd": null,
    "rumoursMd": null,
    "location": null,
    "orderIndex": 0,
    "isMajor": true,
    "createdAt": "2025-09-23T18:00:00.000Z",
    "updatedAt": "2025-09-24T13:11:00.000Z"
  },
  "assist": {
    "field": "description_md",
    "content": "## Mission Brief\nHold the bridge until dawn.",
    "provider": {
      "name": "ollama",
      "model": "qwen3:8b"
    },
    "metrics": {
      "tokensUsed": 612,
      "latencyMs": 1480
    },
    "cache": {
      "key": "objective:description:objective-uuid",
      "hit": false
    }
  }
}
```

**Errors:**
- `400 objective_assist_empty` / `objective_assist_failed`: LLM returned no content or an unexpected error occurred
- `401 authentication_required`
- `403 objective_forbidden`: Caller lacks DM/co-DM/admin privileges
- `404 Objective not found`
- `503 narrative_service_error`: LLM provider/service unavailable

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
  "message": "Successfully joined campaign",
  "playerId": "campaign-player-uuid",
  "autoPlaced": true
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

## Player Movement & Visibility

### GET /api/campaigns/:campaignId/players/:playerId/trail

Return a GeoJSON LineString of the selected player’s recent movement trail when the caller is authorised to see it. Dungeon masters and co-DMs always receive the full trail; players only receive their own trail or party members that are within the configured visibility radius.

**Headers:**
- `Authorization: Bearer <jwt>`

**Parameters:**
- `campaignId` (path): Campaign UUID
- `playerId` (path): Campaign player UUID
- `radius` (query, optional): Override visibility radius in SRID-0 units (defaults to campaign configuration)

**Response (200 OK):**
```json
{
  "playerId": "campaign-player-uuid",
  "geometry": {
    "type": "LineString",
    "coordinates": [[1234.5, 2345.6], [1236.0, 2348.2]]
  },
  "pointCount": 12,
  "recordedFrom": "2025-09-22T12:34:01.234Z",
  "recordedTo": "2025-09-22T12:38:47.912Z"
}
```

**Cache Behaviour:**
- Success responses include `Cache-Control: private, max-age=5, must-revalidate` and `Vary: Authorization` so short-lived client caching does not leak trail data between users.
- Error responses (`403`, `404`, `500`) set `Cache-Control: no-store, must-revalidate` to prevent intermediaries from persisting denial states.

**Errors:**
- `403`: Viewer is not allowed to see this player’s trail (returned with `trail_hidden` error code)
- `404`: No trail data has been recorded for the campaign player
- `500`: Unexpected database failure while generating the trail

**Coordinate system reminder:** All movement, teleport, spawn, and NPC map coordinates use the SRID-0 “world” space (the same `xworld/yworld` columns exposed on map tables such as `maps_burgs`). If you only have pixel-space values (`x_px/y_px`), convert them with `meters_per_pixel` before calling the API.

## Session Lifecycle

The DM Toolkit’s Session Manager consumes the endpoints below to list, create, start, and finish campaign sessions. All routes expect an authenticated bearer token. Mutating endpoints (`POST`/`PUT`) are limited to the campaign’s DM, co-DM, or an administrator; other campaign members receive `dm_action_forbidden`. Read endpoints require the caller to belong to the campaign and otherwise respond with `campaign_access_forbidden`.

### GET /api/campaigns/:campaignId/sessions

Return the sessions scheduled for a campaign in reverse session-number order.

**Headers:**
- `Authorization: Bearer <jwt>` (required; any campaign member)

**Parameters:**
- `campaignId` (path): Campaign UUID

**Response (200 OK):**
```json
[
  {
    "id": "3e00fd89-7854-4bae-9db3-0ec9098c4a5e",
    "campaign_id": "fd8e6d4e-0f5c-4865-b2f5-6b8fbf87194c",
    "session_number": 6,
    "title": "Siege of the Gloaming Vault",
    "summary": "Party infiltrated the outer ward",
    "dm_notes": "Prep lightning ward for next scene",
    "scheduled_at": "2025-09-25T23:00:00.000Z",
    "started_at": "2025-09-25T23:12:19.000Z",
    "ended_at": "2025-09-26T02:58:03.000Z",
    "duration": 226,
    "experience_awarded": 1200,
    "status": "completed",
    "participant_count": 5,
    "created_at": "2025-09-18T04:02:11.524Z",
    "updated_at": "2025-09-26T02:58:03.442Z"
  }
]
```

**Field notes:**
- `status` is one of `scheduled`, `active`, `completed`, or `cancelled`.
- `participant_count` counts rows in `session_participants` and helps the UI show attendance at-a-glance.
- `duration` is stored as whole minutes.

**Errors:**
- `401 authentication_required`: Missing or invalid bearer token
- `403 campaign_access_forbidden`: Caller is not part of the campaign (also returned when the campaign cannot be found)
- `500 session_list_failed`: Unexpected database failure while fetching sessions

### POST /api/campaigns/:campaignId/sessions

Create a new scheduled session. The server assigns the next sequential `session_number`.

**Headers:**
- `Authorization: Bearer <jwt>` (required; DM/co-DM/Admin)
- `Content-Type: application/json`

**Parameters:**
- `campaignId` (path): Campaign UUID

**Request Body:**
```json
{
  "title": "Arcforge Negotiations",
  "summary": "Prep bullet points for the envoy",
  "dm_notes": "Keep Veilguard ambush in reserve",
  "scheduled_at": "2025-09-30T19:00:00.000Z"
}
```

`title` is required. `summary`, `dm_notes`, and `scheduled_at` are optional and may be `null`.

**Response (201 Created):**
Returns the inserted session row using the same shape as the GET endpoint.

**Errors:**
- `400 Validation failed`: Payload failed schema checks (see `details` array)
- `401 authentication_required`: Missing or invalid bearer token
- `403 dm_action_forbidden`: Caller lacks DM/co-DM/Admin privileges for the campaign
- `404 campaign_not_found`: Campaign does not exist
- `500 session_create_failed`: Unexpected database failure while creating the session

### PUT /api/sessions/:sessionId

Update session status or timing fields (e.g., starting or ending a session). Status transitions follow the live workflow: `scheduled → active → completed`, with `cancelled` available from `scheduled` or `active`.

**Headers:**
- `Authorization: Bearer <jwt>` (required; DM/co-DM/Admin)
- `Content-Type: application/json`

**Parameters:**
- `sessionId` (path): Session UUID

**Request Body:**
```json
{
  "status": "completed",
  "started_at": "2025-09-30T19:07:42.000Z",
  "ended_at": "2025-09-30T22:31:05.000Z",
  "duration": 204,
  "experience_awarded": 850,
  "summary": "Resolved the Arcforge treaty without bloodshed."
}
```

Provide only the fields you intend to change. `duration` expects minutes and `experience_awarded` must be a non-negative integer. Passing `null` clears `summary`, `started_at`, or `ended_at`.

**Response (200 OK):**
The updated session row (identical structure to the GET response).

**Errors:**
- `400 Validation failed`: Payload failed schema checks (see `details` array)
- `400 invalid_status_transition`: Requested status change is not allowed from the current state
- `400 no_updates_provided`: Request omitted all updatable fields
- `401 authentication_required`: Missing or invalid bearer token
- `403 dm_action_forbidden`: Caller lacks DM/co-DM/Admin privileges for the campaign
- `404 session_not_found`: Session does not exist
- `500 session_update_failed`: Unexpected database failure while updating the session

### POST /api/sessions/:sessionId/participants

Attach or update a participant record for a session. The target user must already belong to the campaign roster.

**Headers:**
- `Authorization: Bearer <jwt>` (required; DM/co-DM/Admin)
- `Content-Type: application/json`

**Parameters:**
- `sessionId` (path): Session UUID

**Request Body:**
```json
{
  "user_id": "f53d8d84-ee40-44d6-b646-67c096ef6876",
  "character_id": "c71f4866-1d46-4a92-83ff-33e2ee8f0db1",
  "character_level_start": 6,
  "attendance_status": "present"
}
```

`character_level_start` defaults to `1` when omitted. `attendance_status` defaults to `present` and must be one of `present`, `absent`, `late`, or `left_early`.

**Response (200 OK):**
```json
{ "success": true }
```

**Errors:**
- `400 Validation failed`: Payload failed schema checks (see `details` array)
- `400 character_mismatch`: Character does not belong to the specified user
- `401 authentication_required`: Missing or invalid bearer token
- `403 dm_action_forbidden`: Caller lacks DM/co-DM/Admin privileges for the campaign
- `404 session_not_found`: Session does not exist
- `404 campaign_player_not_found`: User is not part of the campaign
- `404 character_not_found`: Character ID not found
- `500 session_participant_failed`: Unexpected database failure while saving the participant record

### GET /api/sessions/:sessionId/participants

List the participants recorded against a session, including attendance metadata.

**Headers:**
- `Authorization: Bearer <jwt>` (required; any campaign member)

**Parameters:**
- `sessionId` (path): Session UUID

**Response (200 OK):**
```json
[
  {
    "id": "c8186813-53d5-4e79-a5cb-4fa0feb8e5d9",
    "session_id": "3e00fd89-7854-4bae-9db3-0ec9098c4a5e",
    "user_id": "f53d8d84-ee40-44d6-b646-67c096ef6876",
    "character_id": "c71f4866-1d46-4a92-83ff-33e2ee8f0db1",
    "character_name": "Elowen",
    "username": "dungeonmistress",
    "character_level_start": 6,
    "character_level_end": 6,
    "attendance_status": "present"
  }
]
```

**Errors:**
- `401 authentication_required`: Missing or invalid bearer token
- `403 campaign_access_forbidden`: Caller is not part of the campaign
- `404 session_not_found`: Session does not exist
- `500 session_participants_failed`: Unexpected database failure while fetching participants

### DELETE /api/sessions/:sessionId/participants/:userId

Remove a participant from the session roster.

**Headers:**
- `Authorization: Bearer <jwt>` (required; DM/co-DM/Admin)

**Parameters:**
- `sessionId` (path): Session UUID
- `userId` (path): User UUID for the participant to remove

**Response (200 OK):**
```json
{ "success": true }
```

**Errors:**
- `401 authentication_required`: Missing or invalid bearer token
- `403 dm_action_forbidden`: Caller lacks DM/co-DM/Admin privileges for the campaign
- `404 session_not_found`: Session does not exist
- `404 participant_not_found`: The specified user is not currently attached to the session
- `500 session_participant_remove_failed`: Unexpected database failure while removing the participant

## DM Sidebar API

All DM Sidebar endpoints require authentication and restrict write access to the campaign’s DM or co-DM (administrators inherit DM privileges). Unless stated otherwise, error responses use the standard `error`/`message` shape described earlier in this document.

### PUT /api/sessions/:sessionId/focus

Persist the DM’s short focus prompt for a live session.

**Headers:**
- `Authorization: Bearer <jwt>`

**Parameters:**
- `sessionId`: Session UUID

**Request Body:**
```json
{
  "focus": "Chart the necromancer’s escape route"
}
```
`focus` may be a string (≤ 500 characters) or `null` to clear the value.

**Response (200 OK):**
```json
{
  "sessionId": "session-uuid",
  "dmFocus": "Chart the necromancer’s escape route"
}
```

**Errors:**
- `401 authentication_required`: Missing/invalid bearer token
- `403 dm_action_forbidden`: Caller is not the DM/co-DM/admin for the campaign
- `404 session_not_found`: Session does not exist or belongs to another campaign

### PUT /api/sessions/:sessionId/context

Replace or append the DM’s extended context (Markdown). The payload accepts either snake_case or camelCase keys.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "context_md": "## Situation\nThe guard captain requests reinforcements.",
  "mode": "replace" // optional – "append" or "replace" (default)
}
```

- When `mode` is `replace`, the provided markdown overwrites the stored value (pass `null` to clear).
- When `mode` is `append` (or `append: true`), the payload must contain a non-empty string; the API inserts two newlines before the appended text. Combined content is capped at 20,000 characters.

**Response (200 OK):**
```json
{
  "sessionId": "session-uuid",
  "mode": "append",
  "dmContextMd": "## Situation\nThe guard captain requests reinforcements.\n\n## Reinforcements\nTwo griffons arrive at dawn."
}
```

**Errors:**
- `400 context_append_invalid`: Attempted to append an empty/undefined string
- `401 authentication_required`
- `403 dm_action_forbidden`
- `404 session_not_found`
- `422 context_too_long`: Resulting markdown would exceed 20,000 characters

### POST /api/sessions/:sessionId/unplanned-encounter

Create an “active” encounter record on the fly. The caller must supply real encounter text; there are no mocks or stubbed defaults.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "type": "combat",               // combat | social | exploration | puzzle | rumour
  "seed": "Spectral riders ambush the caravan.",
  "difficulty": "hard",           // optional; defaults to medium
  "locationId": "location-uuid"   // optional; validates campaign ownership
}
```

**Response (201 Created):**
```json
{
  "encounter": {
    "id": "encounter-uuid",
    "campaign_id": "campaign-uuid",
    "session_id": "session-uuid",
    "name": "Spectral riders ambush the caravan.",
    "description": "Spectral riders ambush the caravan.",
    "type": "combat",
    "difficulty": "hard",
    "status": "active",
    "created_at": "2025-09-24T10:15:00.000Z",
    "updated_at": "2025-09-24T10:15:00.000Z"
  }
}
```

**Errors:**
- `401 authentication_required`
- `403 dm_action_forbidden`
- `404 session_not_found` / `location_not_found`
- `409 llm_generation_unavailable`: `llm: true` is not yet supported (documented limitation)
- `422 invalid_type`: Type outside the accepted list

### POST /api/npcs/:npcId/sentiment

Log an NPC sentiment adjustment with an optional session linkage and tag metadata. The service writes directly to `npc_memories` and updates long-term trust totals.

**Headers:**
- `Authorization: Bearer <jwt>`

**Parameters:**
- `npcId`: NPC UUID

**Request Body:**
```json
{
  "delta": 3,                         // integer between -10 and 10 (clamped server-side)
  "summary": "The guardian now trusts the party.",
  "sentiment": "positive",           // optional; derived from delta when omitted
  "sessionId": "session-uuid",       // optional; must belong to the same campaign
  "tags": ["reassurance", "trust"]  // optional string array
}
```

**Response (201 Created):**
```json
{
  "memory": {
    "id": "memory-uuid",
    "npc_id": "npc-uuid",
    "campaign_id": "campaign-uuid",
    "session_id": "session-uuid",
    "memory_summary": "The guardian now trusts the party.",
    "sentiment": "positive",
    "trust_delta": 3,
    "tags": ["reassurance", "trust"],
    "created_at": "2025-09-24T10:20:11.000Z"
  }
}
```

**Errors:**
- `401 authentication_required`
- `403 dm_action_forbidden`
- `404 npc_not_found` / `session_not_found`
- `422`: Invalid payload (missing summary, delta outside range, unsupported sentiment)

### POST /api/campaigns/:campaignId/teleport/player

Teleport a campaign player token. Coordinates must be SRID-0 values; the call always records an audit trail entry in `player_movement_audit`.

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "playerId": "campaign-player-uuid",
  "spawnId": "spawn-uuid",             // optional – use saved spawn point
  "target": { "x": 123.45, "y": 678.9 },
  "reason": "DM reposition during encounter"
}
```
Provide either `spawnId` **or** coordinates (accepted keys: `target`, `position`, `worldPosition`, or top-level `x/y`).

**Response (200 OK):**
```json
{
  "playerId": "campaign-player-uuid",
  "geometry": { "type": "Point", "coordinates": [123.45, 678.9] },
  "visibilityState": "visible",
  "lastLocatedAt": "2025-09-24T10:30:00.000Z",
  "mode": "teleport",
  "reason": "DM reposition during encounter",
  "spawn": null
}
```

**Errors:**
- `400 player_required` / `invalid_target`: Missing playerId or coordinates
- `401 authentication_required`
- `403 teleport_forbidden`: Caller lacks DM privileges
- `404 spawn_not_found` / `player_not_found`

### POST /api/campaigns/:campaignId/teleport/npc

Teleport an NPC either to a named location (`current_location_id`) or to direct SRID-0 coordinates (persisted in `world_position`).

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body:**
```json
{
  "npcId": "npc-uuid",
  "locationId": "location-uuid"  // optional; campaign-owned location
}
```
or
```json
{
  "npcId": "npc-uuid",
  "target": { "x": 42.5, "y": 99.1 },
  "reason": "Relocate closer to the party"
}
```

**Response (200 OK):**
```json
{
  "npcId": "npc-uuid",
  "campaignId": "campaign-uuid",
  "currentLocationId": null,
  "worldPosition": {
    "type": "Point",
    "coordinates": [42.5, 99.1]
  }
}
```

**Errors:**
- `400 npc_required` / `destination_required`: Missing identifiers or coordinates
- `401 authentication_required`
- `403 dm_action_forbidden`
- `404 npc_not_found` / `location_not_found`

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

## Realtime WebSocket Events

Questables exposes a Socket.IO server on the same origin as the REST API (`ws://localhost:3001` in development). Authenticate with the same bearer token you use for REST calls (or the local `req.user.id` during trusted development sessions) and emit `join-campaign` with the campaign UUID to receive room-scoped broadcasts. All events below are emitted on the `campaign-<campaignId>` room.

### spawn-updated
- **Emitted When:** A DM/co-DM upserts the default spawn for a campaign.
- **Payload:**
```json
{
  "action": "upserted",
  "spawn": {
    "id": "spawn-uuid",
    "campaignId": "campaign-uuid",
    "name": "Default Spawn",
    "note": "Party arrives via spelljammer",
    "isDefault": true,
    "geometry": { "type": "Point", "coordinates": [1234.5, 5678.9] },
    "createdAt": "2025-09-23T18:45:00.000Z",
    "updatedAt": "2025-09-23T19:15:22.000Z"
  },
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:15:33.121Z"
}
```

### objective-created
- **Emitted When:** A new objective is created via `POST /api/campaigns/:campaignId/objectives`.
- **Payload:**
```json
{
  "objective": {
    "id": "objective-uuid",
    "campaignId": "campaign-uuid",
    "parentId": null,
    "title": "Rescue the prisoners",
    "descriptionMd": "Free the villagers before dawn.",
    "orderIndex": 0,
    "isMajor": true,
    "createdAt": "2025-09-23T18:15:00.000Z",
    "updatedAt": "2025-09-23T18:15:00.000Z"
  },
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:16:02.004Z"
}
```

### objective-updated
- **Emitted When:** An existing objective is changed through `PUT /api/objectives/:objectiveId`.
- **Payload:**
```json
{
  "objective": {
    "id": "objective-uuid",
    "campaignId": "campaign-uuid",
    "parentId": null,
    "title": "Secure the outpost",
    "orderIndex": 1,
    "isMajor": false,
    "updatedAt": "2025-09-24T19:01:11.000Z"
  },
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:18:10.889Z"
}
```

### objective-deleted
- **Emitted When:** `DELETE /api/objectives/:objectiveId` removes an objective tree.
- **Payload:**
```json
{
  "deletedObjectiveIds": [
    "objective-uuid",
    "child-objective-uuid"
  ],
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:20:45.512Z"
}
```

### session-focus-updated
- **Emitted When:** The DM updates a session’s focus via `PUT /api/sessions/:sessionId/focus`.
- **Payload:**
```json
{
  "sessionId": "session-uuid",
  "dmFocus": "Track the baron's envoy",
  "actorId": "user-uuid",
  "updatedAt": "2025-09-24T20:25:00.412Z"
}
```

### session-context-updated
- **Emitted When:** `PUT /api/sessions/:sessionId/context` appends or replaces DM notes.
- **Payload:**
```json
{
  "sessionId": "session-uuid",
  "mode": "append",
  "hasContext": true,
  "contextLength": 240,
  "actorId": "user-uuid",
  "updatedAt": "2025-09-24T20:26:12.901Z"
}
```

### unplanned-encounter-created
- **Emitted When:** A DM records an ad-hoc encounter through `POST /api/sessions/:sessionId/unplanned-encounter`.
- **Payload:**
```json
{
  "encounter": {
    "id": "encounter-uuid",
    "campaign_id": "campaign-uuid",
    "session_id": "session-uuid",
    "location_id": null,
    "name": "Forest ambush",
    "description": "A band of raiders surrounds the path.",
    "type": "combat",
    "difficulty": "medium",
    "status": "active",
    "created_at": "2025-09-24T20:27:44.000Z",
    "updated_at": "2025-09-24T20:27:44.000Z"
  },
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:27:44.812Z"
}
```

### npc-sentiment-adjusted
- **Emitted When:** `POST /api/npcs/:npcId/sentiment` logs a memory entry.
- **Payload:**
```json
{
  "memory": {
    "id": "memory-uuid",
    "npc_id": "npc-uuid",
    "campaign_id": "campaign-uuid",
    "session_id": "session-uuid",
    "memory_summary": "PCs rescued the merchant",
    "sentiment": "positive",
    "trust_delta": 3,
    "tags": ["gratitude"],
    "created_at": "2025-09-24T20:28:55.000Z"
  },
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:28:55.337Z"
}
```

### npc-teleported
- **Emitted When:** A DM relocates an NPC via `POST /api/campaigns/:campaignId/teleport/npc`.
- **Payload:**
```json
{
  "npc": {
    "npcId": "npc-uuid",
    "campaignId": "campaign-uuid",
    "currentLocationId": null,
    "worldPosition": { "type": "Point", "coordinates": [4321.0, 987.6] }
  },
  "mode": "coordinates",
  "actorId": "user-uuid",
  "emittedAt": "2025-09-24T20:30:14.209Z"
}
```

All realtime events deliberately omit narrative text from server-side logs; consumers should persist any required history on the client if extended auditing is needed.
