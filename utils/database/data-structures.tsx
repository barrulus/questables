// Data structures for D&D app using PostgreSQL database
//
// This file contains TypeScript interfaces for all D&D entities
// stored in our PostgreSQL database with PostGIS extensions.

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
  bbox?: [number, number, number, number];
  properties?: Record<string, unknown>;
};

// =============================================================================
// USER DATA STRUCTURES
// =============================================================================

export type UserRole = "player" | "dm" | "admin";

export interface User {
  id: string;
  username: string;
  email: string;
  roles: UserRole[];
  role?: UserRole;
  status: "active" | "inactive" | "banned";
  avatar_url?: string;
  timezone?: string;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  last_login?: string; // ISO date string
  // Legacy support for camelCase (for UI components)
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
}

const USER_ROLE_PRIORITY: UserRole[] = ['admin', 'dm', 'player'];
const USER_ROLE_SET = new Set<UserRole>(USER_ROLE_PRIORITY);

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  notifications: {
    email: boolean;
    push: boolean;
    campaigns: boolean;
    sessions: boolean;
  };
  gameplay: {
    autoRollInitiative: boolean;
    showDamageNumbers: boolean;
    compactUI: boolean;
  };
}

// =============================================================================
// CHARACTER DATA STRUCTURES  
// =============================================================================

export interface Character {
  id: string;
  user_id: string; // Owner of the character (database field)
  userId?: string; // Legacy support for UI components
  name: string;
  class: string;
  level: number;
  race: string;
  background: string;
  hit_points: { current: number; max: number; temporary?: number };
  hitPoints?: { current: number; max: number; temporary?: number }; // Legacy support
  armor_class: number;
  armorClass?: number; // Legacy support
  speed: number;
  proficiency_bonus: number;
  proficiencyBonus?: number; // Legacy support
  
  // Core stats
  abilities: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  
  // Derived stats
  saving_throws: Record<string, number>;
  savingThrows?: Record<string, number>; // Legacy support
  skills: Record<string, number>;
  
  // Equipment and inventory
  inventory: InventoryItem[];
  equipment: Equipment;
  
  // Character details
  avatar_url?: string;
  avatar?: string; // Legacy support
  backstory?: string;
  personality?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  
  // Spellcasting (if applicable)
  spellcasting?: SpellcastingInfo;

  // SRD references (nullable for backwards compatibility)
  species_key?: string | null;
  class_key?: string | null;
  background_key?: string | null;
  subrace?: string | null;
  subclass?: string | null;

  // Gameplay tracking
  experience_points?: number;
  alignment?: string | null;
  inspiration?: boolean;
  death_saves?: { successes: number; failures: number };
  conditions?: string[];
  languages?: string[];
  proficiencies?: {
    armor?: string[];
    weapons?: string[];
    tools?: string[];
    savingThrows?: string[];
    skills?: string[];
  };
  ability_score_method?: string | null;

  // Wizard draft state (NULL once character is finalized)
  creation_state?: Record<string, unknown> | null;

  // Related campaign membership (denormalised for quick lookup)
  campaigns?: string[];
  
  // Timestamps (database fields)
  created_at: string;
  updated_at: string;
  last_played?: string;
  
  // Legacy support for UI components
  createdAt?: string;
  updatedAt?: string;
  lastPlayed?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  weight?: number;
  value?: { amount: number; currency: string };
  type: "weapon" | "armor" | "tool" | "consumable" | "treasure" | "other";
  properties?: string[];
}

export interface Equipment {
  armor?: InventoryItem;
  shield?: InventoryItem;
  weapons: {
    mainHand?: InventoryItem;
    offHand?: InventoryItem;
    ranged?: InventoryItem;
  };
  accessories: {
    ring1?: InventoryItem;
    ring2?: InventoryItem;
    necklace?: InventoryItem;
    cloak?: InventoryItem;
  };
}

