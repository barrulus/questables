-- D&D 5e Web App Database Schema
-- PostgreSQL 17 with PostGIS for local development and production
-- Compatible with Express.js authentication system

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- USERS & AUTHENTICATION
-- =============================================================================

-- Users table (main user profiles)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
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

-- User preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE PRIMARY KEY,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    notifications JSONB DEFAULT '{"email": true, "push": true, "campaigns": true, "sessions": true}'::jsonb,
    gameplay JSONB DEFAULT '{"autoRollInitiative": false, "showDamageNumbers": true, "compactUI": false}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- WORLD MAPS (PostGIS-based for Azgaar's FMG data)
-- =============================================================================

-- Main world maps table
CREATE TABLE IF NOT EXISTS public.maps_world (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    geojson_url TEXT, -- Original geoJSON file URL
    thumbnail_url TEXT,

    -- Metadata
    bounds JSONB NOT NULL, -- {"north": 0, "south": 0, "east": 0, "west": 0}
    width_pixels INTEGER,
    height_pixels INTEGER,
    meters_per_pixel DOUBLE PRECISION,
    layers JSONB DEFAULT '{"political": true, "terrain": true, "climate": false, "cultures": true, "religions": false, "provinces": true}'::jsonb,

    -- File info
    file_size NUMERIC, -- MB
    uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,

    -- Status
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Map cells (from Azgaar's FMG) - terrain, biomes, political boundaries
CREATE TABLE IF NOT EXISTS public.maps_cells (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    cell_id INTEGER NOT NULL, -- Original cell ID from Azgaar's
    biome INTEGER,
    type TEXT,
    population INTEGER,
    state INTEGER,
    culture INTEGER,
    religion INTEGER,
    height INTEGER,
    geom geometry(GEOMETRY, 0),

    UNIQUE(world_id, cell_id)
);
CREATE INDEX IF NOT EXISTS maps_cells_geom_gix ON public.maps_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_cells_world_id_idx ON public.maps_cells(world_id);

-- Map burgs (cities/towns from Azgaar's FMG)
CREATE TABLE IF NOT EXISTS public.maps_burgs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    burg_id INTEGER NOT NULL, -- Original burg ID from Azgaar's
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
    xworld INTEGER,
    yworld INTEGER,
    xpixel DOUBLE PRECISION,
    ypixel DOUBLE PRECISION,
    cell INTEGER,
    emblem JSONB,
    geom geometry(Point, 0),

    UNIQUE(world_id, burg_id)
);
CREATE INDEX IF NOT EXISTS maps_burgs_geom_gix ON public.maps_burgs USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_burgs_world_id_idx ON public.maps_burgs(world_id);
CREATE INDEX IF NOT EXISTS maps_burgs_name_idx ON public.maps_burgs(name);

-- Map routes (roads, paths from Azgaar's FMG)
CREATE TABLE IF NOT EXISTS public.maps_routes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    route_id INTEGER NOT NULL, -- Original route ID from Azgaar's
    name TEXT,
    type TEXT,
    feature INTEGER,
    geom geometry(MultiLineString, 0),

    UNIQUE(world_id, route_id)
);
CREATE INDEX IF NOT EXISTS maps_routes_geom_gix ON public.maps_routes USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_routes_world_id_idx ON public.maps_routes(world_id);

-- Map rivers (from Azgaar's FMG)
CREATE TABLE IF NOT EXISTS public.maps_rivers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    river_id INTEGER NOT NULL, -- Original river ID from Azgaar's
    name TEXT,
    type TEXT,
    discharge DOUBLE PRECISION,
    length DOUBLE PRECISION,
    width DOUBLE PRECISION,
    geom geometry(MultiLineString, 0),

    UNIQUE(world_id, river_id)
);
CREATE INDEX IF NOT EXISTS maps_rivers_geom_gix ON public.maps_rivers USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_rivers_world_id_idx ON public.maps_rivers(world_id);

-- Map markers (custom markers from Azgaar's FMG)
CREATE TABLE IF NOT EXISTS public.maps_markers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
    marker_id INTEGER NOT NULL, -- Original marker ID from Azgaar's
    type TEXT,
    icon TEXT,
    x_px DOUBLE PRECISION,
    y_px DOUBLE PRECISION,
    note TEXT,
    geom geometry(Point, 0),

    UNIQUE(world_id, marker_id)
);
CREATE INDEX IF NOT EXISTS maps_markers_geom_gix ON public.maps_markers USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_markers_world_id_idx ON public.maps_markers(world_id);

-- Tile sets for map rendering
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

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

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

    -- Core stats
    hit_points JSONB NOT NULL DEFAULT '{"current": 0, "max": 0, "temporary": 0}'::jsonb,
    armor_class INTEGER NOT NULL DEFAULT 10,
    speed INTEGER NOT NULL DEFAULT 30,
    proficiency_bonus INTEGER NOT NULL DEFAULT 2,

    -- Abilities
    abilities JSONB NOT NULL DEFAULT '{"strength": 10, "dexterity": 10, "constitution": 10, "intelligence": 10, "wisdom": 10, "charisma": 10}'::jsonb,

    -- Derived stats
    saving_throws JSONB DEFAULT '{}'::jsonb,
    skills JSONB DEFAULT '{}'::jsonb,

    -- Equipment and inventory
    inventory JSONB DEFAULT '[]'::jsonb,
    equipment JSONB DEFAULT '{}'::jsonb,

    -- Character details
    avatar_url TEXT,
    backstory TEXT,
    personality TEXT,
    ideals TEXT,
    bonds TEXT,
    flaws TEXT,

    -- Spellcasting
    spellcasting JSONB,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_played TIMESTAMP WITH TIME ZONE
);

-- =============================================================================
-- CAMPAIGNS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    dm_user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,

    -- Campaign settings
    system TEXT NOT NULL DEFAULT 'D&D 5e',
    setting TEXT DEFAULT 'Homebrew',
    status TEXT NOT NULL DEFAULT 'recruiting' CHECK (status IN ('recruiting', 'active', 'paused', 'completed')),
    max_players INTEGER DEFAULT 6,
    level_range JSONB DEFAULT '{"min": 1, "max": 20}'::jsonb,

    -- Campaign content
    world_map_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,

    -- Settings
    is_public BOOLEAN DEFAULT false,
    allow_spectators BOOLEAN DEFAULT false,
    auto_approve_join_requests BOOLEAN DEFAULT false,
    experience_type TEXT DEFAULT 'milestone' CHECK (experience_type IN ('milestone', 'experience_points')),
    resting_rules TEXT DEFAULT 'standard' CHECK (resting_rules IN ('standard', 'gritty', 'heroic')),
    death_save_rules TEXT DEFAULT 'standard' CHECK (death_save_rules IN ('standard', 'hardcore', 'forgiving')),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Campaign players (many-to-many relationship)
CREATE TABLE IF NOT EXISTS public.campaign_players (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'left')),
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'co-dm')),
    loc_current geometry(Point, 4326),
    last_located_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_players_loc_current_srid CHECK (loc_current IS NULL OR ST_SRID(loc_current) = 4326),
    UNIQUE(campaign_id, user_id)
);

