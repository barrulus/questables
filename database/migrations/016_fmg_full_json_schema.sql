-- 016_fmg_full_json_schema.sql
-- Adds full FMG ingest schema: states, provinces, cultures, religions,
-- features, zones, regiments, campaigns, diplomacy, coats-of-arms,
-- biomes, notes, import_jobs. ALTERs maps_burgs/cells/rivers/routes/world
-- with new columns. Migrates existing maps_burgs.emblem JSONB into
-- maps_coats_of_arms and drops the emblem column.
--
-- Idempotent: safe to re-apply.

BEGIN;

-- =====================================================================
-- Polygon-bearing tables (geometry built from cells+vertices at ingest)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_id INTEGER NOT NULL,
  name TEXT,
  full_name TEXT,
  form TEXT,
  form_name TEXT,
  color TEXT,
  type TEXT,
  culture INTEGER,
  religion INTEGER,
  capital_burg_id INTEGER,
  expansionism NUMERIC,
  urban NUMERIC,
  rural NUMERIC,
  area NUMERIC,
  neighbors INTEGER[],
  center_x DOUBLE PRECISION,
  center_y DOUBLE PRECISION,
  pole_x DOUBLE PRECISION,
  pole_y DOUBLE PRECISION,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, state_id)
);
CREATE INDEX IF NOT EXISTS maps_states_geom_gix ON public.maps_states USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_states_world_idx ON public.maps_states (world_id);

CREATE TABLE IF NOT EXISTS public.maps_provinces (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  province_id INTEGER NOT NULL,
  name TEXT,
  full_name TEXT,
  form_name TEXT,
  color TEXT,
  state_id INTEGER,
  burg_id INTEGER,
  center_x DOUBLE PRECISION,
  center_y DOUBLE PRECISION,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, province_id)
);
CREATE INDEX IF NOT EXISTS maps_provinces_geom_gix ON public.maps_provinces USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_provinces_world_idx ON public.maps_provinces (world_id);

CREATE TABLE IF NOT EXISTS public.maps_cultures (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  culture_id INTEGER NOT NULL,
  name TEXT,
  code TEXT,
  color TEXT,
  type TEXT,
  base INTEGER,
  expansionism NUMERIC,
  center_cell INTEGER,
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, culture_id)
);
CREATE INDEX IF NOT EXISTS maps_cultures_geom_gix ON public.maps_cultures USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_cultures_world_idx ON public.maps_cultures (world_id);

CREATE TABLE IF NOT EXISTS public.maps_religions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  religion_id INTEGER NOT NULL,
  name TEXT,
  code TEXT,
  color TEXT,
  type TEXT,
  form TEXT,
  deity TEXT,
  culture INTEGER,
  expansion TEXT,
  expansionism NUMERIC,
  center_cell INTEGER,
  origins INTEGER[],
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, religion_id)
);
CREATE INDEX IF NOT EXISTS maps_religions_geom_gix ON public.maps_religions USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_religions_world_idx ON public.maps_religions (world_id);

CREATE TABLE IF NOT EXISTS public.maps_features (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  group_name TEXT,
  land BOOLEAN,
  area NUMERIC,
  height NUMERIC,
  flux NUMERIC,
  temp NUMERIC,
  evaporation NUMERIC,
  first_cell INTEGER,
  outlet INTEGER,
  geom geometry(MultiPolygon, 0),
  shoreline_geom geometry(MultiLineString, 0),
  UNIQUE (world_id, feature_id)
);
CREATE INDEX IF NOT EXISTS maps_features_geom_gix ON public.maps_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_features_world_idx ON public.maps_features (world_id);

CREATE TABLE IF NOT EXISTS public.maps_zones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  color TEXT,
  cells INTEGER[],
  geom geometry(MultiPolygon, 0),
  UNIQUE (world_id, zone_id)
);
CREATE INDEX IF NOT EXISTS maps_zones_geom_gix ON public.maps_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_zones_world_idx ON public.maps_zones (world_id);

-- =====================================================================
-- Military + political (point + scalar)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_regiments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  regiment_id INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  name TEXT,
  icon TEXT,
  cell INTEGER,
  x_px DOUBLE PRECISION,
  y_px DOUBLE PRECISION,
  base_x DOUBLE PRECISION,
  base_y DOUBLE PRECISION,
  total_men INTEGER,
  attack_value NUMERIC,
  u_infantry INTEGER,
  u_archers INTEGER,
  u_cavalry INTEGER,
  u_artillery INTEGER,
  u_fleet INTEGER,
  geom geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_px, y_px), 0)) STORED,
  UNIQUE (world_id, state_id, regiment_id)
);
CREATE INDEX IF NOT EXISTS maps_regiments_geom_gix ON public.maps_regiments USING GIST (geom);
CREATE INDEX IF NOT EXISTS maps_regiments_world_idx ON public.maps_regiments (world_id);