export interface SpellcastingInfo {
  spellcastingAbility: string;
  spellAttackBonus: number;
  spellSaveDC: number;
  spellSlots: Record<number, { max: number; used: number }>;
  spellsKnown: string[]; // Array of spell IDs
  cantripsKnown: string[];
}

// =============================================================================
// CAMPAIGN DATA STRUCTURES
// =============================================================================

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  dmUserId: string; // DM's user ID
  
  // Campaign settings
  system: "D&D 5e" | "Pathfinder" | "Other";
  setting: string; // "Forgotten Realms", "Homebrew", etc.
  status: "recruiting" | "active" | "paused" | "completed";
  
  // Player management
  players: CampaignPlayer[];
  maxPlayers: number;
  levelRange: { min: number; max: number };
  
  // Session information
  sessions: Session[];
  nextSession?: {
    scheduledAt: string;
    notes?: string;
  };
  
  // Campaign content
  locations: Location[];
  npcs: NPC[];
  routes: Route[];
  worldMapId?: string; // Reference to world map
  
  // Settings
  settings: CampaignSettings;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastActivity: string;
}

export interface CampaignPlayer {
  userId: string;
  characterId: string;
  joinedAt: string;
  status: "active" | "inactive" | "left";
  role: "player" | "co-dm";
}

export interface CampaignSettings {
  isPublic: boolean;
  allowSpectators: boolean;
  autoApproveJoinRequests: boolean;
  experienceType: "milestone" | "experience_points";
  restingRules: "standard" | "gritty" | "heroic";
  deathSaveRules: "standard" | "hardcore" | "forgiving";
}

// =============================================================================
// SESSION DATA STRUCTURES
// =============================================================================

export interface Session {
  id: string;
  campaignId: string;
  sessionNumber: number;
  
  // Session details
  title: string;
  summary?: string;
  notes: string; // DM notes
  
  // Timing
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  duration?: number; // minutes
  
  // Participants
  participants: SessionParticipant[];
  
  // Session content
  encounters: Encounter[];
  locations: string[]; // Location IDs visited
  npcsEncountered: string[]; // NPC IDs
  
  // Experience and rewards
  experienceAwarded?: number;
  treasureAwarded?: InventoryItem[];
  
  // Status
  status: "scheduled" | "active" | "completed" | "cancelled";
  
  createdAt: string;
  updatedAt: string;
}

export interface SessionParticipant {
  userId: string;
  characterId: string;
  attendanceStatus: "present" | "absent" | "late" | "left_early";
  characterLevelStart: number;
  characterLevelEnd: number;
}

// =============================================================================
// LOCATION & NPC DATA STRUCTURES
// =============================================================================

export interface Location {
  id: string;
  campaignId: string;
  name: string;
  description: string;
  type: "city" | "dungeon" | "wilderness" | "building" | "room" | "landmark";
  
  // Map data
  mapUrl?: string; // URL to encounter map image
  gridSize?: number;
  
  // Relationships
  parentLocationId?: string; // For nested locations
  connectedLocations: string[]; // Location IDs
  
  // NPCs present
  npcs: string[]; // NPC IDs
  
  // Encounters
  encounters: Encounter[];
  
  // Loot and features
  features: LocationFeature[];
  
  // Discovery
  isDiscovered: boolean;
  discoveredBy: string[]; // Character IDs
  
  createdAt: string;
  updatedAt: string;
}

export interface LocationFeature {
  id: string;
  name: string;
  description: string;
  type: "trap" | "treasure" | "secret" | "hazard" | "interactable";
  isDiscovered: boolean;
  mechanics?: {
    dcCheck?: number;
    skillRequired?: string;
    damage?: string;
    effect?: string;
  };
}

export interface NPC {
  id: string;
  campaignId: string;
  name: string;
  description: string;
  race: string;
  occupation?: string;
  
  // Appearance and personality
  avatar?: string;
  appearance?: string;
  personality: string;
  motivations?: string;
  secrets?: string;
  
  // Relationships
  relationships: NPCRelationship[];
  
  // Stats (if combat NPC)
  stats?: NPCStats;
  