ALTER TABLE public.campaign_players
    ADD COLUMN IF NOT EXISTS loc_current geometry(Point, 4326);
ALTER TABLE public.campaign_players
    ADD COLUMN IF NOT EXISTS last_located_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.campaign_players
    ALTER COLUMN last_located_at SET DEFAULT NOW();
UPDATE public.campaign_players
    SET last_located_at = NOW()
    WHERE last_located_at IS NULL;
ALTER TABLE public.campaign_players
    ALTER COLUMN last_located_at SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.constraint_column_usage
        WHERE constraint_name = 'campaign_players_loc_current_srid'
          AND table_name = 'campaign_players'
          AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.campaign_players
            ADD CONSTRAINT campaign_players_loc_current_srid CHECK (loc_current IS NULL OR ST_SRID(loc_current) = 4326);
    END IF;
END
$$;

-- Player location history for live map tokens
CREATE TABLE IF NOT EXISTS public.campaign_player_locations (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    player_id UUID REFERENCES public.campaign_players(id) ON DELETE CASCADE NOT NULL,
    loc geometry(Point, 4326) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT campaign_player_locations_loc_srid CHECK (ST_SRID(loc) = 4326)
);
CREATE INDEX IF NOT EXISTS idx_campaign_player_locations_lookup
    ON public.campaign_player_locations (campaign_id, player_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_player_locations_loc_gix
    ON public.campaign_player_locations USING GIST (loc);

-- Automatically capture player location changes
CREATE OR REPLACE FUNCTION public.log_campaign_player_location()
RETURNS trigger
LANGUAGE plpgsql
AS $_log$
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
END;
$_log$;

DROP TRIGGER IF EXISTS trg_campaign_players_location_audit ON public.campaign_players;
CREATE TRIGGER trg_campaign_players_location_audit
AFTER INSERT OR UPDATE OF loc_current ON public.campaign_players
FOR EACH ROW
EXECUTE FUNCTION public.log_campaign_player_location();

-- Recent player trail view (30 most recent points)
CREATE OR REPLACE VIEW public.v_player_recent_trails AS
SELECT
    ranked.campaign_id,
    ranked.player_id,
    ST_SetSRID(ST_MakeLine(ranked.loc ORDER BY ranked.recorded_at), 4326) AS trail_geom,
    MIN(ranked.recorded_at) AS recorded_from,
    MAX(ranked.recorded_at) AS recorded_to,
    COUNT(*) AS point_count
FROM (
    SELECT
        cpl.campaign_id,
        cpl.player_id,
        cpl.loc,
        cpl.recorded_at,
        ROW_NUMBER() OVER (PARTITION BY cpl.campaign_id, cpl.player_id ORDER BY cpl.recorded_at DESC) AS rn
    FROM public.campaign_player_locations cpl
) AS ranked
WHERE ranked.rn <= 30
GROUP BY ranked.campaign_id, ranked.player_id;

-- =============================================================================
-- SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_number INTEGER NOT NULL,

    -- Session details
    title TEXT NOT NULL,
    summary TEXT,
    dm_notes TEXT,

    -- Timing
    scheduled_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration INTEGER, -- minutes

    -- Experience and rewards
    experience_awarded INTEGER DEFAULT 0,
    treasure_awarded JSONB DEFAULT '[]'::jsonb,

    -- Status
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

    UNIQUE(campaign_id, session_number)
);

