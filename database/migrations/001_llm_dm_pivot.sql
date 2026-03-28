-- Migration: LLM-as-DM Pivot (Phases 1-6)
-- Adds columns, constraints, tables, and indexes needed for the autonomous DM architecture.
-- Safe to re-run: uses IF NOT EXISTS and DROP+re-ADD for constraints.

BEGIN;

-- ============================================================================
-- 1. chat_messages: extend message_type and channel_type CHECK constraints
-- ============================================================================
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_message_type_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'dice_roll', 'system', 'ooc', 'narration', 'action_result', 'roll_request', 'system_event', 'world_turn'));

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_channel_type_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_channel_type_check
  CHECK (channel_type IN ('party', 'private', 'dm_whisper', 'dm_broadcast', 'director_whisper'));

-- ============================================================================
-- 2. campaign_players: add settlement tracking columns
-- ============================================================================
ALTER TABLE public.campaign_players
  ADD COLUMN IF NOT EXISTS inside_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL;

-- current_map_level with CHECK — need to handle IF NOT EXISTS manually
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_players'
      AND column_name = 'current_map_level'
  ) THEN
    ALTER TABLE public.campaign_players
      ADD COLUMN current_map_level TEXT NOT NULL DEFAULT 'world'
        CHECK (current_map_level IN ('world', 'settlement'));
  END IF;
END $$;

-- ============================================================================
-- 3. npcs: add auto-generation tracking columns
-- ============================================================================
ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false;

ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS linked_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL;

-- ============================================================================
-- 4. campaign_world_lore: collaborative world-building table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_world_lore (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('geopolitical', 'history', 'cultures', 'religions', 'regions', 'factions', 'custom')),
    subsection TEXT,
    content TEXT NOT NULL,
    cd_direction TEXT,
    generated_by TEXT NOT NULL DEFAULT 'manual' CHECK (generated_by IN ('llm', 'manual')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_campaign_id
  ON public.campaign_world_lore(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_section
  ON public.campaign_world_lore(campaign_id, section);

-- updated_at trigger (only if the function exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_touch_updated_at') THEN
    DROP TRIGGER IF EXISTS _touch_campaign_world_lore ON public.campaign_world_lore;
    CREATE TRIGGER _touch_campaign_world_lore
      BEFORE UPDATE ON public.campaign_world_lore
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 5. Missing tables from schema.sql (session_player_actions, session_live_states, etc.)
--    These are referenced by the game state pipeline but were never applied.
-- ============================================================================

-- session_player_actions (action queue for turn-based play)
CREATE TABLE IF NOT EXISTS public.session_player_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.campaign_players(id) ON DELETE CASCADE,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    action_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'awaiting_roll', 'resolved', 'cancelled')),
    roll_request JSONB,
    roll_result JSONB,
    dm_response JSONB,
    narrative TEXT,
    round_number INT NOT NULL DEFAULT 1,
    turn_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_spa_session_id
  ON public.session_player_actions (session_id);
CREATE INDEX IF NOT EXISTS idx_spa_player_id
  ON public.session_player_actions (player_id);
CREATE INDEX IF NOT EXISTS idx_spa_status
  ON public.session_player_actions (status) WHERE status IN ('pending', 'awaiting_roll');
CREATE INDEX IF NOT EXISTS idx_spa_campaign_id
  ON public.session_player_actions (campaign_id);

-- session_live_states (server-authoritative character state during play)
CREATE TABLE IF NOT EXISTS public.session_live_states (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    campaign_player_id UUID NOT NULL REFERENCES public.campaign_players(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    hit_points JSONB NOT NULL DEFAULT '{"current":0,"max":0,"temporary":0}'::jsonb,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    spell_slots JSONB,
    resources JSONB,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (session_id, campaign_player_id)
);

-- moderation_reports
CREATE TABLE IF NOT EXISTS public.moderation_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reporter_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    target_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    target_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
    admin_notes TEXT,
    reviewed_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- npc_shops
CREATE TABLE IF NOT EXISTS public.npc_shops (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    npc_id UUID NOT NULL REFERENCES public.npcs(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    shop_type TEXT NOT NULL DEFAULT 'general',
    description TEXT,
    location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
    gold_available INT DEFAULT 500,
    restock_interval_days INT DEFAULT 7,
    last_restocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    price_modifier NUMERIC(4,2) DEFAULT 1.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- npc_shop_inventory
CREATE TABLE IF NOT EXISTS public.npc_shop_inventory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES public.npc_shops(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'miscellaneous',
    description TEXT,
    base_price_gp NUMERIC(10,2) NOT NULL DEFAULT 0,
    quantity INT DEFAULT 1,
    is_unlimited BOOLEAN DEFAULT false,
    rarity TEXT DEFAULT 'common'
      CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact')),
    srd_item_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- loot_tables
CREATE TABLE IF NOT EXISTS public.loot_tables (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    table_type TEXT NOT NULL DEFAULT 'random'
      CHECK (table_type IN ('random', 'weighted', 'tiered', 'fixed')),
    min_level INT DEFAULT 1,
    max_level INT DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- loot_table_entries
CREATE TABLE IF NOT EXISTS public.loot_table_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    loot_table_id UUID NOT NULL REFERENCES public.loot_tables(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'miscellaneous',
    description TEXT,
    weight INT DEFAULT 1,
    min_quantity INT DEFAULT 1,
    max_quantity INT DEFAULT 1,
    gold_value_min NUMERIC(10,2),
    gold_value_max NUMERIC(10,2),
    rarity TEXT DEFAULT 'common'
      CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact')),
    srd_item_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

COMMIT;
