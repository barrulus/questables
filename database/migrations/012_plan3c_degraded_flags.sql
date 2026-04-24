-- 012_plan3c_degraded_flags.sql
--
-- Settlemaker 0.5.0 reports `degraded_flags` in the FeatureCollection
-- metadata when geometry validation forced the generator to drop an input
-- flag (e.g. walls on tiny pop, citadel on bad compactness). Persist it
-- so callers can tell "no walls because FMG said so" apart from "no walls
-- because settlemaker degraded the input."
--
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burg_settlements'
      AND column_name = 'degraded_flags'
  ) THEN
    ALTER TABLE public.maps_burg_settlements
      ADD COLUMN degraded_flags TEXT[];
  END IF;
END $$;

COMMIT;
