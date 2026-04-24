-- 013_plan3c_local_origin_shift.sql
--
-- Settlemaker 0.6.0 emits `local_origin_shift: {dx, dy, source}` so consumers
-- can tell which burgs were canvas-shifted toward a coast (source='coast_pull')
-- vs left at origin (source='none' or source='coast_too_far' — the latter
-- meaning the loader passed a coastline that the generator decided wasn't
-- really about this burg). The 'coast_too_far' count is our tuning signal
-- for the coastline-loader's pixel-radius envelope.
--
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_settlements'
      AND column_name = 'local_origin_shift'
  ) THEN
    ALTER TABLE public.maps_burg_settlements
      ADD COLUMN local_origin_shift JSONB;
  END IF;
END $$;

COMMIT;
