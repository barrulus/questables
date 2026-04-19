-- 008_plan3a_burg_entrances.sql
--
-- Adds gate-arrival storage for Plan 3a:
--   - public.maps_burg_entrances (new table, one row per gate per burg)
--   - public.player_movement_audit.arrival_gate_entrance_id (nullable FK)
--
-- Idempotent: safe to re-apply.

BEGIN;

-- Drop the prototype table (different schema: composite PK, integer burg_id,
-- local_x/local_y columns).  No production data lives here yet.
-- CASCADE drops any dependent indexes/constraints automatically.
DROP TABLE IF EXISTS public.maps_burg_entrances CASCADE;

CREATE TABLE IF NOT EXISTS public.maps_burg_entrances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    burg_id UUID NOT NULL REFERENCES public.maps_burgs(id) ON DELETE CASCADE,
    gate_id TEXT NOT NULL,
    route_id UUID REFERENCES public.maps_routes(id) ON DELETE SET NULL,
    x_px DOUBLE PRECISION NOT NULL,
    y_px DOUBLE PRECISION NOT NULL,
    geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
    bearing_deg DOUBLE PRECISION NOT NULL,
    bearing_match_delta_deg DOUBLE PRECISION,
    kind TEXT NOT NULL CHECK (kind IN ('land', 'harbour')),
    sub_kind TEXT NOT NULL CHECK (sub_kind IN ('road', 'foot', 'harbour')),
    wall_vertex_index INTEGER NOT NULL,
    prev_gate_id TEXT,
    next_gate_id TEXT,
    name TEXT,
    settlement_generation_version TEXT NOT NULL,
    settlemaker_version TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (burg_id, gate_id)
);

CREATE INDEX IF NOT EXISTS maps_burg_entrances_geom_gix
  ON public.maps_burg_entrances USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_burg_id_idx
  ON public.maps_burg_entrances (burg_id);
CREATE INDEX IF NOT EXISTS maps_burg_entrances_route_id_idx
  ON public.maps_burg_entrances (route_id)
  WHERE route_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'player_movement_audit'
      AND column_name = 'arrival_gate_entrance_id'
  ) THEN
    ALTER TABLE public.player_movement_audit
      ADD COLUMN arrival_gate_entrance_id UUID
        REFERENCES public.maps_burg_entrances(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
