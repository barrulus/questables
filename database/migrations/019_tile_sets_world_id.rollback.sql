-- Rollback for 019_tile_sets_world_id.sql
BEGIN;

DROP INDEX IF EXISTS public.tile_sets_world_id_unique_idx;

ALTER TABLE public.tile_sets DROP COLUMN IF EXISTS world_id;

COMMIT;
