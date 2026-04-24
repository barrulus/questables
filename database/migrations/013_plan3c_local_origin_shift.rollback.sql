-- 013_plan3c_local_origin_shift.rollback.sql
BEGIN;
ALTER TABLE public.maps_burg_settlements DROP COLUMN IF EXISTS local_origin_shift;
COMMIT;
