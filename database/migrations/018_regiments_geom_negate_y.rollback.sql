-- 018_regiments_geom_negate_y.rollback.sql
-- Reverses 018: restores the raw (un-negated) generated geometry.

BEGIN;

DROP INDEX IF EXISTS public.maps_regiments_geom_gix;

ALTER TABLE public.maps_regiments DROP COLUMN IF EXISTS geom;

ALTER TABLE public.maps_regiments
  ADD COLUMN geom geometry(Point, 0)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED;

CREATE INDEX IF NOT EXISTS maps_regiments_geom_gix
  ON public.maps_regiments USING GIST (geom);

COMMIT;
