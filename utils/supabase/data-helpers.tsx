// Helper functions for working with D&D app data in the KV store
import * as kv from './kv_store';
import type {
  User,
  Character,
  Campaign,
  Session,
  Location,
  NPC,
  Encounter,
  WorldMap,
  TileSet,
  ChatMessage,
  Route
} from './data-structures';

// =============================================================================
// USER HELPERS
// =============================================================================

export const userHelpers = {
  async getUser(userId: string): Promise<User | null> {
    return await kv.get(`user:${userId}`);
  },

  async setUser(user: User): Promise<void> {
    await kv.set(`user:${user.id}`, user);
  },

  async getUserPreferences(userId: string) {
    return await kv.get(`user_preferences:${userId}`);
  },

  async setUserPreferences(userId: string, preferences: any): Promise<void> {
    await kv.set(`user_preferences:${userId}`, preferences);
  }
};

// =============================================================================
// CHARACTER HELPERS
// =============================================================================

export const characterHelpers = {
  async getCharacter(userId: string, characterId: string): Promise<Character | null> {
    return await kv.get(`character:${userId}:${characterId}`);
  },

  async setCharacter(character: Character): Promise<void> {
    await kv.set(`character:${character.userId}:${character.id}`, character);
    
    // Update user's character list
    const userCharacters = await kv.get(`characters_by_user:${character.userId}`) || [];
    if (!userCharacters.includes(character.id)) {
      userCharacters.push(character.id);
      await kv.set(`characters_by_user:${character.userId}`, userCharacters);
    }
  },

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const characterIds = await kv.get(`characters_by_user:${userId}`) || [];
    const characters = [];
    
    for (const id of characterIds) {
      const character = await kv.get(`character:${userId}:${id}`);
      if (character) characters.push(character);
    }
    
    return characters;
  },

  async deleteCharacter(userId: string, characterId: string): Promise<void> {
    await kv.del(`character:${userId}:${characterId}`);
    
    // Remove from user's character list
    const userCharacters = await kv.get(`characters_by_user:${userId}`) || [];
    const updated = userCharacters.filter((id: string) => id !== characterId);
    await kv.set(`characters_by_user:${userId}`, updated);
  }
};

// =============================================================================
// CAMPAIGN HELPERS
// =============================================================================

export const campaignHelpers = {
  async getCampaign(campaignId: string): Promise<Campaign | null> {
    return await kv.get(`campaign:${campaignId}`);
  },

  async setCampaign(campaign: Campaign): Promise<void> {
    await kv.set(`campaign:${campaign.id}`, campaign);
    
    // Update DM's campaign list
    const dmCampaigns = await kv.get(`campaigns_by_dm:${campaign.dmUserId}`) || [];
    if (!dmCampaigns.includes(campaign.id)) {
      dmCampaigns.push(campaign.id);
      await kv.set(`campaigns_by_dm:${campaign.dmUserId}`, dmCampaigns);
    }
  },

  async getCampaignsByDM(userId: string): Promise<Campaign[]> {
    const campaignIds = await kv.get(`campaigns_by_dm:${userId}`) || [];
    const campaigns = [];
    
    for (const id of campaignIds) {
      const campaign = await kv.get(`campaign:${id}`);
      if (campaign) campaigns.push(campaign);
    }
    
    return campaigns;
  },

  async getCampaignsByPlayer(userId: string): Promise<Campaign[]> {
    const campaignIds = await kv.get(`campaigns_by_player:${userId}`) || [];
    const campaigns = [];
    
    for (const id of campaignIds) {
      const campaign = await kv.get(`campaign:${id}`);
      if (campaign) campaigns.push(campaign);
    }
    
    return campaigns;
  },

  async addPlayerToCampaign(campaignId: string, userId: string, characterId: string): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return;

    // Add to campaign's player list
    const newPlayer = {
      userId,
      characterId,
      joinedAt: new Date().toISOString(),
      status: 'active' as const,
      role: 'player' as const
    };
    
    campaign.players.push(newPlayer);
    await this.setCampaign(campaign);

    // Add to player's campaign list
    const playerCampaigns = await kv.get(`campaigns_by_player:${userId}`) || [];
    if (!playerCampaigns.includes(campaignId)) {
      playerCampaigns.push(campaignId);
      await kv.set(`campaigns_by_player:${userId}`, playerCampaigns);
    }
  }
};

