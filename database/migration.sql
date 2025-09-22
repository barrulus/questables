-- Run on an existing DB created from your earlier schema.
-- Safe-ish: uses IF EXISTS/TRY conversions; review before production.

BEGIN;

-- 1) Enable extensions you’ll need going forward
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2) Make usernames/emails case-insensitive
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='user_profiles' AND column_name='username'
               AND data_type <> 'citext') THEN
    ALTER TABLE public.user_profiles
      ALTER COLUMN username TYPE citext;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='user_profiles' AND column_name='email'
               AND data_type <> 'citext') THEN
    ALTER TABLE public.user_profiles
      ALTER COLUMN email TYPE citext;
  END IF;
END$$;

-- 3) Create/attach generic updated_at trigger (idempotent)
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END$$;

DO $outer$
DECLARE
  r RECORD;
  trgname text;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name='updated_at'
      AND table_schema='public'
  LOOP
    trgname := '_touch_' || r.table_name;

    -- if the trigger doesn't exist on this table, create it
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgname = trgname
        AND t.tgrelid = format('%I.%I', r.table_schema, r.table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I
           BEFORE UPDATE ON %I.%I
           FOR EACH ROW
           EXECUTE FUNCTION public.tg_touch_updated_at()',
        trgname, r.table_schema, r.table_name
      );
    END IF;
  END LOOP;
END
$outer$;


-- 4) Geometry SRIDs and types → enforce SRID 0 and correct geometry types

-- maps_cells: set to MultiPolygon,0 (attempt to coerce)
ALTER TABLE public.maps_cells
  ALTER COLUMN geom TYPE geometry(MultiPolygon, 0)
  USING ST_SetSRID(
           COALESCE(
             CASE
               WHEN GeometryType(geom) IN ('MULTIPOLYGON') THEN geom
               WHEN GeometryType(geom) IN ('POLYGON') THEN ST_Multi(geom)
               ELSE ST_Multi(ST_CollectionExtract(geom,3))
             END,
             0);

-- maps_burgs: Point,0
ALTER TABLE public.maps_burgs
  ALTER COLUMN geom TYPE geometry(Point, 0)
  USING ST_SetSRID(ST_Force2D(ST_PointOnSurface(geom)), 0);

-- maps_routes: MultiLineString,0
ALTER TABLE public.maps_routes
  ALTER COLUMN geom TYPE geometry(MultiLineString, 0)
  USING ST_SetSRID(
           CASE
             WHEN GeometryType(geom)='MULTILINESTRING' THEN geom
             WHEN GeometryType(geom)='LINESTRING' THEN ST_Multi(geom)
             ELSE ST_Multi(ST_CollectionExtract(geom,2))
           END, 0);

-- maps_rivers: MultiLineString,0
ALTER TABLE public.maps_rivers
  ALTER COLUMN geom TYPE geometry(MultiLineString, 0)
  USING ST_SetSRID(
           CASE
             WHEN GeometryType(geom)='MULTILINESTRING' THEN geom
             WHEN GeometryType(geom)='LINESTRING' THEN ST_Multi(geom)
             ELSE ST_Multi(ST_CollectionExtract(geom,2))
           END, 0);

-- maps_markers: Point,0
ALTER TABLE public.maps_markers
  ALTER COLUMN geom TYPE geometry(Point, 0)
  USING ST_SetSRID(ST_PointOnSurface(geom), 0);

-- locations.world_position → SRID 0 (already 0 in your draft, keep/ensure)
ALTER TABLE public.locations
  ALTER COLUMN world_position TYPE geometry(Point, 0)
  USING CASE
         WHEN world_position IS NULL THEN NULL
         ELSE ST_SetSRID(ST_Force2D(world_position), 0)
       END;

-- campaign_players.loc_current from 4326 → 0
ALTER TABLE public.campaign_players
  ALTER COLUMN loc_current TYPE geometry(Point, 0)
  USING CASE
         WHEN loc_current IS NULL THEN NULL
         ELSE ST_SetSRID(ST_Force2D(loc_current), 0)
       END;

-- fix SRID check constraint (drop if 4326, add for 0)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='campaign_players'
      AND constraint_name='campaign_players_loc_current_srid'
  ) THEN
    ALTER TABLE public.campaign_players DROP CONSTRAINT campaign_players_loc_current_srid;
  END IF;
  ALTER TABLE public.campaign_players
    ADD CONSTRAINT campaign_players_loc_current_srid
    CHECK (loc_current IS NULL OR ST_SRID(loc_current)=0);
END$$;

-- campaign player visibility state for SRID-0 map
ALTER TABLE public.campaign_players
  ADD COLUMN IF NOT EXISTS visibility_state TEXT NOT NULL DEFAULT 'visible'
    CHECK (visibility_state IN ('visible', 'stealthed', 'hidden'));
