-- 010_drop_pixels_per_mile.rollback.sql
--
-- Re-adds `maps_world.pixels_per_mile` and backfills it from
-- `meters_per_pixel` so worlds calibrated under the new scheme don't lose
-- their travel scale on rollback.

BEGIN;

ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS pixels_per_mile DOUBLE PRECISION;

UPDATE public.maps_world
   SET pixels_per_mile = 1609.344 / meters_per_pixel
 WHERE pixels_per_mile IS NULL
   AND meters_per_pixel IS NOT NULL
   AND meters_per_pixel > 0;

COMMIT;
