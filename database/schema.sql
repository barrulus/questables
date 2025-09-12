-- D&D 5e Web App Database Schema
-- This schema is for live deployment with Supabase
-- Run these migrations in your Supabase SQL editor

-- Enable RLS (Row Level Security)
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- USERS & AUTHENTICATION
-- =============================================================================

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'dm', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
    avatar_url TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    last_login TIMESTAMP WITH TIME ZONE
);

-- User preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE PRIMARY KEY,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    notifications JSONB DEFAULT '{"email": true, "push": true, "campaigns": true, "sessions": true}'::jsonb,
    gameplay JSONB DEFAULT '{"autoRollInitiative": false, "showDamageNumbers": true, "compactUI": false}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Campaign players (many-to-many relationship)
CREATE TABLE IF NOT EXISTS public.campaign_players (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'left')),
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'co-dm')),
    UNIQUE(campaign_id, user_id)
);

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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    
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
    world_position geometry(Point, 4326), -- Position on the world map
    linked_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL, -- Link to Azgaar's burg if applicable
    
    -- Relationships
    parent_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
    
    -- Features and encounters
    features JSONB DEFAULT '[]'::jsonb,
    
    -- Discovery
    is_discovered BOOLEAN DEFAULT false,
    discovered_by JSONB DEFAULT '[]'::jsonb, -- Array of character IDs
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    UNIQUE(npc_id, target_id)
);

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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    layers JSONB DEFAULT '{"political": true, "terrain": true, "climate": false, "cultures": true, "religions": false, "provinces": true}'::jsonb,
    
    -- File info
    file_size NUMERIC, -- MB
    uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    geom geometry(GEOMETRY, 4326),
    
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
    geom geometry(Point, 4326),
    
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
    geom geometry(MultiLineString, 4326),
    
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
    geom geometry(MultiLineString, 4326),
    
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
    geom geometry(Point, 4326),
    
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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- User profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);

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
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npc_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_world ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_burgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_rivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tile_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- User profiles: Users can see all profiles but only update their own
CREATE POLICY "Public profiles are viewable by everyone" ON public.user_profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.user_profiles
    FOR UPDATE USING (auth.uid() = id);

-- User preferences: Users can only see and modify their own preferences
CREATE POLICY "Users can view own preferences" ON public.user_preferences
    FOR ALL USING (auth.uid() = user_id);

-- Characters: Users can only see and modify their own characters
CREATE POLICY "Users can manage own characters" ON public.characters
    FOR ALL USING (auth.uid() = user_id);

-- Campaigns: Public campaigns viewable by all, private campaigns only by participants
CREATE POLICY "Public campaigns are viewable by everyone" ON public.campaigns
    FOR SELECT USING (is_public = true);

CREATE POLICY "Campaign participants can view private campaigns" ON public.campaigns
    FOR SELECT USING (
        auth.uid() = dm_user_id OR 
        EXISTS (
            SELECT 1 FROM public.campaign_players 
            WHERE campaign_id = id AND user_id = auth.uid()
        )
    );

CREATE POLICY "DMs can manage their campaigns" ON public.campaigns
    FOR ALL USING (auth.uid() = dm_user_id);

-- Campaign players: Viewable by campaign participants, manageable by DM
CREATE POLICY "Campaign participants can view players" ON public.campaign_players
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_id AND (
                c.dm_user_id = auth.uid() OR 
                EXISTS (SELECT 1 FROM public.campaign_players cp WHERE cp.campaign_id = c.id AND cp.user_id = auth.uid())
            )
        )
    );

CREATE POLICY "DMs can manage campaign players" ON public.campaign_players
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_id AND c.dm_user_id = auth.uid()
        )
    );

-- Similar policies for other tables...
-- (For brevity, I'll include the key ones. You can extend this pattern for all tables)

-- Chat messages: Viewable by campaign participants
CREATE POLICY "Campaign participants can view chat" ON public.chat_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_id AND (
                c.dm_user_id = auth.uid() OR 
                EXISTS (SELECT 1 FROM public.campaign_players cp WHERE cp.campaign_id = c.id AND cp.user_id = auth.uid())
            )
        ) OR (
            is_private = true AND (
                sender_id = auth.uid() OR 
                recipients ? auth.uid()::text
            )
        )
    );

CREATE POLICY "Campaign participants can send chat messages" ON public.chat_messages
    FOR INSERT WITH CHECK (
        auth.uid() = sender_id AND
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_id AND (
                c.dm_user_id = auth.uid() OR 
                EXISTS (SELECT 1 FROM public.campaign_players cp WHERE cp.campaign_id = c.id AND cp.user_id = auth.uid())
            )
        )
    );

