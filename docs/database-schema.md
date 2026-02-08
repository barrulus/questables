# Database Schema

PostgreSQL 17 with PostGIS extension. All tables use UUID primary keys and `updated_at` triggers.

Schema file: `database/schema.sql`

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive text for usernames/emails
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- UUID generation
```

## Entity Relationship Overview

```
user_profiles ─┬── characters ─── encounter_participants
               │                        │
               ├── campaign_players ── campaigns ─┬── sessions
               │                                  ├── encounters
               │                                  ├── npcs
               │                                  ├── campaign_objectives
               │                                  ├── campaign_map_regions
               │                                  ├── campaign_spawns
               │                                  ├── chat_messages
               │                                  └── llm_narratives
               │
               └── user_preferences

maps_world ─┬── maps_burgs
             ├── maps_cells
             ├── maps_routes
             ├── maps_rivers
             └── maps_markers

srd_species ─── srd_subspecies
srd_classes ─── srd_subclasses
                srd_class_saving_throws
srd_spells ──── srd_spell_classes
srd_items
srd_backgrounds
srd_feats
srd_conditions
```

## Tables

### Users & Authentication

#### user_profiles

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, default gen_random_uuid() |
| username | CITEXT | Unique, not null |
| email | CITEXT | Unique, not null |
| password_hash | TEXT | bcrypt hash |
| roles | TEXT[] | e.g., `{player}`, `{player,dm}`, `{admin}` |
| status | TEXT | `active`, `suspended`, etc. |
| avatar_url | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | Auto-trigger |

#### user_preferences

| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, FK → user_profiles |
| theme | TEXT | `light`, `dark`, `system` |
| notifications | JSONB | Notification settings |
| gameplay | JSONB | Gameplay preferences |

### Maps (SRID 0 — Pixel Coordinates)

All geometry columns use SRID 0 (unitless pixel space from Azgaar's Fantasy Map Generator).

#### maps_world

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | TEXT | |
| width | INTEGER | Pixel width |
| height | INTEGER | Pixel height |
| settings | JSONB | Map settings |
| info | JSONB | Metadata from Azgaar |
| created_by | UUID | FK → user_profiles |

#### maps_burgs

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| world_map_id | UUID | FK → maps_world |
| burg_id | INTEGER | Azgaar's burg ID |
| name | TEXT | |
| xpixel | DOUBLE PRECISION | Note: aliased as `x_px` in API |
| ypixel | DOUBLE PRECISION | Note: aliased as `y_px` in API |
| geom | GEOMETRY(Point, 0) | PostGIS point |
| population | INTEGER | |
| type | TEXT | |
| state_name | TEXT | |
| province_name | TEXT | |
| culture_name | TEXT | |

#### maps_cells

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| world_map_id | UUID | FK → maps_world |
| cell_id | INTEGER | |
| geom | GEOMETRY(MultiPolygon, 0) | Terrain polygon |
| biome | TEXT | |
| height | DOUBLE PRECISION | Elevation |

#### maps_routes

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| world_map_id | UUID | FK → maps_world |
| route_id | INTEGER | |
| geom | GEOMETRY(MultiLineString, 0) | Road geometry |
| type | TEXT | Road type |

#### maps_rivers

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| world_map_id | UUID | FK → maps_world |
| river_id | INTEGER | |
| geom | GEOMETRY(MultiLineString, 0) | River geometry |
| name | TEXT | |

#### maps_markers

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| world_map_id | UUID | FK → maps_world |
| x_px | DOUBLE PRECISION | Note: different column name than burgs |
| y_px | DOUBLE PRECISION | |
| geom | GEOMETRY(Point, 0) | |
| name | TEXT | |
| type | TEXT | |
| icon | TEXT | |
| notes | TEXT | |

#### tile_sets

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | TEXT | |
| path | TEXT | Filesystem path to tiles |
| min_zoom | INTEGER | |
| max_zoom | INTEGER | |

### Campaigns

#### campaigns

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | TEXT | |
| status | TEXT | `planning`, `active`, `paused`, `completed` |
| system | TEXT | e.g., `dnd5e` |
| setting | TEXT | |
| dm_user_id | UUID | FK → user_profiles |
| world_map_id | UUID | FK → maps_world |
| level_range | JSONB | `{ min, max }` |
| max_players | INTEGER | |
| visibility_radius | DOUBLE PRECISION | Player fog-of-war radius |
| allow_spectators | BOOLEAN | |
| auto_approve_join | BOOLEAN | |

#### campaign_players

| Column | Type | Notes |
|--------|------|-------|
| campaign_id | UUID | FK → campaigns |
| user_id | UUID | FK → user_profiles |
| character_id | UUID | FK → characters |
| role | TEXT | `player`, `co-dm` |
| current_location | GEOMETRY(Point, 0) | Player position on map |
| joined_at | TIMESTAMPTZ | |

#### campaign_spawns

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| location | GEOMETRY(Point, 0) | Spawn point |
| label | TEXT | |

#### campaign_map_regions

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| world_map_id | UUID | FK → maps_world |
| geom | GEOMETRY(MultiPolygon, 0) | DM-drawn area |
| label | TEXT | |
| type | TEXT | `encounter`, `rumor`, `note`, etc. |
| metadata | JSONB | Type-specific data |

#### campaign_objectives

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| parent_id | UUID | FK → self (tree structure) |
| title | TEXT | |
| description | TEXT | |
| status | TEXT | `active`, `completed`, `failed` |
| sort_order | INTEGER | |

### Characters

#### characters

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → user_profiles |
| name | TEXT | |
| species | TEXT | SRD key |
| class | TEXT | SRD key |
| level | INTEGER | |
| abilities | JSONB | `{ strength: 15, dexterity: 14, ... }` |
| background | TEXT | SRD key |
| alignment | TEXT | |
| inventory | JSONB | Item list |
| equipment | JSONB | Equipped items |
| spells | JSONB | Known/prepared spells |
| hit_points | JSONB | `{ max, current, temp }` |
| personality | TEXT | |
| ideals | TEXT | |
| bonds | TEXT | |
| flaws | TEXT | |
| backstory | TEXT | |

### Sessions & Encounters

#### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| session_number | INTEGER | |
| title | TEXT | |
| status | TEXT | `planned`, `active`, `completed` |
| scheduled_at | TIMESTAMPTZ | |
| started_at | TIMESTAMPTZ | |
| ended_at | TIMESTAMPTZ | |

#### encounters

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| session_id | UUID | FK → sessions |
| type | TEXT | `combat`, `social`, `exploration` |
| status | TEXT | |
| data | JSONB | Encounter-specific data |

### NPCs

#### npcs

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| name | TEXT | |
| species | TEXT | |
| occupation | TEXT | |
| personality | TEXT | |
| world_position | GEOMETRY(Point, 0) | Location on map |
| stats | JSONB | NPC stat block |

#### npc_relationships

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| npc_id | UUID | FK → npcs |
| target_type | TEXT | `character` or `npc` |
| target_id | UUID | |
| relationship | TEXT | |
| trust_level | INTEGER | -100 to 100 |

#### npc_memories

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| npc_id | UUID | FK → npcs |
| interaction_type | TEXT | |
| summary | TEXT | |
| sentiment | TEXT | |
| trust_delta | INTEGER | |
| tags | TEXT[] | |

### Chat

#### chat_messages

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| user_id | UUID | FK → user_profiles |
| character_id | UUID | FK → characters (nullable) |
| type | TEXT | `message`, `dice-roll`, `system` |
| content | TEXT | |
| metadata | JSONB | Dice results, etc. |

### SRD (System Reference Document)

#### srd_species

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | PK (e.g., `srd-2024_elf`) |
| source_key | TEXT | e.g., `srd-2024` |
| name | TEXT | Display name |
| desc_text | TEXT | Description (markdown) |
| speed | INTEGER | Base walking speed |
| size | TEXT | |
| traits | JSONB | `[{ name, desc }]` |

#### srd_classes

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | PK |
| source_key | TEXT | |
| name | TEXT | |
| desc_text | TEXT | |
| hit_die | TEXT | e.g., `d8` |
| caster_type | TEXT | `FULL`, `HALF`, `THIRD`, `PACT`, or null |
| primary_abilities | TEXT[] | |
| features | JSONB | `[{ name, desc, level }]` |

#### srd_spells

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | PK |
| source_key | TEXT | |
| name | TEXT | |
| level | INTEGER | 0 = cantrip |
| school | TEXT | e.g., `Evocation` |
| casting_time | TEXT | |
| range | TEXT | |
| components | TEXT | e.g., `V, S, M` |
| duration | TEXT | |
| ritual | BOOLEAN | |
| desc_text | TEXT | Full description (markdown) |

#### srd_spell_classes (Junction)

| Column | Type | Notes |
|--------|------|-------|
| spell_key | TEXT | FK → srd_spells |
| class_key | TEXT | FK → srd_classes |

Class keys use the prefixed format matching `srd_classes.key` (e.g., `srd-2024_wizard`).

#### srd_items

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | PK |
| source_key | TEXT | |
| name | TEXT | |
| category | TEXT | `weapon`, `armor`, `adventuring-gear`, etc. |
| rarity | TEXT | `common`, `uncommon`, etc. |
| cost | TEXT | GP value as string |
| weight | DOUBLE PRECISION | Pounds |
| requires_attunement | BOOLEAN | |
| desc_text | TEXT | |

#### srd_backgrounds, srd_feats, srd_conditions

Similar structure with `key`, `source_key`, `name`, `desc_text`, and type-specific JSONB fields.

### LLM

#### llm_providers

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | PK |
| adapter | TEXT | e.g., `ollama` |
| host | TEXT | |
| model | TEXT | |
| default_provider | BOOLEAN | |

#### llm_narratives

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| campaign_id | UUID | FK → campaigns |
| type | TEXT | `dm_narration`, `scene_description`, etc. |
| prompt | TEXT | |
| response | TEXT | |
| provider | TEXT | |
| model | TEXT | |
| cached | BOOLEAN | |
| latency_ms | INTEGER | |
| tokens | JSONB | `{ prompt, completion }` |

## Indexes

All geometry columns have GIST spatial indexes:

```sql
CREATE INDEX idx_maps_burgs_geom ON maps_burgs USING GIST (geom);
CREATE INDEX idx_maps_cells_geom ON maps_cells USING GIST (geom);
CREATE INDEX idx_maps_routes_geom ON maps_routes USING GIST (geom);
CREATE INDEX idx_maps_rivers_geom ON maps_rivers USING GIST (geom);
CREATE INDEX idx_maps_markers_geom ON maps_markers USING GIST (geom);
CREATE INDEX idx_campaign_players_location ON campaign_players USING GIST (current_location);
CREATE INDEX idx_npcs_position ON npcs USING GIST (world_position);
```

Additional B-tree indexes on foreign keys and lookup columns (e.g., `world_map_id`, `campaign_id`, `source_key`).

## Column Naming Convention

Database columns use `snake_case`. The API layer maps to `camelCase` for JSON responses.

Notable inconsistency: `maps_burgs` uses `xpixel`/`ypixel` while `maps_markers` uses `x_px`/`y_px`. The API normalizes both to `x_px`/`y_px` via SQL aliases.
