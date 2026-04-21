-- 009_plan3b_sidecar.rollback.sql
--
-- Reverse of 009_plan3b_sidecar.sql. Drops the sidecar table and removes
-- the arrival_local column. Sidecar data is lost; arrival_local data is
-- lost. Run only if the forward migration failed or the feature is being
-- rolled back before the code consuming these is live.

BEGIN;

DROP TABLE IF EXISTS public.maps_burg_settlements;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_entrances'
      AND column_name = 'arrival_local'
  ) THEN
    ALTER TABLE public.maps_burg_entrances DROP COLUMN arrival_local;
  END IF;
END $$;

COMMIT;
