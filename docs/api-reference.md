# API Reference

Base URL: `http://localhost:3001/api`

All endpoints return JSON. Protected endpoints require a `Bearer` token in the `Authorization` header.

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Database connection status and pool statistics |

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Authenticate user, returns JWT |
| POST | `/auth/register` | No | Create new user account |

### POST /auth/login

```json
// Request
{ "email": "user@example.com", "password": "secret" }

// Response
{ "token": "eyJ...", "user": { "id": "uuid", "username": "...", "roles": ["player"] } }
```

### POST /auth/register

```json
// Request
{ "username": "adventurer", "email": "user@example.com", "password": "secret" }

// Response
{ "token": "eyJ...", "user": { "id": "uuid", "username": "adventurer", "roles": ["player"] } }
```

---

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/profile` | Yes | Get current user's profile |
| PUT | `/users/profile` | Yes | Update current user's profile |
| GET | `/users/:userId/characters` | Yes | List user's characters |
| GET | `/users/:userId/campaigns` | Yes | List user's campaigns |

---

## Characters

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/characters` | Yes | Create a character |
| GET | `/characters/:id` | Yes | Get character details |
| DELETE | `/characters/:id` | Yes | Delete a character (owner only) |

### POST /characters

```json
// Request
{
  "name": "Elara",
  "species": "srd-2024_elf",
  "class": "srd-2024_wizard",
  "level": 1,
  "abilities": { "strength": 8, "dexterity": 14, ... },
  "background": "srd-2024_sage",
  "inventory": [],
  "spells": ["srd-2024_fire-bolt", "srd-2024_mage-hand"],
  "equipment": ["Quarterstaff", "Arcane Focus"]
}
```

---

## Campaigns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/campaigns` | Yes | Create a campaign |
| GET | `/campaigns/public` | Yes | List public campaigns |
| GET | `/campaigns/:id` | Yes | Get campaign details |
| PUT | `/campaigns/:id` | Yes (DM) | Update campaign |
| DELETE | `/campaigns/:id` | Yes (DM) | Delete campaign |
| POST | `/campaigns/:id/players` | Yes | Add player to campaign |
| DELETE | `/campaigns/:id/players/:userId` | Yes (DM) | Remove player |
| GET | `/campaigns/:id/characters` | Yes | List campaign characters |
| PUT | `/campaigns/:id/spawn` | Yes (DM) | Set campaign spawn point |

### Campaign Objectives

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/campaigns/:id/objectives` | Yes | List campaign objectives |
| POST | `/campaigns/:id/objectives` | Yes (DM) | Create objective |
| PUT | `/campaigns/:id/objectives/:objId` | Yes (DM) | Update objective |
| DELETE | `/campaigns/:id/objectives/:objId` | Yes (DM) | Delete objective |

---

## Maps

### World Maps

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/maps/world` | Yes | Create world map |
| GET | `/maps/world` | Yes | List all world maps |
| GET | `/maps/world/:id` | Yes | Get world map by ID |
| GET | `/maps/tilesets` | Yes | List available tile sets |

### Spatial Data

All spatial endpoints support a `bounds` query parameter in the format `minX,minY,maxX,maxY` for viewport-based filtering.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/maps/:worldId/burgs` | Yes | List settlements (query: `bounds`) |
| GET | `/maps/:worldId/burgs/search` | Yes | Search settlements (query: `q`, `limit`) |
| GET | `/maps/:worldId/markers` | Yes | List map markers (query: `bounds`) |
| GET | `/maps/:worldId/rivers` | Yes | List rivers (query: `bounds`) |
| GET | `/maps/:worldId/routes` | Yes | List roads/routes (query: `bounds`) |
| GET | `/maps/:worldId/cells` | Yes | List terrain cells (query: `bounds`) |

### Settlements

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/maps/settlements/:burgId/info` | Yes | Get settlement details |
| GET | `/maps/settlements/:burgId/tiles/:z/:x/:y.png` | Yes | Get settlement tile image |

### Campaign Map Regions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/campaigns/:id/map-regions` | Yes | List DM-drawn map regions |
| POST | `/campaigns/:id/map-regions` | Yes (DM) | Create map region |
| PUT | `/campaigns/:id/map-regions/:regionId` | Yes (DM) | Update map region |
| DELETE | `/campaigns/:id/map-regions/:regionId` | Yes (DM) | Delete map region |

### Campaign Locations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/campaigns/:id/locations` | Yes | Create campaign location |
| GET | `/campaigns/:id/locations` | Yes | List campaign locations |

---

## Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sessions/campaigns/:campaignId/sessions` | Yes | List sessions for campaign |
| GET | `/sessions/:sessionId/participants` | Yes | List session participants |

---

## Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/campaigns/:id/messages` | Yes | Send chat message |
| GET | `/campaigns/:id/messages` | Yes | Get message history |
| GET | `/campaigns/:id/messages/recent` | Yes | Get recent messages |
| DELETE | `/campaigns/:id/messages/:msgId` | Yes | Delete message |

