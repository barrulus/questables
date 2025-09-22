# DM Toolkit — Campaign Manager · Project Scope

## 0) Goal & Non-Goals

**Goal:** Enable DMs to create/edit/manage campaigns, prep content (spawn + objectives), and run sessions with a live DM Sidebar that steers the LLM and controls in-game state.

**Non-Goals (v1):**

- Multiple game systems (assume one).
- Compendium integrations (loot/creatures) – LLM text only.
- Player-side UI scope (this doc covers DM tooling).
- CRS changes – maps use SRID 0 consistently.

## 1) Actors & Definitions

- **DM**: authenticated user with `dm` or `admin`.
- **Campaign**: container for prep, objectives, sessions, world map link.
- **World Map**: `maps_world` (SRID 0) + burgs/markers/routes layers.
- **Objective**: story unit with description, location, treasure, combat, NPCs, rumours.
- **LLM**: contextual service used for assisted drafting.

## 2) Assumptions

- Backend: PostgreSQL 17 + PostGIS (SRID 0), schema aligned with current repo.
- API server: `server/database-server.js` (Express + node-pg).
- Auth: `requireAuth`/`requireRole` middleware working.
- Frontend: OpenLayers map + panels (existing stack).

## 3) User Stories

### 3.1 Campaign CRUD (Prep/Inactive)

- Create a campaign with: `name (unique per DM)`, `description (Markdown)`, `world_map (optional)`, `max_players (1–20)`, `level_range {min,max}`, `is_public`.
- Edit any of the above; change/remove world map.
- Enter **Campaign View** for prep.

### 3.2 Prep Tools (Campaign View)

- **Spawn**: click map → set private spawn pin + **starting scene note** (LLM context).
- **Objectives**:
  - **Single** objective (standalone) with LLM-assisted description.
  - **Multiple** objectives → create a **tree** with LLM-assisted overarching plotline.
  - Each Objective includes:
    - `description_md` (LLM assist)
    - `location` (pin/burg/marker)
    - `treasure_md` (LLM assist)
    - `combat_md` (LLM assist)
    - `npcs_md` (LLM assist)
    - `rumours_md` (LLM assist)

### 3.3 DM Sidebar (Active Session)

- Prompt Focus (short text) and Add Context (Markdown) for LLM.
- Introduce unplanned encounters (combat/social/exploration/rumour).
- Adjust NPC sentiment.
- Move/Teleport players or NPCs.

## 4) Functional Requirements

### 4.1 Campaign Model

- `campaigns`: `name`, `description`, `dm_user_id`, `world_map_id?`, `max_players`, `level_range {min,max}`, `is_public`, timestamps.
- Uniqueness: `(dm_user_id, lower(name))`.

### 4.2 Spawn Point

- `campaign_spawns`: point (SRID 0), `note`, `is_default` (<=1 per campaign).

### 4.3 Objectives

- `campaign_objectives`:
  - Hierarchy via `parent_id` (tree).
  - Location: one of `pin (Point,0)` | `burg (maps_burgs.id)` | `marker (maps_markers.id)`.
  - Content fields: `description_md`, `treasure_md`, `combat_md`, `npcs_md`, `rumours_md`.

### 4.4 DM Sidebar Session Fields

- `sessions`: add optional `dm_focus TEXT`, `dm_context_md TEXT`.

### 4.5 Teleport & Audit

- Player movement updates `campaign_players.loc_current` (SRID 0) + `player_movement_audit` insert.

## 5) API Surface (Minimal)

### Campaigns

- `POST /api/campaigns`
- `PUT /api/campaigns/:id`
- `GET /api/campaigns/:id`
- `GET /api/users/:userId/campaigns`
- `GET /api/campaigns/public` (existing)

### Spawn

- `PUT /api/campaigns/:campaignId/spawn` `{ x, y, note }`

### Objectives

- `POST /api/campaigns/:campaignId/objectives`
- `GET /api/campaigns/:campaignId/objectives`
- `PUT /api/objectives/:objectiveId`
- `DELETE /api/objectives/:objectiveId`

### Objective LLM Assist

- `POST /api/objectives/:objectiveId/assist/description`
- `POST /api/objectives/:objectiveId/assist/treasure`
- `POST /api/objectives/:objectiveId/assist/combat`
- `POST /api/objectives/:objectiveId/assist/npcs`
- `POST /api/objectives/:objectiveId/assist/rumours`

### DM Sidebar

- `PUT /api/sessions/:sessionId/focus` `{ focus }`
- `PUT /api/sessions/:sessionId/context` `{ context_md }`
- `POST /api/sessions/:sessionId/unplanned-encounter` `{ type, seed, llm? }`
- `POST /api/npcs/:npcId/sentiment` `{ delta, summary }`
- `POST /api/campaigns/:campaignId/teleport/player` `{ player_id, x, y, reason }`
- `POST /api/campaigns/:campaignId/teleport/npc` `{ npc_id, location_id? x? y? }`

## 6) Data Model (DDL Sketch)

```sql
-- Unique name per DM
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_name_per_dm
  ON public.campaigns (dm_user_id, lower(name));

-- Spawn
CREATE TABLE IF NOT EXISTS public.campaign_spawns (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default Spawn',
  note TEXT,
  world_position geometry(Point, 0) NOT NULL,
  is_default BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_default
  ON public.campaign_spawns (campaign_id) WHERE is_default = true;

-- Objectives
CREATE TABLE IF NOT EXISTS public.campaign_objectives (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.campaign_objectives(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description_md TEXT,
  location_type TEXT CHECK (location_type IN ('pin','burg','marker')),
  location_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
  location_marker_id UUID REFERENCES public.maps_markers(id) ON DELETE SET NULL,
  location_pin geometry(Point, 0),
  treasure_md TEXT,
  combat_md TEXT,
  npcs_md TEXT,
  rumours_md TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objectives_campaign ON public.campaign_objectives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_objectives_parent ON public.campaign_objectives(parent_id);
CREATE INDEX IF NOT EXISTS idx_objectives_pin_gix ON public.campaign_objectives USING GIST(location_pin);

-- Session extras
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS dm_focus TEXT,
  ADD COLUMN IF NOT EXISTS dm_context_md TEXT;
```

## 7) Security

- All endpoints require auth.
- DM/co-DM of a campaign required for edits, prep, and sidebar actions.

## 8) Acceptance Criteria (Spot Checks)

- Duplicate campaign `name` for same DM rejected; allowed for different DMs.
- Spawn pin saved, private to DM/co-DM.
- Objective tree persists & renders hierarchically; reorder persists.
- Objective location stored in chosen mode (pin/burg/marker).
- DM Sidebar writes focus/context; unplanned encounters appear in encounter list.
- Teleport writes both location and movement audit.
- All geoms SRID 0; spatial indexes used.

## 9) Milestones

- **M0** DB migrations + API stubs + auth guards.
- **M1** Campaign CRUD UI + world map selector.
- **M2** Campaign View: Spawn + Objectives (single/multi/tree + LLM assists).
- **M3** DM Sidebar: focus/context, unplanned encounters, sentiment, teleport.
- **M4** Polish: audit logs, empty states, error toasts, docs, tests.
