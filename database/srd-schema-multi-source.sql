-- =============================================================================
-- Multi-Source SRD Migration
-- Adds document_source column to all entity tables, replaces UNIQUE(key)
-- with UNIQUE(key, document_source), updates junction tables and character FKs.
-- Run after srd-schema.sql
-- =============================================================================

-- =============================================================================
-- STEP 1: Add document_source to entity tables
-- =============================================================================

ALTER TABLE public.srd_species ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_classes ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_backgrounds ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_feats ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_spells ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_items ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_weapons ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_armor ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';

-- =============================================================================
-- STEP 2: Drop old UNIQUE(key) constraints, add composite UNIQUE(key, document_source)
-- =============================================================================

-- srd_species
ALTER TABLE public.srd_species DROP CONSTRAINT IF EXISTS srd_species_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_species_key_source_unique') THEN
    ALTER TABLE public.srd_species ADD CONSTRAINT srd_species_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_classes
ALTER TABLE public.srd_classes DROP CONSTRAINT IF EXISTS srd_classes_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_classes_key_source_unique') THEN
    ALTER TABLE public.srd_classes ADD CONSTRAINT srd_classes_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_backgrounds
ALTER TABLE public.srd_backgrounds DROP CONSTRAINT IF EXISTS srd_backgrounds_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_backgrounds_key_source_unique') THEN
    ALTER TABLE public.srd_backgrounds ADD CONSTRAINT srd_backgrounds_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_feats
ALTER TABLE public.srd_feats DROP CONSTRAINT IF EXISTS srd_feats_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_feats_key_source_unique') THEN
    ALTER TABLE public.srd_feats ADD CONSTRAINT srd_feats_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_spells
ALTER TABLE public.srd_spells DROP CONSTRAINT IF EXISTS srd_spells_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_spells_key_source_unique') THEN
    ALTER TABLE public.srd_spells ADD CONSTRAINT srd_spells_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_items
ALTER TABLE public.srd_items DROP CONSTRAINT IF EXISTS srd_items_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_items_key_source_unique') THEN
    ALTER TABLE public.srd_items ADD CONSTRAINT srd_items_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_weapons
ALTER TABLE public.srd_weapons DROP CONSTRAINT IF EXISTS srd_weapons_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_weapons_key_source_unique') THEN
    ALTER TABLE public.srd_weapons ADD CONSTRAINT srd_weapons_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- srd_armor
ALTER TABLE public.srd_armor DROP CONSTRAINT IF EXISTS srd_armor_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_armor_key_source_unique') THEN
    ALTER TABLE public.srd_armor ADD CONSTRAINT srd_armor_key_source_unique UNIQUE (key, document_source);
  END IF;
END $$;

-- Indexes on document_source for filtering
CREATE INDEX IF NOT EXISTS idx_srd_species_doc_source ON public.srd_species(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_classes_doc_source ON public.srd_classes(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_backgrounds_doc_source ON public.srd_backgrounds(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_feats_doc_source ON public.srd_feats(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_spells_doc_source ON public.srd_spells(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_items_doc_source ON public.srd_items(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_weapons_doc_source ON public.srd_weapons(document_source);
CREATE INDEX IF NOT EXISTS idx_srd_armor_doc_source ON public.srd_armor(document_source);

-- =============================================================================
-- STEP 3: Junction tables — add document_source
-- =============================================================================

-- Drop existing junction FKs and PKs, re-create with document_source

-- srd_class_saving_throws
ALTER TABLE public.srd_class_saving_throws ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_class_saving_throws DROP CONSTRAINT IF EXISTS srd_class_saving_throws_pkey;
ALTER TABLE public.srd_class_saving_throws DROP CONSTRAINT IF EXISTS srd_class_saving_throws_class_key_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_class_saving_throws_pkey_v2') THEN
    ALTER TABLE public.srd_class_saving_throws ADD CONSTRAINT srd_class_saving_throws_pkey_v2
      PRIMARY KEY (class_key, ability_key, document_source);
  END IF;
END $$;

-- srd_class_primary_abilities
ALTER TABLE public.srd_class_primary_abilities ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_class_primary_abilities DROP CONSTRAINT IF EXISTS srd_class_primary_abilities_pkey;
ALTER TABLE public.srd_class_primary_abilities DROP CONSTRAINT IF EXISTS srd_class_primary_abilities_class_key_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_class_primary_abilities_pkey_v2') THEN
    ALTER TABLE public.srd_class_primary_abilities ADD CONSTRAINT srd_class_primary_abilities_pkey_v2
      PRIMARY KEY (class_key, ability_key, document_source);
  END IF;
END $$;

-- srd_spell_classes
ALTER TABLE public.srd_spell_classes ADD COLUMN IF NOT EXISTS document_source TEXT NOT NULL DEFAULT 'merged';
ALTER TABLE public.srd_spell_classes DROP CONSTRAINT IF EXISTS srd_spell_classes_pkey;
ALTER TABLE public.srd_spell_classes DROP CONSTRAINT IF EXISTS srd_spell_classes_spell_key_fkey;
ALTER TABLE public.srd_spell_classes DROP CONSTRAINT IF EXISTS srd_spell_classes_class_key_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srd_spell_classes_pkey_v2') THEN
    ALTER TABLE public.srd_spell_classes ADD CONSTRAINT srd_spell_classes_pkey_v2
      PRIMARY KEY (spell_key, class_key, document_source);
  END IF;
END $$;

-- =============================================================================
-- STEP 4: Characters table — add srd_document_source
-- =============================================================================

ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS srd_document_source TEXT DEFAULT 'srd-2024';

-- Set default for existing characters
UPDATE public.characters SET srd_document_source = 'srd-2024' WHERE srd_document_source IS NULL;

-- Drop old single-column FK constraints on characters (they reference the old UNIQUE(key))
ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS characters_species_key_fkey;
ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS characters_class_key_fkey;
ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS characters_background_key_fkey;

-- Note: We don't re-add composite FKs here because existing character data may reference
-- 'merged' source rows. The import script handles data migration.