-- Session participants
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

-- =============================================================================
-- LOCATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('city', 'dungeon', 'wilderness', 'building', 'room', 'landmark')),

    -- Map data
    map_url TEXT, -- For encounter/battle maps
    grid_size INTEGER,

    -- World map positioning (for locations on the world map)
    world_map_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
    world_position geometry(Point, 0), -- Position on the world map (pixel coordinates)
    linked_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL, -- Link to Azgaar's burg if applicable

    -- Relationships
    parent_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,

    -- Features and encounters
    features JSONB DEFAULT '[]'::jsonb,

    -- Discovery
    is_discovered BOOLEAN DEFAULT false,
    discovered_by JSONB DEFAULT '[]'::jsonb, -- Array of character IDs

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Location connections (many-to-many)
CREATE TABLE IF NOT EXISTS public.location_connections (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    from_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    to_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    distance NUMERIC,
    travel_time INTEGER, -- minutes
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

    -- Appearance and personality
    avatar_url TEXT,
    appearance TEXT,
    personality TEXT NOT NULL,
    motivations TEXT,
    secrets TEXT,

    -- Stats (for combat NPCs)
    stats JSONB,

    -- Current location
    current_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- NPC relationships
CREATE TABLE IF NOT EXISTS public.npc_relationships (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    npc_id UUID REFERENCES public.npcs(id) ON DELETE CASCADE NOT NULL,
    target_id UUID NOT NULL, -- Can reference NPCs or characters
    target_type TEXT NOT NULL CHECK (target_type IN ('npc', 'character')),
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('ally', 'enemy', 'neutral', 'romantic', 'family', 'business')),
    description TEXT,
    strength INTEGER DEFAULT 0 CHECK (strength >= -5 AND strength <= 5),
    last_interaction_at TIMESTAMP WITH TIME ZONE,
    last_interaction_summary TEXT,
    UNIQUE(npc_id, target_id)
);

