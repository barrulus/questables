# Architecture Overview

Questables is a D&D 5e campaign management application with integrated world mapping, character creation, real-time gameplay, and AI-powered narrative generation.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| UI Components | Radix UI (ShadCN/UI) |
| Mapping | OpenLayers 10.x with custom pixel projection |
| Backend | Express.js (Node.js) |
| Database | PostgreSQL 17 + PostGIS |
| Real-time | Socket.io |
| LLM | Ollama (provider-abstracted) |
| Testing | Jest, React Testing Library |

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │  React    │  │ OpenLayers│  │  Socket.io   │ │
│  │  App      │  │  Map      │  │  Client      │ │
│  └────┬─────┘  └─────┬─────┘  └──────┬───────┘ │
└───────┼───────────────┼───────────────┼─────────┘
        │ HTTP/REST     │ HTTP (tiles)  │ WebSocket
        ▼               ▼               ▼
┌─────────────────────────────────────────────────┐
│              Express.js Server (:3001)           │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │  Routes   │  │ Services  │  │  WebSocket   │ │
│  │  (REST)   │  │ (Logic)   │  │  Server      │ │
│  └────┬─────┘  └─────┬─────┘  └──────────────┘ │
│       │        ┌──────┴──────┐                   │
│       │        │ LLM Service │                   │
│       │        │ (Ollama)    │                   │
│       │        └─────────────┘                   │
└───────┼─────────────────────────────────────────┘
        │ SQL + PostGIS
        ▼
┌─────────────────────────────────────────────────┐
│          PostgreSQL 17 + PostGIS                 │
│  ┌────────┐ ┌──────────┐ ┌───────────────────┐ │
│  │ Users  │ │ Campaigns│ │ Spatial (PostGIS)  │ │
│  │ Chars  │ │ Sessions │ │ Maps, Burgs, Cells │ │
│  │ SRD    │ │ NPCs     │ │ Routes, Rivers     │ │
│  └────────┘ └──────────┘ └───────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Application States

The frontend operates as a single-page application with four top-level states:

| State | Description |
|-------|-------------|
| `landing` | Pre-login landing page with auth modals |
| `dashboard` | Post-login hub with player/DM/admin views |
| `game` | Active gameplay with map, chat, and tool panels |
| `character-create` | 7-step character creation wizard |

### Dashboard Views

- **Player** — Character list, campaign membership, session history
- **DM** — Campaign management, NPC editor, session planning (requires `dm` role)
- **Admin** — System metrics, LLM monitoring, cache governance (requires `admin` role)

### Game View Layout

```
┌────┬──────────────────────┬────────────┐
│Icon│     Map (center)      │   Chat     │
│Side│                       │   Panel    │
│bar │                       │            │
│    │    OpenLayers Map      │  Messages  │
│    │    with layers        │  Dice Rolls│
│    │                       │            │
│    ├──────────────────────┤│            │
│    │  Tool Panel (opt.)   ││            │
└────┴──────────────────────┴────────────┘
```

## Backend Architecture

### Request Pipeline

```
Request → Rate Limiter → CORS → Auth Middleware → Route Handler → Service → Database
                                                                           ↓
Response ← JSON Serialization ← Error Handler ← Service Result ← Query Result
```

### Service Layer Pattern

Each domain has its own route + service pair:

```
server/
├── routes/           # HTTP endpoint definitions
│   ├── auth.routes.js
│   ├── campaigns.routes.js
│   ├── game-state.routes.js
│   ├── rest.routes.js          # Rest phase endpoints (WS5)
│   ├── levelling.routes.js     # Level-up endpoints (WS6)
│   ├── shop.routes.js          # NPC shop CRUD, inventory, purchase endpoints
│   ├── loot.routes.js          # Loot table CRUD, roll endpoint
│   └── ...
├── services/         # Business logic
│   ├── campaigns/
│   │   └── service.js
│   ├── game-state/
│   │   ├── service.js        # Core state machine (phase, turns)
│   │   ├── transitions.js    # Phase transition rules
│   │   └── turn-order.js     # Turn order computation
│   ├── dm-action/
│   │   └── service.js        # LLM action processing pipeline (WS3)
│   ├── combat/
│   │   ├── service.js          # Combat initiation, turn budget, resolution (WS4)
│   │   ├── enemy-turn-service.js # LLM-controlled enemy turns (WS4)
│   │   └── death-saves.js      # Death save logic, HP-zero handling (WS6)
│   ├── live-state/
│   │   └── service.js        # Session-scoped mutable character state (WS3)
│   ├── regions/
│   │   └── trigger-service.js # Map region entry detection (WS3)
│   ├── rest/
│   │   └── service.js        # Short/long rest mechanics, hit die spending (WS5)
│   ├── levelling/
│   │   └── service.js        # XP thresholds, level-up application (WS6)
│   ├── shop/
│   │   └── service.js        # NPC shop CRUD, inventory, purchases
│   ├── loot/
│   │   └── service.js        # Loot table CRUD, weighted random rolling
│   ├── srd/
│   │   ├── service.js
│   │   └── stats-engine.js
│   └── ...
└── llm/              # LLM provider abstraction
    ├── enhanced-llm-service.js
    ├── provider-registry.js
    ├── providers/
    ├── schemas/
    │   └── dm-response-schema.js  # JSON schema for structured LLM output (WS3)
    └── context/
        └── action-prompt-builder.js # Action + world turn prompt construction (WS3)
```

