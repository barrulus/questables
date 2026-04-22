-- 010_drop_pixels_per_mile.sql
--
-- Drops `maps_world.pixels_per_mile`. The column was added in migration 007
-- but never had a write path — every consumer in the application code now
-- reads `meters_per_pixel` directly. The two are inverses
-- (pixels_per_mile = 1609.344 / meters_per_pixel), so any historical caller
-- that needs the mile factor can derive it inline.
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE public.maps_world
  DROP COLUMN IF EXISTS pixels_per_mile;

COMMIT;
