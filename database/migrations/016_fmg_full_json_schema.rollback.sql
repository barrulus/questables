-- Rollback for 016_fmg_full_json_schema.sql
-- Re-adds maps_burgs.emblem (data NOT restored — coats moved to maps_coats_of_arms)
-- and drops new tables + new columns.

BEGIN;

ALTER TABLE public.maps_burgs ADD COLUMN IF NOT EXISTS emblem JSONB;

ALTER TABLE public.maps_routes DROP COLUMN IF EXISTS group_name;
ALTER TABLE public.maps_rivers
  DROP COLUMN IF EXISTS width_factor,
  DROP COLUMN IF EXISTS source_width,
  DROP COLUMN IF EXISTS basin,
  DROP COLUMN IF EXISTS parent;
ALTER TABLE public.maps_cells
  DROP COLUMN IF EXISTS temperature,
  DROP COLUMN IF EXISTS area,
  DROP COLUMN IF EXISTS feature,
  DROP COLUMN IF EXISTS province,
  DROP COLUMN IF EXISTS pop,
  DROP COLUMN IF EXISTS harbor,
  DROP COLUMN IF EXISTS haven,
  DROP COLUMN IF EXISTS river_id,
  DROP COLUMN IF EXISTS confluence,
  DROP COLUMN IF EXISTS flux;
ALTER TABLE public.maps_burgs
  DROP COLUMN IF EXISTS feature,
  DROP COLUMN IF EXISTS "group",
  DROP COLUMN IF EXISTS base_population,
  DROP COLUMN IF EXISTS settlement_type,
  DROP COLUMN IF EXISTS is_regional_center,
  DROP COLUMN IF EXISTS is_large_port,
  DROP COLUMN IF EXISTS type;
ALTER TABLE public.maps_world
  DROP COLUMN IF EXISTS fmg_seed,
  DROP COLUMN IF EXISTS fmg_map_id,
  DROP COLUMN IF EXISTS fmg_version,
  DROP COLUMN IF EXISTS map_coordinates;

DROP TABLE IF EXISTS public.maps_import_jobs;
DROP TABLE IF EXISTS public.maps_notes;
DROP TABLE IF EXISTS public.maps_biomes;
DROP TABLE IF EXISTS public.maps_coats_of_arms;
DROP TABLE IF EXISTS public.maps_diplomacy;
DROP TABLE IF EXISTS public.maps_campaigns;
DROP TABLE IF EXISTS public.maps_regiments;
DROP TABLE IF EXISTS public.maps_zones;
DROP TABLE IF EXISTS public.maps_features;
DROP TABLE IF EXISTS public.maps_religions;
DROP TABLE IF EXISTS public.maps_cultures;
DROP TABLE IF EXISTS public.maps_provinces;
DROP TABLE IF EXISTS public.maps_states;

COMMIT;
