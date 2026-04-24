-- 011_plan3c_multi_route_entrances.sql
--
-- Settlemaker 0.4.0 ships per-route detail per gate (matched_route_ids,
-- matched_routes). On small burgs a single gate can legitimately serve
-- multiple route bearings sharing one wall vertex.
--
-- Model: keep maps_burg_entrances one-row-per-gate with a denormalized
-- scalar route_id (= primary / best-match route) for the cheap "show this
-- gate" read path, and add a child table maps_burg_entrance_routes holding
-- the full route list with per-edge attributes.
--
-- Idempotent: safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.maps_burg_entrance_routes (
    entrance_id UUID NOT NULL
      REFERENCES public.maps_burg_entrances(id) ON DELETE CASCADE,
    route_id UUID NOT NULL
      REFERENCES public.maps_routes(id) ON DELETE CASCADE,
    kind TEXT,
    requested_bearing_deg DOUBLE PRECISION,
    match_delta_deg DOUBLE PRECISION,
    PRIMARY KEY (entrance_id, route_id)
);

CREATE INDEX IF NOT EXISTS maps_burg_entrance_routes_route_id_idx
    ON public.maps_burg_entrance_routes (route_id);

-- Backfill from the existing scalar route_id so reverse lookups behave
-- consistently against pre-0.4.0 entrances until they're re-ingested.
INSERT INTO public.maps_burg_entrance_routes (entrance_id, route_id)
SELECT id, route_id
  FROM public.maps_burg_entrances
 WHERE route_id IS NOT NULL
ON CONFLICT (entrance_id, route_id) DO NOTHING;

COMMIT;
