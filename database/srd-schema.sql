-- =============================================================================
-- SRD Reference Data Schema (D&D 5e)
-- Imported from Open5e v2 API
-- Run after schema.sql
-- =============================================================================

-- =============================================================================
-- LOOKUP TABLES (no FK dependencies)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.srd_abilities (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT
);

CREATE TABLE IF NOT EXISTS public.srd_damage_types (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT
);

CREATE TABLE IF NOT EXISTS public.srd_spell_schools (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT
);

CREATE TABLE IF NOT EXISTS public.srd_conditions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    descriptions JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.srd_sizes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    rank INTEGER DEFAULT 0,
    space_diameter NUMERIC
);

CREATE TABLE IF NOT EXISTS public.srd_languages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_exotic BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.srd_alignments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.srd_item_categories (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.srd_item_rarities (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    rank INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.srd_weapon_properties (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT
);

-- =============================================================================
-- ENTITY TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.srd_classes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    hit_dice TEXT,
    caster_type TEXT CHECK (caster_type IN ('FULL', 'HALF', 'THIRD', 'PACT', 'NONE')),
    subclass_of_key TEXT,
    features JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_srd_classes_subclass ON public.srd_classes(subclass_of_key);

CREATE TABLE IF NOT EXISTS public.srd_species (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    is_subspecies BOOLEAN DEFAULT false,
    subspecies_of_key TEXT,
    traits JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_srd_species_subspecies ON public.srd_species(subspecies_of_key);

CREATE TABLE IF NOT EXISTS public.srd_backgrounds (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    benefits JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.srd_feats (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    feat_type TEXT,
    prerequisite TEXT,
    benefits JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_srd_feats_type ON public.srd_feats(feat_type);

CREATE TABLE IF NOT EXISTS public.srd_spells (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    level INTEGER CHECK (level >= 0 AND level <= 9),
    school_key TEXT REFERENCES public.srd_spell_schools(key) ON DELETE SET NULL,
    casting_time TEXT,
    range_text TEXT,
    range NUMERIC,
    duration TEXT,
    concentration BOOLEAN DEFAULT false,
    ritual BOOLEAN DEFAULT false,
    verbal BOOLEAN DEFAULT false,
    somatic BOOLEAN DEFAULT false,
    material BOOLEAN DEFAULT false,
    material_specified TEXT,
    damage_roll TEXT,
    damage_types JSONB DEFAULT '[]'::jsonb,
    saving_throw_ability TEXT,
    attack_roll BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_srd_spells_level ON public.srd_spells(level);
CREATE INDEX IF NOT EXISTS idx_srd_spells_school ON public.srd_spells(school_key);
CREATE INDEX IF NOT EXISTS idx_srd_spells_ritual ON public.srd_spells(ritual) WHERE ritual = true;

CREATE TABLE IF NOT EXISTS public.srd_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    desc_text TEXT,
    category_key TEXT REFERENCES public.srd_item_categories(key) ON DELETE SET NULL,
    rarity_key TEXT REFERENCES public.srd_item_rarities(key) ON DELETE SET NULL,
    cost TEXT,
    weight NUMERIC,
    weight_unit TEXT DEFAULT 'lb',
    requires_attunement BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_srd_items_category ON public.srd_items(category_key);

CREATE TABLE IF NOT EXISTS public.srd_weapons (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    item_key TEXT REFERENCES public.srd_items(key) ON DELETE SET NULL,
    damage_dice TEXT,
    damage_type_key TEXT REFERENCES public.srd_damage_types(key) ON DELETE SET NULL,
    range INTEGER,
    long_range INTEGER,
    is_simple BOOLEAN DEFAULT true,
    properties JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.srd_armor (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    item_key TEXT REFERENCES public.srd_items(key) ON DELETE SET NULL,
    ac_base INTEGER,
    ac_add_dexmod BOOLEAN DEFAULT false,
    ac_cap_dexmod INTEGER,
    category TEXT CHECK (category IN ('light', 'medium', 'heavy', 'shield')),
    grants_stealth_disadvantage BOOLEAN DEFAULT false,
    strength_score_required INTEGER
);
CREATE INDEX IF NOT EXISTS idx_srd_armor_category ON public.srd_armor(category);

-- =============================================================================
-- JUNCTION TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.srd_class_saving_throws (
    class_key TEXT NOT NULL REFERENCES public.srd_classes(key) ON DELETE CASCADE,
    ability_key TEXT NOT NULL REFERENCES public.srd_abilities(key) ON DELETE CASCADE,
    PRIMARY KEY (class_key, ability_key)
);

CREATE TABLE IF NOT EXISTS public.srd_class_primary_abilities (
    class_key TEXT NOT NULL REFERENCES public.srd_classes(key) ON DELETE CASCADE,
    ability_key TEXT NOT NULL REFERENCES public.srd_abilities(key) ON DELETE CASCADE,
    PRIMARY KEY (class_key, ability_key)
);

CREATE TABLE IF NOT EXISTS public.srd_spell_classes (
    spell_key TEXT NOT NULL REFERENCES public.srd_spells(key) ON DELETE CASCADE,
    class_key TEXT NOT NULL REFERENCES public.srd_classes(key) ON DELETE CASCADE,
    PRIMARY KEY (spell_key, class_key)
);

-- =============================================================================
-- CHARACTER TABLE EXTENSIONS
-- =============================================================================

-- SRD foreign-key references (nullable for backwards compatibility)
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS species_key TEXT REFERENCES public.srd_species(key) ON DELETE SET NULL;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS class_key TEXT REFERENCES public.srd_classes(key) ON DELETE SET NULL;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS background_key TEXT REFERENCES public.srd_backgrounds(key) ON DELETE SET NULL;

-- Sub-selections
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS subrace TEXT;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS subclass TEXT;

-- Gameplay tracking
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS experience_points INTEGER DEFAULT 0;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS alignment TEXT;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS inspiration BOOLEAN DEFAULT FALSE;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS death_saves JSONB DEFAULT '{"successes": 0, "failures": 0}'::jsonb;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS languages JSONB DEFAULT '["Common"]'::jsonb;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS proficiencies JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS ability_score_method TEXT;

-- Wizard draft state (NULL once character is finalized)
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS creation_state JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_characters_species_key ON public.characters(species_key);
CREATE INDEX IF NOT EXISTS idx_characters_class_key ON public.characters(class_key);
CREATE INDEX IF NOT EXISTS idx_characters_background_key ON public.characters(background_key);
