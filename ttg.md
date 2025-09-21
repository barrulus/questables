Love this—here’s a lean, TTG-friendly expansion that stays practical for an area map, PostGIS, and an AI DM. I’ve kept your design, but I’ll flag where a small change pays off big.

# Core data model (Postgres/PostGIS)

> Note: you used both `campaign_players` and `campaign_player`. I’ll assume `public.campaign_players`.

## 1) Player location fields

### Character location

```sql
ALTER TABLE public.campaign_players
  ADD COLUMN loc_current geometry(Point, 4326),
```

### Character location history table

```sql
CREATE TABLE public.campaign_player_locations (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL,
  player_id bigint NOT NULL REFERENCES public.campaign_players(id) ON DELETE CASCADE,
  t timestamptz NOT NULL DEFAULT now(),
  loc geography(Point) NOT NULL -- or geometry(Point, 4326)
);

CREATE INDEX ON public.campaign_player_locations (campaign_id, player_id, t DESC);
CREATE INDEX ON public.campaign_player_locations USING GIST (loc);
```

Materialize a short trail per player via a view:

```sql
CREATE OR REPLACE VIEW public.v_player_trails AS
SELECT campaign_id, player_id,
       ST_MakeLine(loc::geometry ORDER BY t) AS trail_geom,
       MIN(t) AS t_min, MAX(t) AS t_max
FROM (
  SELECT campaign_id, player_id, t, loc,
         ROW_NUMBER() OVER (PARTITION BY campaign_id, player_id ORDER BY t DESC) AS rn
  FROM public.campaign_player_locations
) s
WHERE rn <= 30
GROUP BY campaign_id, player_id;
```

- DM dashboard:

  - Create/choose default spawn for campaign.
  - Drag-drop to move spawn (`PUT /campaigns/:id/spawn/:spawnId`).
  - “Teleport” a player to a spawn or arbitrary map point (with audit log).

- When a player joins:

  - If they have a saved `loc_current`, reuse it.
  - Else place at default spawn (or party spawn if you support per-party spawns).

- Session save:
  - On disconnect or interval tick, persist `loc_current` (and write a history row).

## 3) Movement & history mechanics

Minimal server flow

- Endpoint to move:

  - `POST /campaigns/:id/players/:playerId/move`
  - Body: `{ "target": { "lon": ..., "lat": ... }, "mode": "walk|ride|boat|fly" }`

- Server logic:

  1. Validate target inside campaign bounds / allowed layers (optional snapping).
  2. Enforce rate/cooldown (e.g., max km per 5s, or turn-based).
  3. Update `loc_current`.
  4. Append history:
     - **Array**: push, truncate to 30; spill overflow into `loc_archive`.
     - **Table**: insert new row; view `v_player_trails` gives the last 30.

- Optional niceties (lightweight):
  - Snap to nearest traversable network within 30m (roads/trails/rivers) using `ST_ClosestPoint` onto a merged `LineString` layer.
  * Characters should be able to leave routes
  - Clamp speed by terrain (use a cost surface or per-feature speed attribute).
  - Status tags on movement (stealthed/invisible → visibility rules below).

### Helpful indexes

```sql
CREATE INDEX ON public.campaign_players USING GIST ((loc_current::geometry));
-- for geometry: CREATE INDEX ... USING GIST (loc_current);
```

# Role-based visibility (DM vs players, 50 km rule)

Use **server-side filtering**; don’t ship hidden data to clients.

### Visibility function (geography → km)

```sql
-- Who can see whom within a campaign?
CREATE OR REPLACE FUNCTION public.visible_player_positions(
  p_campaign_id bigint,
  p_requestor_player_id bigint,
  p_km numeric DEFAULT 50
)
RETURNS TABLE (
  player_id bigint,
  loc geography(Point),
  can_see_history boolean
) LANGUAGE sql SECURITY DEFINER AS
$$
  -- DM sees all:
  WITH me AS (
    SELECT cp.id AS player_id, cp.role
    FROM public.campaign_players cp
    WHERE cp.id = p_requestor_player_id AND cp.campaign_id = p_campaign_id
  ),
  base AS (
    SELECT cp.id AS player_id, cp.loc_current AS loc,
           (SELECT role FROM me) AS my_role
    FROM public.campaign_players cp
    WHERE cp.campaign_id = p_campaign_id
  ),
  party_scope AS (
    -- limit to party if not DM
    SELECT b.*
    FROM base b
    WHERE (b.my_role = 'DM')
       OR EXISTS (
         SELECT 1
         FROM public.party_memberships pm1
         JOIN public.party_memberships pm2
           ON pm1.party_id = pm2.party_id
          AND pm1.campaign_id = pm2.campaign_id
         WHERE pm1.player_id = p_requestor_player_id
           AND pm2.player_id = b.player_id
           AND pm1.campaign_id = p_campaign_id
       )
  ),
  distance_scope AS (
    -- limit by distance if not DM
    SELECT p.player_id, p.loc,
           (p.my_role = 'DM') AS can_see_history
    FROM party_scope p
    WHERE (p.my_role = 'DM')
       OR ST_DWithin(
            (SELECT loc_current FROM public.campaign_players WHERE id = p_requestor_player_id),
            p.loc,
            p_km * 1000.0 -- meters
          )
  )
  SELECT * FROM distance_scope;
$$;
```

