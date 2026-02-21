# Frontend Guide

## Stack

- **React 19** with TypeScript
- **Vite** for dev server and builds
- **Tailwind CSS v4** for styling
- **Radix UI / ShadCN** for UI primitives (`components/ui/`)
- **OpenLayers 10** for map rendering
- **Socket.io Client** for real-time features

## Directory Structure

```
├── App.tsx                      # Root component, top-level routing
├── main.tsx                     # Vite entry point
├── components/
│   ├── ui/                      # ~40 Radix/ShadCN primitives
│   ├── layers/                  # OpenLayers layer factories
│   ├── maps/                    # Map utilities (styles, tooltips)
│   ├── character-wizard/        # Character creation (see character-wizard.md)
│   ├── openlayers-map.tsx       # Game map
│   ├── campaign-prep-map.tsx    # DM prep map
│   ├── player-dashboard.tsx     # Player home screen
│   ├── dm-dashboard.tsx         # DM toolkit
│   ├── admin-dashboard.tsx      # System administration
│   ├── campaign-manager.tsx     # Campaign CRUD
│   ├── campaign-prep.tsx        # DM campaign preparation
│   ├── character-manager.tsx    # Character list
│   ├── character-sheet.tsx      # Character sheet view
│   ├── chat-panel.tsx           # In-game chat
│   ├── combat-tracker.tsx       # Initiative and combat
│   ├── session-manager.tsx      # Session lifecycle
│   ├── npc-manager.tsx          # NPC management
│   ├── objectives-panel.tsx     # Quest objectives tree
│   ├── narrative-console.tsx    # LLM narrative generation
│   ├── compendium/              # SRD Compendium browser
│   │   ├── compendium-panel.tsx     # Tabbed container (Items/Spells/Shops/Loot)
│   │   ├── item-browser.tsx         # SRD item search + filter + pagination
│   │   ├── spell-browser.tsx        # SRD spell search + filter + pagination
│   │   ├── item-detail-card.tsx     # Rich item detail view
│   │   ├── spell-detail-card.tsx    # Rich spell detail view
│   │   ├── shop-view.tsx            # Player shop browser + purchase
│   │   ├── shop-editor.tsx          # DM shop CRUD + auto-stock
│   │   └── loot-table-editor.tsx    # DM loot table builder + rolling
│   ├── inventory.tsx            # Character inventory
│   ├── spellbook.tsx            # Spell management (SRD detail resolution)
│   └── map-data-loader.tsx      # Singleton for loading map data
├── contexts/
│   ├── UserContext.tsx           # Authentication state
│   └── GameSessionContext.tsx    # Active campaign/session
├── utils/
│   ├── api-client.ts            # HTTP client with auth headers
│   ├── api/srd.ts               # SRD API (items, spells, search, pagination)
│   ├── api/loot.ts              # Loot table API (CRUD, roll)
│   ├── srd/types.ts             # SRD TypeScript interfaces
│   ├── srd/constants.ts         # D&D constants
│   ├── world-map-cache.ts       # Map data caching
│   ├── sanitization.tsx         # DOMPurify input sanitization
│   └── error-handler.tsx        # Centralized error handling
└── styles/
    └── globals.css              # Tailwind v4 config
```

## State Management

### UserContext

Provides authentication state globally.

```typescript
interface UserContextValue {
  user: UserProfile | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}
```

- JWT stored in `localStorage`
- Token attached to all API requests via `api-client.ts`
- Stale sessions are detected and cleared automatically

### GameSessionContext

Manages the active campaign and session.

```typescript
interface GameSessionState {
  activeCampaignId: string | null;
  activeCampaign: CampaignMetadata | null;
  latestSession: SessionMetadata | null;
  loading: boolean;
  error: string | null;
  visibilityRadius: number | null;
  viewerRole: string | null;
}
```

- Campaign ID persisted in `localStorage` (`dnd-active-campaign`)
- `selectCampaign(id)` fetches campaign metadata and latest session
- `updateVisibilityMetadata()` updates fog-of-war settings

### Character Wizard Context

Uses `useReducer` for complex multi-step form state. See [Character Wizard docs](./character-wizard.md).

## API Client

`utils/api-client.ts` wraps `fetch` with:

- Base URL from `VITE_DATABASE_SERVER_URL`
- Automatic `Authorization: Bearer <token>` header
- JSON serialization/deserialization
- Error response parsing

```typescript
import { apiClient } from '@/utils/api-client';

const campaigns = await apiClient.get('/campaigns/public');
await apiClient.post('/characters', characterData);
```

## UI Components

All UI primitives live in `components/ui/` and follow ShadCN/UI conventions:

- Composable with `className` props
- Built on Radix UI headless components
- Styled with Tailwind CSS utility classes
- `cn()` utility (from `clsx` + `tailwind-merge`) for class merging

Available components include: `Button`, `Card`, `Dialog`, `Input`, `Label`, `Select`, `Tabs`, `Table`, `ScrollArea`, `Badge`, `Checkbox`, `RadioGroup`, `Separator`, `Sheet`, `Tooltip`, `Toast`, and more.

## Component Patterns

### Dashboard Components

Each dashboard (player, DM, admin) fetches its own data on mount and manages local loading/error states. They use `UserContext` for the current user and `apiClient` for data fetching.

### Map Components

Two map components share utilities but serve different purposes:

| Component | Purpose | Users |
|-----------|---------|-------|
| `openlayers-map.tsx` | Game map during active sessions | All players |
| `campaign-prep-map.tsx` | Campaign preparation and region drawing | DMs only |

Both use:
- Layer factories from `components/layers/`
- Style factory from `maps/questables-style-factory.ts`
- Tooltip utilities from `maps/feature-tooltip.ts`
- `MapDataLoader` singleton for data fetching

### Stable Callback Pattern

OpenLayers event listeners must be stable references. The codebase uses refs to avoid re-registering listeners:

```typescript
// Store changing state in a ref
const layerVisibilityRef = useRef(layerVisibility);
useEffect(() => { layerVisibilityRef.current = layerVisibility; }, [layerVisibility]);

// Callback reads from ref — never recreated
const handleMapClick = useCallback((e: MapBrowserEvent) => {
  const visibility = layerVisibilityRef.current;  // read from ref
  // ... handle click
}, []);  // empty deps — stable reference
```

### Markdown Rendering

SRD content contains markdown formatting. The `character-wizard/markdown-text.tsx` component handles:

- `**bold**` and `*italic*` inline formatting
- Multi-paragraph text (blank line separation)
- Pipe tables with header detection
- Key-value table styling (2-column tables with bold left column)

```tsx
import { MarkdownText } from './markdown-text';

<MarkdownText text={feature.desc} className="text-sm text-muted-foreground" />
```

## Build Configuration

### Vite (`vite.config.ts`)

- Dev server on port 3000
- Optional HTTPS/TLS support
- Code splitting: `vendor`, `ui`, `utils` chunks
- Path alias: `@/` → project root
- OpenLayers pre-bundled for faster dev starts

### TypeScript (`tsconfig.json`)

- Target: ES2020
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` → `./*`

## Error Handling

- **Error boundaries** catch rendering errors application-wide
- **Toast notifications** for user-facing errors from API calls
- **Loading states** with consistent spinner patterns
- **No fallback data** — errors are surfaced, not masked with dummy content
