-- 003_npc_demographics.sql
-- Add gender and age_group to npcs to support demographic-aware extraction
-- and population caps in small settlements.

ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS age_group TEXT;

-- Optional CHECK to keep age_group values bounded
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'npcs_age_group_check'
  ) THEN
    ALTER TABLE public.npcs
      ADD CONSTRAINT npcs_age_group_check
      CHECK (age_group IS NULL OR age_group IN ('child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elder'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_npcs_linked_burg ON public.npcs(linked_burg_id) WHERE linked_burg_id IS NOT NULL;