- Players: see only party members within 50 km (`p_km` configurable).
- DM: sees all tokens and history (`can_see_history = true`).
- If you want stealth/invisibility: add a column `visibility_state` per player; modify WHERE to exclude when hidden (unless DM).

# Minimal API surface (REST/WebSocket)

- `GET /campaigns/:id/players/visible.geojson`

  - Returns only what requester can see: points + minimal props (name, status summary, party id).

- `GET /campaigns/:id/players/:playerId/trail.geojson`

  - If requester can view history: return `v_player_trails` for that player; else 403.

- `POST /campaigns/:id/players/:playerId/move`

  - Performs validated move (rate limit + audit).

- `POST /campaigns/:id/spawns` / `PUT /.../spawns/:spawnId`

  - DM-only spawn CRUD.

- `WS /campaigns/:id/stream`

  - Server pushes: token moved, joined/left, status change, encounter triggers.

Return GeoJSON so OpenLayers can consume directly.

# OpenLayers integration (simple & robust)

- **Player layer (on by default)**

  ```js
  const srcPlayers = new ol.source.Vector({
    url: `/api/campaigns/${id}/players/visible.geojson`,
    format: new ol.format.GeoJSON(),
  });
  const layerPlayers = new ol.layer.Vector({ source: srcPlayers });
  map.addLayer(layerPlayers);
  ```

- **History toggle (LineString)**
  On toggle, fetch `/trail.geojson` per visible player (or one combined GeoJSON), add a vector layer for trails. Style dashed; thinner than tokens.
- **Role-specific visibility**
  Don’t rely on client checks—server already filtered data. UI simply shows whatever comes back.
- **Live updates**
  WebSocket message `{ type: "player-moved", player_id, lon, lat }` → update feature geometry in source. Periodically `srcPlayers.refresh()` as a fallback.
- **Token styling**

  - Default pin if no avatar.
  - Status chip overlay (hp %, conditions).
  - Cluster if many tokens zoomed out.

# DM dashboard essentials (not too much)

- Spawn tool: click-to-set and mark default.
- Select/move player pins (drag or click+assign target).
- Quick status peek (HP, conditions, stealth flag, party).
- Teleport (with audit + optional confirmation).
- Toggle: show/hide history.
- Encounter zones overlay (read-only polygons that can auto-trigger events—see AI hooks).

# AI DM hooks (lightweight but powerful)

- **Context payload** (when LLM needs awareness):

  - Current player’s `loc_current`, last 30 points from `v_player_trails`, nearby features within X km (POIs, roads, biomes), current party composition, active conditions.
  - Keep it small: summarize trails to a few segments (Douglas-Peucker) before sending.

- **On-move triggers** (server side):

  - `ST_Intersects(loc_current, encounter_zones.geom)` → enqueue “encounter suggestion” for AI DM.
  - `ST_DWithin(loc_current, poi.geom, 500)` → prompt for descriptive flavor.

- **Rate-limit prompts** to avoid spam (e.g., one per 10s or on tile/zone change).

# Movement validation (a few good defaults)

- Max step distance per tick (mode-based): walk < ride < boat < fly.
- Optional **snapping** to traversable network within 30m (roads/rivers/paths). If snap fails, reject or allow free move depending on campaign rules.
- Terrain costs: if you have a raster cost surface, sample cost at `target` to allow/deny or slow the move.

# Persistence & resume

- On auth/session close:

  - Persist `loc_current` (already on every move).
  - On rejoin, place them at their saved `loc_current`. If none, default spawn.

# Auditing & safety (tiny but important)

- `movement_audit` table: `who`, `when`, `from`, `to`, `mode`, `approved_by` (if DM teleported).
- Server-side **rate limits** per player to prevent spammy moves.
- Optional **cooldown** column on `campaign_players` to throttle LLM prompts.

# What to implement first (smallest viable slice)

1. Columns: `loc_current` + spawn table.
2. History table + `v_player_trails`.
3. Visibility function + filtered GeoJSON endpoint.
4. OpenLayers player layer + history toggle.
5. DM: set default spawn and move a player.
6. WebSocket “player-moved”.
7. Simple AI hook: when entering an encounter polygon, emit a “suggest prompt” event.