UPDATE public.campaign_players
  SET visibility_state = 'visible'
  WHERE visibility_state IS NULL OR visibility_state NOT IN ('visible', 'stealthed', 'hidden');

-- 5) Clean up redundant ALTERs in original (no-op here; just ensuring final shape)

-- 6) Strengthen types/indexes/uniques

-- npc_relationships unique should include target_type
DO $$
BEGIN
  -- try drop old unique if present
  BEGIN
    ALTER TABLE public.npc_relationships DROP CONSTRAINT IF EXISTS npc_relationships_npc_id_target_id_key;
  EXCEPTION WHEN undefined_object THEN
    -- ignore
  END;
  -- (re)add correct unique
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='npc_relationships'
      AND constraint_type='UNIQUE' AND constraint_name='uq_npc_relationship'
  ) THEN
    ALTER TABLE public.npc_relationships
      ADD CONSTRAINT uq_npc_relationship UNIQUE (npc_id, target_type, target_id);
  END IF;
END$$;

-- llm_narratives.request_id unique (already unique in draft, re-ensure)
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_narratives_request_id ON public.llm_narratives(request_id);

-- tile_sets add updated_at and touch trigger (if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tile_sets' AND column_name='updated_at'
  ) THEN
    ALTER TABLE public.tile_sets ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='_touch_tile_sets') THEN
    CREATE TRIGGER _touch_tile_sets
    BEFORE UPDATE ON public.tile_sets
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
  END IF;
END$$;

-- maps_world file_size_bytes (rename from file_size if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='maps_world' AND column_name='file_size'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='maps_world' AND column_name='file_size_bytes'
  ) THEN
    ALTER TABLE public.maps_world ADD COLUMN file_size_bytes BIGINT;
    -- if you previously stored MB, try convert (best-effort). Comment if unknown.
    UPDATE public.maps_world SET file_size_bytes = (file_size * 1024 * 1024)::bigint;
    ALTER TABLE public.maps_world DROP COLUMN file_size;
  END IF;
END$$;

-- campaigns.assets to persist uploaded asset metadata
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS assets JSONB DEFAULT '[]'::jsonb;
UPDATE public.campaigns
  SET assets = COALESCE(assets, '[]'::jsonb);

