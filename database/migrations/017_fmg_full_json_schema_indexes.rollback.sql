-- 017_fmg_full_json_schema_indexes.rollback.sql
-- Reverses 017_fmg_full_json_schema_indexes.sql:
--   1. Drop the _world_id_idx renames, recreate the original _world_idx names.
--   2. Recreate maps_notes_world_idx.
--   3. Drop maps_provinces_state_idx.

BEGIN;

-- =====================================================================
-- 1. Revert _world_id_idx → _world_idx
-- =====================================================================

DROP INDEX IF EXISTS public.maps_states_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_states_world_idx ON public.maps_states (world_id);

DROP INDEX IF EXISTS public.maps_provinces_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_provinces_world_idx ON public.maps_provinces (world_id);

DROP INDEX IF EXISTS public.maps_cultures_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_cultures_world_idx ON public.maps_cultures (world_id);

DROP INDEX IF EXISTS public.maps_religions_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_religions_world_idx ON public.maps_religions (world_id);

DROP INDEX IF EXISTS public.maps_features_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_features_world_idx ON public.maps_features (world_id);

DROP INDEX IF EXISTS public.maps_zones_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_zones_world_idx ON public.maps_zones (world_id);

DROP INDEX IF EXISTS public.maps_regiments_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_regiments_world_idx ON public.maps_regiments (world_id);

DROP INDEX IF EXISTS public.maps_campaigns_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_campaigns_world_idx ON public.maps_campaigns (world_id);

DROP INDEX IF EXISTS public.maps_diplomacy_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_diplomacy_world_idx ON public.maps_diplomacy (world_id);

DROP INDEX IF EXISTS public.maps_coats_of_arms_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_coats_world_idx ON public.maps_coats_of_arms (world_id);

DROP INDEX IF EXISTS public.maps_import_jobs_world_id_idx;
CREATE INDEX IF NOT EXISTS maps_import_jobs_world_idx ON public.maps_import_jobs (world_id);

-- =====================================================================
-- 2. Recreate maps_notes_world_idx
-- =====================================================================
CREATE INDEX IF NOT EXISTS maps_notes_world_idx ON public.maps_notes (world_id);

-- =====================================================================
-- 3. Drop maps_provinces_state_idx
-- =====================================================================
DROP INDEX IF EXISTS public.maps_provinces_state_idx;

COMMIT;
