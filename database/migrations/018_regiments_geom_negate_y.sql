-- 018_regiments_geom_negate_y.sql
-- Fix-up for 016_fmg_full_json_schema.sql.
--
-- Every PostGIS `geom` column that the world map renders stores the
-- QUESTABLES_PIXEL convention: Y-up, i.e. the raw FMG pixel Y negated, so a
-- world occupies y in [-height, 0] and matches maps_world.bounds
-- ({north: 0, south: -height}). maps_regiments.geom was defined as a
-- generated column over the RAW scalars (x_px, y_px), which put regiments in
-- positive-Y space — outside the view extent, so /api/maps/:worldId/regiments
-- served GeoJSON the map could never draw.
--
-- x_px / y_px stay raw FMG pixels (same contract as maps_burgs.xpixel/ypixel
-- and maps_markers.x_px/y_px); only the generated geometry is flipped.
--
-- Dropping and re-adding the generated column rewrites the table. That is
-- cheap: maps_regiments is only ever populated by the FMG full-JSON import,
-- which had no production worlds when this shipped.

BEGIN;

DROP INDEX IF EXISTS public.maps_regiments_geom_gix;

ALTER TABLE public.maps_regiments DROP COLUMN IF EXISTS geom;

ALTER TABLE public.maps_regiments
  ADD COLUMN geom geometry(Point, 0)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, -y_px), 0)) STORED;

CREATE INDEX IF NOT EXISTS maps_regiments_geom_gix
  ON public.maps_regiments USING GIST (geom);

COMMIT;
