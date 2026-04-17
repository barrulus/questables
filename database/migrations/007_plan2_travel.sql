-- 007_plan2_travel.sql
--
-- Adds two columns supporting narrative player movement Plan 2:
--   - maps_world.pixels_per_mile       (DOUBLE PRECISION, nullable)
--   - campaigns.campaign_clock_days    (INTEGER NOT NULL DEFAULT 0 CHECK >= 0)
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS pixels_per_mile DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND column_name = 'campaign_clock_days'
  ) THEN
    ALTER TABLE public.campaigns
      ADD COLUMN campaign_clock_days INTEGER NOT NULL DEFAULT 0
        CHECK (campaign_clock_days >= 0);
  END IF;
END $$;

COMMIT;
