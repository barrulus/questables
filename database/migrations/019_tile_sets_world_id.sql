-- 019_tile_sets_world_id.sql
-- Lazy world base-map tiles (spec: docs/superpowers/specs/2026-08-09-lazy-world-tiles-design.md)
-- Link tile_sets rows to a world. NULL = legacy global tileset. At most one
-- world-scoped row per world (the world's base map) — enforced by a partial
-- unique index, which is also the ON CONFLICT target for the upload upsert.
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE public.tile_sets
  ADD COLUMN IF NOT EXISTS world_id UUID REFERENCES public.maps_world(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS tile_sets_world_id_unique_idx
  ON public.tile_sets (world_id)
  WHERE world_id IS NOT NULL;

COMMIT;