// =============================================================================
// LOCATION HELPERS
// =============================================================================

export const locationHelpers = {
  async getLocation(campaignId: string, locationId: string): Promise<Location | null> {
    return await kv.get(`location:${campaignId}:${locationId}`);
  },

  async setLocation(location: Location): Promise<void> {
    await kv.set(`location:${location.campaignId}:${location.id}`, location);
    
    // Update campaign's location list
    const campaignLocations = await kv.get(`locations_by_campaign:${location.campaignId}`) || [];
    if (!campaignLocations.includes(location.id)) {
      campaignLocations.push(location.id);
      await kv.set(`locations_by_campaign:${location.campaignId}`, campaignLocations);
    }
  },

  async getLocationsByCampaign(campaignId: string): Promise<Location[]> {
    const locationIds = await kv.get(`locations_by_campaign:${campaignId}`) || [];
    const locations = [];
    
    for (const id of locationIds) {
      const location = await kv.get(`location:${campaignId}:${id}`);
      if (location) locations.push(location);
    }
    
    return locations;
  }
};

// =============================================================================
// NPC HELPERS
// =============================================================================

export const npcHelpers = {
  async getNPC(campaignId: string, npcId: string): Promise<NPC | null> {
    return await kv.get(`npc:${campaignId}:${npcId}`);
  },

  async setNPC(npc: NPC): Promise<void> {
    await kv.set(`npc:${npc.campaignId}:${npc.id}`, npc);
    
    // Update campaign's NPC list
    const campaignNPCs = await kv.get(`npcs_by_campaign:${npc.campaignId}`) || [];
    if (!campaignNPCs.includes(npc.id)) {
      campaignNPCs.push(npc.id);
      await kv.set(`npcs_by_campaign:${npc.campaignId}`, campaignNPCs);
    }
    
    // Update location's NPC list if applicable
    if (npc.currentLocationId) {
      const locationNPCs = await kv.get(`npcs_by_location:${npc.currentLocationId}`) || [];
      if (!locationNPCs.includes(npc.id)) {
        locationNPCs.push(npc.id);
        await kv.set(`npcs_by_location:${npc.currentLocationId}`, locationNPCs);
      }
    }
  },

  async getNPCsByCampaign(campaignId: string): Promise<NPC[]> {
    const npcIds = await kv.get(`npcs_by_campaign:${campaignId}`) || [];
    const npcs = [];
    
    for (const id of npcIds) {
      const npc = await kv.get(`npc:${campaignId}:${id}`);
      if (npc) npcs.push(npc);
    }
    
    return npcs;
  }
};

// =============================================================================
// MAP HELPERS
// =============================================================================

export const mapHelpers = {
  async getWorldMap(mapId: string): Promise<WorldMap | null> {
    return await kv.get(`world_map:${mapId}`);
  },

  async setWorldMap(map: WorldMap): Promise<void> {
    await kv.set(`world_map:${map.id}`, map);
    
    // Update global map list
    const allMaps = await kv.get('world_maps_all') || [];
    if (!allMaps.includes(map.id)) {
      allMaps.push(map.id);
      await kv.set('world_maps_all', allMaps);
    }
  },

  async getAllWorldMaps(): Promise<WorldMap[]> {
    const mapIds = await kv.get('world_maps_all') || [];
    const maps = [];
    
    for (const id of mapIds) {
      const map = await kv.get(`world_map:${id}`);
      if (map) maps.push(map);
    }
    
    return maps;
  },

  async getTileSet(tileSetId: string): Promise<TileSet | null> {
    return await kv.get(`tile_set:${tileSetId}`);
  },

  async setTileSet(tileSet: TileSet): Promise<void> {
    await kv.set(`tile_set:${tileSet.id}`, tileSet);
    
    // Update active tile sets list if active
    if (tileSet.isActive) {
      const activeTileSets = await kv.get('tile_sets_active') || [];
      if (!activeTileSets.includes(tileSet.id)) {
        activeTileSets.push(tileSet.id);
        await kv.set('tile_sets_active', activeTileSets);
      }
    }
  },

  async getActiveTileSets(): Promise<TileSet[]> {
    const tileSetIds = await kv.get('tile_sets_active') || [];
    const tileSets = [];
    
    for (const id of tileSetIds) {
      const tileSet = await kv.get(`tile_set:${id}`);
      if (tileSet && tileSet.isActive) tileSets.push(tileSet);
    }
    
    return tileSets;
  }
};

