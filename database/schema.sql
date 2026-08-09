-- D&D 5e Web App Database Schema (SRID 0 version)
-- PostgreSQL 17 + PostGIS
-- Coordinate policy: SRID 0 (unitless/pixel-space). No geography casts.
-- Case-insensitive usernames/emails via CITEXT.
-- Uniform updated_at trigger.
--
-- Drift policy: this file is the *final-state* schema applied by
-- server/setup-database.js on every server start. It MUST stay in sync
-- with database/migrations/*.sql — the migrations are authoritative for
-- existing DBs being rolled forward, this file is authoritative for a
-- fresh install. When a migration adds a table or column, fold the same
-- shape into this file in its CREATE TABLE block. Every statement here
-- must be idempotent (CREATE … IF NOT EXISTS, ALTER … ADD COLUMN
-- IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD).

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
-- username / email hold AES-256-GCM ciphertext (see server/crypto.js).
-- Uniqueness and login lookup go through the *_lookup HMAC columns instead of the CITEXT
-- columns we used to rely on.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username TEXT NOT NULL,
    username_lookup TEXT NOT NULL,
    email TEXT NOT NULL,
    email_lookup TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_lookup ON public.user_profiles(username_lookup);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email_lookup ON public.user_profiles(email_lookup);
CREATE INDEX IF NOT EXISTS idx_user_profiles_roles ON public.user_profiles USING GIN (roles);

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[],
    device_name TEXT,
    backup_eligible BOOLEAN NOT NULL DEFAULT false,
    backup_state BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON public.webauthn_credentials(user_id);

-- One-time tokens used to bind a freshly created (or re-enrolled) user to a new passkey.
-- token_hash is sha256(plain_token); the plain token is only ever shown once via the admin UI.
CREATE TABLE IF NOT EXISTS public.enrolment_tokens (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrolment_tokens_user_id ON public.enrolment_tokens(user_id);

-- Transient challenge store for the in-flight registration / authentication ceremony.
-- challenge_id is a random opaque value handed to the client; rows are short-lived (~5 min).
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    challenge_id TEXT NOT NULL UNIQUE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
    challenge TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON public.webauthn_challenges(expires_at);
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

    -- FMG full-JSON import metadata (migration 016)
    map_coordinates JSONB,
    fmg_version TEXT,
    fmg_map_id BIGINT,
    fmg_seed TEXT,

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
    flux INTEGER,
    confluence INTEGER,
    river_id INTEGER,
    haven INTEGER,
    harbor INTEGER,
    pop NUMERIC,
    province INTEGER,
    feature INTEGER,
    area NUMERIC,
    temperature NUMERIC,
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
    type TEXT,
    is_large_port BOOLEAN,
    is_regional_center BOOLEAN,
    settlement_type TEXT,
    base_population NUMERIC,
    "group" TEXT,
    feature INTEGER,
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
    group_name TEXT,
    geom geometry(MultiLineString, 0) NOT NULL,
    UNIQUE(world_id, route_id)
);
CREATE INDEX IF NOT EXISTS maps_routes_geom_gix ON public.maps_routes USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_routes_world_id_idx ON public.maps_routes(world_id);

-- Upgrade paths for DBs created before migration 016 added these columns.
ALTER TABLE public.maps_world
    ADD COLUMN IF NOT EXISTS map_coordinates JSONB,
    ADD COLUMN IF NOT EXISTS fmg_version TEXT,
    ADD COLUMN IF NOT EXISTS fmg_map_id BIGINT,
    ADD COLUMN IF NOT EXISTS fmg_seed TEXT;

ALTER TABLE public.maps_burgs
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS is_large_port BOOLEAN,
    ADD COLUMN IF NOT EXISTS is_regional_center BOOLEAN,
    ADD COLUMN IF NOT EXISTS settlement_type TEXT,
    ADD COLUMN IF NOT EXISTS base_population NUMERIC,
    ADD COLUMN IF NOT EXISTS "group" TEXT,
    ADD COLUMN IF NOT EXISTS feature INTEGER;
-- migration 016 also migrates maps_burgs.emblem into maps_coats_of_arms
-- and drops it; handled in the FMG tables section below.

ALTER TABLE public.maps_cells
    ADD COLUMN IF NOT EXISTS flux INTEGER,
    ADD COLUMN IF NOT EXISTS confluence INTEGER,
    ADD COLUMN IF NOT EXISTS river_id INTEGER,
    ADD COLUMN IF NOT EXISTS haven INTEGER,
    ADD COLUMN IF NOT EXISTS harbor INTEGER,
    ADD COLUMN IF NOT EXISTS pop NUMERIC,
    ADD COLUMN IF NOT EXISTS province INTEGER,
    ADD COLUMN IF NOT EXISTS feature INTEGER,
    ADD COLUMN IF NOT EXISTS area NUMERIC,
    ADD COLUMN IF NOT EXISTS temperature NUMERIC;

ALTER TABLE public.maps_rivers
    ADD COLUMN IF NOT EXISTS parent INTEGER,
    ADD COLUMN IF NOT EXISTS basin INTEGER,
    ADD COLUMN IF NOT EXISTS source_width NUMERIC,
    ADD COLUMN IF NOT EXISTS width_factor NUMERIC;

ALTER TABLE public.maps_routes
    ADD COLUMN IF NOT EXISTS group_name TEXT;

-- Burg entrances / gates (one row per gate per burg, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_burg_entrances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    burg_id UUID NOT NULL REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    gate_id TEXT NOT NULL,
    route_id UUID REFERENCES public.maps_routes(id) ON DELETE SET NULL,
    x_px DOUBLE PRECISION NOT NULL,
    y_px DOUBLE PRECISION NOT NULL,
    geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
    bearing_deg DOUBLE PRECISION NOT NULL,
    bearing_match_delta_deg DOUBLE PRECISION,
    kind TEXT NOT NULL CHECK (kind IN ('land', 'harbour')),
    sub_kind TEXT NOT NULL CHECK (sub_kind IN ('road', 'foot', 'harbour')),
    wall_vertex_index INTEGER NOT NULL,
    prev_gate_id TEXT,
    next_gate_id TEXT,
    name TEXT,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    arrival_local JSONB,
    UNIQUE (burg_id, gate_id)
);
-- Upgrade path for DBs created before migration 009 added arrival_local.
ALTER TABLE public.maps_burg_entrances ADD COLUMN IF NOT EXISTS arrival_local JSONB;
CREATE INDEX IF NOT EXISTS maps_burg_entrances_geom_gix
  ON public.maps_burg_entrances USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_burg_id_idx
  ON public.maps_burg_entrances (burg_id);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_route_id_idx
  ON public.maps_burg_entrances (route_id)
  WHERE route_id IS NOT NULL;

-- Per-burg settlement metadata (sidecar to maps_burgs, written by
-- settlemaker). Added by migration 009; degraded_flags by 012;
-- local_origin_shift by 013.
CREATE TABLE IF NOT EXISTS public.maps_burg_settlements (
    burg_id UUID PRIMARY KEY REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    meters_per_unit NUMERIC NOT NULL,
    diameter_meters NUMERIC NOT NULL,
    diameter_local NUMERIC NOT NULL,
    scale_source TEXT NOT NULL,
    local_bounds JSONB NOT NULL,
    max_zoom INTEGER NOT NULL,
    tile_extent_px INTEGER NOT NULL,
    svg_viewbox JSONB NOT NULL,
    has_harbour BOOLEAN NOT NULL,
    ocean_bearing_deg INTEGER,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    degraded_flags TEXT[],
    local_origin_shift JSONB
);
-- Upgrade paths for DBs created before migrations 012 / 013.
ALTER TABLE public.maps_burg_settlements ADD COLUMN IF NOT EXISTS degraded_flags TEXT[];
ALTER TABLE public.maps_burg_settlements ADD COLUMN IF NOT EXISTS local_origin_shift JSONB;

-- Multi-route gate join table (settlemaker 0.4.0+). Added by migration 011.
-- A single gate can legitimately serve multiple route bearings sharing one
-- wall vertex; maps_burg_entrances.route_id stays as the denormalised primary
-- match, this table holds the full per-route detail.
CREATE TABLE IF NOT EXISTS public.maps_burg_entrance_routes (
    entrance_id UUID NOT NULL
      REFERENCES public.maps_burg_entrances(id) ON DELETE CASCADE,
    route_id UUID NOT NULL
      REFERENCES public.maps_routes(id) ON DELETE CASCADE,
    kind TEXT,
    requested_bearing_deg DOUBLE PRECISION,
    match_delta_deg DOUBLE PRECISION,
    PRIMARY KEY (entrance_id, route_id)
);
CREATE INDEX IF NOT EXISTS maps_burg_entrance_routes_route_id_idx
    ON public.maps_burg_entrance_routes (route_id);

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
    parent INTEGER,
    basin INTEGER,
    source_width NUMERIC,
    width_factor NUMERIC,
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

-- =============================================================================
-- FMG FULL-JSON TABLES (migration 016 + 017 index fixes)
-- =============================================================================

-- States (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_states (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    state_id INTEGER NOT NULL,
    name TEXT,
    full_name TEXT,
    form TEXT,
    form_name TEXT,
    color TEXT,
    type TEXT,
    culture INTEGER,
    religion INTEGER,
    capital_burg_id INTEGER,
    expansionism NUMERIC,
    urban NUMERIC,
    rural NUMERIC,
    area NUMERIC,
    neighbors INTEGER[],
    center_x DOUBLE PRECISION,
    center_y DOUBLE PRECISION,
    pole_x DOUBLE PRECISION,
    pole_y DOUBLE PRECISION,
    geom geometry(MultiPolygon, 0),
    UNIQUE (world_id, state_id)
);
CREATE INDEX IF NOT EXISTS maps_states_geom_gix ON public.maps_states USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_states_world_id_idx ON public.maps_states (world_id);

-- Provinces (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_provinces (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    province_id INTEGER NOT NULL,
    name TEXT,
    full_name TEXT,
    form_name TEXT,
    color TEXT,
    state_id INTEGER,
    burg_id INTEGER,
    center_x DOUBLE PRECISION,
    center_y DOUBLE PRECISION,
    geom geometry(MultiPolygon, 0),
    UNIQUE (world_id, province_id)
);
CREATE INDEX IF NOT EXISTS maps_provinces_geom_gix ON public.maps_provinces USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_provinces_world_id_idx ON public.maps_provinces (world_id);
CREATE INDEX IF NOT EXISTS maps_provinces_state_idx ON public.maps_provinces (world_id, state_id);

-- Cultures (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_cultures (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    culture_id INTEGER NOT NULL,
    name TEXT,
    code TEXT,
    color TEXT,
    type TEXT,
    base INTEGER,
    expansionism NUMERIC,
    center_cell INTEGER,
    geom geometry(MultiPolygon, 0),
    UNIQUE (world_id, culture_id)
);
CREATE INDEX IF NOT EXISTS maps_cultures_geom_gix ON public.maps_cultures USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_cultures_world_id_idx ON public.maps_cultures (world_id);

-- Religions (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_religions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    religion_id INTEGER NOT NULL,
    name TEXT,
    code TEXT,
    color TEXT,
    type TEXT,
    form TEXT,
    deity TEXT,
    culture INTEGER,
    expansion TEXT,
    expansionism NUMERIC,
    center_cell INTEGER,
    origins INTEGER[],
    geom geometry(MultiPolygon, 0),
    UNIQUE (world_id, religion_id)
);
CREATE INDEX IF NOT EXISTS maps_religions_geom_gix ON public.maps_religions USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_religions_world_id_idx ON public.maps_religions (world_id);

-- Features (MultiPolygon + shoreline MultiLineString, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_features (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    feature_id INTEGER NOT NULL,
    name TEXT,
    type TEXT,
    group_name TEXT,
    land BOOLEAN,
    area NUMERIC,
    height NUMERIC,
    flux NUMERIC,
    temp NUMERIC,
    evaporation NUMERIC,
    first_cell INTEGER,
    outlet INTEGER,
    geom geometry(MultiPolygon, 0),
    shoreline_geom geometry(MultiLineString, 0),
    UNIQUE (world_id, feature_id)
);
CREATE INDEX IF NOT EXISTS maps_features_geom_gix ON public.maps_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_features_world_id_idx ON public.maps_features (world_id);

-- Zones (MultiPolygon, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_zones (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    zone_id INTEGER NOT NULL,
    name TEXT,
    type TEXT,
    color TEXT,
    cells INTEGER[],
    geom geometry(MultiPolygon, 0),
    UNIQUE (world_id, zone_id)
);
CREATE INDEX IF NOT EXISTS maps_zones_geom_gix ON public.maps_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_zones_world_id_idx ON public.maps_zones (world_id);

-- Regiments (Point generated from x_px/y_px, SRID 0)
CREATE TABLE IF NOT EXISTS public.maps_regiments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    regiment_id INTEGER NOT NULL,
    state_id INTEGER NOT NULL,
    name TEXT,
    icon TEXT,
    cell INTEGER,
    x_px DOUBLE PRECISION,
    y_px DOUBLE PRECISION,
    base_x DOUBLE PRECISION,
    base_y DOUBLE PRECISION,
    total_men INTEGER,
    attack_value NUMERIC,
    u_infantry INTEGER,
    u_archers INTEGER,
    u_cavalry INTEGER,
    u_artillery INTEGER,
    u_fleet INTEGER,
    -- x_px/y_px are raw FMG pixels (Y-down); geom is QUESTABLES_PIXEL
    -- (Y-up), hence the negation. See migration 018.
    geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, -y_px), 0)) STORED,
    UNIQUE (world_id, state_id, regiment_id)
);
CREATE INDEX IF NOT EXISTS maps_regiments_geom_gix ON public.maps_regiments USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_regiments_world_id_idx ON public.maps_regiments (world_id);

-- FMG historical war records (NOT the Questables RPG campaigns table)
CREATE TABLE IF NOT EXISTS public.maps_campaigns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    state_id INTEGER NOT NULL,
    campaign_index INTEGER NOT NULL,
    name TEXT,
    start_year INTEGER,
    end_year INTEGER,
    attacker TEXT,
    defender TEXT,
    UNIQUE (world_id, state_id, campaign_index)
);
COMMENT ON TABLE public.maps_campaigns IS
    'FMG historical war record nested on pack.states[].campaigns[]. NOT the Questables RPG-campaign concept (see public.campaigns). Application code MUST use the fully qualified table name to avoid confusion.';
CREATE INDEX IF NOT EXISTS maps_campaigns_world_id_idx ON public.maps_campaigns (world_id);

-- Diplomacy (state-pair relation)
CREATE TABLE IF NOT EXISTS public.maps_diplomacy (
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    state_a_id INTEGER NOT NULL,
    state_b_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (world_id, state_a_id, state_b_id)
);
CREATE INDEX IF NOT EXISTS maps_diplomacy_world_id_idx ON public.maps_diplomacy (world_id);

-- Coats of arms (heraldry for states, provinces, burgs)
CREATE TABLE IF NOT EXISTS public.maps_coats_of_arms (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('state', 'province', 'burg')),
    owner_id INTEGER NOT NULL,
    shield TEXT,
    t1 TEXT,
    division JSONB,
    ordinaries JSONB,
    charges JSONB,
    UNIQUE (world_id, owner_kind, owner_id)
);
CREATE INDEX IF NOT EXISTS maps_coats_of_arms_world_id_idx ON public.maps_coats_of_arms (world_id);

-- Migrate any pre-016 maps_burgs.emblem data into maps_coats_of_arms, then drop emblem.
-- Idempotent: the DO block checks column existence before acting.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burgs'
      AND column_name = 'emblem'
  ) THEN
    INSERT INTO public.maps_coats_of_arms
      (world_id, owner_kind, owner_id, shield, t1, division, ordinaries, charges)
    SELECT
      b.world_id,
      'burg',
      b.burg_id,
      b.emblem->>'shield',
      b.emblem->>'t1',
      b.emblem->'division',
      b.emblem->'ordinaries',
      b.emblem->'charges'
    FROM public.maps_burgs b
    WHERE b.emblem IS NOT NULL
    ON CONFLICT (world_id, owner_kind, owner_id) DO NOTHING;

    ALTER TABLE public.maps_burgs DROP COLUMN emblem;
  END IF;
END $$;

-- Biomes reference table
CREATE TABLE IF NOT EXISTS public.maps_biomes (
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    biome_id INTEGER NOT NULL,
    name TEXT,
    color TEXT,
    habitability NUMERIC,
    icons_csv TEXT,
    biomes_martin TEXT,
    cost INTEGER,
    PRIMARY KEY (world_id, biome_id)
);

-- World notes (FMG notes layer)
CREATE TABLE IF NOT EXISTS public.maps_notes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    name TEXT,
    legend TEXT,
    UNIQUE (world_id, target_kind, target_id)
);
-- maps_notes_world_id_idx intentionally omitted: maps_notes_target_idx
-- on (world_id, target_kind, target_id) is a superset covering world seeks.
CREATE INDEX IF NOT EXISTS maps_notes_target_idx ON public.maps_notes (world_id, target_kind, target_id);

-- Import job tracking
CREATE TABLE IF NOT EXISTS public.maps_import_jobs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    stage TEXT,
    percent INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    file_path TEXT,
    file_size_bytes BIGINT,
    uploaded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS maps_import_jobs_status_idx ON public.maps_import_jobs (status);
CREATE INDEX IF NOT EXISTS maps_import_jobs_world_id_idx ON public.maps_import_jobs (world_id);

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
    xp INTEGER NOT NULL DEFAULT 0,
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
    campaign_clock_days INTEGER NOT NULL DEFAULT 0 CHECK (campaign_clock_days >= 0),
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
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'left', 'pending')),
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'co-dm')),
    visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK (visibility_state IN ('visible', 'stealthed', 'hidden')),
    loc_current geometry(Point, 0),
    inside_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
    current_map_level TEXT NOT NULL DEFAULT 'world' CHECK (current_map_level IN ('world', 'settlement')),
    current_scene TEXT,
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

-- campaign world lore (collaborative CD + LLM world-building)
CREATE TABLE IF NOT EXISTS public.campaign_world_lore (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('geopolitical', 'history', 'cultures', 'religions', 'regions', 'factions', 'custom', 'npc', 'location', 'event', 'political', 'cultural', 'religious')),
    subsection TEXT,               -- state name, culture name, faction name, etc.
    content TEXT NOT NULL,
    cd_direction TEXT,             -- the CD's prompt/direction that generated this content
    generated_by TEXT NOT NULL DEFAULT 'manual' CHECK (generated_by IN ('llm', 'manual')),
    source_message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_campaign_id ON public.campaign_world_lore(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_section ON public.campaign_world_lore(campaign_id, section);
CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_source_message
  ON public.campaign_world_lore (source_message_id)
  WHERE source_message_id IS NOT NULL;
DROP TRIGGER IF EXISTS _touch_campaign_world_lore ON public.campaign_world_lore;
CREATE TRIGGER _touch_campaign_world_lore
BEFORE UPDATE ON public.campaign_world_lore
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
    source TEXT DEFAULT 'api',
    arrival_gate_entrance_id UUID REFERENCES public.maps_burg_entrances(id) ON DELETE SET NULL
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
    voice_config JSONB DEFAULT '{}'::jsonb,
    auto_generated BOOLEAN DEFAULT false,
    linked_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
    gender TEXT,
    age_group TEXT CHECK (age_group IS NULL OR age_group IN ('child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elder')),
    scene_tag TEXT,
    source_message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npcs_campaign_id ON public.npcs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_npcs_location_id ON public.npcs(current_location_id);
CREATE INDEX IF NOT EXISTS idx_npcs_world_position_gix
    ON public.npcs USING GIST (world_position) WHERE world_position IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_npcs_linked_burg ON public.npcs(linked_burg_id) WHERE linked_burg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_npcs_source_message ON public.npcs(source_message_id) WHERE source_message_id IS NOT NULL;
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
CREATE INDEX IF NOT EXISTS idx_npc_relationships_npc_id ON public.npc_relationships(npc_id);
CREATE INDEX IF NOT EXISTS idx_npc_relationships_target ON public.npc_relationships(target_id, target_type);

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
    adapter TEXT NOT NULL CHECK (adapter IN ('ollama', 'anthropic')),
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

CREATE TABLE IF NOT EXISTS public.campaign_llm_settings (
    campaign_id    UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
    world_tone     TEXT DEFAULT 'balanced',
    narrative_voice TEXT DEFAULT 'concise',
    custom_world_context TEXT,
    system_prompt_additions TEXT,
    directive_overrides JSONB DEFAULT '{}'::jsonb,
    chat_history_depth INT DEFAULT 5,
    npc_memory_depth   INT DEFAULT 10,
    include_undiscovered_locations BOOLEAN DEFAULT false,
    preferred_provider TEXT,
    preferred_model    TEXT,
    temperature        NUMERIC(3,2),
    top_p              NUMERIC(3,2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES user_profiles(id)
);
DROP TRIGGER IF EXISTS _touch_campaign_llm_settings ON public.campaign_llm_settings;
CREATE TRIGGER _touch_campaign_llm_settings
BEFORE UPDATE ON public.campaign_llm_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.prompt_versions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by UUID REFERENCES user_profiles(id),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_campaign ON public.prompt_versions(campaign_id, changed_at DESC);

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
    has_acted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES public.user_profiles(id)
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
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'dice_roll', 'system', 'ooc', 'narration', 'action_result', 'roll_request', 'system_event', 'world_turn')),
    sender_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    sender_name TEXT NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    dice_roll JSONB,
    is_private BOOLEAN DEFAULT false,
    recipients JSONB,
    reactions JSONB DEFAULT '[]'::jsonb,
    channel_type TEXT NOT NULL DEFAULT 'party'
      CHECK (channel_type IN ('party', 'private', 'dm_whisper', 'dm_broadcast', 'director_whisper')),
    channel_target_user_id UUID REFERENCES public.user_profiles(id),
    loc_x DOUBLE PRECISION,
    loc_y DOUBLE PRECISION,
    inside_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_campaign_id ON public.chat_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON public.chat_messages (campaign_id, channel_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_read_cursors (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
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

-- =============================================================================
-- SESSION PLAYER ACTIONS (WS3: Action Processing Pipeline)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.session_player_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id),
    player_id UUID NOT NULL REFERENCES public.campaign_players(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES public.characters(id),
    round_number INTEGER NOT NULL DEFAULT 1,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'move', 'interact', 'search', 'use_item', 'cast_spell',
        'talk_to_npc', 'pass', 'free_action',
        'attack', 'dash', 'dodge', 'disengage', 'help', 'hide', 'ready'
    )),
    action_payload JSONB NOT NULL DEFAULT '{}',
    dm_response JSONB,
    roll_result JSONB,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'awaiting_roll', 'resolved', 'cancelled', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_spa_session_round
    ON public.session_player_actions (session_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spa_user_session
    ON public.session_player_actions (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_spa_status
    ON public.session_player_actions (status)
    WHERE status IN ('pending', 'processing', 'awaiting_roll');
CREATE INDEX IF NOT EXISTS idx_spa_campaign_id
    ON public.session_player_actions (campaign_id);

-- =============================================================================
-- SESSION LIVE STATES (WS3: Server-Authoritative Character State)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.session_live_states (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id),
    character_id UUID NOT NULL REFERENCES public.characters(id),
    hp_current INTEGER NOT NULL,
    hp_max INTEGER NOT NULL,
    hp_temporary INTEGER NOT NULL DEFAULT 0,
    conditions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    spell_slots JSONB NOT NULL DEFAULT '{}'::jsonb,
    hit_dice JSONB NOT NULL DEFAULT '{}'::jsonb,
    class_resources JSONB NOT NULL DEFAULT '{}'::jsonb,
    inspiration BOOLEAN NOT NULL DEFAULT false,
    death_saves JSONB NOT NULL DEFAULT '{"successes": 0, "failures": 0}'::jsonb,
    xp_gained INTEGER NOT NULL DEFAULT 0,
    concentration JSONB DEFAULT NULL,
    change_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_sls_session ON public.session_live_states (session_id);
CREATE INDEX IF NOT EXISTS idx_sls_character ON public.session_live_states (character_id);
DROP TRIGGER IF EXISTS _touch_session_live_states ON public.session_live_states;
CREATE TRIGGER _touch_session_live_states
BEFORE UPDATE ON public.session_live_states
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- WS3: free_movement flag on sessions
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS free_movement BOOLEAN NOT NULL DEFAULT false;

-- WS4: Combat overhaul migrations
ALTER TABLE public.encounter_participants ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id);
ALTER TABLE public.session_live_states ADD COLUMN IF NOT EXISTS concentration JSONB DEFAULT NULL;

-- WS4: Expand action_type CHECK to include combat types
-- (DROP + ADD since ALTER CHECK is not supported in-place)
ALTER TABLE public.session_player_actions
  DROP CONSTRAINT IF EXISTS session_player_actions_action_type_check;
ALTER TABLE public.session_player_actions
  ADD CONSTRAINT session_player_actions_action_type_check
  CHECK (action_type IN (
    'move', 'interact', 'search', 'use_item', 'cast_spell',
    'talk_to_npc', 'pass', 'free_action',
    'attack', 'dash', 'dodge', 'disengage', 'help', 'hide', 'ready'
  ));

-- =============================================================================
-- NPC SHOPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.npc_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  npc_id UUID REFERENCES public.npcs(id) ON DELETE SET NULL,
  shop_type TEXT NOT NULL DEFAULT 'general',
  price_modifier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  location_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npc_shops_campaign ON public.npc_shops(campaign_id);

CREATE TABLE IF NOT EXISTS public.npc_shop_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.npc_shops(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  document_source TEXT NOT NULL DEFAULT 'srd-2024',
  stock_quantity INT,
  price_override NUMERIC(10,2),
  is_available BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(shop_id, item_key, document_source)
);
CREATE INDEX IF NOT EXISTS idx_shop_inv_shop ON public.npc_shop_inventory(shop_id);

-- =============================================================================
-- LOOT TABLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.loot_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  table_type TEXT NOT NULL DEFAULT 'custom',
  cr_min INT,
  cr_max INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.loot_table_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loot_table_id UUID NOT NULL REFERENCES public.loot_tables(id) ON DELETE CASCADE,
  item_key TEXT,
  document_source TEXT DEFAULT 'srd-2024',
  weight INT NOT NULL DEFAULT 1,
  quantity_min INT NOT NULL DEFAULT 1,
  quantity_max INT NOT NULL DEFAULT 1,
  currency_amount TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loot_entries_table ON public.loot_table_entries(loot_table_id);

-- =============================================================================
-- MODERATION REPORTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    reporter_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL NOT NULL,
    reported_user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL CHECK (report_type IN ('harassment', 'cheating', 'spam', 'inappropriate_content', 'other')),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    admin_notes TEXT,
    resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON public.moderation_reports(status);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported_user ON public.moderation_reports(reported_user_id);
