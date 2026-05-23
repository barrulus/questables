-- 017_fmg_full_json_schema_indexes.sql
-- Fix-up for 016_fmg_full_json_schema.sql:
--   1. Rename 11 of the 12 _world_idx indexes on new tables to _world_id_idx
--      to match the existing repo convention (maps_cells_world_id_idx etc.)
--   2. Drop maps_notes_world_idx without replacement — maps_notes_target_idx
--      on (world_id, target_kind, target_id) is a superset that covers all
--      world-only seeks.
--   3. Add missing maps_provinces_state_idx for (world_id, state_id).
--
-- Idempotent: safe to re-apply.

BEGIN;

-- =====================================================================
-- 1. Rename _world_idx → _world_id_idx (11 tables with replacement)
-- =====================================================================

-- maps_states
DROP INDEX IF EXISTS public.maps_states_world_idx;
CREATE INDEX IF NOT EXISTS maps_states_world_id_idx ON public.maps_states (world_id);

-- maps_provinces
DROP INDEX IF EXISTS public.maps_provinces_world_idx;
CREATE INDEX IF NOT EXISTS maps_provinces_world_id_idx ON public.maps_provinces (world_id);

-- maps_cultures
DROP INDEX IF EXISTS public.maps_cultures_world_idx;
CREATE INDEX IF NOT EXISTS maps_cultures_world_id_idx ON public.maps_cultures (world_id);

-- maps_religions
DROP INDEX IF EXISTS public.maps_religions_world_idx;
CREATE INDEX IF NOT EXISTS maps_religions_world_id_idx ON public.maps_religions (world_id);

-- maps_features
DROP INDEX IF EXISTS public.maps_features_world_idx;
CREATE INDEX IF NOT EXISTS maps_features_world_id_idx ON public.maps_features (world_id);

-- maps_zones
DROP INDEX IF EXISTS public.maps_zones_world_idx;
CREATE INDEX IF NOT EXISTS maps_zones_world_id_idx ON public.maps_zones (world_id);

-- maps_regiments
DROP INDEX IF EXISTS public.maps_regiments_world_idx;
CREATE INDEX IF NOT EXISTS maps_regiments_world_id_idx ON public.maps_regiments (world_id);

-- maps_campaigns
DROP INDEX IF EXISTS public.maps_campaigns_world_idx;
CREATE INDEX IF NOT EXISTS maps_campaigns_world_id_idx ON public.maps_campaigns (world_id);

-- maps_diplomacy
DROP INDEX IF EXISTS public.maps_diplomacy_world_idx;
CREATE INDEX IF NOT EXISTS maps_diplomacy_world_id_idx ON public.maps_diplomacy (world_id);

-- maps_coats_of_arms  (016 named this maps_coats_world_idx — rename to canonical form)
DROP INDEX IF EXISTS public.maps_coats_world_idx;
CREATE INDEX IF NOT EXISTS maps_coats_of_arms_world_id_idx ON public.maps_coats_of_arms (world_id);

-- maps_import_jobs
DROP INDEX IF EXISTS public.maps_import_jobs_world_idx;
CREATE INDEX IF NOT EXISTS maps_import_jobs_world_id_idx ON public.maps_import_jobs (world_id);

-- =====================================================================
-- 2. Drop redundant maps_notes_world_idx (no replacement needed —
--    maps_notes_target_idx on (world_id, target_kind, target_id) is a
--    superset)
-- =====================================================================
DROP INDEX IF EXISTS public.maps_notes_world_idx;

-- =====================================================================
-- 3. Add missing province → state index
-- =====================================================================
CREATE INDEX IF NOT EXISTS maps_provinces_state_idx ON public.maps_provinces (world_id, state_id);

COMMIT;
