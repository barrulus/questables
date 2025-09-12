-- Characters table for player characters
CREATE TABLE characters (
    id UUID PRIMARY KEY DEFAULT generate_timestamped_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    race character_race NOT NULL,
    character_class character_class NOT NULL,
    subclass VARCHAR(50),
    level INTEGER NOT NULL DEFAULT 1,
    experience_points INTEGER DEFAULT 0,

    -- Core ability scores
    strength INTEGER DEFAULT 10,
    dexterity INTEGER DEFAULT 10,
    constitution INTEGER DEFAULT 10,
    intelligence INTEGER DEFAULT 10,
    wisdom INTEGER DEFAULT 10,
    charisma INTEGER DEFAULT 10,

    -- Derived stats
    armor_class INTEGER DEFAULT 10,
    hit_points INTEGER NOT NULL DEFAULT 1,
    max_hit_points INTEGER NOT NULL DEFAULT 1,
    temporary_hit_points INTEGER DEFAULT 0,
    speed INTEGER DEFAULT 30,
    proficiency_bonus INTEGER DEFAULT 2,

    -- Character details
    background VARCHAR(100),
    alignment VARCHAR(20),
    personality_traits TEXT,
    ideals TEXT,
    bonds TEXT,
    flaws TEXT,
    backstory TEXT,

    -- Game mechanics
    spell_slots JSONB DEFAULT '{}', -- Spell slots by level
    conditions JSONB DEFAULT '[]', -- Current conditions/effects
    inventory JSONB DEFAULT '[]', -- Equipment and items
    spells_known JSONB DEFAULT '[]', -- Known spells
    features JSONB DEFAULT '[]', -- Class/race features

    -- Position and status
    current_location geometry(Point, 4326),
    is_active BOOLEAN DEFAULT true,
    death_saves_success INTEGER DEFAULT 0,
    death_saves_failure INTEGER DEFAULT 0,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT characters_name_length CHECK (length(name) >= 1),
    CONSTRAINT characters_level CHECK (level >= 1 AND level <= 20),
    CONSTRAINT characters_ability_scores CHECK (
        strength >= 1 AND strength <= 30 AND
        dexterity >= 1 AND dexterity <= 30 AND
        constitution >= 1 AND constitution <= 30 AND
        intelligence >= 1 AND intelligence <= 30 AND
        wisdom >= 1 AND wisdom <= 30 AND
        charisma >= 1 AND charisma <= 30
    ),
    CONSTRAINT characters_hit_points CHECK (
        hit_points >= 0 AND
        max_hit_points >= 1 AND
        temporary_hit_points >= 0
    ),
    CONSTRAINT characters_death_saves CHECK (
        death_saves_success >= 0 AND death_saves_success <= 3 AND
        death_saves_failure >= 0 AND death_saves_failure <= 3
    ),

    -- Unique constraint: one character per user per campaign with same name
    UNIQUE(user_id, campaign_id, name)
);

-- Create trigger for updated_at
CREATE TRIGGER update_characters_updated_at
    BEFORE UPDATE ON characters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();