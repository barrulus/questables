// Production data helpers for live Supabase deployment
// These replace the KV store helpers when moving to production

// Database client is imported from database-client.tsx
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

// Initialize database client (Supabase or local PostgreSQL)
import { databaseClient as supabase } from './database-client';

// Export the database client for backward compatibility
export { supabase };

// =============================================================================
// USER HELPERS
// =============================================================================

export const userHelpers = {
  async getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return profile;
  },

  async getUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  },

  async updateUserProfile(userId: string, updates: Partial<User>) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getUserPreferences(userId: string) {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  },

  async updateUserPreferences(userId: string, preferences: any) {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, ...preferences })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};

// =============================================================================
// CHARACTER HELPERS
// =============================================================================

export const characterHelpers = {
  async getCharacter(characterId: string): Promise<Character | null> {
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('id', characterId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  async createCharacter(character: Omit<Character, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('characters')
      .insert(character)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateCharacter(characterId: string, updates: Partial<Character>) {
    const { data, error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', characterId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async deleteCharacter(characterId: string) {
    const { error } = await supabase
      .from('characters')
      .delete()
      .eq('id', characterId);

    if (error) throw error;
  },

  async getCharactersByCampaign(campaignId: string): Promise<Character[]> {
    const { data, error } = await supabase
      .from('characters')
      .select(`
        *,
        campaign_players!inner(campaign_id)
      `)
      .eq('campaign_players.campaign_id', campaignId);

    if (error) throw error;
    return data || [];
  }
};

// =============================================================================
// CAMPAIGN HELPERS
// =============================================================================

export const campaignHelpers = {
  async getCampaign(campaignId: string): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        campaign_players(
          id,
          user_id,
          character_id,
          joined_at,
          status,
          role,
          user_profiles(username),
          characters(name)
        ),
        world_maps(name, thumbnail_url)
      `)
      .eq('id', campaignId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async createCampaign(campaign: Omit<Campaign, 'id' | 'created_at' | 'updated_at' | 'last_activity'>) {
    const { data, error } = await supabase
      .from('campaigns')
      .insert(campaign)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateCampaign(campaignId: string, updates: Partial<Campaign>) {
    const { data, error } = await supabase
      .from('campaigns')
      .update(updates)
      .eq('id', campaignId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getCampaignsByDM(userId: string): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        campaign_players(count)
      `)
      .eq('dm_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getCampaignsByPlayer(userId: string): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        campaign_players!inner(
          user_id,
          character_id,
          characters(name)
        )
      `)
      .eq('campaign_players.user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getPublicCampaigns(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select(`
        *,
        user_profiles(username),
        campaign_players(count)
      `)
      .eq('is_public', true)
      .eq('status', 'recruiting')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async joinCampaign(campaignId: string, characterId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('campaign_players')
      .insert({
        campaign_id: campaignId,
        user_id: user.id,
        character_id: characterId
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async leaveCampaign(campaignId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('campaign_players')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id);

    if (error) throw error;
  }
};

// =============================================================================
// LOCATION HELPERS
// =============================================================================

export const locationHelpers = {
  async getLocation(locationId: string): Promise<Location | null> {
    const { data, error } = await supabase
      .from('locations')
      .select(`
        *,
        parent_location:locations(name),
        child_locations:locations(id, name, type),
        npcs(id, name, avatar_url)
      `)
      .eq('id', locationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async createLocation(location: Omit<Location, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('locations')
      .insert(location)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateLocation(locationId: string, updates: Partial<Location>) {
    const { data, error } = await supabase
      .from('locations')
      .update(updates)
      .eq('id', locationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getLocationsByCampaign(campaignId: string): Promise<Location[]> {
    const { data, error } = await supabase
      .from('locations')
      .select(`
        *,
        npcs(count),
        encounters(count)
      `)
      .eq('campaign_id', campaignId)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async deleteLocation(locationId: string) {
    const { error } = await supabase
      .from('locations')
      .delete()
      .eq('id', locationId);

    if (error) throw error;
  },

  // Spatial queries for locations
  async getLocationsNearPoint(campaignId: string, lat: number, lng: number, radiusKm: number = 10) {
    const { data, error } = await supabase.rpc('get_campaign_locations_near_point', {
      campaign_id: campaignId,
      lat: lat,
      lng: lng,
      radius_km: radiusKm
    });

    if (error) throw error;
    return data || [];
  },

  async linkLocationToBurg(locationId: string, burgId: string, worldMapId: string) {
    // Get the burg's position
    const { data: burg } = await supabase
      .from('maps_burgs')
      .select('geom')
      .eq('id', burgId)
      .single();

    if (!burg) throw new Error('Burg not found');

    // Update location with burg link and position
    const { data, error } = await supabase
      .from('locations')
      .update({
        linked_burg_id: burgId,
        world_map_id: worldMapId,
        world_position: burg.geom
      })
      .eq('id', locationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};

// =============================================================================
// NPC HELPERS
// =============================================================================

export const npcHelpers = {
  async getNPC(npcId: string): Promise<NPC | null> {
    const { data, error } = await supabase
      .from('npcs')
      .select(`
        *,
        current_location:locations(name),
        npc_relationships(
          id,
          target_id,
          target_type,
          relationship_type,
          description,
          strength
        )
      `)
      .eq('id', npcId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async createNPC(npc: Omit<NPC, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('npcs')
      .insert(npc)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateNPC(npcId: string, updates: Partial<NPC>) {
    const { data, error } = await supabase
      .from('npcs')
      .update(updates)
      .eq('id', npcId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getNPCsByCampaign(campaignId: string): Promise<NPC[]> {
    const { data, error } = await supabase
      .from('npcs')
      .select(`
        *,
        current_location:locations(name)
      `)
      .eq('campaign_id', campaignId)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async getNPCsByLocation(locationId: string): Promise<NPC[]> {
    const { data, error } = await supabase
      .from('npcs')
      .select('*')
      .eq('current_location_id', locationId)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async deleteNPC(npcId: string) {
    const { error } = await supabase
      .from('npcs')
      .delete()
      .eq('id', npcId);

    if (error) throw error;
  }
};

// =============================================================================
// SESSION HELPERS
// =============================================================================

export const sessionHelpers = {
  async getSession(sessionId: string): Promise<Session | null> {
    const { data, error } = await supabase
      .from('sessions')
      .select(`
        *,
        campaign:campaigns(name, dm_user_id),
        session_participants(
          id,
          user_id,
          character_id,
          attendance_status,
          character_level_start,
          character_level_end,
          user_profiles(username),
          characters(name)
        )
      `)
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async createSession(session: Omit<Session, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('sessions')
      .insert(session)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateSession(sessionId: string, updates: Partial<Session>) {
    const { data, error } = await supabase
      .from('sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getSessionsByCampaign(campaignId: string): Promise<Session[]> {
    const { data, error } = await supabase
      .from('sessions')
      .select(`
        *,
        session_participants(count)
      `)
      .eq('campaign_id', campaignId)
      .order('session_number', { ascending: false });

    if (error) throw error;
    return data || [];
  }
};

// =============================================================================
// CHAT HELPERS
// =============================================================================

export const chatHelpers = {
  async getChatMessages(campaignId: string, limit: number = 50): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        *,
        sender:user_profiles(username, avatar_url),
        character:characters(name)
      `)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data?.reverse() || [];
  },

  async sendMessage(message: Omit<ChatMessage, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert(message)
      .select(`
        *,
        sender:user_profiles(username, avatar_url),
        character:characters(name)
      `)
      .single();

    if (error) throw error;
    return data;
  },

  async subscribeToMessages(campaignId: string, callback: (message: ChatMessage) => void) {
    return supabase
      .channel(`campaign:${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `campaign_id=eq.${campaignId}`
        },
        (payload) => callback(payload.new as ChatMessage)
      )
      .subscribe();
  }
};

// =============================================================================
// MAP HELPERS (PostGIS-enabled)
// =============================================================================

export const mapHelpers = {
  async getWorldMap(mapId: string): Promise<WorldMap | null> {
    const { data, error } = await supabase
      .from('maps_world')
      .select('*')
      .eq('id', mapId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  },

  async getAllWorldMaps(): Promise<WorldMap[]> {
    const { data, error } = await supabase
      .from('maps_world')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async createWorldMap(map: Omit<WorldMap, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('maps_world')
      .insert(map)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteWorldMap(mapId: string) {
    const { error } = await supabase
      .from('maps_world')
      .delete()
      .eq('id', mapId);

    if (error) throw error;
  },

  // PostGIS spatial queries for world map data
  async getBurgsByWorldMap(worldMapId: string) {
    const { data, error } = await supabase
      .from('maps_burgs')
      .select('*')
      .eq('world_id', worldMapId)
      .order('population', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getBurgsNearPoint(worldMapId: string, lat: number, lng: number, radiusKm: number = 50) {
    const { data, error } = await supabase.rpc('get_burgs_near_point', {
      world_map_id: worldMapId,
      lat: lat,
      lng: lng,
      radius_km: radiusKm
    });

    if (error) throw error;
    return data || [];
  },

  async getRoutesBetweenPoints(worldMapId: string, startLat: number, startLng: number, endLat: number, endLng: number) {
    const { data, error } = await supabase.rpc('get_routes_between_points', {
      world_map_id: worldMapId,
      start_lat: startLat,
      start_lng: startLng,
      end_lat: endLat,
      end_lng: endLng
    });

    if (error) throw error;
    return data || [];
  },

  async getCellAtPoint(worldMapId: string, lat: number, lng: number) {
    const { data, error } = await supabase.rpc('get_cell_at_point', {
      world_map_id: worldMapId,
      lat: lat,
      lng: lng
    });

    if (error) throw error;
    return data;
  },

  async getRiversInBounds(worldMapId: string, north: number, south: number, east: number, west: number) {
    const { data, error } = await supabase.rpc('get_rivers_in_bounds', {
      world_map_id: worldMapId,
      north: north,
      south: south,
      east: east,
      west: west
    });

    if (error) throw error;
    return data || [];
  },

  async getMarkersInBounds(worldMapId: string, north: number, south: number, east: number, west: number) {
    const { data, error } = await supabase
      .from('maps_markers')
      .select('*')
      .eq('world_id', worldMapId)
      .gte('geom', `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`);

    if (error) throw error;
    return data || [];
  },

  async getActiveTileSets(): Promise<TileSet[]> {
    const { data, error } = await supabase
      .from('tile_sets')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async createTileSet(tileSet: Omit<TileSet, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('tile_sets')
      .insert(tileSet)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateTileSet(tileSetId: string, updates: Partial<TileSet>) {
    const { data, error } = await supabase
      .from('tile_sets')
      .update(updates)
      .eq('id', tileSetId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};

// =============================================================================
// FILE UPLOAD HELPERS
// =============================================================================

export const fileHelpers = {
  async uploadCharacterAvatar(userId: string, characterId: string, file: File) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${characterId}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('character-avatars')
      .upload(fileName, file, { upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('character-avatars')
      .getPublicUrl(fileName);

    return publicUrl;
  },

  async uploadUserAvatar(userId: string, file: File) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/avatar.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('user-avatars')
      .upload(fileName, file, { upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('user-avatars')
      .getPublicUrl(fileName);

    return publicUrl;
  },

  async uploadWorldMap(userId: string, file: File) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${file.name}`;

    const { data, error } = await supabase.storage
      .from('world-maps')
      .upload(fileName, file);

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('world-maps')
      .getPublicUrl(fileName);

    return publicUrl;
  },

  async uploadCampaignAsset(campaignId: string, file: File, folder?: string) {
    const fileExt = file.name.split('.').pop();
    const folderPath = folder ? `${folder}/` : '';
    const fileName = `${campaignId}/${folderPath}${Date.now()}-${file.name}`;

    const { data, error } = await supabase.storage
      .from('campaign-assets')
      .upload(fileName, file);

    if (error) throw error;

    const { data: signedUrl } = await supabase.storage
      .from('campaign-assets')
      .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year expiry

    return signedUrl?.signedUrl;
  }
};

// =============================================================================
// REAL-TIME SUBSCRIPTIONS
// =============================================================================

export const realtimeHelpers = {
  subscribeToEncounter(encounterId: string, callback: (encounter: any) => void) {
    return supabase
      .channel(`encounter:${encounterId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'encounters',
          filter: `id=eq.${encounterId}`
        },
        (payload) => callback(payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'encounter_participants',
          filter: `encounter_id=eq.${encounterId}`
        },
        (payload) => callback(payload)
      )
      .subscribe();
  },

  subscribeToCampaign(campaignId: string, callback: (change: any) => void) {
    return supabase
      .channel(`campaign:${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaigns',
          filter: `id=eq.${campaignId}`
        },
        callback
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaign_players',
          filter: `campaign_id=eq.${campaignId}`
        },
        callback
      )
      .subscribe();
  }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export const utils = {
  generateId(): string {
    return crypto.randomUUID();
  },

  async handleAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      throw new Error('Authentication required');
    }
    return user;
  },

  async checkPermission(table: string, id: string, permission: 'read' | 'write' = 'read') {
    // This would contain your permission checking logic
    // For now, we rely on RLS policies
    return true;
  }
};