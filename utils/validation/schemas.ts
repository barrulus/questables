import { z } from 'zod';

// Base validation schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const emailSchema = z.string().email('Invalid email format');
export const usernameSchema = z.string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be less than 50 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and dashes');

// D&D specific validations
export const abilityScoreSchema = z.number()
  .int('Ability score must be a whole number')
  .min(1, 'Ability score must be at least 1')
  .max(30, 'Ability score cannot exceed 30');

export const characterLevelSchema = z.number()
  .int('Character level must be a whole number')
  .min(1, 'Character level must be at least 1')
  .max(20, 'Character level cannot exceed 20');

export const hitPointsSchema = z.object({
  max: z.number().int().min(1, 'Max HP must be at least 1'),
  current: z.number().int().min(-100, 'Current HP cannot be less than -100'),
  temporary: z.number().int().min(0, 'Temporary HP cannot be negative').default(0)
});

export const armorClassSchema = z.number()
  .int('Armor Class must be a whole number')
  .min(1, 'Armor Class must be at least 1')
  .max(30, 'Armor Class cannot exceed 30');

export const proficiencyBonusSchema = z.number()
  .int('Proficiency bonus must be a whole number')
  .min(2, 'Proficiency bonus must be at least 2')
  .max(6, 'Proficiency bonus cannot exceed 6');

// User validation schema
export const userSchema = z.object({
  id: uuidSchema.optional(),
  username: usernameSchema,
  email: emailSchema,
  roles: z.array(z.enum(['player', 'dm', 'admin'])).nonempty().default(['player']),
  role: z.enum(['player', 'dm', 'admin']).optional(),
  avatar_url: z.string().url().optional().or(z.literal('')),
  timezone: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

export const userRegistrationSchema = userSchema.pick({
  username: true,
  email: true,
  roles: true,
  role: true
}).extend({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number')
}).superRefine((data, ctx) => {
  if (!data.roles?.length && !data.role) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roles'],
      message: 'At least one role must be specified'
    });
  }
});

export const userLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});

// Character validation schema
export const characterAbilitiesSchema = z.object({
  strength: abilityScoreSchema,
  dexterity: abilityScoreSchema,
  constitution: abilityScoreSchema,
  intelligence: abilityScoreSchema,
  wisdom: abilityScoreSchema,
  charisma: abilityScoreSchema
});

export const characterSkillsSchema = z.record(
  z.string(),
  z.number().int().min(0, 'Skill modifier cannot be negative')
);

export const spellSlotSchema = z.object({
  level: z.number().int().min(1).max(9),
  max: z.number().int().min(0),
  used: z.number().int().min(0)
});

export const spellcastingSchema = z.object({
  class: z.string().optional(),
  ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']).optional(),
  spell_save_dc: z.number().int().min(8).max(30).optional(),
  spell_attack_bonus: z.number().int().optional(),
  spell_slots: z.array(spellSlotSchema).optional(),
  known_spells: z.array(z.string()).optional(),
  prepared_spells: z.array(z.string()).optional()
});

export const inventoryItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(100, 'Item name too long'),
  description: z.string().max(500, 'Item description too long').optional(),
  type: z.enum(['weapon', 'armor', 'consumable', 'tool', 'treasure', 'other']).default('other'),
  quantity: z.number().int().min(0, 'Quantity cannot be negative').default(1),
  weight: z.number().min(0, 'Weight cannot be negative').default(0),
  value: z.number().min(0, 'Value cannot be negative').default(0),
  properties: z.array(z.string()).optional(),
  equipped: z.boolean().default(false)
});

export const currencySchema = z.object({
  platinum: z.number().int().min(0, 'Platinum cannot be negative').default(0),
  gold: z.number().int().min(0, 'Gold cannot be negative').default(0),
  silver: z.number().int().min(0, 'Silver cannot be negative').default(0),
  copper: z.number().int().min(0, 'Copper cannot be negative').default(0)
});