-- PostGIS Maps: World maps are viewable by everyone, manageable by admins
CREATE POLICY "World maps are viewable by everyone" ON public.maps_world
    FOR SELECT USING (true);

CREATE POLICY "Admins can manage world maps" ON public.maps_world
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Map data is viewable by everyone (read-only for most users)
CREATE POLICY "Map cells are viewable by everyone" ON public.maps_cells
    FOR SELECT USING (true);

CREATE POLICY "Map burgs are viewable by everyone" ON public.maps_burgs
    FOR SELECT USING (true);

CREATE POLICY "Map routes are viewable by everyone" ON public.maps_routes
    FOR SELECT USING (true);

CREATE POLICY "Map rivers are viewable by everyone" ON public.maps_rivers
    FOR SELECT USING (true);

CREATE POLICY "Map markers are viewable by everyone" ON public.maps_markers
    FOR SELECT USING (true);

-- Only admins can modify map data
CREATE POLICY "Admins can manage map cells" ON public.maps_cells
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can manage map burgs" ON public.maps_burgs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can manage map routes" ON public.maps_routes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can manage map rivers" ON public.maps_rivers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can manage map markers" ON public.maps_markers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- =============================================================================
-- FUNCTIONS AND TRIGGERS
-- =============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply the trigger to all tables with updated_at columns
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_npcs_updated_at BEFORE UPDATE ON public.npcs FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_encounters_updated_at BEFORE UPDATE ON public.encounters FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_routes_updated_at BEFORE UPDATE ON public.routes FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_maps_world_updated_at BEFORE UPDATE ON public.maps_world FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, username, role)
    VALUES (NEW.id, NEW.email, 'player');
    
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get campaign locations near a point
CREATE OR REPLACE FUNCTION get_campaign_locations_near_point(
    campaign_id UUID,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_km DOUBLE PRECISION DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    type TEXT,
    distance_km DOUBLE PRECISION,
    linked_burg_name TEXT
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.name,
        l.type,
        ST_Distance(l.world_position::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) / 1000 AS distance_km,
        b.name AS linked_burg_name
    FROM public.locations l
    LEFT JOIN public.maps_burgs b ON l.linked_burg_id = b.id
    WHERE l.campaign_id = campaign_id
    AND l.world_position IS NOT NULL
    AND ST_DWithin(l.world_position::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_km * 1000)
    ORDER BY distance_km;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================================
-- SPATIAL QUERY FUNCTIONS FOR MAP DATA
-- =============================================================================

-- Function to get burgs near a point
CREATE OR REPLACE FUNCTION get_burgs_near_point(
    world_map_id UUID,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    population INTEGER,
    capital BOOLEAN,
    distance_km DOUBLE PRECISION
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.name,
        b.population,
        b.capital,
        ST_Distance(b.geom::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) / 1000 AS distance_km
    FROM public.maps_burgs b
    WHERE b.world_id = world_map_id
    AND ST_DWithin(b.geom::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_km * 1000)
    ORDER BY distance_km;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

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
    length_km DOUBLE PRECISION
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.type,
        ST_Length(r.geom::geography) / 1000 AS length_km
    FROM public.maps_routes r
    WHERE r.world_id = world_map_id
    AND ST_Intersects(
        r.geom,
        ST_MakeLine(
            ST_SetSRID(ST_MakePoint(start_lng, start_lat), 4326),
            ST_SetSRID(ST_MakePoint(end_lng, end_lat), 4326)
        )
    )
    ORDER BY length_km;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get cell data at a specific point
CREATE OR REPLACE FUNCTION get_cell_at_point(
    world_map_id UUID,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    biome INTEGER,
    type TEXT,
    population INTEGER,
    height INTEGER
) AS $
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
    AND ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    LIMIT 1;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get rivers within bounds
CREATE OR REPLACE FUNCTION get_rivers_in_bounds(
    world_map_id UUID,
    north DOUBLE PRECISION,
    south DOUBLE PRECISION,
    east DOUBLE PRECISION,
    west DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    type TEXT,
    discharge DOUBLE PRECISION,
    length DOUBLE PRECISION
) AS $
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.type,
        r.discharge,
        r.length
    FROM public.maps_rivers r
    WHERE r.world_id = world_map_id
    AND ST_Intersects(
        r.geom,
        ST_MakeEnvelope(west, south, east, north, 4326)
    )
    ORDER BY r.discharge DESC NULLS LAST;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;