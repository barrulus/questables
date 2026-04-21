-- 009_plan3b_sidecar.sql
--
-- Adds per-burg settlement metadata (sidecar to maps_burgs) and an
-- arrival_local column on maps_burg_entrances. Consumed by Plan 3b.
--
-- Idempotent: safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.maps_burg_settlements (
    burg_id UUID PRIMARY KEY REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    meters_per_unit NUMERIC NOT NULL,
    diameter_meters NUMERIC NOT NULL,
    diameter_local NUMERIC NOT NULL,
    scale_source TEXT NOT NULL,
    local_bounds JSONB NOT NULL,
    max_zoom INTEGER NOT NULL,
    tile_extent_px INTEGER NOT NULL,
    svg_viewbox JSONB NOT NULL,
    has_harbour BOOLEAN NOT NULL,
    ocean_bearing_deg INTEGER,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_entrances'
      AND column_name = 'arrival_local'
  ) THEN
    ALTER TABLE public.maps_burg_entrances
      ADD COLUMN arrival_local JSONB;
  END IF;
END $$;

COMMIT;
