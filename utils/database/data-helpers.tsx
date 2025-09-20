// Helper functions for working with D&D app data in PostgreSQL database
import { databaseClient } from './client';
import { mapDatabaseFields } from './data-structures';
import type {
  User,
  Character,
  Campaign,
  Session,
  Location,
  NPC,
  Encounter,
  WorldMap,
  ChatMessage,
  CampaignRoute,
  Burg,
  Cell,
  River,
  Route,
  Marker,
  UserRole
} from './data-structures';

type JsonColumnOptions = {
  required?: boolean;
};

const parseJsonColumn = <T,>(value: unknown, column: string, options: JsonColumnOptions = {}): T | undefined => {
  const { required = true } = options;

  if (value === null || value === undefined) {
    if (required) {
      throw new Error(`[DataHelpers] ${column} returned null/undefined from the database.`);
    }
    return undefined;
  }

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new Error(`[DataHelpers] ${column} contains invalid JSON: ${(error as Error).message}`);
    }
  }

  throw new Error(`[DataHelpers] ${column} returned unsupported type ${typeof value}.`);
};

const USER_ROLE_PRIORITY: UserRole[] = ['admin', 'dm', 'player'];

const normalizeUserRoles = (roles?: unknown, fallback?: unknown): UserRole[] => {
  const collected = new Set<UserRole>();

  const register = (value: unknown) => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(register);
      return;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === 'player' || normalized === 'dm' || normalized === 'admin') {
        collected.add(normalized as UserRole);
      }
    }
  };

  register(roles);
  register(fallback);
  collected.add('player');

  return USER_ROLE_PRIORITY.filter((role) => collected.has(role));
};

const normalizeCharacterRow = (row: any): Character => {
  const abilities = parseJsonColumn<Character['abilities']>(row.abilities, 'characters.abilities');
  const savingThrows = parseJsonColumn<Record<string, number>>(row.saving_throws ?? row.savingThrows, 'characters.saving_throws');
  const skills = parseJsonColumn<Record<string, number>>(row.skills, 'characters.skills');
  const inventory = parseJsonColumn<Character['inventory']>(row.inventory, 'characters.inventory');
  const equipment = parseJsonColumn<Character['equipment']>(row.equipment, 'characters.equipment');
  const hitPoints = parseJsonColumn<Character['hit_points']>(row.hit_points ?? row.hitPoints, 'characters.hit_points');
  const spellcasting = parseJsonColumn<Character['spellcasting']>(row.spellcasting, 'characters.spellcasting', { required: false });
  const campaigns = parseJsonColumn<string[]>(row.campaigns, 'characters.campaigns', { required: false });

  return {
    ...row,
    userId: row.user_id,
    abilities: abilities!,
    saving_throws: savingThrows!,
    savingThrows: savingThrows!,
    skills: skills!,
    inventory: inventory!,
    equipment: equipment!,
    hit_points: hitPoints!,
    hitPoints: hitPoints!,
    armorClass: row.armor_class,
    proficiencyBonus: row.proficiency_bonus,
    spellcasting: spellcasting,
    campaigns
  };
};

// =============================================================================
// USER HELPERS
// =============================================================================

export const userHelpers = {
  async getUser(userId: string): Promise<User | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM user_profiles WHERE id = $1',
      [userId]
    );
    if (error || !data || data.length === 0) return null;
    return data[0];
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await databaseClient.query(
      'SELECT id, username, email, roles, status, created_at as "createdAt", last_login as "lastLogin" FROM user_profiles WHERE email = $1',
      [email]
    );
    if (error || !data || data.length === 0) return null;
    return mapDatabaseFields<User>(data[0]);
  },

  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'lastLogin'>): Promise<User | null> {
    const roles = normalizeUserRoles(userData.roles, userData.role);
    const { data, error } = await databaseClient.query(`
      INSERT INTO user_profiles (username, email, roles, status) 
      VALUES ($1, $2, $3, $4) 
      RETURNING id, username, email, roles, status, created_at as "createdAt", last_login as "lastLogin"
    `, [userData.username, userData.email, roles, userData.status ?? 'active']);

    if (error || !data || data.length === 0) return null;
    return mapDatabaseFields<User>(data[0]);
  },

  async updateLastLogin(userId: string): Promise<void> {
    await databaseClient.query(
      'UPDATE user_profiles SET last_login = NOW() WHERE id = $1',
      [userId]
    );
  }
};

// =============================================================================
// CHARACTER HELPERS
// =============================================================================