ALTER TABLE public.npc_relationships
    ADD COLUMN IF NOT EXISTS trust_delta_total INTEGER DEFAULT 0;

ALTER TABLE public.npc_relationships
    ALTER COLUMN trust_delta_total SET DEFAULT 0;

-- LLM provider configuration
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
    ON public.llm_providers (default_provider)
    WHERE default_provider;

CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON public.llm_providers(enabled);

-- LLM narrative response log
CREATE TABLE IF NOT EXISTS public.llm_narratives (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    request_id UUID NOT NULL,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    npc_id UUID REFERENCES public.npcs(id) ON DELETE SET NULL,
    request_type TEXT NOT NULL CHECK (request_type IN ('dm_narration','scene_description','npc_dialogue','action_narrative','quest_generation')),
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(request_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_narratives_campaign_id ON public.llm_narratives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_llm_narratives_session_id ON public.llm_narratives(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_narratives_request_type ON public.llm_narratives(request_type);

-- NPC memory log (conversation history and outcomes)
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
    type TEXT NOT NULL CHECK (type IN ('combat', 'social', 'exploration', 'puzzle')),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'deadly')),

    -- Combat specific
    initiative_order JSONB,
    current_round INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),

    -- Rewards
    experience_reward INTEGER DEFAULT 0,
    treasure_reward JSONB DEFAULT '[]'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Encounter participants
CREATE TABLE IF NOT EXISTS public.encounter_participants (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    encounter_id UUID REFERENCES public.encounters(id) ON DELETE CASCADE NOT NULL,
    participant_id UUID NOT NULL, -- Character or NPC ID
    participant_type TEXT NOT NULL CHECK (participant_type IN ('character', 'npc')),
    name TEXT NOT NULL,
    initiative INTEGER,
    hit_points JSONB NOT NULL DEFAULT '{"max": 0, "current": 0, "temporary": 0}'::jsonb,
    armor_class INTEGER NOT NULL DEFAULT 10,
    conditions JSONB DEFAULT '[]'::jsonb,
    has_acted BOOLEAN DEFAULT false
);

-- =============================================================================
-- ROUTES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.routes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,

    start_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
    end_location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,

    distance NUMERIC NOT NULL, -- miles
    travel_time INTEGER NOT NULL, -- hours
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'deadly')),

    -- Travel conditions
    terrain JSONB DEFAULT '[]'::jsonb,
    weather TEXT,
    hazards JSONB DEFAULT '[]'::jsonb,

    -- Encounters
    encounters JSONB DEFAULT '[]'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- CHAT SYSTEM
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,

    -- Message content
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'dice_roll', 'system', 'ooc')),

    -- Sender info
    sender_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    sender_name TEXT NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,

    -- Dice roll specific
    dice_roll JSONB,

    -- Visibility
    is_private BOOLEAN DEFAULT false,
    recipients JSONB, -- Array of user IDs for private messages

    -- Reactions
    reactions JSONB DEFAULT '[]'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- SPATIAL FUNCTIONS FOR AZGAAR'S FMG DATA
-- =============================================================================

