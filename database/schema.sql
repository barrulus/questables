-- D&D 5e Web App Database Schema (SRID 0 version)
-- PostgreSQL 17 + PostGIS
-- Coordinate policy: SRID 0 (unitless/pixel-space). No geography casts.
-- Case-insensitive usernames/emails via CITEXT.
-- Uniform updated_at trigger.

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- =============================================================================
-- UTIL TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END$$;

-- helper: add touch trigger to a table (usage is repeated below)
-- (left as inline CREATE TRIGGER per table for clarity)

-- =============================================================================
-- USERS & AUTHENTICATION
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username CITEXT UNIQUE NOT NULL,
    email CITEXT UNIQUE NOT NULL,
    password_hash TEXT,
    roles TEXT[] NOT NULL DEFAULT ARRAY['player']::TEXT[] CHECK (
        array_length(roles, 1) >= 1
        AND roles <@ ARRAY['player','dm','admin']::TEXT[]
    ),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
    avatar_url TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_login TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_roles ON public.user_profiles USING GIN (roles);
DROP TRIGGER IF EXISTS _touch_user_profiles ON public.user_profiles;
CREATE TRIGGER _touch_user_profiles
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    notifications JSONB DEFAULT '{"email": true, "push": true, "campaigns": true, "sessions": true}'::jsonb,
    gameplay JSONB DEFAULT '{"autoRollInitiative": false, "showDamageNumbers": true, "compactUI": false}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
