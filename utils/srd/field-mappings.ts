/**
 * Cross-source field mapping configuration.
 * Defines how fields from different SRD document sources relate to each other.
 */

export interface FieldMapping {
  entityType: 'species_trait' | 'background_benefit' | 'class_feature';
  sourceA: string;
  fieldA: string;
  sourceB: string;
  fieldB: string;
  mappingType: 'equivalent' | 'superset' | 'renamed';
  notes?: string;
}

export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'srd-2014': 'SRD 2014 (5e)',
  'srd-2024': 'SRD 2024 (5.5e)',
  'a5e-ag': "A5E Adventurer's Guide",
  'merged': 'Merged (Legacy)',
};

export const FIELD_MAPPINGS: FieldMapping[] = [
  // BackgroundBenefit type mappings
  {
    entityType: 'background_benefit',
    sourceA: 'srd-2024', fieldA: 'skill_proficiency',
    sourceB: 'srd-2014', fieldB: 'skill_proficiency',
    mappingType: 'equivalent',
  },
  {
    entityType: 'background_benefit',
    sourceA: 'srd-2024', fieldA: 'tool_proficiency',
    sourceB: 'srd-2014', fieldB: 'tool_proficiency',
    mappingType: 'equivalent',
  },
  {
    entityType: 'background_benefit',
    sourceA: 'srd-2024', fieldA: 'equipment',
    sourceB: 'srd-2014', fieldB: 'equipment',
    mappingType: 'equivalent',
  },
  {
    entityType: 'background_benefit',
    sourceA: 'srd-2024', fieldA: 'ability_score',
    sourceB: 'a5e-ag', fieldB: 'ability_score_increase',
    mappingType: 'renamed',
    notes: 'a5e-ag uses ability_score_increase instead of ability_score',
  },
  {
    entityType: 'background_benefit',
    sourceA: 'srd-2024', fieldA: 'feat',
    sourceB: 'srd-2014', fieldB: 'feature',
    mappingType: 'renamed',
    notes: 'srd-2014 calls background feats "features"',
  },

  // SpeciesTrait type mappings
  {
    entityType: 'species_trait',
    sourceA: 'srd-2024', fieldA: 'SIZE',
    sourceB: 'srd-2014', fieldB: 'size',
    mappingType: 'equivalent',
    notes: 'srd-2024 uses uppercase type values',
  },
  {
    entityType: 'species_trait',
    sourceA: 'srd-2024', fieldA: 'SPEED',
    sourceB: 'srd-2014', fieldB: 'speed',
    mappingType: 'equivalent',
  },

  // ClassFeature type mappings
  {
    entityType: 'class_feature',
    sourceA: 'srd-2024', fieldA: 'feature_type',
    sourceB: 'a5e-ag', fieldB: 'feature_type',
    mappingType: 'equivalent',
    notes: 'Both use feature_type but a5e-ag has additional values like exploration_knack',
  },
];