export const characterSchema = z.object({
  id: uuidSchema.optional(),
  user_id: uuidSchema,
  name: z.string()
    .min(1, 'Character name is required')
    .max(50, 'Character name must be less than 50 characters'),
  race: z.string()
    .min(1, 'Race is required')
    .max(30, 'Race name too long'),
  character_class: z.string()
    .min(1, 'Class is required')
    .max(30, 'Class name too long'),
  level: characterLevelSchema,
  background: z.string().max(50, 'Background name too long').optional(),
  alignment: z.string().max(30, 'Alignment too long').optional(),
  abilities: characterAbilitiesSchema,
  hit_points: hitPointsSchema,
  armor_class: armorClassSchema,
  proficiency_bonus: proficiencyBonusSchema,
  speed: z.number().int().min(0, 'Speed cannot be negative').default(30),
  skills: characterSkillsSchema.optional(),
  saving_throws: z.record(z.string(), z.number().int()).optional(),
  inventory: z.array(inventoryItemSchema).optional(),
  equipment: z.record(z.string(), inventoryItemSchema.optional()).optional(),
  spellcasting: spellcastingSchema.optional(),
  currency: currencySchema.optional(),
  notes: z.string().max(2000, 'Notes too long').optional(),
  species_key: z.string().optional().nullable(),
  class_key: z.string().optional().nullable(),
  background_key: z.string().optional().nullable(),
  subrace: z.string().max(100).optional().nullable(),
  subclass: z.string().max(100).optional().nullable(),
  experience_points: z.number().int().min(0).optional(),
  inspiration: z.boolean().optional(),
  death_saves: z.object({
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
  }).optional(),
  conditions: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  proficiencies: z.record(z.string(), z.array(z.string())).optional(),
  ability_score_method: z.string().max(30).optional().nullable(),
  creation_state: z.record(z.string(), z.unknown()).optional().nullable(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// Campaign validation schema
export const campaignSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string()
    .min(1, 'Campaign name is required')
    .max(100, 'Campaign name must be less than 100 characters'),
  description: z.string()
    .max(2000, 'Campaign description too long')
    .optional(),
  dm_user_id: uuidSchema,
  max_players: z.number()
    .int('Max players must be a whole number')
    .min(1, 'Must allow at least 1 player')
    .max(20, 'Cannot exceed 20 players')
    .default(6),
  current_players: z.number()
    .int('Current players must be a whole number')
    .min(0, 'Current players cannot be negative')
    .default(0),
  status: z.enum(['draft', 'recruiting', 'active', 'completed', 'paused']).default('draft'),
  is_public: z.boolean().default(false),
  start_date: z.string().datetime().optional(),
  session_frequency: z.string().max(50).optional(),
  setting: z.string().max(100).optional(),
  system: z.string().max(50).default('D&D 5e'),
  tags: z.array(z.string().max(30)).max(10, 'Too many tags').optional(),
  rules: z.string().max(1000, 'Rules text too long').optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// Chat message validation schema
export const chatMessageSchema = z.object({
  id: uuidSchema.optional(),
  campaign_id: uuidSchema,
  content: z.string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long'),
  message_type: z.enum(['text', 'dice_roll', 'system', 'ooc']).default('text'),
  sender_id: uuidSchema,
  sender_name: z.string().min(1, 'Sender name required').max(50),
  character_id: uuidSchema.optional(),
  character_name: z.string().max(50).optional(),
  dice_roll: z.object({
    expression: z.string().max(100),
    total: z.number().int(),
    rolls: z.array(z.number().int()).optional(),
    modifier: z.number().int().optional()
  }).optional(),
  created_at: z.string().datetime().optional()
});

// Session validation schema
export const sessionSchema = z.object({
  id: uuidSchema.optional(),
  campaign_id: uuidSchema,
  session_number: z.number().int().min(1, 'Session number must be at least 1'),
  title: z.string().max(200, 'Session title too long').optional(),
  description: z.string().max(2000, 'Session description too long').optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).default('planned'),
  scheduled_start: z.string().datetime().optional(),
  actual_start: z.string().datetime().optional(),
  actual_end: z.string().datetime().optional(),
  experience_awarded: z.number().int().min(0, 'Experience cannot be negative').default(0),
  summary: z.string().max(2000, 'Session summary too long').optional(),
  dm_notes: z.string().max(2000, 'DM notes too long').optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// Location validation schema
export const locationSchema = z.object({
  id: uuidSchema.optional(),
  campaign_id: uuidSchema,
  world_map_id: uuidSchema.optional(),
  name: z.string()
    .min(1, 'Location name is required')
    .max(100, 'Location name too long'),
  description: z.string().max(2000, 'Location description too long').optional(),
  type: z.enum(['city', 'town', 'village', 'dungeon', 'landmark', 'other']).default('other'),
  coordinates: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  parent_location_id: uuidSchema.optional(),
  is_public: z.boolean().default(false),
  dm_notes: z.string().max(1000, 'DM notes too long').optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// File upload validation schemas
export const avatarUploadSchema = z.object({
  file: z.instanceof(File)
    .refine(file => file.size <= 5 * 1024 * 1024, 'Avatar must be less than 5MB')
    .refine(
      file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
      'Avatar must be a JPEG, PNG, or WebP image'
    )
});

export const mapUploadSchema = z.object({
  file: z.instanceof(File)
    .refine(file => file.size <= 50 * 1024 * 1024, 'Map file must be less than 50MB')
    .refine(
      file => ['image/jpeg', 'image/png', 'image/webp', 'application/json'].includes(file.type),
      'Map must be an image (JPEG, PNG, WebP) or JSON file'
    )
});

export const campaignAssetUploadSchema = z.object({
  file: z.instanceof(File)
    .refine(file => file.size <= 25 * 1024 * 1024, 'Asset must be less than 25MB')
    .refine(
      file => [
        'image/jpeg', 
        'image/png', 
        'image/webp', 
        'application/pdf',
        'text/plain',
        'application/json'
      ].includes(file.type),
      'Unsupported file type'
    )
});

// Validation helper functions
export const validateField = <T>(schema: z.ZodSchema<T>, value: unknown): { 
  isValid: boolean; 
  data?: T; 
  errors?: string[] 
} => {
  try {
    const data = schema.parse(value);
    return { isValid: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        isValid: false, 
        errors: error.errors.map(e => e.message) 
      };
    }
    return { 
      isValid: false, 
      errors: ['Validation failed'] 
    };
  }
};

export const validateFormData = <T>(schema: z.ZodSchema<T>, formData: FormData | Record<string, any>): {
  isValid: boolean;
  data?: T;
  fieldErrors?: Record<string, string[]>;
  generalErrors?: string[];
} => {
  try {
    const data = formData instanceof FormData 
      ? Object.fromEntries(formData.entries())
      : formData;
    
    const validatedData = schema.parse(data);
    return { isValid: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      const generalErrors: string[] = [];
      
      error.errors.forEach(e => {
        if (e.path.length > 0) {
          const field = e.path.join('.');
          if (!fieldErrors[field]) {
            fieldErrors[field] = [];
          }
          fieldErrors[field].push(e.message);
        } else {
          generalErrors.push(e.message);
        }
      });
      
      return { 
        isValid: false, 
        fieldErrors, 
        generalErrors: generalErrors.length > 0 ? generalErrors : undefined
      };
    }
    return { 
      isValid: false, 
      generalErrors: ['Validation failed'] 
    };
  }
};

// Export all schemas for type inference
export type User = z.infer<typeof userSchema>;
export type UserRegistration = z.infer<typeof userRegistrationSchema>;
export type UserLogin = z.infer<typeof userLoginSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Location = z.infer<typeof locationSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type Currency = z.infer<typeof currencySchema>;