  // Location
  currentLocationId?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface NPCRelationship {
  targetId: string; // NPC or Character ID
  type: "ally" | "enemy" | "neutral" | "romantic" | "family" | "business";
  description: string;
  strength: number; // -5 to +5
}

export interface NPCStats {
  armorClass: number;
  hitPoints: { max: number; current: number };
  speed: number;
  abilities: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  challengeRating: number;
  actions: NPCAction[];
}

export interface NPCAction {
  name: string;
  description: string;
  type: "action" | "bonus_action" | "reaction" | "legendary";
  recharge?: string; // "5-6", "short_rest", "long_rest"
}

// =============================================================================
// ENCOUNTER & COMBAT DATA STRUCTURES
// =============================================================================

export interface Encounter {
  id: string;
  campaignId: string;
  sessionId?: string;
  locationId?: string;
  
  name: string;
  description: string;
  type: "combat" | "social" | "exploration" | "puzzle";
  difficulty: "easy" | "medium" | "hard" | "deadly";
  
  // Combat specific
  initiative?: InitiativeEntry[];
  round?: number;
  status: "planned" | "active" | "completed";
  
  // Participants
  participants: EncounterParticipant[];
  
  // Rewards
  experienceReward?: number;
  treasureReward?: InventoryItem[];
  
  createdAt: string;
  updatedAt: string;
}

export interface EncounterParticipant {
  id: string; // Character or NPC ID
  type: "character" | "npc";
  name: string;
  initiative?: number;
  hitPoints: { max: number; current: number; temporary?: number };
  armorClass: number;
  conditions: Condition[];
}

export interface InitiativeEntry {
  participantId: string;
  initiative: number;
  hasActed: boolean;
}

export interface Condition {
  name: string;
  description: string;
  duration?: number; // rounds, -1 for permanent
  source?: string; // spell/ability that caused it
}

// =============================================================================
// MAP DATA STRUCTURES (PostgreSQL + PostGIS)
// =============================================================================

export interface WorldMap {
  id: string;
  name: string;
  description: string;
  
  // Metadata
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  
  // Available layers from Azgaar's FMG
  layers: {
    political: boolean;
    terrain: boolean;
    climate: boolean;
    cultures: boolean;
    religions: boolean;
    provinces: boolean;
  };
  
  // File info
  uploadedBy: string; // User ID
  
  createdAt: string;
  updatedAt: string;
}

// PostGIS spatial data structures from Azgaar's FMG
export interface Burg {
  id: number;
  world_map_id: string;
  i: number; // Original ID from FMG
  cell: number;
  x: number;
  y: number;
  state: number;
  name: string;
  population: number;
  type: string;
  capital: number;
  feature: number;
  port: number;
  geometry: GeoJsonGeometry | null; // PostGIS Point geometry
}

export interface Cell {
  id: number;
  world_map_id: string;
  i: number; // Original ID from FMG
  v: number[];
  c: number[];
  p: number[];
  g: number;
  h: number;
  area: number;
  f: number;
  t: number;
  haven: number;
  harbor: number;
  fl: number;
  r: number;
  conf: number;
  biome: number;
  s: number;
  pop: number;
  culture: number;
  religion: number;
  province: number;
  crossroad: number;
  road: number;
  geometry: GeoJsonGeometry | null; // PostGIS Polygon geometry
}

export interface River {
  id: number;
  world_map_id: string;
  i: number; // Original ID from FMG
  source: number;
  mouth: number;
  discharge: number;
  length: number;
  width: number;
  widthFactor: number;
  sourceWidth: number;
  parent: number;
  cells: number[];
  basin: number;
  name: string;
  type: string;
  geometry: GeoJsonGeometry | null; // PostGIS LineString geometry
}

export interface Route {
  id: number;
  world_map_id: string;
  i: number; // Original ID from FMG
  group: number;
  length: number;
  feature: number;
  points: number[];
  cells: number[];
  geometry: GeoJsonGeometry | null; // PostGIS LineString geometry
}

export interface Marker {
  id: number;
  world_map_id: string;
  icon: string;
  type: string;
  dx: number;
  dy: number;
  px: number;
  py: number;
  x: number;
  y: number;
  cell: number;
  i: number;
  note: string;
  geometry: GeoJsonGeometry | null; // PostGIS Point geometry
}

// =============================================================================
// CHAT DATA STRUCTURES
// =============================================================================

export interface ChatMessage {
  id: string;
  campaignId?: string; // null for DM-only chat
  sessionId?: string;
  
