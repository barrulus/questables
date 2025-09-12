// Data structures for D&D app using Supabase KV store
// 
// Since we cannot create custom schemas in the Make environment,
// all data is stored as JSON objects in the key-value store.
// Keys follow a pattern: {entity_type}:{id} or {entity_type}:{user_id}:{id}

// =============================================================================
// USER DATA STRUCTURES
// =============================================================================

export interface User {
  id: string;
  username: string;
  email: string;
  role: "player" | "dm" | "admin";
  status: "active" | "inactive" | "banned";
  createdAt: string; // ISO date string
  lastLogin: string; // ISO date string
  profile?: {
    avatar?: string;
    timezone?: string;
    preferences?: UserPreferences;
  };
}

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

// KV Store Keys:
// user:{userId} -> User object
// user_preferences:{userId} -> UserPreferences object

// =============================================================================
// CHARACTER DATA STRUCTURES  
// =============================================================================

export interface Character {
  id: string;
  userId: string; // Owner of the character
  name: string;
  class: string;
  level: number;
  race: string;
  background: string;
  hitPoints: { current: number; max: number; temporary?: number };
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  
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
  savingThrows: Record<string, number>;
  skills: Record<string, number>;
  
  // Equipment and inventory
  inventory: InventoryItem[];
  equipment: Equipment;
  
  // Character details
  avatar?: string;
  backstory?: string;
  personality?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  
  // Spellcasting (if applicable)
  spellcasting?: SpellcastingInfo;
  
  // Campaign associations
  campaigns: string[]; // Array of campaign IDs
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
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

// KV Store Keys:
// character:{userId}:{characterId} -> Character object
// characters_by_user:{userId} -> string[] (array of character IDs)
// character_in_campaign:{campaignId}:{characterId} -> boolean

// =============================================================================
// CAMPAIGN DATA STRUCTURES
// =============================================================================

export interface Campaign {
  id: string;
  name: string;
  description: string;
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

// KV Store Keys:
// campaign:{campaignId} -> Campaign object
// campaigns_by_dm:{userId} -> string[] (array of campaign IDs)
// campaigns_by_player:{userId} -> string[] (array of campaign IDs)
// campaign_players:{campaignId} -> CampaignPlayer[]

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
// MAP DATA STRUCTURES
// =============================================================================

export interface WorldMap {
  id: string;
  name: string;
  description: string;
  geoJsonUrl: string; // URL to the geoJSON file
  thumbnailUrl?: string;
  
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
  fileSize: number; // MB
  uploadedBy: string; // User ID
  
  createdAt: string;
  updatedAt: string;
}

export interface TileSet {
  id: string;
  name: string;
  description: string;
  baseUrl: string; // Tile URL template
  format: "png" | "jpg" | "webp";
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  attribution?: string;
  isActive: boolean;
  uploadedBy: string; // User ID
  createdAt: string;
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

export interface Route {
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
// KEY PATTERNS FOR KV STORE
// =============================================================================

/*
Key patterns used in the KV store:

USERS:
- user:{userId} -> User
- user_preferences:{userId} -> UserPreferences

CHARACTERS:
- character:{userId}:{characterId} -> Character
- characters_by_user:{userId} -> string[] (character IDs)

CAMPAIGNS:
- campaign:{campaignId} -> Campaign
- campaigns_by_dm:{userId} -> string[] (campaign IDs)
- campaigns_by_player:{userId} -> string[] (campaign IDs)
- campaign_players:{campaignId} -> CampaignPlayer[]

SESSIONS:
- session:{campaignId}:{sessionId} -> Session
- sessions_by_campaign:{campaignId} -> string[] (session IDs)

LOCATIONS:
- location:{campaignId}:{locationId} -> Location
- locations_by_campaign:{campaignId} -> string[] (location IDs)

NPCS:
- npc:{campaignId}:{npcId} -> NPC
- npcs_by_campaign:{campaignId} -> string[] (NPC IDs)
- npcs_by_location:{locationId} -> string[] (NPC IDs)

ENCOUNTERS:
- encounter:{campaignId}:{encounterId} -> Encounter
- encounters_by_campaign:{campaignId} -> string[] (encounter IDs)
- encounters_by_session:{sessionId} -> string[] (encounter IDs)

MAPS:
- world_map:{mapId} -> WorldMap
- tile_set:{tileSetId} -> TileSet
- world_maps_all -> string[] (map IDs)
- tile_sets_active -> string[] (active tile set IDs)

CHAT:
- chat_message:{campaignId}:{messageId} -> ChatMessage
- chat_messages_by_campaign:{campaignId} -> string[] (message IDs, newest first)
- chat_messages_by_session:{sessionId} -> string[] (message IDs)

ROUTES:
- route:{campaignId}:{routeId} -> Route
- routes_by_campaign:{campaignId} -> string[] (route IDs)
*/