Routes handle HTTP concerns (parsing, validation, status codes). Services contain all business logic and database queries.

## Frontend Architecture

### Key Patterns

1. **Context API** — `UserContext` for auth state, `GameSessionContext` for active campaign/session, `GameStateContext` for game phase/turn state, `ActionContext` for player action lifecycle, `LiveStateContext` for session-scoped mutable character state
2. **Reducer pattern** — Character wizard uses `useReducer` for complex multi-step state
3. **Singleton pattern** — `MapDataLoader` manages spatial data loading
4. **Factory pattern** — Layer and style factories for OpenLayers configuration
5. **Ref-based callbacks** — Stable event handlers that read from refs to avoid re-registration of OpenLayers listeners

### Component Organization

```
components/
├── ui/                    # Radix UI primitives (button, card, dialog, etc.)
├── layers/                # OpenLayers layer factories
├── maps/                  # Map utilities (styles, tooltips, tile sources)
├── character-wizard/      # Character creation wizard (7 steps)
│   ├── steps/             # Individual wizard steps
│   └── preview/           # Live character preview panel
├── game-state/            # Game phase & turn UI
│   ├── phase-indicator.tsx  # Phase badge (exploration/combat/social/rest)
│   └── turn-banner.tsx      # Turn status strip with action buttons
├── action-panel/          # Player action declaration (WS3)
│   ├── action-panel.tsx     # Main panel (visible on player's turn)
│   ├── action-grid.tsx      # Action type buttons (move, search, cast, etc.)
│   ├── roll-prompt.tsx      # Dice roll submission UI
│   ├── npc-picker.tsx       # NPC selection for social phase (WS5)
│   ├── social-action-grid.tsx # Social action buttons (WS5)
│   ├── rest-panel.tsx       # Rest phase UI — hit dice, rest completion (WS5)
│   └── death-save-panel.tsx # Death save UI — roll saves at 0 HP (WS6)
├── compendium/            # SRD Compendium browser + shop/loot management
│   ├── compendium-panel.tsx   # Tabbed container (Items/Spells/Shops/Loot)
│   ├── item-browser.tsx       # Searchable/filterable SRD item list
│   ├── spell-browser.tsx      # Searchable/filterable SRD spell list
│   ├── item-detail-card.tsx   # Rich item detail view
│   ├── spell-detail-card.tsx  # Rich spell detail view
│   ├── shop-view.tsx          # Player-facing shop browser with purchase
│   ├── shop-editor.tsx        # DM shop CRUD + LLM auto-stock
│   └── loot-table-editor.tsx  # DM loot table builder with weighted rolls
├── live-state/            # Session-scoped character state (WS3)
│   └── live-state-bar.tsx   # Compact HP bar + conditions + death saves + hit dice display
├── chat-channel-tabs.tsx  # Chat channel tab bar (party/whisper/narration/private)
├── openlayers-map.tsx     # Main game map
├── campaign-prep-map.tsx  # DM preparation map
├── player-dashboard.tsx   # Player home
├── dm-dashboard.tsx       # DM home
└── admin-dashboard.tsx    # Admin home
```

## Authentication & Authorization

- **JWT-based** — Tokens issued on login with 24h expiry
- **Password hashing** — bcrypt with configurable salt rounds
- **Role-based access** — `player`, `dm`, `admin` roles stored as arrays on `user_profiles`
- **Campaign ownership** — Separate middleware checks DM ownership for campaign mutations
- **No demo mode** — All auth flows require a live database; no fallback accounts

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| PostGIS for spatial data | Native spatial indexing and queries for map features |
| JSONB for D&D data | Flexible schema for abilities, inventory, spells without migration churn |
| UUID primary keys | Distributed-friendly, no sequential enumeration |
| Pixel-space projection (SRID 0) | Maps use pixel coordinates from Azgaar's Fantasy Map Generator |
| Provider-abstracted LLM | Swap Ollama for other providers without changing service code |
| Ref-based OL callbacks | OpenLayers listeners must be stable references to avoid re-registration |
| Server-side stat computation | Single source of truth for character stats via `/api/srd/compute-stats` |
| Server-authoritative game state | Game phase/turn stored as JSONB on sessions, mutated via SELECT FOR UPDATE, logged to audit table |
| Non-blocking LLM action calls | Action POST returns `{ actionId, status }` immediately; LLM runs async, results broadcast via WebSocket |
| Server-authoritative live state | `session_live_states` table shadows mutable character fields during session; all mutations go through server PATCH |
| Structured LLM output | Ollama `format` parameter enforces JSON schema on DM responses (narration, mechanical outcomes, required rolls, phase transitions) |
| Channel-based chat routing | Private/whisper messages delivered only to sender+target via per-user socket tracking |

## Related Documentation

- [API Reference](./api-reference.md) — Full endpoint documentation
- [Database Schema](./database-schema.md) — Tables, indexes, and relationships
- [Frontend Guide](./frontend-guide.md) — Component patterns and state management
- [Mapping System](./mapping-system.md) — OpenLayers integration details
- [Character Wizard](./character-wizard.md) — Character creation flow
- [LLM Integration](./llm-integration.md) — Narrative generation system
- [WebSocket Events](./websocket-events.md) — Real-time event reference
- [Development Guide](./development-guide.md) — Setup, testing, and contributing
