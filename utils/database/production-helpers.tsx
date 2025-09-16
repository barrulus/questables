// Production data helpers for PostgreSQL database
// These handle all database operations for the D&D application

import { databaseClient } from './client';
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
} from './data-structures';
import { mapDatabaseFields, mapToDatabase } from './data-structures';

// Export the database client for backward compatibility
export { databaseClient as db };

// =============================================================================
// USER HELPERS
// =============================================================================

export const userHelpers = {
  async getCurrentUser(userId: string): Promise<User | null> {
    try {
      const { data, error } = await databaseClient.query(
        'SELECT id, username, email, role, status, avatar_url, timezone, created_at, updated_at, last_login FROM user_profiles WHERE id = $1',
        [userId]
      );
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return mapDatabaseFields<User>(data[0]);
    } catch (error) {
      console.error('Error getting current user:', error);
      throw error;
    }
  },

  async getUserProfile(userId: string): Promise<User | null> {
    try {
      const { data, error } = await databaseClient.query(
        'SELECT * FROM user_profiles WHERE id = $1',
        [userId]
      );
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return mapDatabaseFields<User>(data[0]);
    } catch (error) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  },

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<User | null> {
    try {
      // Convert camelCase to database format
      const dbUpdates = mapToDatabase(updates);
      
      // Build dynamic update query
      const fields = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(dbUpdates)) {
        if (key === 'id' || key === 'created_at') continue;
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }

      if (fields.length === 0) return this.getUserProfile(userId);

      fields.push('updated_at = NOW()');
      values.push(userId);

      const { error } = await databaseClient.query(
        `UPDATE user_profiles SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      if (error) throw error;
      return this.getUserProfile(userId);
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  },

  async createUser(userData: Omit<User, 'id' | 'created_at' | 'updated_at' | 'last_login'>): Promise<User | null> {
    try {
      const { data, error } = await databaseClient.query(`
        INSERT INTO user_profiles (username, email, role, status, avatar_url, timezone) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING *
      `, [userData.username, userData.email, userData.role || 'player', userData.status || 'active', userData.avatar_url, userData.timezone]);
      
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return mapDatabaseFields<User>(data[0]);
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
};

// =============================================================================
// CHARACTER HELPERS
// =============================================================================

export const characterHelpers = {
  async getCharacter(characterId: string): Promise<Character | null> {
    try {
      const { data, error } = await databaseClient.query(
        'SELECT * FROM characters WHERE id = $1',
        [characterId]
      );
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return mapDatabaseFields<Character>(data[0]);
    } catch (error) {
      console.error('Error getting character:', error);
      throw error;
    }
  },

  async createCharacter(character: Omit<Character, 'id' | 'created_at' | 'updated_at' | 'last_played'>): Promise<Character | null> {
    try {
      // Convert to database format
      const dbCharacter = mapToDatabase(character);
      
      const { data, error } = await databaseClient.query(`
        INSERT INTO characters (
          user_id, name, class, level, race, background, hit_points, armor_class, speed, 
          proficiency_bonus, abilities, saving_throws, skills, inventory, equipment, 
          avatar_url, backstory, personality, ideals, bonds, flaws, spellcasting
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING id
      `, [
        dbCharacter.user_id, dbCharacter.name, dbCharacter.class, dbCharacter.level || 1, dbCharacter.race,
        dbCharacter.background, dbCharacter.hit_points || '{"current": 0, "max": 0, "temporary": 0}',
        dbCharacter.armor_class || 10, dbCharacter.speed || 30, dbCharacter.proficiency_bonus || 2,
        dbCharacter.abilities || '{"strength": 10, "dexterity": 10, "constitution": 10, "intelligence": 10, "wisdom": 10, "charisma": 10}',
        dbCharacter.saving_throws || '{}', dbCharacter.skills || '{}',
        dbCharacter.inventory || '[]', dbCharacter.equipment || '{}',
        dbCharacter.avatar_url, dbCharacter.backstory, dbCharacter.personality, 
        dbCharacter.ideals, dbCharacter.bonds, dbCharacter.flaws, dbCharacter.spellcasting
      ]);
      
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Failed to create character');
      return this.getCharacter(data[0].id);
    } catch (error) {
      console.error('Error creating character:', error);
      throw error;
    }
  },

  async updateCharacter(characterId: string, updates: Partial<Character>): Promise<Character | null> {
    try {
      // Convert to database format
      const dbUpdates = mapToDatabase(updates);
      
      // Build dynamic update query
      const fields = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(dbUpdates)) {
        if (key === 'id' || key === 'created_at') continue;
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }

      if (fields.length === 0) return this.getCharacter(characterId);

      fields.push('updated_at = NOW()');
      values.push(characterId);

      const { error } = await databaseClient.query(
        `UPDATE characters SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      if (error) throw error;
      return this.getCharacter(characterId);
    } catch (error) {
      console.error('Error updating character:', error);
      throw error;
    }
  },

  async getCharactersByUser(userId: string): Promise<Character[]> {
    try {
      const { data, error } = await databaseClient.query(
        'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      if (error) throw error;
      if (!data) return [];
      
      return data.map(character => mapDatabaseFields<Character>(character));
    } catch (error) {
      console.error('Error getting characters by user:', error);
      throw error;
    }
  },

  async getCharactersByCampaign(campaignId: string): Promise<Character[]> {
    try {
      // Note: This is a placeholder - in the new schema we should use campaign_players table
      const { data, error } = await databaseClient.query(`
        SELECT c.* FROM characters c
        JOIN campaign_players cp ON c.id = cp.character_id
        WHERE cp.campaign_id = $1 AND cp.status = 'active'
        ORDER BY c.name
      `, [campaignId]);
      if (error) throw error;
      if (!data) return [];
      
      return data.map(character => mapDatabaseFields<Character>(character));
    } catch (error) {
      console.error('Error getting characters by campaign:', error);
      throw error;
    }
  },

  async deleteCharacter(characterId: string): Promise<void> {
    try {
      const { error } = await databaseClient.query(
        'DELETE FROM characters WHERE id = $1',
        [characterId]
      );
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting character:', error);
      throw error;
    }
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
    if (error) throw error;
    if (!data || data.length === 0) return null;
    
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

  async createCampaign(campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'lastActivity'>): Promise<Campaign | null> {
    const { data, error } = await databaseClient.query(`
      INSERT INTO campaigns (
        name, description, dm_user_id, system, setting, status, max_players, 
        level_range, settings, players, sessions, locations, npcs, routes, world_map_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `, [
      campaign.name, campaign.description, campaign.dmUserId, campaign.system,
      campaign.setting, campaign.status, campaign.maxPlayers,
      JSON.stringify(campaign.levelRange), JSON.stringify(campaign.settings),
      JSON.stringify(campaign.players), JSON.stringify(campaign.sessions),
      JSON.stringify(campaign.locations), JSON.stringify(campaign.npcs),
      JSON.stringify(campaign.routes), campaign.worldMapId
    ]);
    
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Failed to create campaign');
    return this.getCampaign(data[0].id);
  },

  async updateCampaign(campaignId: string, updates: Partial<Campaign>): Promise<Campaign | null> {
    // Build dynamic update query
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'createdAt') continue;
      
      const dbField = key === 'dmUserId' ? 'dm_user_id' :
                     key === 'maxPlayers' ? 'max_players' :
                     key === 'levelRange' ? 'level_range' :
                     key === 'worldMapId' ? 'world_map_id' :
                     key === 'nextSession' ? 'next_session' :
                     key === 'lastActivity' ? 'last_activity' : key;
      
      fields.push(`${dbField} = $${paramIndex++}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (fields.length === 0) return this.getCampaign(campaignId);

    fields.push('updated_at = NOW()');
    values.push(campaignId);

    const { error } = await databaseClient.query(
      `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    if (error) throw error;
    return this.getCampaign(campaignId);
  },

  async getCampaignsByDM(userId: string): Promise<Campaign[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM campaigns WHERE dm_user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    if (error) throw error;
    if (!data) return [];
    
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
    if (error) throw error;
    if (!data) return [];
    
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

  async getPublicCampaigns(): Promise<Campaign[]> {
    const { data, error } = await databaseClient.query(`
      SELECT c.*, u.username as dm_username FROM campaigns c
      JOIN user_profiles u ON c.dm_user_id = u.id
      WHERE c.settings::jsonb->>'isPublic' = 'true' 
      AND c.status = 'recruiting'
      ORDER BY c.created_at DESC
    `, []);
    if (error) throw error;
    if (!data) return [];
    
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

  async joinCampaign(campaignId: string, userId: string, characterId: string): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const newPlayer = {
      userId,
      characterId,
      joinedAt: new Date().toISOString(),
      status: 'active' as const,
      role: 'player' as const
    };

    campaign.players.push(newPlayer);
    await this.updateCampaign(campaignId, { players: campaign.players });

    // Also update character's campaigns array
    const character = await characterHelpers.getCharacter(characterId);
    if (character && !character.campaigns.includes(campaignId)) {
      character.campaigns.push(campaignId);
      await characterHelpers.updateCharacter(characterId, { campaigns: character.campaigns });
    }
  },

  async leaveCampaign(campaignId: string, userId: string): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    campaign.players = campaign.players.filter(p => p.userId !== userId);
    await this.updateCampaign(campaignId, { players: campaign.players });
  }
};

// =============================================================================
// LOCATION HELPERS
// =============================================================================

export const locationHelpers = {
  async getLocation(locationId: string): Promise<Location | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM locations WHERE id = $1',
      [locationId]
    );
    if (error) throw error;
    if (!data || data.length === 0) return null;
    
    const location = data[0];
    return {
      ...location,
      connectedLocations: JSON.parse(location.connected_locations || '[]'),
      npcs: JSON.parse(location.npcs || '[]'),
      encounters: JSON.parse(location.encounters || '[]'),
      features: JSON.parse(location.features || '[]'),
      discoveredBy: JSON.parse(location.discovered_by || '[]')
    };
  },

  async createLocation(location: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>): Promise<Location | null> {
    const { data, error } = await databaseClient.query(`
      INSERT INTO locations (
        campaign_id, name, description, type, map_url, grid_size, parent_location_id,
        connected_locations, npcs, encounters, features, is_discovered, discovered_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      location.campaignId, location.name, location.description, location.type,
      location.mapUrl, location.gridSize, location.parentLocationId,
      JSON.stringify(location.connectedLocations), JSON.stringify(location.npcs),
      JSON.stringify(location.encounters), JSON.stringify(location.features),
      location.isDiscovered, JSON.stringify(location.discoveredBy)
    ]);
    
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Failed to create location');
    return this.getLocation(data[0].id);
  },

  async updateLocation(locationId: string, updates: Partial<Location>): Promise<Location | null> {
    // Build dynamic update query
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'createdAt') continue;
      
      const dbField = key === 'campaignId' ? 'campaign_id' :
                     key === 'mapUrl' ? 'map_url' :
                     key === 'gridSize' ? 'grid_size' :
                     key === 'parentLocationId' ? 'parent_location_id' :
                     key === 'connectedLocations' ? 'connected_locations' :
                     key === 'isDiscovered' ? 'is_discovered' :
                     key === 'discoveredBy' ? 'discovered_by' : key;
      
      fields.push(`${dbField} = $${paramIndex++}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (fields.length === 0) return this.getLocation(locationId);

    fields.push('updated_at = NOW()');
    values.push(locationId);

    const { error } = await databaseClient.query(
      `UPDATE locations SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    if (error) throw error;
    return this.getLocation(locationId);
  },

  async getLocationsByCampaign(campaignId: string): Promise<Location[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM locations WHERE campaign_id = $1 ORDER BY name',
      [campaignId]
    );
    if (error) throw error;
    if (!data) return [];
    
    return data.map(location => ({
      ...location,
      connectedLocations: JSON.parse(location.connected_locations || '[]'),
      npcs: JSON.parse(location.npcs || '[]'),
      encounters: JSON.parse(location.encounters || '[]'),
      features: JSON.parse(location.features || '[]'),
      discoveredBy: JSON.parse(location.discovered_by || '[]')
    }));
  },

  async deleteLocation(locationId: string): Promise<void> {
    const { error } = await databaseClient.query(
      'DELETE FROM locations WHERE id = $1',
      [locationId]
    );
    if (error) throw error;
  }
};

// =============================================================================
// MAP HELPERS (PostGIS Integration)
// =============================================================================

export const mapHelpers = {
  async getWorldMap(mapId: string): Promise<WorldMap | null> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM maps_world WHERE id = $1',
      [mapId]
    );
    if (error) throw error;
    if (!data || data.length === 0) return null;
    
    const map = data[0];
    return {
      ...map,
      bounds: JSON.parse(map.bounds),
      layers: JSON.parse(map.layers)
    };
  },

  async getAllWorldMaps(): Promise<WorldMap[]> {
    const { data, error } = await databaseClient.query(
      'SELECT * FROM maps_world ORDER BY created_at DESC'
    );
    if (error) throw error;
    if (!data) return [];
    
    return data.map(map => ({
      ...map,
      bounds: JSON.parse(map.bounds),
      layers: JSON.parse(map.layers)
    }));
  },

  async createWorldMap(map: Omit<WorldMap, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorldMap | null> {
    const { data, error } = await databaseClient.query(`
      INSERT INTO maps_world (name, description, bounds, layers, uploaded_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      map.name, map.description, JSON.stringify(map.bounds), 
      JSON.stringify(map.layers), map.uploadedBy
    ]);
    
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Failed to create world map');
    return this.getWorldMap(data[0].id);
  },

  async deleteWorldMap(mapId: string): Promise<void> {
    const { error } = await databaseClient.query(
      'DELETE FROM maps_world WHERE id = $1',
      [mapId]
    );
    if (error) throw error;
  },

  // PostGIS spatial queries for world map data
  async getBurgsNearPoint(worldMapId: string, lat: number, lng: number, radiusKm: number = 50): Promise<Burg[]> {
    const { data, error } = await databaseClient.spatial('get_burgs_near_point', {
      world_map_id: worldMapId,
      lat,
      lng,
      radius_km: radiusKm
    });
    if (error) throw error;
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
    if (error) throw error;
    return data || [];
  },

  async getCellAtPoint(worldMapId: string, lat: number, lng: number): Promise<Cell | null> {
    const { data, error } = await databaseClient.spatial('get_cell_at_point', {
      world_map_id: worldMapId,
      lat,
      lng
    });
    if (error) throw error;
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
    if (error) throw error;
    return data || [];
  },

  async getMarkersInBounds(worldMapId: string, north: number, south: number, east: number, west: number): Promise<Marker[]> {
    const { data, error } = await databaseClient.query(`
      SELECT * FROM maps_markers 
      WHERE world_map_id = $1 
      AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
    `, [worldMapId, west, south, east, north]);
    if (error) throw error;
    return data || [];
  }
};

// =============================================================================
// CHAT HELPERS
// =============================================================================

export const chatHelpers = {
  async getChatMessages(campaignId: string, limit: number = 50): Promise<ChatMessage[]> {
    const { data, error } = await databaseClient.query(`
      SELECT cm.*, up.username as sender_name, c.name as character_name 
      FROM chat_messages cm
      JOIN user_profiles up ON cm.sender_id = up.id
      LEFT JOIN characters c ON cm.character_id = c.id
      WHERE cm.campaign_id = $1 
      ORDER BY cm.timestamp DESC 
      LIMIT $2
    `, [campaignId, limit]);
    
    if (error) throw error;
    if (!data) return [];
    
    return data.reverse().map(msg => ({
      ...msg,
      diceRoll: msg.dice_roll ? JSON.parse(msg.dice_roll) : undefined,
      reactions: JSON.parse(msg.reactions || '[]'),
      recipients: msg.recipients ? JSON.parse(msg.recipients) : undefined
    }));
  },

  async sendMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage | null> {
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
    
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Failed to send message');
    
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
    const { data, error } = await databaseClient.query('SELECT 1 as test');
    if (error) throw error;
    return data && data.length > 0;
  },

  async initializeDatabase(): Promise<boolean> {
    const { data, error } = await databaseClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('user_profiles', 'characters', 'campaigns', 'maps_world')
    `);
    
    if (error) throw error;
    return data && data.length >= 4;
  }
};