  // Message content
  content: string;
  type: "text" | "dice_roll" | "system" | "ooc"; // out of character
  
  // Sender info
  senderId: string; // User ID
  senderName: string;
  characterId?: string; // If sent as character
  
  // Dice roll specific
  diceRoll?: DiceRoll;
  
  // Visibility
  isPrivate: boolean; // DM-only message
  recipients?: string[]; // User IDs for private messages
  
  // Reactions
  reactions: MessageReaction[];
  
  timestamp: string;
}

export interface DiceRoll {
  expression: string; // "1d20+5"
  results: DiceResult[];
  total: number;
  context?: string; // "Attack roll", "Saving throw", etc.
}

export interface DiceResult {
  die: string; // "d20", "d6", etc.
  rolls: number[];
  modifier?: number;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  timestamp: string;
}

// =============================================================================
// ROUTE DATA STRUCTURES
// =============================================================================

export interface CampaignRoute {
  id: string;
  campaignId: string;
  name: string;
  description: string;
  
  // Route details
  startLocationId: string;
  endLocationId: string;
  distance: number; // miles
  travelTime: number; // hours
  difficulty: "easy" | "medium" | "hard" | "deadly";
  
  // Travel encounters
  encounters: RouteEncounter[];
  
  // Conditions
  terrain: string[];
  weather?: string;
  hazards?: string[];
  
  createdAt: string;
  updatedAt: string;
}

export interface RouteEncounter {
  id: string;
  name: string;
  description: string;
  type: "combat" | "social" | "exploration" | "environmental";
  probability: number; // 0-100
  isTriggered: boolean;
  encounterId?: string; // Reference to full encounter
}

// =============================================================================
// FIELD MAPPING UTILITIES
// =============================================================================

// Convert database snake_case fields to camelCase for UI components
export function mapDatabaseFields<T>(dbObject: unknown): T {
  if (!dbObject || typeof dbObject !== 'object') return dbObject as T;

  const mapped: Record<string, unknown> = { ...(dbObject as Record<string, unknown>) };

  // User field mappings
  if (mapped.created_at) mapped.createdAt = mapped.created_at;
  if (mapped.updated_at) mapped.updatedAt = mapped.updated_at;
  if (mapped.last_login) mapped.lastLogin = mapped.last_login;
  if (mapped.avatar_url) mapped.avatar = mapped.avatar_url;

  const collectedRoles = new Set<UserRole>();

  const registerRole = (value: unknown) => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(registerRole);
      return;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (USER_ROLE_SET.has(normalized as UserRole)) {
        collectedRoles.add(normalized as UserRole);
      }
    }
  };

  registerRole(mapped.roles);
  registerRole(mapped.role);
  collectedRoles.add('player');

  const normalizedRoles = USER_ROLE_PRIORITY.filter((role) => collectedRoles.has(role));
  const resolvedRoles: UserRole[] = normalizedRoles.length > 0 ? normalizedRoles : ['player'];
  mapped.roles = resolvedRoles;
  const primaryRole = resolvedRoles.find((role) => role !== 'player') ?? 'player';
  mapped.role = primaryRole;

  // Character field mappings
  if (mapped.user_id) mapped.userId = mapped.user_id;
  if (mapped.hit_points) mapped.hitPoints = mapped.hit_points;
  if (mapped.armor_class) mapped.armorClass = mapped.armor_class;
  if (mapped.proficiency_bonus) mapped.proficiencyBonus = mapped.proficiency_bonus;
  if (mapped.saving_throws) mapped.savingThrows = mapped.saving_throws;
  if (mapped.last_played) mapped.lastPlayed = mapped.last_played;
  
  // Parse JSON fields if they're strings
  const jsonFields = ['hit_points', 'abilities', 'saving_throws', 'skills', 'inventory', 'equipment', 'spellcasting'];
  jsonFields.forEach(field => {
    if (mapped[field] && typeof mapped[field] === 'string') {
      try {
        mapped[field] = JSON.parse(mapped[field]);
      } catch (error) {
        console.warn(`Failed to parse JSON field ${field}:`, error);
      }
    }
  });
  
  return mapped as T;
}