---

## Encounters

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/encounters/campaigns/:id/encounters` | Yes (DM) | Create encounter |
| GET | `/encounters/campaigns/:id/encounters` | Yes | List encounters |
| GET | `/encounters/:id` | Yes | Get encounter details |
| PUT | `/encounters/:id` | Yes (DM) | Update encounter |
| DELETE | `/encounters/:id` | Yes (DM) | Delete encounter |

---

## NPCs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/npcs/campaigns/:id/npcs` | Yes (DM) | Create NPC |
| GET | `/npcs/campaigns/:id/npcs` | Yes | List campaign NPCs |
| PUT | `/npcs/:npcId` | Yes (DM) | Update NPC |
| DELETE | `/npcs/:npcId` | Yes (DM) | Delete NPC |
| POST | `/npcs/:npcId/relationships` | Yes (DM) | Create NPC relationship |
| GET | `/npcs/:npcId/relationships` | Yes | Get NPC relationships |

---

## Narratives (LLM)

All narrative endpoints require DM/co-DM/admin access unless noted. Each call persists a row in `llm_narratives`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/campaigns/:id/narratives/dm` | DM | Generate DM narration |
| POST | `/campaigns/:id/narratives/scene` | DM | Generate scene description |
| POST | `/campaigns/:id/narratives/npc` | DM | Generate NPC dialogue |
| POST | `/campaigns/:id/narratives/action` | Any | Narrate action outcome |
| POST | `/campaigns/:id/narratives/quest` | DM | Generate quest outline |

Provider failures surface as `502`/`503` responses — no fallback content is returned.

---

## SRD (System Reference Document)

These endpoints serve D&D 5e reference data. All support a `source` query parameter to filter by SRD source (e.g., `srd-2024`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/srd/species` | No | List all species |
| GET | `/srd/species/:key` | No | Get species with subspecies and traits |
| GET | `/srd/classes` | No | List all classes |
| GET | `/srd/classes/:key` | No | Get class with features, subclasses, saving throws |
| GET | `/srd/backgrounds` | No | List all backgrounds |
| GET | `/srd/backgrounds/:key` | No | Get background with benefits |
| GET | `/srd/spells` | No | List spells (query: `source`, `level`, `ritual`, `class`) |
| GET | `/srd/spells/:key` | No | Get spell with class associations |
| GET | `/srd/items` | No | List items (query: `source`, `category`) |
| GET | `/srd/feats` | No | List feats (query: `source`, `type`) |
| GET | `/srd/conditions` | No | List all conditions |
| POST | `/srd/compute-stats` | No | Compute derived character statistics |

### POST /srd/compute-stats

Server-side stat computation engine. Returns derived stats from base character data.

```json
// Request
{
  "classKey": "srd-2024_wizard",
  "speciesKey": "srd-2024_elf",
  "subraceKey": "srd-2024_high-elf",
  "backgroundKey": "srd-2024_sage",
  "level": 1,
  "abilities": {
    "strength": 8, "dexterity": 14, "constitution": 13,
    "intelligence": 15, "wisdom": 12, "charisma": 10
  }
}

// Response
{
  "abilities": {
    "strength": { "score": 8, "modifier": -1 },
    "dexterity": { "score": 14, "modifier": 2 },
    ...
  },
  "hitPoints": { "max": 7 },
  "armorClass": 12,
  "speed": 30,
  "proficiencyBonus": 2,
  "skills": {
    "arcana": { "modifier": 4, "proficient": true },
    ...
  },
  "savingThrows": {
    "intelligence": { "modifier": 4, "proficient": true },
    ...
  },
  "spellcasting": {
    "ability": "intelligence",
    "attackBonus": 4,
    "saveDC": 12,
    "slots": [2]
  }
}
```

### Item Categories

Valid values for the `category` query parameter on `/srd/items`:

- `weapon`
- `armor`
- `adventuring-gear`
- `tools`
- `ammunition`
- `equipment-pack`
- `spellcasting-focus`

---

## Uploads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/uploads/avatar` | Yes | Upload user avatar (max 50MB) |
| POST | `/uploads/map` | Yes | Upload map file (JSON/image) |
| POST | `/uploads/campaigns/:id/assets` | Yes (DM) | Upload campaign asset |
| GET | `/uploads/campaigns/:id/assets` | Yes | List campaign assets |

---

## Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/metrics` | Admin | System metrics |
| GET | `/admin/llm/metrics` | Admin | LLM usage metrics (latency, tokens, requests) |
| GET | `/admin/llm/cache` | Admin | LLM cache entries |
| DELETE | `/admin/llm/cache` | Admin | Clear entire LLM cache |
| DELETE | `/admin/llm/cache/:key` | Admin | Clear specific cache entry |
| GET | `/admin/llm/providers` | Admin | List LLM providers with health |

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Not authenticated |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 429 | Rate limited (1000 req / 15 min) |
| 502 | LLM provider error |
| 503 | LLM provider unavailable |
| 500 | Internal server error |