// =============================================================================
// CHAT HELPERS
// =============================================================================

export const chatHelpers = {
  async getChatMessage(campaignId: string, messageId: string): Promise<ChatMessage | null> {
    return await kv.get(`chat_message:${campaignId}:${messageId}`);
  },

  async setChatMessage(message: ChatMessage): Promise<void> {
    if (!message.campaignId) return;
    
    await kv.set(`chat_message:${message.campaignId}:${message.id}`, message);
    
    // Update campaign's message list (newest first)
    const campaignMessages = await kv.get(`chat_messages_by_campaign:${message.campaignId}`) || [];
    campaignMessages.unshift(message.id); // Add to beginning
    
    // Keep only latest 1000 messages
    if (campaignMessages.length > 1000) {
      campaignMessages.splice(1000);
    }
    
    await kv.set(`chat_messages_by_campaign:${message.campaignId}`, campaignMessages);
    
    // Update session messages if applicable
    if (message.sessionId) {
      const sessionMessages = await kv.get(`chat_messages_by_session:${message.sessionId}`) || [];
      sessionMessages.unshift(message.id);
      await kv.set(`chat_messages_by_session:${message.sessionId}`, sessionMessages);
    }
  },

  async getChatMessagesByCampaign(campaignId: string, limit: number = 50): Promise<ChatMessage[]> {
    const messageIds = await kv.get(`chat_messages_by_campaign:${campaignId}`) || [];
    const messages = [];
    
    // Get the most recent messages up to the limit
    const idsToFetch = messageIds.slice(0, limit);
    
    for (const id of idsToFetch) {
      const message = await kv.get(`chat_message:${campaignId}:${id}`);
      if (message) messages.push(message);
    }
    
    return messages;
  }
};

// =============================================================================
// SESSION HELPERS
// =============================================================================

export const sessionHelpers = {
  async getSession(campaignId: string, sessionId: string): Promise<Session | null> {
    return await kv.get(`session:${campaignId}:${sessionId}`);
  },

  async setSession(session: Session): Promise<void> {
    await kv.set(`session:${session.campaignId}:${session.id}`, session);
    
    // Update campaign's session list
    const campaignSessions = await kv.get(`sessions_by_campaign:${session.campaignId}`) || [];
    if (!campaignSessions.includes(session.id)) {
      campaignSessions.push(session.id);
      await kv.set(`sessions_by_campaign:${session.campaignId}`, campaignSessions);
    }
  },

  async getSessionsByCampaign(campaignId: string): Promise<Session[]> {
    const sessionIds = await kv.get(`sessions_by_campaign:${campaignId}`) || [];
    const sessions = [];
    
    for (const id of sessionIds) {
      const session = await kv.get(`session:${campaignId}:${id}`);
      if (session) sessions.push(session);
    }
    
    return sessions.sort((a, b) => b.sessionNumber - a.sessionNumber);
  }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export const utils = {
  generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  },

  async searchByPrefix(prefix: string): Promise<any[]> {
    return await kv.getByPrefix(prefix);
  },

  async bulkUpdate(updates: Record<string, any>): Promise<void> {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    await kv.mset(keys, values);
  }
};