// Convert UI camelCase fields to database snake_case
export function mapToDatabase(frontendObject: unknown): Record<string, unknown> {
  if (!frontendObject || typeof frontendObject !== 'object') return frontendObject as Record<string, unknown>;

  const mapped: Record<string, unknown> = { ...(frontendObject as Record<string, unknown>) };

  // User field mappings
  if (mapped.createdAt && !mapped.created_at) mapped.created_at = mapped.createdAt;
  if (mapped.updatedAt && !mapped.updated_at) mapped.updated_at = mapped.updatedAt;
  if (mapped.lastLogin && !mapped.last_login) mapped.last_login = mapped.lastLogin;
  if (mapped.avatar && !mapped.avatar_url) mapped.avatar_url = mapped.avatar;
  if (mapped.roles && Array.isArray(mapped.roles)) {
    const candidate = new Set<UserRole>();
    mapped.roles.forEach((role) => {
      if (typeof role === 'string') {
        const normalized = role.toLowerCase();
        if (USER_ROLE_SET.has(normalized as UserRole)) {
          candidate.add(normalized as UserRole);
        }
      }
    });
    if (typeof mapped.role === 'string') {
      const normalized = mapped.role.toLowerCase();
      if (USER_ROLE_SET.has(normalized as UserRole)) {
        candidate.add(normalized as UserRole);
      }
    }
    candidate.add('player');
    mapped.roles = USER_ROLE_PRIORITY.filter((role) => candidate.has(role));
  } else if (typeof mapped.role === 'string' && USER_ROLE_SET.has(mapped.role.toLowerCase() as UserRole)) {
    const normalized = mapped.role.toLowerCase() as UserRole;
    mapped.roles = USER_ROLE_PRIORITY.filter((role) => role === normalized || role === 'player');
  } else {
    mapped.roles = ['player'];
  }

  // Character field mappings
  if (mapped.userId && !mapped.user_id) mapped.user_id = mapped.userId;
  if (mapped.hitPoints && !mapped.hit_points) mapped.hit_points = mapped.hitPoints;
  if (mapped.armorClass && !mapped.armor_class) mapped.armor_class = mapped.armorClass;
  if (mapped.proficiencyBonus && !mapped.proficiency_bonus) mapped.proficiency_bonus = mapped.proficiencyBonus;
  if (mapped.savingThrows && !mapped.saving_throws) mapped.saving_throws = mapped.savingThrows;
  if (mapped.lastPlayed && !mapped.last_played) mapped.last_played = mapped.lastPlayed;
  
  // Ensure JSON fields are strings for database
  const jsonFields = ['hit_points', 'abilities', 'saving_throws', 'skills', 'inventory', 'equipment', 'spellcasting'];
  jsonFields.forEach(field => {
    if (mapped[field] && typeof mapped[field] === 'object') {
      mapped[field] = JSON.stringify(mapped[field]);
    }
  });
  
  // Remove legacy camelCase fields to avoid confusion
  delete mapped.createdAt;
  delete mapped.updatedAt;
  delete mapped.lastLogin;
  delete mapped.userId;
  delete mapped.hitPoints;
  delete mapped.armorClass;
  delete mapped.proficiencyBonus;
  delete mapped.savingThrows;
  delete mapped.lastPlayed;
  delete mapped.avatar;
  delete mapped.role;

  return mapped;
}