-- Function to get burgs near a specific point
CREATE OR REPLACE FUNCTION get_burgs_near_point(
    world_map_id UUID,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_km DOUBLE PRECISION DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    population INTEGER,
    capital BOOLEAN,
    distance_km DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.name,
        b.population,
        b.capital,
        ST_Distance(b.geom::geography, ST_SetSRID(ST_MakePoint(longitude, latitude), 0)::geography) / 1000 AS distance_km
    FROM public.maps_burgs b
    WHERE b.world_id = world_map_id
      AND ST_DWithin(b.geom::geography, ST_SetSRID(ST_MakePoint(longitude, latitude), 0)::geography, radius_km * 1000)
    ORDER BY distance_km;
END;
$$ LANGUAGE plpgsql;

-- Function to get routes between two points
CREATE OR REPLACE FUNCTION get_routes_between_points(
    world_map_id UUID,
    start_lat DOUBLE PRECISION,
    start_lng DOUBLE PRECISION,
    end_lat DOUBLE PRECISION,
    end_lng DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    type TEXT,
    geom geometry
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id,
        r.name,
        r.type,
        r.geom
    FROM public.maps_routes r
    WHERE r.world_id = world_map_id
      AND ST_Intersects(
          r.geom,
          ST_MakeLine(
              ST_SetSRID(ST_MakePoint(start_lng, start_lat), 0),
              ST_SetSRID(ST_MakePoint(end_lng, end_lat), 0)
          )
      );
END;
$$ LANGUAGE plpgsql;

-- Function to get cell at specific point
CREATE OR REPLACE FUNCTION get_cell_at_point(
    world_map_id UUID,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    biome INTEGER,
    type TEXT,
    population INTEGER,
    height INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.biome,
        c.type,
        c.population,
        c.height
    FROM public.maps_cells c
    WHERE c.world_id = world_map_id
      AND ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(longitude, latitude), 0))
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get rivers in bounding box
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
    geometry JSON
) AS $$
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
        ST_AsGeoJSON(r.geom)::json AS geometry
    FROM public.maps_rivers r
    WHERE r.world_id = world_map_id
      AND ST_Intersects(
          r.geom,
          ST_MakeEnvelope(west, south, east, north, 0)
      );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- User profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_roles ON public.user_profiles USING GIN (roles);

-- Characters
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON public.characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON public.characters(name);

-- Campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_dm_user_id ON public.campaigns(dm_user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_is_public ON public.campaigns(is_public);

-- Campaign players
CREATE INDEX IF NOT EXISTS idx_campaign_players_campaign_id ON public.campaign_players(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_players_user_id ON public.campaign_players(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_players_loc_current_gix
    ON public.campaign_players USING GIST (loc_current) WHERE loc_current IS NOT NULL;

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_campaign_id ON public.sessions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);

-- Locations
CREATE INDEX IF NOT EXISTS idx_locations_campaign_id ON public.locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON public.locations(parent_location_id);
CREATE INDEX IF NOT EXISTS idx_locations_world_map_id ON public.locations(world_map_id);
CREATE INDEX IF NOT EXISTS idx_locations_world_position_gix ON public.locations USING GIST (world_position);

-- NPCs
CREATE INDEX IF NOT EXISTS idx_npcs_campaign_id ON public.npcs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_npcs_location_id ON public.npcs(current_location_id);

-- Encounters
CREATE INDEX IF NOT EXISTS idx_encounters_campaign_id ON public.encounters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_encounters_session_id ON public.encounters(session_id);
CREATE INDEX IF NOT EXISTS idx_encounters_location_id ON public.encounters(location_id);

-- Chat messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_campaign_id ON public.chat_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

-- =============================================================================
-- NOTES FOR POSTGRESQL DEPLOYMENT
-- =============================================================================

-- This schema is designed for PostgreSQL 17 with PostGIS and is compatible with:
-- - Local development with Express.js authentication
-- - Managed PostgreSQL services (AWS RDS, Google Cloud SQL, etc.)
-- - Self-hosted PostgreSQL deployments
--
-- Authentication is handled at the application layer (Express.js server)
-- Row Level Security (RLS) has been intentionally omitted for flexibility
--
-- To use this schema:
-- 1. Ensure PostgreSQL 17+ with PostGIS extension is installed
-- 2. Create database: CREATE DATABASE dnd_app;
-- 3. Run this schema file: psql -d dnd_app -f schema.sql
-- 4. Configure your Express.js server to connect to the database
-- 5. Import Azgaar's FMG data using the provided import scripts
