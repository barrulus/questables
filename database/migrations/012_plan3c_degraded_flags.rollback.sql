-- 012_plan3c_degraded_flags.rollback.sql
BEGIN;
ALTER TABLE public.maps_burg_settlements DROP COLUMN IF EXISTS degraded_flags;
COMMIT;