export const characterHelpers = {
  async getCharacter(characterId: string): Promise<Character | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM characters WHERE id = $1',
      [characterId]
    );
    if (error || !data || data.length === 0) return null;

    return normalizeCharacterRow(data[0]);
  },

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    if (error || !data) return [];
    
    return data.map(normalizeCharacterRow);
  },

  async createCharacter(character: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>): Promise<Character | null> {
    const { data, error } = await databaseClient.query(`
      INSERT INTO characters (
        user_id, name, class, level, race, background, hit_points, armor_class, speed, 
        proficiency_bonus, abilities, saving_throws, skills, inventory, equipment, 
        avatar, backstory, personality, ideals, bonds, flaws, spellcasting, campaigns
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *
    `, [
      character.userId, character.name, character.class, character.level, character.race,
      character.background, JSON.stringify(character.hitPoints), character.armorClass,
      character.speed, character.proficiencyBonus, JSON.stringify(character.abilities),
      JSON.stringify(character.savingThrows), JSON.stringify(character.skills),
      JSON.stringify(character.inventory), JSON.stringify(character.equipment),
      character.avatar, character.backstory, character.personality, character.ideals,
      character.bonds, character.flaws, JSON.stringify(character.spellcasting),
      JSON.stringify(character.campaigns)
    ]);
    
    if (error || !data || data.length === 0) return null;
    return this.getCharacter(data[0].id);
  },

  async updateCharacter(characterId: string, updates: Partial<Character>): Promise<Character | null> {
    // Build dynamic update query
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'createdAt') continue;
      
      const dbField = key === 'userId' ? 'user_id' : 
                     key === 'hitPoints' ? 'hit_points' :
                     key === 'armorClass' ? 'armor_class' :
                     key === 'proficiencyBonus' ? 'proficiency_bonus' :
                     key === 'savingThrows' ? 'saving_throws' : key;
      
      fields.push(`${dbField} = $${paramIndex++}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (fields.length === 0) return this.getCharacter(characterId);

    fields.push(`updated_at = NOW()`);
    values.push(characterId);

    const { error } = await databaseClient.query(
      `UPDATE characters SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    if (error) return null;
    return this.getCharacter(characterId);
  }
};

// =============================================================================
// CAMPAIGN HELPERS
// =============================================================================

export const campaignHelpers = {
  async getCampaign(campaignId: string): Promise<Campaign | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM campaigns WHERE id = $1',
      [campaignId]
    );
    if (error || !data || data.length === 0) return null;
    
    const campaign = data[0];
    return {
      ...campaign,
      players: JSON.parse(campaign.players || '[]'),
      sessions: JSON.parse(campaign.sessions || '[]'),
      locations: JSON.parse(campaign.locations || '[]'),
      npcs: JSON.parse(campaign.npcs || '[]'),
      routes: JSON.parse(campaign.routes || '[]'),
      settings: JSON.parse(campaign.settings),
      levelRange: JSON.parse(campaign.level_range),
      nextSession: campaign.next_session ? JSON.parse(campaign.next_session) : undefined
    };
  },

  async getCampaignsByDM(userId: string): Promise<Campaign[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM campaigns WHERE dm_user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    if (error || !data) return [];
    
    return data.map(campaign => ({
      ...campaign,
      players: JSON.parse(campaign.players || '[]'),
      sessions: JSON.parse(campaign.sessions || '[]'),
      locations: JSON.parse(campaign.locations || '[]'),
      npcs: JSON.parse(campaign.npcs || '[]'),
      routes: JSON.parse(campaign.routes || '[]'),
      settings: JSON.parse(campaign.settings),
      levelRange: JSON.parse(campaign.level_range),
      nextSession: campaign.next_session ? JSON.parse(campaign.next_session) : undefined
    }));
  },

  async getCampaignsByPlayer(userId: string): Promise<Campaign[]> {
    const { data, error } = await databaseClient.query(`
      SELECT c.* FROM campaigns c
      WHERE c.players::jsonb @> '[{"userId": "${userId}"}]'
      ORDER BY c.created_at DESC
    `, []);
    if (error || !data) return [];
    
    return data.map(campaign => ({
      ...campaign,
      players: JSON.parse(campaign.players || '[]'),
      sessions: JSON.parse(campaign.sessions || '[]'),
      locations: JSON.parse(campaign.locations || '[]'),
      npcs: JSON.parse(campaign.npcs || '[]'),
      routes: JSON.parse(campaign.routes || '[]'),
      settings: JSON.parse(campaign.settings),
      levelRange: JSON.parse(campaign.level_range),
      nextSession: campaign.next_session ? JSON.parse(campaign.next_session) : undefined
    }));
  }
};

