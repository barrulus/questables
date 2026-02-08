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
│    │    OpenLayers Map     │  Messages  │
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
│   └── ...
├── services/         # Business logic
│   ├── campaigns/
│   │   └── service.js
│   ├── srd/
│   │   ├── service.js
│   │   └── stats-engine.js
│   └── ...
└── llm/              # LLM provider abstraction
    ├── enhanced-llm-service.js
    ├── provider-registry.js
    └── providers/
```

Routes handle HTTP concerns (parsing, validation, status codes). Services contain all business logic and database queries.

## Frontend Architecture

### Key Patterns

1. **Context API** — `UserContext` for auth state, `GameSessionContext` for active campaign/session
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

## Related Documentation

- [API Reference](./api-reference.md) — Full endpoint documentation
- [Database Schema](./database-schema.md) — Tables, indexes, and relationships
- [Frontend Guide](./frontend-guide.md) — Component patterns and state management
- [Mapping System](./mapping-system.md) — OpenLayers integration details
- [Character Wizard](./character-wizard.md) — Character creation flow
- [LLM Integration](./llm-integration.md) — Narrative generation system
- [WebSocket Events](./websocket-events.md) — Real-time event reference
- [Development Guide](./development-guide.md) — Setup, testing, and contributing