CREATE TABLE IF NOT EXISTS public.maps_campaigns (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_id INTEGER NOT NULL,
  campaign_index INTEGER NOT NULL,
  name TEXT,
  start_year INTEGER,
  end_year INTEGER,
  attacker TEXT,
  defender TEXT,
  UNIQUE (world_id, state_id, campaign_index)
);
COMMENT ON TABLE public.maps_campaigns IS
  'FMG historical war record nested on pack.states[].campaigns[]. NOT the Questables RPG-campaign concept (see public.campaigns). Application code MUST use the fully qualified table name to avoid confusion.';
CREATE INDEX IF NOT EXISTS maps_campaigns_world_idx ON public.maps_campaigns (world_id);

CREATE TABLE IF NOT EXISTS public.maps_diplomacy (
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  state_a_id INTEGER NOT NULL,
  state_b_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (world_id, state_a_id, state_b_id)
);
CREATE INDEX IF NOT EXISTS maps_diplomacy_world_idx ON public.maps_diplomacy (world_id);

CREATE TABLE IF NOT EXISTS public.maps_coats_of_arms (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('state','province','burg')),
  owner_id INTEGER NOT NULL,
  shield TEXT,
  t1 TEXT,
  division JSONB,
  ordinaries JSONB,
  charges JSONB,
  UNIQUE (world_id, owner_kind, owner_id)
);
CREATE INDEX IF NOT EXISTS maps_coats_world_idx ON public.maps_coats_of_arms (world_id);

-- =====================================================================
-- Reference / lore
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_biomes (
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  biome_id INTEGER NOT NULL,
  name TEXT,
  color TEXT,
  habitability NUMERIC,
  icons_csv TEXT,
  biomes_martin TEXT,
  cost INTEGER,
  PRIMARY KEY (world_id, biome_id)
);

CREATE TABLE IF NOT EXISTS public.maps_notes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES public.maps_world(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  name TEXT,
  legend TEXT,
  UNIQUE (world_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS maps_notes_world_idx ON public.maps_notes (world_id);
CREATE INDEX IF NOT EXISTS maps_notes_target_idx ON public.maps_notes (world_id, target_kind, target_id);

-- =====================================================================
-- Import job tracking
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maps_import_jobs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  world_id UUID REFERENCES public.maps_world(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  stage TEXT,
  percent INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  file_path TEXT,
  file_size_bytes BIGINT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS maps_import_jobs_status_idx ON public.maps_import_jobs (status);
CREATE INDEX IF NOT EXISTS maps_import_jobs_world_idx ON public.maps_import_jobs (world_id);

-- =====================================================================
-- ALTERs on existing maps_* tables
-- =====================================================================

ALTER TABLE public.maps_world
  ADD COLUMN IF NOT EXISTS map_coordinates JSONB,
  ADD COLUMN IF NOT EXISTS fmg_version TEXT,
  ADD COLUMN IF NOT EXISTS fmg_map_id BIGINT,
  ADD COLUMN IF NOT EXISTS fmg_seed TEXT;

ALTER TABLE public.maps_burgs
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS is_large_port BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_regional_center BOOLEAN,
  ADD COLUMN IF NOT EXISTS settlement_type TEXT,
  ADD COLUMN IF NOT EXISTS base_population NUMERIC,
  ADD COLUMN IF NOT EXISTS "group" TEXT,
  ADD COLUMN IF NOT EXISTS feature INTEGER;

ALTER TABLE public.maps_cells
  ADD COLUMN IF NOT EXISTS flux INTEGER,
  ADD COLUMN IF NOT EXISTS confluence INTEGER,
  ADD COLUMN IF NOT EXISTS river_id INTEGER,
  ADD COLUMN IF NOT EXISTS haven INTEGER,
  ADD COLUMN IF NOT EXISTS harbor INTEGER,
  ADD COLUMN IF NOT EXISTS pop NUMERIC,
  ADD COLUMN IF NOT EXISTS province INTEGER,
  ADD COLUMN IF NOT EXISTS feature INTEGER,
  ADD COLUMN IF NOT EXISTS area NUMERIC,
  ADD COLUMN IF NOT EXISTS temperature NUMERIC;

ALTER TABLE public.maps_rivers
  ADD COLUMN IF NOT EXISTS parent INTEGER,
  ADD COLUMN IF NOT EXISTS basin INTEGER,
  ADD COLUMN IF NOT EXISTS source_width NUMERIC,
  ADD COLUMN IF NOT EXISTS width_factor NUMERIC;

ALTER TABLE public.maps_routes
  ADD COLUMN IF NOT EXISTS group_name TEXT;

-- =====================================================================
-- Migrate maps_burgs.emblem → maps_coats_of_arms, then drop emblem
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maps_burgs'
      AND column_name = 'emblem'
  ) THEN
    INSERT INTO public.maps_coats_of_arms
      (world_id, owner_kind, owner_id, shield, t1, division, ordinaries, charges)
    SELECT
      b.world_id,
      'burg',
      b.burg_id,
      b.emblem->>'shield',
      b.emblem->>'t1',
      b.emblem->'division',
      b.emblem->'ordinaries',
      b.emblem->'charges'
    FROM public.maps_burgs b
    WHERE b.emblem IS NOT NULL
    ON CONFLICT (world_id, owner_kind, owner_id) DO NOTHING;

    ALTER TABLE public.maps_burgs DROP COLUMN emblem;
  END IF;
END $$;

COMMIT;