// =============================================================================
// MAP DATA HELPERS (PostGIS Integration)
// =============================================================================

export const mapHelpers = {
  async getWorldMaps(): Promise<WorldMap[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM maps_world ORDER BY created_at DESC'
    );
    if (error || !data) return [];
    
    return data.map(map => ({
      ...map,
      bounds: JSON.parse(map.bounds),
      layers: JSON.parse(map.layers)
    }));
  },

  async getWorldMap(mapId: string): Promise<WorldMap | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM maps_world WHERE id = $1',
      [mapId]
    );
    if (error || !data || data.length === 0) return null;
    
    const map = data[0];
    return {
      ...map,
      bounds: JSON.parse(map.bounds),
      layers: JSON.parse(map.layers)
    };
  },

  // Spatial query functions using PostGIS
  async getBurgsNearPoint(worldMapId: string, lat: number, lng: number, radiusKm: number): Promise<Burg[]> {
    const { data, error } = await databaseClient.spatial('get_burgs_near_point', {
      world_map_id: worldMapId,
      lat,
      lng,
      radius_km: radiusKm
    });
    return data || [];
  },

  async getRoutesBetweenPoints(worldMapId: string, startLat: number, startLng: number, endLat: number, endLng: number): Promise<Route[]> {
    const { data, error } = await databaseClient.spatial('get_routes_between_points', {
      world_map_id: worldMapId,
      start_lat: startLat,
      start_lng: startLng,
      end_lat: endLat,
      end_lng: endLng
    });
    return data || [];
  },

  async getCellAtPoint(worldMapId: string, lat: number, lng: number): Promise<Cell | null> {
    const { data, error } = await databaseClient.spatial('get_cell_at_point', {
      world_map_id: worldMapId,
      lat,
      lng
    });
    return data && data.length > 0 ? data[0] : null;
  },

  async getRiversInBounds(worldMapId: string, north: number, south: number, east: number, west: number): Promise<River[]> {
    const { data, error } = await databaseClient.spatial('get_rivers_in_bounds', {
      world_map_id: worldMapId,
      north,
      south,
      east,
      west
    });
    return data || [];
  },

  async getMarkersInBounds(worldMapId: string, north: number, south: number, east: number, west: number): Promise<Marker[]> {
    const { data, error } = await databaseClient.query(`
      SELECT * FROM maps_markers 
      WHERE world_map_id = $1 
      AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
    `, [worldMapId, west, south, east, north]);
    return data || [];
  }
};

// =============================================================================
// CHAT HELPERS
// =============================================================================

export const chatHelpers = {
  async getChatMessagesByCampaign(campaignId: string, limit: number = 50): Promise<ChatMessage[]> {
    const { data, error } = await databaseClient.query(`
      SELECT * FROM chat_messages 
      WHERE campaign_id = $1 
      ORDER BY timestamp DESC 
      LIMIT $2
    `, [campaignId, limit]);
    
    if (error || !data) return [];
    
    return data.map(msg => ({
      ...msg,
      diceRoll: msg.dice_roll ? JSON.parse(msg.dice_roll) : undefined,
      reactions: JSON.parse(msg.reactions || '[]'),
      recipients: msg.recipients ? JSON.parse(msg.recipients) : undefined
    }));
  },

  async createChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage | null> {
    const { data, error } = await databaseClient.query(`
      INSERT INTO chat_messages (
        campaign_id, session_id, content, type, sender_id, sender_name, 
        character_id, dice_roll, is_private, recipients, reactions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      message.campaignId, message.sessionId, message.content, message.type,
      message.senderId, message.senderName, message.characterId,
      JSON.stringify(message.diceRoll), message.isPrivate,
      JSON.stringify(message.recipients), JSON.stringify(message.reactions)
    ]);
    
    if (error || !data || data.length === 0) return null;
    
    const msg = data[0];
    return {
      ...msg,
      diceRoll: msg.dice_roll ? JSON.parse(msg.dice_roll) : undefined,
      reactions: JSON.parse(msg.reactions || '[]'),
      recipients: msg.recipients ? JSON.parse(msg.recipients) : undefined
    };
  }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export const utils = {
  generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  },

  async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await databaseClient.query('SELECT 1 as test');
      return !error && data && data.length > 0;
    } catch {
      return false;
    }
  },

  async initializeDatabase(): Promise<boolean> {
    try {
      // Check if tables exist, create if not
      const { data, error } = await databaseClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('user_profiles', 'characters', 'campaigns')
      `);
      
      return !error && data && data.length >= 3;
    } catch {
      return false;
    }
  }
};