-- campaign spawns table (SRID 0)
CREATE TABLE IF NOT EXISTS public.campaign_spawns (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  world_position geometry(Point, 0) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_name ON public.campaign_spawns(campaign_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_default ON public.campaign_spawns(campaign_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_campaign_spawns_campaign_id ON public.campaign_spawns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_spawns_world_position_gix ON public.campaign_spawns USING GIST (world_position);
DROP TRIGGER IF EXISTS _touch_campaign_spawns ON public.campaign_spawns;
CREATE TRIGGER _touch_campaign_spawns
  BEFORE UPDATE ON public.campaign_spawns
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- movement audit log
CREATE TABLE IF NOT EXISTS public.player_movement_audit (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES public.campaign_players(id) ON DELETE CASCADE NOT NULL,
  moved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('walk', 'ride', 'boat', 'fly', 'teleport', 'gm')),
  reason TEXT,
  previous_loc geometry(Point, 0),
  new_loc geometry(Point, 0) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  source TEXT DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_player_movement_audit_campaign_id_created_at
  ON public.player_movement_audit (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_movement_audit_player_id_created_at
  ON public.player_movement_audit (player_id, created_at DESC);

-- visibility helper (SRID 0)
DROP FUNCTION IF EXISTS visible_player_positions(UUID, UUID, double precision);
CREATE OR REPLACE FUNCTION visible_player_positions(
  p_campaign_id UUID,
  p_requestor_user_id UUID,
  p_radius DOUBLE PRECISION DEFAULT 500.0
)
RETURNS TABLE (
  player_id UUID,
  user_id UUID,
  character_id UUID,
  role TEXT,
  visibility_state TEXT,
  loc geometry(Point, 0),
  can_view_history BOOLEAN
) LANGUAGE plpgsql AS $$
DECLARE
  viewer_role TEXT;
  viewer_player_id UUID;
  effective_radius DOUBLE PRECISION := COALESCE(p_radius, 0);
  viewer_loc geometry(Point, 0);
BEGIN
  SELECT
    CASE
      WHEN c.dm_user_id = p_requestor_user_id THEN 'dm'
      WHEN EXISTS (
        SELECT 1 FROM public.campaign_players cp
        WHERE cp.campaign_id = p_campaign_id
          AND cp.user_id = p_requestor_user_id
          AND cp.role = 'co-dm'
      ) THEN 'co-dm'
      WHEN EXISTS (
        SELECT 1 FROM public.campaign_players cp
        WHERE cp.campaign_id = p_campaign_id
          AND cp.user_id = p_requestor_user_id
      ) THEN 'player'
      ELSE NULL
    END,
    (
      SELECT cp.id
      FROM public.campaign_players cp
      WHERE cp.campaign_id = p_campaign_id
        AND cp.user_id = p_requestor_user_id
      LIMIT 1
    )
  INTO viewer_role, viewer_player_id
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

  IF viewer_role IS NULL THEN
    RETURN;
  END IF;

  IF viewer_player_id IS NOT NULL THEN
    SELECT loc_current INTO viewer_loc
    FROM public.campaign_players
    WHERE id = viewer_player_id;
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.user_id,
    cp.character_id,
    cp.role,
    cp.visibility_state,
    cp.loc_current,
    (viewer_role IN ('dm', 'co-dm')) AS can_view_history
  FROM public.campaign_players cp
  WHERE cp.campaign_id = p_campaign_id
    AND cp.status = 'active'
    AND cp.loc_current IS NOT NULL
    AND (
      viewer_role IN ('dm', 'co-dm')
      OR cp.id = viewer_player_id
      OR (
        cp.visibility_state = 'visible'
        AND viewer_player_id IS NOT NULL
        AND viewer_loc IS NOT NULL
        AND (
          effective_radius <= 0
          OR ST_DWithin(cp.loc_current, viewer_loc, effective_radius)
        )
      )
    );
END;
$$;

-- 7) Add missing helpful indexes
CREATE INDEX IF NOT EXISTS idx_session_participants_session_id ON public.session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user_id ON public.session_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_character_id ON public.session_participants(character_id);
CREATE INDEX IF NOT EXISTS idx_encounter_participants_encounter_id ON public.encounter_participants(encounter_id);
CREATE INDEX IF NOT EXISTS idx_routes_start_location_id ON public.routes(start_location_id);
CREATE INDEX IF NOT EXISTS idx_routes_end_location_id ON public.routes(end_location_id);

-- 8) Replace functions with SRID 0 versions (drop & recreate)

DROP FUNCTION IF EXISTS get_burgs_near_point(UUID, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_burgs_near_point(
  world_map_id UUID, x DOUBLE PRECISION, y DOUBLE PRECISION, radius DOUBLE PRECISION DEFAULT 100.0
) RETURNS TABLE (id UUID, name TEXT, population INTEGER, capital BOOLEAN, distance DOUBLE PRECISION)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.name, b.population, b.capital,
         ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(x, y), 0)) AS distance
  FROM public.maps_burgs b
  WHERE b.world_id = world_map_id
    AND ST_DWithin(b.geom, ST_SetSRID(ST_MakePoint(x, y), 0), radius)
  ORDER BY distance;
END$$;

DROP FUNCTION IF EXISTS get_routes_between_points(UUID, double precision, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_routes_between_points(
  world_map_id UUID, start_x DOUBLE PRECISION, start_y DOUBLE PRECISION, end_x DOUBLE PRECISION, end_y DOUBLE PRECISION
) RETURNS TABLE (id UUID, name TEXT, type TEXT, geom geometry)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.name, r.type, r.geom
  FROM public.maps_routes r
  WHERE r.world_id = world_map_id
    AND ST_Intersects(
      r.geom,
      ST_MakeLine(
        ST_SetSRID(ST_MakePoint(start_x, start_y), 0),
        ST_SetSRID(ST_MakePoint(end_x, end_y), 0)
      )
    );
END$$;

DROP FUNCTION IF EXISTS get_cell_at_point(UUID, double precision, double precision);
CREATE OR REPLACE FUNCTION get_cell_at_point(
  world_map_id UUID, x DOUBLE PRECISION, y DOUBLE PRECISION
) RETURNS TABLE (id UUID, biome INTEGER, type TEXT, population INTEGER, height INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.biome, c.type, c.population, c.height
  FROM public.maps_cells c
  WHERE c.world_id = world_map_id
    AND ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(x, y), 0))
  LIMIT 1;
END$$;

DROP FUNCTION IF EXISTS get_rivers_in_bounds(UUID, double precision, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_rivers_in_bounds(
  world_map_id UUID, north DOUBLE PRECISION, south DOUBLE PRECISION, east DOUBLE PRECISION, west DOUBLE PRECISION
) RETURNS TABLE (
  id UUID, world_id UUID, river_id INTEGER, name TEXT, type TEXT,
  discharge DOUBLE PRECISION, length DOUBLE PRECISION, width DOUBLE PRECISION, geometry JSONB
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.world_id, r.river_id, r.name, r.type,
         r.discharge, r.length, r.width,
         ST_AsGeoJSON(r.geom)::jsonb AS geometry
  FROM public.maps_rivers r
  WHERE r.world_id = world_map_id
    AND ST_Intersects(r.geom, ST_MakeEnvelope(west, south, east, north, 0));
END$$;

COMMIT;