DROP TRIGGER IF EXISTS _touch_user_preferences ON public.user_preferences;
CREATE TRIGGER _touch_user_preferences
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =============================================================================
-- WORLD MAPS (SRID 0; FMG-style coordinates)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.maps_world (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    geojson_url TEXT,
    thumbnail_url TEXT,

    -- Metadata
    bounds JSONB NOT NULL, -- {"north": ..., "south": ..., "east": ..., "west": ...} in SRID 0 units
    width_pixels INTEGER,
    height_pixels INTEGER,
    meters_per_pixel DOUBLE PRECISION,
    layers JSONB DEFAULT '{"political": true, "terrain": true, "climate": false, "cultures": true, "religions": false, "provinces": true}'::jsonb,

    -- File info
    file_size_bytes BIGINT,
    uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
DROP TRIGGER IF EXISTS _touch_maps_world ON public.maps_world;
CREATE TRIGGER _touch_maps_world
BEFORE UPDATE ON public.maps_world
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Cells (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_cells (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    cell_id INTEGER NOT NULL,
    biome INTEGER,
    type TEXT,
    population INTEGER,
    state INTEGER,
    culture INTEGER,
    religion INTEGER,
    height INTEGER,
    geom geometry(MultiPolygon, 0) NOT NULL,
    UNIQUE(world_id, cell_id)
);
CREATE INDEX IF NOT EXISTS maps_cells_geom_gix ON public.maps_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_cells_world_id_idx ON public.maps_cells(world_id);

-- Burgs (Point, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_burgs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    burg_id INTEGER NOT NULL,
    name TEXT,
    state TEXT,
    statefull TEXT,
    province TEXT,
    provincefull TEXT,
    culture TEXT,
    religion TEXT,
    population INTEGER,
    populationraw DOUBLE PRECISION,
    elevation INTEGER,
    temperature TEXT,
    temperaturelikeness TEXT,
    capital BOOLEAN DEFAULT false,
    port BOOLEAN DEFAULT false,
    citadel BOOLEAN DEFAULT false,
    walls BOOLEAN DEFAULT false,
    plaza BOOLEAN DEFAULT false,
    temple BOOLEAN DEFAULT false,
    shanty BOOLEAN DEFAULT false,
    x_px DOUBLE PRECISION,
    y_px DOUBLE PRECISION,
    cell INTEGER,
    emblem JSONB,
    geom geometry(Point, 0) NOT NULL,
    UNIQUE(world_id, burg_id)
);
CREATE INDEX IF NOT EXISTS maps_burgs_geom_gix ON public.maps_burgs USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_burgs_world_id_idx ON public.maps_burgs(world_id);
CREATE INDEX IF NOT EXISTS maps_burgs_name_idx ON public.maps_burgs(name);

-- Routes (MultiLineString, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_routes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    route_id INTEGER NOT NULL,
    name TEXT,
    type TEXT,
    feature INTEGER,
    geom geometry(MultiLineString, 0) NOT NULL,
    UNIQUE(world_id, route_id)
);
CREATE INDEX IF NOT EXISTS maps_routes_geom_gix ON public.maps_routes USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_routes_world_id_idx ON public.maps_routes(world_id);

-- Rivers (MultiLineString, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_rivers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    river_id INTEGER NOT NULL,
    name TEXT,
    type TEXT,
    discharge DOUBLE PRECISION,
    length DOUBLE PRECISION,
    width DOUBLE PRECISION,
    mouth INTEGER,
    source INTEGER,
    geom geometry(MultiLineString, 0) NOT NULL,
    UNIQUE(world_id, river_id)
);
CREATE INDEX IF NOT EXISTS maps_rivers_geom_gix ON public.maps_rivers USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_rivers_world_id_idx ON public.maps_rivers(world_id);

-- Markers (Point, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_markers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    marker_id INTEGER NOT NULL,
    type TEXT,
    icon TEXT,
    x_px DOUBLE PRECISION,
    y_px DOUBLE PRECISION,
    note TEXT,
    geom geometry(Point, 0) NOT NULL,
    UNIQUE(world_id, marker_id)
);
CREATE INDEX IF NOT EXISTS maps_markers_geom_gix ON public.maps_markers USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_markers_world_id_idx ON public.maps_markers(world_id);

-- Tile sets
CREATE TABLE IF NOT EXISTS public.tile_sets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_url TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('png', 'jpg', 'webp')),
    min_zoom INTEGER NOT NULL DEFAULT 0,
    max_zoom INTEGER NOT NULL DEFAULT 18,
    tile_size INTEGER NOT NULL DEFAULT 256,
    attribution TEXT,
    is_active BOOLEAN DEFAULT false,
    uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
DROP TRIGGER IF EXISTS _touch_tile_sets ON public.tile_sets;
CREATE TRIGGER _touch_tile_sets
BEFORE UPDATE ON public.tile_sets
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =============================================================================
-- CHARACTERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.characters (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    class TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 20),
    race TEXT NOT NULL,
    background TEXT NOT NULL,
    hit_points JSONB NOT NULL DEFAULT '{"current": 0, "max": 0, "temporary": 0}'::jsonb,
    armor_class INTEGER NOT NULL DEFAULT 10,
    speed INTEGER NOT NULL DEFAULT 30,
    proficiency_bonus INTEGER NOT NULL DEFAULT 2,
    abilities JSONB NOT NULL DEFAULT '{"strength": 10, "dexterity": 10, "constitution": 10, "intelligence": 10, "wisdom": 10, "charisma": 10}'::jsonb,
    saving_throws JSONB DEFAULT '{}'::jsonb,
    skills JSONB DEFAULT '{}'::jsonb,
    inventory JSONB DEFAULT '[]'::jsonb,
    equipment JSONB DEFAULT '{}'::jsonb,
    avatar_url TEXT,
    backstory TEXT,
    personality TEXT,
    ideals TEXT,
    bonds TEXT,
    flaws TEXT,
    spellcasting JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_played TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON public.characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON public.characters(name);
DROP TRIGGER IF EXISTS _touch_characters ON public.characters;
CREATE TRIGGER _touch_characters
BEFORE UPDATE ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =============================================================================
-- CAMPAIGNS & PLAYERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    dm_user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    system TEXT NOT NULL DEFAULT 'D&D 5e',
    setting TEXT DEFAULT 'Homebrew',
    status TEXT NOT NULL DEFAULT 'recruiting' CHECK (status IN ('recruiting', 'active', 'paused', 'completed')),
    max_players INTEGER DEFAULT 6,
    level_range JSONB DEFAULT '{"min": 1, "max": 20}'::jsonb,
    world_map_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
    assets JSONB DEFAULT '[]'::jsonb,
    is_public BOOLEAN DEFAULT false,
    allow_spectators BOOLEAN DEFAULT false,
    auto_approve_join_requests BOOLEAN DEFAULT false,
    experience_type TEXT DEFAULT 'milestone' CHECK (experience_type IN ('milestone', 'experience_points')),
    resting_rules TEXT DEFAULT 'standard' CHECK (resting_rules IN ('standard', 'gritty', 'heroic')),
    death_save_rules TEXT DEFAULT 'standard' CHECK (death_save_rules IN ('standard', 'hardcore', 'forgiving')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_dm_user_id ON public.campaigns(dm_user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_is_public ON public.campaigns(is_public);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_name_per_dm
    ON public.campaigns (dm_user_id, lower(name));
DROP TRIGGER IF EXISTS _touch_campaigns ON public.campaigns;
CREATE TRIGGER _touch_campaigns
BEFORE UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_players (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'left')),
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'co-dm')),
    visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK (visibility_state IN ('visible', 'stealthed', 'hidden')),
    loc_current geometry(Point, 0),
    last_located_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_players_loc_current_srid CHECK (loc_current IS NULL OR ST_SRID(loc_current) = 0),
    UNIQUE(campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_players_campaign_id ON public.campaign_players(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_players_user_id ON public.campaign_players(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_players_loc_current_gix
    ON public.campaign_players USING GIST (loc_current) WHERE loc_current IS NOT NULL;

-- player location history (Point, SRID 0)
CREATE TABLE IF NOT EXISTS public.campaign_player_locations (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    player_id UUID REFERENCES public.campaign_players(id) ON DELETE CASCADE NOT NULL,
    loc geometry(Point, 0) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_player_locations_loc_srid CHECK (ST_SRID(loc) = 0)
);
CREATE INDEX IF NOT EXISTS idx_campaign_player_locations_lookup
    ON public.campaign_player_locations (campaign_id, player_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_player_locations_loc_gix
    ON public.campaign_player_locations USING GIST (loc);

CREATE TABLE IF NOT EXISTS public.player_movement_paths (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    player_id UUID REFERENCES public.campaign_players(id) ON DELETE CASCADE NOT NULL,
    path geometry(LineStringZ, 0) NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('walk', 'ride', 'boat', 'fly', 'teleport', 'gm')),
    moved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_movement_paths_campaign_created
    ON public.player_movement_paths (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_movement_paths_player_created
    ON public.player_movement_paths (player_id, created_at DESC);

-- auto-log player location changes
CREATE OR REPLACE FUNCTION public.log_campaign_player_location()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.loc_current IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.loc_current IS DISTINCT FROM OLD.loc_current)) THEN
    NEW.last_located_at := NOW();
    INSERT INTO public.campaign_player_locations (campaign_id, player_id, loc, recorded_at)
    VALUES (NEW.campaign_id, NEW.id, NEW.loc_current, NEW.last_located_at);
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_campaign_players_location_audit ON public.campaign_players;
CREATE TRIGGER trg_campaign_players_location_audit
AFTER INSERT OR UPDATE OF loc_current ON public.campaign_players
FOR EACH ROW EXECUTE FUNCTION public.log_campaign_player_location();

-- recent trails view (last 30 points)
CREATE OR REPLACE VIEW public.v_player_recent_trails AS
SELECT
  ranked.campaign_id,
  ranked.player_id,
  ST_LineMerge(ST_Collect(ranked.path)) AS trail_geom,
  MIN(ranked.created_at) AS recorded_from,
  MAX(ranked.created_at) AS recorded_to,
  COUNT(*) AS point_count
FROM (
  SELECT
    pmp.campaign_id,
    pmp.player_id,
    pmp.path,
    pmp.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY pmp.campaign_id, pmp.player_id
      ORDER BY pmp.created_at DESC
    ) AS rn
  FROM public.player_movement_paths pmp
) AS ranked
WHERE ranked.rn <= 30
GROUP BY ranked.campaign_id, ranked.player_id;

-- campaign spawn points (SRID 0)
CREATE TABLE IF NOT EXISTS public.campaign_spawns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL DEFAULT 'Default Spawn',
    note TEXT,
    world_position geometry(Point, 0) NOT NULL,
    is_default BOOLEAN DEFAULT true,
    CONSTRAINT campaign_spawns_world_position_srid CHECK (ST_SRID(world_position) = 0),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_name ON public.campaign_spawns(campaign_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_default ON public.campaign_spawns(campaign_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_campaign_spawns_campaign_id ON public.campaign_spawns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_spawns_world_position_gix ON public.campaign_spawns USING GIST (world_position);
DROP TRIGGER IF EXISTS _touch_campaign_spawns ON public.campaign_spawns;
CREATE TRIGGER _touch_campaign_spawns
BEFORE UPDATE ON public.campaign_spawns
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- campaign map regions (SRID 0 polygons for prep annotations)
CREATE TABLE IF NOT EXISTS public.campaign_map_regions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    world_map_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('encounter', 'rumour', 'narrative', 'travel', 'custom')),
    color TEXT,
    CONSTRAINT campaign_map_regions_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
    metadata JSONB DEFAULT '{}'::jsonb,
    region geometry(MultiPolygon, 0) NOT NULL,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_map_regions_region_srid CHECK (ST_SRID(region) = 0)
);
CREATE INDEX IF NOT EXISTS idx_campaign_map_regions_campaign_id ON public.campaign_map_regions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_map_regions_category ON public.campaign_map_regions(category);
CREATE INDEX IF NOT EXISTS idx_campaign_map_regions_world_map_id ON public.campaign_map_regions(world_map_id);
CREATE INDEX IF NOT EXISTS idx_campaign_map_regions_region_gix ON public.campaign_map_regions USING GIST (region);
DROP TRIGGER IF EXISTS _touch_campaign_map_regions ON public.campaign_map_regions;
CREATE TRIGGER _touch_campaign_map_regions
BEFORE UPDATE ON public.campaign_map_regions
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- campaign objectives tree (DM Toolkit)
CREATE TABLE IF NOT EXISTS public.campaign_objectives (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES public.campaign_objectives(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description_md TEXT,
    location_type TEXT CHECK (location_type IN ('pin', 'burg', 'marker', 'region')),
    location_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
    location_marker_id UUID REFERENCES public.maps_markers(id) ON DELETE SET NULL,
    location_pin geometry(Point, 0),
    location_region_id UUID REFERENCES public.campaign_map_regions(id) ON DELETE SET NULL,
    treasure_md TEXT,
    combat_md TEXT,
    npcs_md TEXT,
    rumours_md TEXT,
    is_major BOOLEAN DEFAULT false,
    slug TEXT,
    order_index INTEGER DEFAULT 0,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_objectives_location_choice CHECK (
        (location_type IS NULL AND location_burg_id IS NULL AND location_marker_id IS NULL AND location_pin IS NULL)
        OR (location_type = 'pin' AND location_pin IS NOT NULL AND location_burg_id IS NULL AND location_marker_id IS NULL)
        OR (location_type = 'burg' AND location_burg_id IS NOT NULL AND location_marker_id IS NULL AND location_pin IS NULL)
        OR (location_type = 'marker' AND location_marker_id IS NOT NULL AND location_burg_id IS NULL AND location_pin IS NULL)
        OR (location_type = 'region' AND location_region_id IS NOT NULL AND location_burg_id IS NULL AND location_marker_id IS NULL AND location_pin IS NULL)
    ),
    CONSTRAINT campaign_objectives_location_pin_srid CHECK (location_pin IS NULL OR ST_SRID(location_pin) = 0)
);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_campaign_id ON public.campaign_objectives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_parent_id ON public.campaign_objectives(parent_id);

ALTER TABLE public.campaign_objectives
  ADD COLUMN IF NOT EXISTS location_region_id UUID REFERENCES public.campaign_map_regions(id) ON DELETE SET NULL;

ALTER TABLE public.campaign_objectives
  DROP CONSTRAINT IF EXISTS campaign_objectives_location_type_check;

ALTER TABLE public.campaign_objectives
  ADD CONSTRAINT campaign_objectives_location_type_check CHECK (location_type IN ('pin', 'burg', 'marker', 'region'));

ALTER TABLE public.campaign_objectives
  DROP CONSTRAINT IF EXISTS campaign_objectives_location_choice;

ALTER TABLE public.campaign_objectives
  ADD CONSTRAINT campaign_objectives_location_choice CHECK (
    (location_type IS NULL AND location_burg_id IS NULL AND location_marker_id IS NULL AND location_pin IS NULL AND location_region_id IS NULL)
    OR (location_type = 'pin' AND location_pin IS NOT NULL AND location_burg_id IS NULL AND location_marker_id IS NULL AND location_region_id IS NULL)
    OR (location_type = 'burg' AND location_burg_id IS NOT NULL AND location_marker_id IS NULL AND location_pin IS NULL AND location_region_id IS NULL)
    OR (location_type = 'marker' AND location_marker_id IS NOT NULL AND location_burg_id IS NULL AND location_pin IS NULL AND location_region_id IS NULL)
    OR (location_type = 'region' AND location_region_id IS NOT NULL AND location_burg_id IS NULL AND location_marker_id IS NULL AND location_pin IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_campaign_objectives_location_region_id ON public.campaign_objectives(location_region_id);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_order ON public.campaign_objectives(campaign_id, order_index);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_location_burg ON public.campaign_objectives(location_burg_id);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_location_marker ON public.campaign_objectives(location_marker_id);
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_location_pin_gix
    ON public.campaign_objectives USING GIST (location_pin) WHERE location_pin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_objectives_slug ON public.campaign_objectives(slug) WHERE slug IS NOT NULL;
DROP TRIGGER IF EXISTS _touch_campaign_objectives ON public.campaign_objectives;
CREATE TRIGGER _touch_campaign_objectives
BEFORE UPDATE ON public.campaign_objectives
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Objective geometry view (SRID 0)
CREATE OR REPLACE VIEW public.v_campaign_objective_points AS
SELECT
  obj.id AS objective_id,
  obj.campaign_id,
  obj.title,
  obj.is_major,
  obj.order_index,
  COALESCE(obj.location_pin, burg.geom, marker.geom) AS geom
FROM public.campaign_objectives obj
LEFT JOIN public.maps_burgs burg ON obj.location_burg_id = burg.id
LEFT JOIN public.maps_markers marker ON obj.location_marker_id = marker.id
WHERE COALESCE(obj.location_pin, burg.geom, marker.geom) IS NOT NULL;

-- Current campaign player positions (SRID 0)
CREATE OR REPLACE VIEW public.v_campaign_player_positions AS
SELECT
  cp.id AS campaign_player_id,
  cp.campaign_id,
  cp.user_id,
  cp.character_id,
  cp.role,
  cp.visibility_state,
  cp.last_located_at,
  cp.loc_current AS geom
FROM public.campaign_players cp
WHERE cp.loc_current IS NOT NULL;

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
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

-- =============================================================================
-- SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    dm_notes TEXT,
    dm_focus TEXT,
    dm_context_md TEXT,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration INTEGER,
    experience_awarded INTEGER DEFAULT 0,
    treasure_awarded JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
    game_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(campaign_id, session_number)
);
CREATE INDEX IF NOT EXISTS idx_sessions_campaign_id ON public.sessions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);

CREATE TABLE IF NOT EXISTS public.game_state_log (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'phase_changed', 'turn_advanced', 'world_turn_started',
      'world_turn_completed', 'turn_order_set', 'player_skipped'
    )),
    actor_id UUID REFERENCES public.user_profiles(id),
    previous_state JSONB,
    new_state JSONB NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_state_log_session ON public.game_state_log(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_state_log_campaign ON public.game_state_log(campaign_id, created_at DESC);
DROP TRIGGER IF EXISTS _touch_sessions ON public.sessions;
CREATE TRIGGER _touch_sessions
BEFORE UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.session_participants (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE NOT NULL,
    attendance_status TEXT NOT NULL DEFAULT 'present' CHECK (attendance_status IN ('present', 'absent', 'late', 'left_early')),
    character_level_start INTEGER NOT NULL,
    character_level_end INTEGER NOT NULL,
    UNIQUE(session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_session_participants_session_id ON public.session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user_id ON public.session_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_character_id ON public.session_participants(character_id);

-- =============================================================================
-- LOCATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('city', 'dungeon', 'wilderness', 'building', 'room', 'landmark')),
    map_url TEXT,
    grid_size INTEGER,
    world_map_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
    world_position geometry(Point, 0), -- SRID 0 (pixel/world)
    linked_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
    parent_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
    features JSONB DEFAULT '[]'::jsonb,
    is_discovered BOOLEAN DEFAULT false,
    discovered_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_campaign_id ON public.locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON public.locations(parent_location_id);
CREATE INDEX IF NOT EXISTS idx_locations_world_map_id ON public.locations(world_map_id);
CREATE INDEX IF NOT EXISTS idx_locations_world_position_gix ON public.locations USING GIST (world_position);
DROP TRIGGER IF EXISTS _touch_locations ON public.locations;
CREATE TRIGGER _touch_locations
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.location_connections (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    from_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    to_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    distance NUMERIC,
    travel_time INTEGER,
    description TEXT,
    UNIQUE(from_location_id, to_location_id)
);

-- =============================================================================
-- NPCS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.npcs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    race TEXT NOT NULL,
    occupation TEXT,
    avatar_url TEXT,
    appearance TEXT,
    personality TEXT NOT NULL,
    motivations TEXT,
    secrets TEXT,
    stats JSONB,
    current_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
    world_position geometry(Point, 0),
    CONSTRAINT npc_world_position_srid CHECK (world_position IS NULL OR ST_SRID(world_position) = 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npcs_campaign_id ON public.npcs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_npcs_location_id ON public.npcs(current_location_id);
CREATE INDEX IF NOT EXISTS idx_npcs_world_position_gix
    ON public.npcs USING GIST (world_position) WHERE world_position IS NOT NULL;
DROP TRIGGER IF EXISTS _touch_npcs ON public.npcs;
CREATE TRIGGER _touch_npcs
BEFORE UPDATE ON public.npcs
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.npc_relationships (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    npc_id UUID REFERENCES public.npcs(id) ON DELETE CASCADE NOT NULL,
    target_id UUID NOT NULL, -- character or npc uuid
    target_type TEXT NOT NULL CHECK (target_type IN ('npc', 'character')),
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('ally', 'enemy', 'neutral', 'romantic', 'family', 'business')),
    description TEXT,
    strength INTEGER DEFAULT 0 CHECK (strength >= -5 AND strength <= 5),
    last_interaction_at TIMESTAMP WITH TIME ZONE,
    last_interaction_summary TEXT,
    trust_delta_total INTEGER DEFAULT 0,
    UNIQUE(npc_id, target_type, target_id)
);

-- Normalized NPC world positions (SRID 0)
CREATE OR REPLACE VIEW public.v_npc_world_positions AS
SELECT
  npc.id,
  npc.campaign_id,
  npc.name,
  npc.occupation,
  COALESCE(npc.world_position, loc.world_position) AS geom
FROM public.npcs npc
LEFT JOIN public.locations loc ON npc.current_location_id = loc.id
WHERE COALESCE(npc.world_position, loc.world_position) IS NOT NULL;

-- =============================================================================
-- LLM CONFIG & LOGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.llm_providers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    adapter TEXT NOT NULL CHECK (adapter IN ('ollama')),
    host TEXT,
    model TEXT,
    api_key TEXT,
    timeout_ms INTEGER,
    options JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN DEFAULT true,
    default_provider BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_providers_default
  ON public.llm_providers (default_provider) WHERE default_provider;
CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON public.llm_providers(enabled);
DROP TRIGGER IF EXISTS _touch_llm_providers ON public.llm_providers;
CREATE TRIGGER _touch_llm_providers
BEFORE UPDATE ON public.llm_providers
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.llm_narratives (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    npc_id UUID REFERENCES public.npcs(id) ON DELETE SET NULL,
    request_type TEXT NOT NULL CHECK (
        request_type IN (
            'dm_narration',
            'scene_description',
            'npc_dialogue',
            'action_narrative',
            'quest_generation',
            'objective_description',
            'objective_treasure',
            'objective_combat',
            'objective_npcs',
            'objective_rumours'
        )
    ),
    requested_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    cache_key TEXT,
    cache_hit BOOLEAN DEFAULT false,
    provider_name TEXT NOT NULL,
    provider_model TEXT,
    provider_request_metadata JSONB,
    prompt TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    metrics JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
ALTER TABLE public.llm_narratives
    DROP CONSTRAINT IF EXISTS llm_narratives_request_type_check;
ALTER TABLE public.llm_narratives
    ADD CONSTRAINT llm_narratives_request_type_check CHECK (
        request_type IN (
            'dm_narration',
            'scene_description',
            'npc_dialogue',
            'action_narrative',
            'quest_generation',
            'objective_description',
            'objective_treasure',
            'objective_combat',
            'objective_npcs',
            'objective_rumours'
        )
    );
CREATE INDEX IF NOT EXISTS idx_llm_narratives_campaign_id ON public.llm_narratives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_llm_narratives_session_id ON public.llm_narratives(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_narratives_request_type ON public.llm_narratives(request_type);
CREATE INDEX IF NOT EXISTS idx_llm_narratives_cache_key ON public.llm_narratives(cache_key) WHERE cache_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.npc_memories (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    npc_id UUID REFERENCES public.npcs(id) ON DELETE CASCADE NOT NULL,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    narrative_id UUID REFERENCES public.llm_narratives(id) ON DELETE SET NULL,
    memory_summary TEXT NOT NULL,
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    trust_delta INTEGER DEFAULT 0 CHECK (trust_delta >= -10 AND trust_delta <= 10),
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npc_memories_npc_id ON public.npc_memories(npc_id);
CREATE INDEX IF NOT EXISTS idx_npc_memories_campaign_id ON public.npc_memories(campaign_id);
CREATE INDEX IF NOT EXISTS idx_npc_memories_session_id ON public.npc_memories(session_id);

-- =============================================================================
-- ENCOUNTERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.encounters (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('combat', 'social', 'exploration', 'puzzle', 'rumour')),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'deadly')),
    initiative_order JSONB,
    current_round INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
    experience_reward INTEGER DEFAULT 0,
    treasure_reward JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_encounters_campaign_id ON public.encounters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_encounters_session_id ON public.encounters(session_id);
CREATE INDEX IF NOT EXISTS idx_encounters_location_id ON public.encounters(location_id);
DROP TRIGGER IF EXISTS _touch_encounters ON public.encounters;
CREATE TRIGGER _touch_encounters
BEFORE UPDATE ON public.encounters
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.encounter_participants (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    encounter_id UUID REFERENCES public.encounters(id) ON DELETE CASCADE NOT NULL,
    participant_id UUID NOT NULL,
    participant_type TEXT NOT NULL CHECK (participant_type IN ('character', 'npc')),
    name TEXT NOT NULL,
    initiative INTEGER,
    hit_points JSONB NOT NULL DEFAULT '{"max": 0, "current": 0, "temporary": 0}'::jsonb,
    armor_class INTEGER NOT NULL DEFAULT 10,
    conditions JSONB DEFAULT '[]'::jsonb,
    has_acted BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_encounter_participants_encounter_id ON public.encounter_participants(encounter_id);

-- =============================================================================
-- ROUTES (campaign-level travel)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.routes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    start_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    end_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    distance NUMERIC NOT NULL, -- in your chosen units
    travel_time INTEGER NOT NULL, -- hours
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'deadly')),
    terrain JSONB DEFAULT '[]'::jsonb,
    weather TEXT,
    hazards JSONB DEFAULT '[]'::jsonb,
    encounters JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routes_start_location_id ON public.routes(start_location_id);
CREATE INDEX IF NOT EXISTS idx_routes_end_location_id ON public.routes(end_location_id);
DROP TRIGGER IF EXISTS _touch_routes ON public.routes;
CREATE TRIGGER _touch_routes
BEFORE UPDATE ON public.routes
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =============================================================================
-- CHAT
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'dice_roll', 'system', 'ooc')),
    sender_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    sender_name TEXT NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    dice_roll JSONB,
    is_private BOOLEAN DEFAULT false,
    recipients JSONB,
    reactions JSONB DEFAULT '[]'::jsonb,
    channel_type TEXT NOT NULL DEFAULT 'party'
      CHECK (channel_type IN ('party', 'private', 'dm_whisper', 'dm_broadcast')),
    channel_target_user_id UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_campaign_id ON public.chat_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON public.chat_messages (campaign_id, channel_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_read_cursors (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
  channel_type TEXT NOT NULL,
  channel_target_user_id UUID,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_read_cursors_unique
  ON public.chat_read_cursors (user_id, campaign_id, channel_type, COALESCE(channel_target_user_id, '00000000-0000-0000-0000-000000000000'));

-- =============================================================================
-- SPATIAL FUNCTIONS (SRID 0 safe; no geography)
-- =============================================================================

-- burgs near a point (SRID 0 units)
DROP FUNCTION IF EXISTS get_burgs_near_point(UUID, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_burgs_near_point(
    world_map_id UUID,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    radius DOUBLE PRECISION DEFAULT 100.0 -- SRID 0 units
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    population INTEGER,
    capital BOOLEAN,
    distance DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.population,
    b.capital,
    ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(x, y), 0)) AS distance
  FROM public.maps_burgs b
  WHERE b.world_id = world_map_id
    AND ST_DWithin(b.geom, ST_SetSRID(ST_MakePoint(x, y), 0), radius)
  ORDER BY distance;
END$$;

-- routes that intersect a straight line between two points (SRID 0)
DROP FUNCTION IF EXISTS get_routes_between_points(UUID, double precision, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_routes_between_points(
    world_map_id UUID,
    start_x DOUBLE PRECISION,
    start_y DOUBLE PRECISION,
    end_x DOUBLE PRECISION,
    end_y DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    type TEXT,
    geom geometry
) LANGUAGE plpgsql AS $$
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

-- cell at a point (SRID 0)
DROP FUNCTION IF EXISTS get_cell_at_point(UUID, double precision, double precision);
CREATE OR REPLACE FUNCTION get_cell_at_point(
    world_map_id UUID,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    biome INTEGER,
    type TEXT,
    population INTEGER,
    height INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.biome, c.type, c.population, c.height
  FROM public.maps_cells c
  WHERE c.world_id = world_map_id
    AND ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(x, y), 0))
  LIMIT 1;
END$$;

-- rivers in bounds (SRID 0)
DROP FUNCTION IF EXISTS get_rivers_in_bounds(UUID, double precision, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION get_rivers_in_bounds(
    world_map_id UUID,
    north DOUBLE PRECISION,
    south DOUBLE PRECISION,
    east DOUBLE PRECISION,
    west DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    world_id UUID,
    river_id INTEGER,
    name TEXT,
    type TEXT,
    discharge DOUBLE PRECISION,
    length DOUBLE PRECISION,
    width DOUBLE PRECISION,
    geometry JSONB
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.world_id,
    r.river_id,
    r.name,
    r.type,
    r.discharge,
    r.length,
    r.width,
    ST_AsGeoJSON(r.geom)::jsonb AS geometry
  FROM public.maps_rivers r
  WHERE r.world_id = world_map_id
    AND ST_Intersects(r.geom, ST_MakeEnvelope(west, south, east, north, 0));
END$$;
