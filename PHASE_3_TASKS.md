# Phase 3: Advanced Features Tasks
## PostGIS Mapping, Combat Tracking, Sessions & File Storage (3-4 weeks)

**Phase 3 Goal:** Integrate PostGIS mapping features, implement combat tracking with database persistence, add session and encounter management, and implement file storage for assets.

**Prerequisites:** Phase 2 must be completed (character/campaign management, real-time chat, inventory/spellbook integration)

---

## Task Sequence

### Task 1: Implement PostGIS World Map API Endpoints
**File:** `/server/database-server.js`
**Priority:** Critical - Mapping Foundation
**Dependencies:** Phase 2 complete

1. **Add world map management endpoints**
   ```javascript
   // POST /api/maps/world - Upload and create world map
   app.post('/api/maps/world', async (req, res) => {
     try {
       const { name, description, bounds, layers, uploaded_by } = req.body;
       
       const result = await pool.query(`
         INSERT INTO maps_world (name, description, bounds, layers, uploaded_by, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *
       `, [name, description, JSON.stringify(bounds), JSON.stringify(layers), uploaded_by]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/maps/world - Get all world maps
   app.get('/api/maps/world', async (req, res) => {
     try {
       const result = await pool.query(`
         SELECT mw.*, up.username as uploaded_by_username
         FROM maps_world mw
         LEFT JOIN user_profiles up ON mw.uploaded_by = up.id
         WHERE mw.is_active = true
         ORDER BY mw.created_at DESC
       `);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/maps/world/:id - Get specific world map
   app.get('/api/maps/world/:id', async (req, res) => {
     try {
       const { id } = req.params;
       const result = await pool.query('SELECT * FROM maps_world WHERE id = $1', [id]);
       if (result.rows.length === 0) {
         return res.status(404).json({ error: 'World map not found' });
       }
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Add PostGIS spatial data endpoints**
   ```javascript
   // GET /api/maps/:worldId/burgs - Get burgs for world map
   app.get('/api/maps/:worldId/burgs', async (req, res) => {
     try {
       const { worldId } = req.params;
       const { bounds } = req.query; // Optional bounding box filter
       
       let query = 'SELECT * FROM maps_burgs WHERE world_id = $1';
       let params = [worldId];
       
       if (bounds) {
         const { north, south, east, west } = JSON.parse(bounds);
         query += ` AND ST_Within(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
         params.push(west, south, east, north);
       }
       
       const result = await pool.query(query, params);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/maps/:worldId/rivers - Get rivers for world map
   app.get('/api/maps/:worldId/rivers', async (req, res) => {
     try {
       const { worldId } = req.params;
       const { bounds } = req.query;
       
       let query = 'SELECT * FROM maps_rivers WHERE world_id = $1';
       let params = [worldId];
       
       if (bounds) {
         const { north, south, east, west } = JSON.parse(bounds);
         query += ` AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
         params.push(west, south, east, north);
       }
       
       const result = await pool.query(query, params);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/maps/:worldId/routes - Get routes for world map  
   app.get('/api/maps/:worldId/routes', async (req, res) => {
     try {
       const { worldId } = req.params;
       const { bounds } = req.query;
       
       let query = 'SELECT * FROM maps_routes WHERE world_id = $1';
       let params = [worldId];
       
       if (bounds) {
         const { north, south, east, west } = JSON.parse(bounds);
         query += ` AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
         params.push(west, south, east, north);
       }
       
       const result = await pool.query(query, params);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

3. **Add location management endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/locations - Create campaign location
   app.post('/api/campaigns/:campaignId/locations', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { name, description, type, world_map_id, world_position, parent_location_id } = req.body;
       
       const result = await pool.query(`
         INSERT INTO locations (campaign_id, name, description, type, world_map_id, world_position, parent_location_id, is_discovered)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, false)
         RETURNING *
       `, [campaignId, name, description, type, world_map_id, 
           world_position?.lng, world_position?.lat, parent_location_id]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/campaigns/:campaignId/locations - Get campaign locations
   app.get('/api/campaigns/:campaignId/locations', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const result = await pool.query(`
         SELECT *, ST_X(world_position) as lng, ST_Y(world_position) as lat
         FROM locations 
         WHERE campaign_id = $1
         ORDER BY name
       `, [campaignId]);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

**Success Criteria:** PostGIS spatial data can be queried via API endpoints with proper geographic filtering

---

### Task 2: Replace Map Viewer with PostGIS Integration
**File:** `/components/map-viewer.tsx`
**Priority:** High - Mapping UI
**Dependencies:** Task 1 complete

1. **Replace hardcoded data with PostGIS queries**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface WorldMap {
     id: string;
     name: string;
     description: string;
     bounds: { north: number; south: number; east: number; west: number };
     layers: { political: boolean; terrain: boolean; rivers: boolean; routes: boolean };
     uploaded_by: string;
     uploaded_by_username?: string;
   }

   interface Burg {
     id: string;
     world_id: string;
     burg_id: number;
     name: string;
     population: number;
     capital: boolean;
     xworld: number;
     yworld: number;
     geom: any;
   }

   interface CampaignLocation {
     id: string;
     campaign_id: string;
     name: string;
     description: string;
     type: 'city' | 'dungeon' | 'wilderness' | 'building' | 'room' | 'landmark';
     lng: number;
     lat: number;
     is_discovered: boolean;
   }

   export default function MapViewer({ campaignId }: { campaignId?: string }) {
     const { user } = useContext(UserContext);
     const [worldMaps, setWorldMaps] = useState<WorldMap[]>([]);
     const [selectedWorldMap, setSelectedWorldMap] = useState<WorldMap | null>(null);
     const [burgs, setBurgs] = useState<Burg[]>([]);
     const [rivers, setRivers] = useState<any[]>([]);
     const [routes, setRoutes] = useState<any[]>([]);
     const [campaignLocations, setCampaignLocations] = useState<CampaignLocation[]>([]);
     const [loading, setLoading] = useState(true);
     const [mapBounds, setMapBounds] = useState<any>(null);
   ```

2. **Implement data loading functions**
   ```typescript
   const loadWorldMaps = async () => {
     try {
       const response = await fetch('/api/maps/world');
       const data = await response.json();
       setWorldMaps(data);
       if (data.length > 0 && !selectedWorldMap) {
         setSelectedWorldMap(data[0]);
       }
     } catch (error) {
       console.error('Failed to load world maps:', error);
     }
   };

   const loadMapData = async (worldMapId: string, bounds?: any) => {
     try {
       setLoading(true);
       const boundsParam = bounds ? `?bounds=${JSON.stringify(bounds)}` : '';
       
       const [burgsRes, riversRes, routesRes] = await Promise.all([
         fetch(`/api/maps/${worldMapId}/burgs${boundsParam}`),
         fetch(`/api/maps/${worldMapId}/rivers${boundsParam}`),
         fetch(`/api/maps/${worldMapId}/routes${boundsParam}`)
       ]);

       const [burgsData, riversData, routesData] = await Promise.all([
         burgsRes.json(),
         riversRes.json(), 
         routesRes.json()
       ]);

       setBurgs(burgsData);
       setRivers(riversData);
       setRoutes(routesData);
     } catch (error) {
       console.error('Failed to load map data:', error);
     } finally {
       setLoading(false);
     }
   };

   const loadCampaignLocations = async () => {
     if (!campaignId) return;
     
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/locations`);
       const data = await response.json();
       setCampaignLocations(data);
     } catch (error) {
       console.error('Failed to load campaign locations:', error);
     }
   };

   useEffect(() => {
     loadWorldMaps();
   }, []);

   useEffect(() => {
     if (selectedWorldMap) {
       loadMapData(selectedWorldMap.id, mapBounds);
     }
   }, [selectedWorldMap, mapBounds]);

   useEffect(() => {
     loadCampaignLocations();
   }, [campaignId]);
   ```

3. **Implement map interaction functions**
   ```typescript
   const handleMapBoundsChange = (newBounds: any) => {
     setMapBounds(newBounds);
     // Reload data when map viewport changes
     if (selectedWorldMap) {
       loadMapData(selectedWorldMap.id, newBounds);
     }
   };

   const addCampaignLocation = async (lat: number, lng: number, locationData: any) => {
     if (!campaignId || !selectedWorldMap) return;

     try {
       const response = await fetch(`/api/campaigns/${campaignId}/locations`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           ...locationData,
           world_map_id: selectedWorldMap.id,
           world_position: { lat, lng }
         })
       });

       if (response.ok) {
         await loadCampaignLocations();
       }
     } catch (error) {
       console.error('Failed to add campaign location:', error);
     }
   };

   const searchNearbyBurgs = async (lat: number, lng: number, radius: number = 50) => {
     if (!selectedWorldMap) return [];

     try {
       const response = await fetch('/api/database/spatial/get_burgs_near_point', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           world_map_id: selectedWorldMap.id,
           lat,
           lng,
           radius_km: radius
         })
       });

       const data = await response.json();
       return data.data || [];
     } catch (error) {
       console.error('Failed to search nearby burgs:', error);
       return [];
     }
   };
   ```

4. **Add layer toggle functionality**
   ```typescript
   const toggleLayer = (layerName: string) => {
     if (!selectedWorldMap) return;

     const updatedLayers = {
       ...selectedWorldMap.layers,
       [layerName]: !selectedWorldMap.layers[layerName]
     };

     setSelectedWorldMap({
       ...selectedWorldMap,
       layers: updatedLayers
     });
   };

   const renderMapLayers = () => {
     if (!selectedWorldMap) return null;

     return (
       <>
         {selectedWorldMap.layers.political && burgs.map(burg => (
           <BurgMarker key={burg.id} burg={burg} />
         ))}
         {selectedWorldMap.layers.rivers && rivers.map(river => (
           <RiverPath key={river.id} river={river} />
         ))}
         {selectedWorldMap.layers.routes && routes.map(route => (
           <RoutePath key={route.id} route={route} />
         ))}
         {campaignLocations.map(location => (
           <CampaignLocationMarker key={location.id} location={location} />
         ))}
       </>
     );
   };
   ```

**Success Criteria:** Map viewer displays real PostGIS world map data with interactive layers and campaign locations

---

### Task 3: Implement Session Management System
**File:** `/server/database-server.js` (extend) and new `/components/session-manager.tsx`
**Priority:** High - Session Foundation
**Dependencies:** Task 2 complete

1. **Add session management API endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/sessions - Create session
   app.post('/api/campaigns/:campaignId/sessions', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { title, summary, dm_notes, scheduled_at } = req.body;
       
       // Get next session number for campaign
       const sessionCountResult = await pool.query(
         'SELECT COALESCE(MAX(session_number), 0) + 1 as next_number FROM sessions WHERE campaign_id = $1',
         [campaignId]
       );
       const sessionNumber = sessionCountResult.rows[0].next_number;

       const result = await pool.query(`
         INSERT INTO sessions (campaign_id, session_number, title, summary, dm_notes, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
         RETURNING *
       `, [campaignId, sessionNumber, title, summary, dm_notes, scheduled_at]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/campaigns/:campaignId/sessions - Get campaign sessions
   app.get('/api/campaigns/:campaignId/sessions', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const result = await pool.query(`
         SELECT s.*, 
                COUNT(sp.user_id) as participant_count
         FROM sessions s
         LEFT JOIN session_participants sp ON s.id = sp.session_id
         WHERE s.campaign_id = $1
         GROUP BY s.id
         ORDER BY s.session_number DESC
       `, [campaignId]);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // PUT /api/sessions/:sessionId - Update session
   app.put('/api/sessions/:sessionId', async (req, res) => {
     try {
       const { sessionId } = req.params;
       const { status, started_at, ended_at, duration, experience_awarded, summary } = req.body;
       
       const result = await pool.query(`
         UPDATE sessions 
         SET status = COALESCE($1, status),
             started_at = COALESCE($2, started_at),
             ended_at = COALESCE($3, ended_at), 
             duration = COALESCE($4, duration),
             experience_awarded = COALESCE($5, experience_awarded),
             summary = COALESCE($6, summary),
             updated_at = NOW()
         WHERE id = $7
         RETURNING *
       `, [status, started_at, ended_at, duration, experience_awarded, summary, sessionId]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // POST /api/sessions/:sessionId/participants - Add session participant
   app.post('/api/sessions/:sessionId/participants', async (req, res) => {
     try {
       const { sessionId } = req.params;
       const { user_id, character_id, character_level_start } = req.body;
       
       await pool.query(`
         INSERT INTO session_participants (session_id, user_id, character_id, character_level_start, character_level_end, attendance_status)
         VALUES ($1, $2, $3, $4, $4, 'present')
         ON CONFLICT (session_id, user_id) DO NOTHING
       `, [sessionId, user_id, character_id, character_level_start]);
       
       res.json({ success: true });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Create session manager component**
   ```typescript
   // File: /components/session-manager.tsx
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface Session {
     id: string;
     campaign_id: string;
     session_number: number;
     title: string;
     summary?: string;
     dm_notes?: string;
     scheduled_at?: string;
     started_at?: string;
     ended_at?: string;
     duration?: number;
     status: 'scheduled' | 'active' | 'completed' | 'cancelled';
     participant_count: number;
     experience_awarded?: number;
   }

   interface SessionParticipant {
     id: string;
     session_id: string;
     user_id: string;
     character_id: string;
     character_name: string;
     username: string;
     character_level_start: number;
     character_level_end: number;
     attendance_status: 'present' | 'absent' | 'late' | 'left_early';
   }

   export default function SessionManager({ campaignId, isDM }: { campaignId: string; isDM: boolean }) {
     const { user } = useContext(UserContext);
     const [sessions, setSessions] = useState<Session[]>([]);
     const [selectedSession, setSelectedSession] = useState<Session | null>(null);
     const [participants, setParticipants] = useState<SessionParticipant[]>([]);
     const [loading, setLoading] = useState(true);
   ```

3. **Implement session management functions**
   ```typescript
   const loadSessions = async () => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/sessions`);
       const data = await response.json();
       setSessions(data);
     } catch (error) {
       console.error('Failed to load sessions:', error);
     } finally {
       setLoading(false);
     }
   };

   const createSession = async (sessionData: Omit<Session, 'id' | 'campaign_id' | 'session_number' | 'participant_count'>) => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/sessions`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(sessionData)
       });

       if (response.ok) {
         await loadSessions();
       }
     } catch (error) {
       console.error('Failed to create session:', error);
     }
   };

   const startSession = async (sessionId: string) => {
     try {
       const response = await fetch(`/api/sessions/${sessionId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           status: 'active',
           started_at: new Date().toISOString()
         })
       });

       if (response.ok) {
         await loadSessions();
       }
     } catch (error) {
       console.error('Failed to start session:', error);
     }
   };

   const endSession = async (sessionId: string, experienceAwarded: number, summary: string) => {
     try {
       const session = sessions.find(s => s.id === sessionId);
       if (!session?.started_at) return;

       const endTime = new Date().toISOString();
       const duration = Math.floor((new Date(endTime).getTime() - new Date(session.started_at).getTime()) / 1000 / 60);

       const response = await fetch(`/api/sessions/${sessionId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           status: 'completed',
           ended_at: endTime,
           duration,
           experience_awarded: experienceAwarded,
           summary
         })
       });

       if (response.ok) {
         await loadSessions();
       }
     } catch (error) {
       console.error('Failed to end session:', error);
     }
   };

   useEffect(() => {
     loadSessions();
   }, [campaignId]);
   ```

**Success Criteria:** Session management system allows DMs to create, start, and end sessions with participant tracking

---

### Task 4: Implement Combat Encounter System
**File:** `/components/combat-tracker.tsx` and server endpoints
**Priority:** High - Combat Foundation  
**Dependencies:** Task 3 complete

1. **Add encounter management API endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/encounters - Create encounter
   app.post('/api/campaigns/:campaignId/encounters', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { name, description, type, difficulty, session_id, location_id } = req.body;
       
       const result = await pool.query(`
         INSERT INTO encounters (campaign_id, session_id, location_id, name, description, type, difficulty, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned')
         RETURNING *
       `, [campaignId, session_id, location_id, name, description, type, difficulty]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // POST /api/encounters/:encounterId/participants - Add encounter participant
   app.post('/api/encounters/:encounterId/participants', async (req, res) => {
     try {
       const { encounterId } = req.params;
       const { participant_id, participant_type, name, hit_points, armor_class } = req.body;
       
       const result = await pool.query(`
         INSERT INTO encounter_participants (encounter_id, participant_id, participant_type, name, hit_points, armor_class)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       `, [encounterId, participant_id, participant_type, name, JSON.stringify(hit_points), armor_class]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // PUT /api/encounters/:encounterId - Update encounter (start combat, advance round)
   app.put('/api/encounters/:encounterId', async (req, res) => {
     try {
       const { encounterId } = req.params;
       const { status, current_round, initiative_order } = req.body;
       
       const result = await pool.query(`
         UPDATE encounters 
         SET status = COALESCE($1, status),
             current_round = COALESCE($2, current_round),
             initiative_order = COALESCE($3, initiative_order),
             updated_at = NOW()
         WHERE id = $4
         RETURNING *
       `, [status, current_round, JSON.stringify(initiative_order), encounterId]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // PUT /api/encounter-participants/:participantId - Update participant HP/conditions
   app.put('/api/encounter-participants/:participantId', async (req, res) => {
     try {
       const { participantId } = req.params;
       const { hit_points, conditions, has_acted, initiative } = req.body;
       
       const result = await pool.query(`
         UPDATE encounter_participants 
         SET hit_points = COALESCE($1, hit_points),
             conditions = COALESCE($2, conditions),
             has_acted = COALESCE($3, has_acted),
             initiative = COALESCE($4, initiative)
         WHERE id = $5
         RETURNING *
       `, [JSON.stringify(hit_points), JSON.stringify(conditions), has_acted, initiative, participantId]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Replace hardcoded combat tracker with database integration**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface Encounter {
     id: string;
     campaign_id: string;
     session_id?: string;
     location_id?: string;
     name: string;
     description: string;
     type: 'combat' | 'social' | 'exploration' | 'puzzle';
     difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
     status: 'planned' | 'active' | 'completed';
     current_round: number;
     initiative_order?: any[];
   }

   interface EncounterParticipant {
     id: string;
     encounter_id: string;
     participant_id: string;
     participant_type: 'character' | 'npc';
     name: string;
     initiative?: number;
     hit_points: { max: number; current: number; temporary: number };
     armor_class: number;
     conditions: string[];
     has_acted: boolean;
   }

   export default function CombatTracker({ 
     campaignId, 
     sessionId, 
     isDM 
   }: { 
     campaignId: string; 
     sessionId?: string; 
     isDM: boolean 
   }) {
     const { user } = useContext(UserContext);
     const [encounters, setEncounters] = useState<Encounter[]>([]);
     const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
     const [participants, setParticipants] = useState<EncounterParticipant[]>([]);
     const [loading, setLoading] = useState(true);
   ```

3. **Implement combat management functions**
   ```typescript
   const createEncounter = async (encounterData: Omit<Encounter, 'id' | 'campaign_id' | 'status' | 'current_round'>) => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/encounters`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ...encounterData, session_id: sessionId })
       });

       if (response.ok) {
         const newEncounter = await response.json();
         setEncounters(prev => [...prev, newEncounter]);
       }
     } catch (error) {
       console.error('Failed to create encounter:', error);
     }
   };

   const addParticipant = async (participantData: {
     participant_id: string;
     participant_type: 'character' | 'npc';
     name: string;
     hit_points: { max: number; current: number; temporary: number };
     armor_class: number;
   }) => {
     if (!activeEncounter) return;

     try {
       const response = await fetch(`/api/encounters/${activeEncounter.id}/participants`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(participantData)
       });

       if (response.ok) {
         const newParticipant = await response.json();
         setParticipants(prev => [...prev, newParticipant]);
       }
     } catch (error) {
       console.error('Failed to add participant:', error);
     }
   };

   const rollInitiative = async () => {
     if (!activeEncounter) return;

     // Roll initiative for all participants
     const initiativeOrder = participants.map(p => ({
       participantId: p.id,
       initiative: Math.floor(Math.random() * 20) + 1, // Simple d20 roll
       hasActed: false
     })).sort((a, b) => b.initiative - a.initiative);

     try {
       const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           status: 'active',
           current_round: 1,
           initiative_order: initiativeOrder
         })
       });

       if (response.ok) {
         const updatedEncounter = await response.json();
         setActiveEncounter(updatedEncounter);
       }
     } catch (error) {
       console.error('Failed to roll initiative:', error);
     }
   };

   const updateParticipantHP = async (participantId: string, newHP: { max: number; current: number; temporary: number }) => {
     try {
       const response = await fetch(`/api/encounter-participants/${participantId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ hit_points: newHP })
       });

       if (response.ok) {
         setParticipants(prev => prev.map(p => 
           p.id === participantId ? { ...p, hit_points: newHP } : p
         ));
       }
     } catch (error) {
       console.error('Failed to update participant HP:', error);
     }
   };

   const addCondition = async (participantId: string, condition: string) => {
     const participant = participants.find(p => p.id === participantId);
     if (!participant) return;

     const newConditions = [...participant.conditions, condition];

     try {
       const response = await fetch(`/api/encounter-participants/${participantId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ conditions: newConditions })
       });

       if (response.ok) {
         setParticipants(prev => prev.map(p => 
           p.id === participantId ? { ...p, conditions: newConditions } : p
         ));
       }
     } catch (error) {
       console.error('Failed to add condition:', error);
     }
   };

   const nextTurn = async () => {
     if (!activeEncounter?.initiative_order) return;

     const currentOrder = [...activeEncounter.initiative_order];
     const currentIndex = currentOrder.findIndex(p => !p.hasActed);
     
     if (currentIndex >= 0) {
       currentOrder[currentIndex].hasActed = true;
       
       // If all participants have acted, advance round
       const allActed = currentOrder.every(p => p.hasActed);
       if (allActed) {
         currentOrder.forEach(p => p.hasActed = false);
         
         const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             current_round: activeEncounter.current_round + 1,
             initiative_order: currentOrder
           })
         });

         if (response.ok) {
           const updated = await response.json();
           setActiveEncounter(updated);
         }
       } else {
         const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ initiative_order: currentOrder })
         });

         if (response.ok) {
           const updated = await response.json();
           setActiveEncounter(updated);
         }
       }
     }
   };
   ```

**Success Criteria:** Combat tracker persists encounter state and supports turn-based combat with HP/condition tracking

---

### Task 5: Implement File Storage System
**File:** `/server/database-server.js` (extend) and new upload middleware
**Priority:** Medium - Asset Management
**Dependencies:** Task 4 complete

1. **Add file upload middleware and endpoints**
   ```javascript
   import multer from 'multer';
   import path from 'path';
   import { promises as fs } from 'fs';

   // Configure multer for file uploads
   const storage = multer.diskStorage({
     destination: async (req, file, cb) => {
       const uploadDir = path.join(process.cwd(), 'uploads');
       await fs.mkdir(uploadDir, { recursive: true });
       cb(null, uploadDir);
     },
     filename: (req, file, cb) => {
       const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
       cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
     }
   });

   const upload = multer({ 
     storage,
     limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
     fileFilter: (req, file, cb) => {
       const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/json'];
       if (allowedTypes.includes(file.mimetype)) {
         cb(null, true);
       } else {
         cb(new Error('Invalid file type'));
       }
     }
   });

   // POST /api/upload/avatar - Upload character/user avatar
   app.post('/api/upload/avatar', upload.single('avatar'), async (req, res) => {
     try {
       if (!req.file) {
         return res.status(400).json({ error: 'No file uploaded' });
       }

       const fileUrl = `/uploads/${req.file.filename}`;
       res.json({ url: fileUrl, filename: req.file.filename });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // POST /api/upload/map - Upload world map file
   app.post('/api/upload/map', upload.single('mapFile'), async (req, res) => {
     try {
       if (!req.file) {
         return res.status(400).json({ error: 'No file uploaded' });
       }

       const { name, description, uploaded_by } = req.body;
       
       // For Azgaar's FMG files, parse the JSON to extract bounds and metadata
       if (req.file.mimetype === 'application/json') {
         const fileContent = await fs.readFile(req.file.path, 'utf8');
         const mapData = JSON.parse(fileContent);
         
         // Extract bounds from Azgaar's format
         const bounds = {
           north: mapData.info?.mapHeight || 100,
           south: 0,
           east: mapData.info?.mapWidth || 100,
           west: 0
         };

         // Create world map record
         const result = await pool.query(`
           INSERT INTO maps_world (name, description, geojson_url, bounds, uploaded_by, file_size)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *
         `, [name, description, `/uploads/${req.file.filename}`, JSON.stringify(bounds), uploaded_by, req.file.size]);

         res.json({ worldMap: result.rows[0], fileUrl: `/uploads/${req.file.filename}` });
       } else {
         // Handle regular image files
         const fileUrl = `/uploads/${req.file.filename}`;
         res.json({ url: fileUrl, filename: req.file.filename });
       }
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /uploads/:filename - Serve uploaded files
   app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
   ```

2. **Add campaign asset management endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/assets - Upload campaign asset
   app.post('/api/campaigns/:campaignId/assets', upload.single('asset'), async (req, res) => {
     try {
       const { campaignId } = req.params;
       
       if (!req.file) {
         return res.status(400).json({ error: 'No file uploaded' });
       }

       const { name, description, type = 'image' } = req.body;
       const fileUrl = `/uploads/${req.file.filename}`;

       // For now, store asset info in campaign's assets array
       // In a full implementation, you'd create a separate assets table
       const result = await pool.query(`
         UPDATE campaigns 
         SET assets = COALESCE(assets, '[]'::jsonb) || $1::jsonb
         WHERE id = $2
         RETURNING assets
       `, [JSON.stringify([{
         id: req.file.filename,
         name,
         description,
         type,
         url: fileUrl,
         size: req.file.size,
         uploadedAt: new Date().toISOString()
       }]), campaignId]);

       res.json({ 
         asset: {
           id: req.file.filename,
           name,
           description, 
           type,
           url: fileUrl,
           size: req.file.size
         }
       });
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/campaigns/:campaignId/assets - Get campaign assets
   app.get('/api/campaigns/:campaignId/assets', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const result = await pool.query('SELECT assets FROM campaigns WHERE id = $1', [campaignId]);
       
       if (result.rows.length === 0) {
         return res.status(404).json({ error: 'Campaign not found' });
       }

       res.json(result.rows[0].assets || []);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

3. **Create file upload components**
   ```typescript
   // File: /components/file-upload.tsx
   import { useState } from 'react';

   interface FileUploadProps {
     endpoint: string;
     acceptedTypes: string[];
     maxSize: number;
     onUploadComplete: (result: any) => void;
     onError: (error: string) => void;
   }

   export default function FileUpload({ 
     endpoint, 
     acceptedTypes, 
     maxSize, 
     onUploadComplete, 
     onError 
   }: FileUploadProps) {
     const [uploading, setUploading] = useState(false);
     const [progress, setProgress] = useState(0);

     const handleFileUpload = async (file: File, additionalData: any = {}) => {
       if (!acceptedTypes.includes(file.type)) {
         onError('Invalid file type');
         return;
       }

       if (file.size > maxSize) {
         onError(`File too large. Maximum size is ${maxSize / 1024 / 1024}MB`);
         return;
       }

       try {
         setUploading(true);
         setProgress(0);

         const formData = new FormData();
         formData.append('file', file);
         
         Object.keys(additionalData).forEach(key => {
           formData.append(key, additionalData[key]);
         });

         const response = await fetch(endpoint, {
           method: 'POST',
           body: formData
         });

         if (!response.ok) {
           throw new Error('Upload failed');
         }

         const result = await response.json();
         onUploadComplete(result);
       } catch (error) {
         onError(error instanceof Error ? error.message : 'Upload failed');
       } finally {
         setUploading(false);
         setProgress(0);
       }
     };

     return (
       <div className="file-upload">
         <input
           type="file"
           accept={acceptedTypes.join(',')}
           onChange={(e) => {
             const file = e.target.files?.[0];
             if (file) {
               handleFileUpload(file);
             }
           }}
           disabled={uploading}
         />
         {uploading && (
           <div className="upload-progress">
             <div>Uploading... {Math.round(progress)}%</div>
           </div>
         )}
       </div>
     );
   }
   ```

**Success Criteria:** File upload system supports avatars, map files, and campaign assets with proper storage and retrieval

---

### Task 6: Connect Journals to Session System
**File:** `/components/journals.tsx`
**Priority:** Medium - Session Integration
**Dependencies:** Task 5 complete

1. **Replace hardcoded journals with session data**
   ```typescript
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface JournalEntry {
     id: string;
     session_id: string;
     session_number: number;
     session_title: string;
     summary?: string;
     date: string;
     duration?: number;
     experience_awarded?: number;
     participants: string[];
     locations_visited: string[];
     npcs_encountered: string[];
     treasure_found: any[];
   }

   export default function Journals({ campaignId }: { campaignId: string }) {
     const { user } = useContext(UserContext);
     const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
     const [loading, setLoading] = useState(true);
     const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
   ```

2. **Implement journal data loading**
   ```typescript
   const loadJournalEntries = async () => {
     try {
       // Load completed sessions as journal entries
       const response = await fetch(`/api/campaigns/${campaignId}/sessions`);
       const sessions = await response.json();
       
       const completedSessions = sessions
         .filter((s: any) => s.status === 'completed')
         .map((s: any) => ({
           id: s.id,
           session_id: s.id,
           session_number: s.session_number,
           session_title: s.title,
           summary: s.summary,
           date: s.ended_at || s.started_at || s.created_at,
           duration: s.duration,
           experience_awarded: s.experience_awarded,
           participants: [], // Would need to join with session_participants
           locations_visited: [], // Would need session-location tracking
           npcs_encountered: [], // Would need session-npc tracking
           treasure_found: s.treasure_awarded || []
         }));

       setJournalEntries(completedSessions);
     } catch (error) {
       console.error('Failed to load journal entries:', error);
     } finally {
       setLoading(false);
     }
   };

   useEffect(() => {
     loadJournalEntries();
   }, [campaignId]);
   ```

3. **Add journal entry creation from sessions**
   ```typescript
   const createJournalEntry = async (sessionId: string, journalData: {
     personal_notes?: string;
     favorite_moments?: string;
     character_thoughts?: string;
   }) => {
     try {
       // Store personal journal data (could be in a separate user_journal_entries table)
       const response = await fetch(`/api/sessions/${sessionId}/journal`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ...journalData, user_id: user.id })
       });

       if (response.ok) {
         await loadJournalEntries();
       }
     } catch (error) {
       console.error('Failed to create journal entry:', error);
     }
   };

   const updateJournalEntry = async (entryId: string, updates: any) => {
     try {
       const response = await fetch(`/api/journal-entries/${entryId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(updates)
       });

       if (response.ok) {
         await loadJournalEntries();
       }
     } catch (error) {
       console.error('Failed to update journal entry:', error);
     }
   };
   ```

4. **Add session summary views**
   ```typescript
   const renderSessionSummary = (entry: JournalEntry) => {
     return (
       <div className="session-summary">
         <h3>Session {entry.session_number}: {entry.session_title}</h3>
         <div className="session-meta">
           <span>Date: {new Date(entry.date).toLocaleDateString()}</span>
           {entry.duration && <span>Duration: {entry.duration} minutes</span>}
           {entry.experience_awarded && <span>XP Awarded: {entry.experience_awarded}</span>}
         </div>
         
         <div className="session-content">
           <h4>Session Summary</h4>
           <p>{entry.summary || 'No summary available'}</p>
           
           {entry.locations_visited.length > 0 && (
             <div>
               <h4>Locations Visited</h4>
               <ul>
                 {entry.locations_visited.map(location => (
                   <li key={location}>{location}</li>
                 ))}
               </ul>
             </div>
           )}
           
           {entry.npcs_encountered.length > 0 && (
             <div>
               <h4>NPCs Encountered</h4>
               <ul>
                 {entry.npcs_encountered.map(npc => (
                   <li key={npc}>{npc}</li>
                 ))}
               </ul>
             </div>
           )}
           
           {entry.treasure_found.length > 0 && (
             <div>
               <h4>Treasure Found</h4>
               <ul>
                 {entry.treasure_found.map((item, index) => (
                   <li key={index}>{item.name} - {item.description}</li>
                 ))}
               </ul>
             </div>
           )}
         </div>
       </div>
     );
   };
   ```

**Success Criteria:** Journal entries are generated from completed sessions and display session data accurately

---

### Task 7: Implement NPC Management System
**Files:** `/server/database-server.js` (extend) and new `/components/npc-manager.tsx`
**Priority:** Medium - Campaign Content
**Dependencies:** Task 6 complete

1. **Add NPC management API endpoints**
   ```javascript
   // POST /api/campaigns/:campaignId/npcs - Create NPC
   app.post('/api/campaigns/:campaignId/npcs', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const { name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, stats } = req.body;
       
       const result = await pool.query(`
         INSERT INTO npcs (campaign_id, name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, stats)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *
       `, [campaignId, name, description, race, occupation, personality, appearance, motivations, secrets, current_location_id, JSON.stringify(stats)]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // GET /api/campaigns/:campaignId/npcs - Get campaign NPCs
   app.get('/api/campaigns/:campaignId/npcs', async (req, res) => {
     try {
       const { campaignId } = req.params;
       const result = await pool.query(`
         SELECT n.*, l.name as location_name
         FROM npcs n
         LEFT JOIN locations l ON n.current_location_id = l.id
         WHERE n.campaign_id = $1
         ORDER BY n.name
       `, [campaignId]);
       res.json(result.rows);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // PUT /api/npcs/:npcId - Update NPC
   app.put('/api/npcs/:npcId', async (req, res) => {
     try {
       const { npcId } = req.params;
       const updates = req.body;
       
       // Build dynamic update query
       const fields = [];
       const values = [];
       let paramIndex = 1;

       Object.keys(updates).forEach(key => {
         if (key !== 'id' && key !== 'created_at') {
           fields.push(`${key} = $${paramIndex++}`);
           values.push(typeof updates[key] === 'object' ? JSON.stringify(updates[key]) : updates[key]);
         }
       });

       if (fields.length === 0) {
         return res.status(400).json({ error: 'No valid fields to update' });
       }

       fields.push('updated_at = NOW()');
       values.push(npcId);

       const result = await pool.query(
         `UPDATE npcs SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
         values
       );
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // POST /api/npcs/:npcId/relationships - Add NPC relationship
   app.post('/api/npcs/:npcId/relationships', async (req, res) => {
     try {
       const { npcId } = req.params;
       const { target_id, target_type, relationship_type, description, strength } = req.body;
       
       const result = await pool.query(`
         INSERT INTO npc_relationships (npc_id, target_id, target_type, relationship_type, description, strength)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (npc_id, target_id) DO UPDATE SET
         relationship_type = EXCLUDED.relationship_type,
         description = EXCLUDED.description,
         strength = EXCLUDED.strength
         RETURNING *
       `, [npcId, target_id, target_type, relationship_type, description, strength]);
       
       res.json(result.rows[0]);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Create NPC manager component**
   ```typescript
   // File: /components/npc-manager.tsx
   import { useState, useEffect, useContext } from 'react';
   import { UserContext } from '../App';

   interface NPC {
     id: string;
     campaign_id: string;
     name: string;
     description: string;
     race: string;
     occupation?: string;
     personality: string;
     appearance?: string;
     motivations?: string;
     secrets?: string;
     current_location_id?: string;
     location_name?: string;
     avatar_url?: string;
     stats?: NPCStats;
     created_at: string;
     updated_at: string;
   }

   interface NPCStats {
     armor_class: number;
     hit_points: { max: number; current: number };
     speed: number;
     abilities: {
       strength: number;
       dexterity: number;
       constitution: number;
       intelligence: number;
       wisdom: number;
       charisma: number;
     };
     challenge_rating: number;
     actions: NPCAction[];
   }

   interface NPCAction {
     name: string;
     description: string;
     type: 'action' | 'bonus_action' | 'reaction' | 'legendary';
     recharge?: string;
   }

   export default function NPCManager({ campaignId, isDM }: { campaignId: string; isDM: boolean }) {
     const { user } = useContext(UserContext);
     const [npcs, setNpcs] = useState<NPC[]>([]);
     const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null);
     const [locations, setLocations] = useState<any[]>([]);
     const [loading, setLoading] = useState(true);
   ```

3. **Implement NPC management functions**
   ```typescript
   const loadNPCs = async () => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/npcs`);
       const data = await response.json();
       setNpcs(data);
     } catch (error) {
       console.error('Failed to load NPCs:', error);
     }
   };

   const loadLocations = async () => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/locations`);
       const data = await response.json();
       setLocations(data);
     } catch (error) {
       console.error('Failed to load locations:', error);
     }
   };

   const createNPC = async (npcData: Omit<NPC, 'id' | 'campaign_id' | 'created_at' | 'updated_at'>) => {
     try {
       const response = await fetch(`/api/campaigns/${campaignId}/npcs`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(npcData)
       });

       if (response.ok) {
         await loadNPCs();
       }
     } catch (error) {
       console.error('Failed to create NPC:', error);
     }
   };

   const updateNPC = async (npcId: string, updates: Partial<NPC>) => {
     try {
       const response = await fetch(`/api/npcs/${npcId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(updates)
       });

       if (response.ok) {
         await loadNPCs();
       }
     } catch (error) {
       console.error('Failed to update NPC:', error);
     }
   };

   const addRelationship = async (npcId: string, relationshipData: {
     target_id: string;
     target_type: 'npc' | 'character';
     relationship_type: 'ally' | 'enemy' | 'neutral' | 'romantic' | 'family' | 'business';
     description: string;
     strength: number;
   }) => {
     try {
       const response = await fetch(`/api/npcs/${npcId}/relationships`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(relationshipData)
       });

       if (response.ok) {
         // Refresh NPC data to show new relationship
         await loadNPCs();
       }
     } catch (error) {
       console.error('Failed to add relationship:', error);
     }
   };

   useEffect(() => {
     Promise.all([loadNPCs(), loadLocations()])
       .finally(() => setLoading(false));
   }, [campaignId]);
   ```

**Success Criteria:** NPC management system allows creation and editing of NPCs with location tracking and relationship management

---

### Task 8: Add Advanced Error Handling and Performance Optimization
**Files:** All components and server
**Priority:** Medium - Reliability
**Dependencies:** Task 7 complete

1. **Implement comprehensive error boundaries**
   ```typescript
   // File: /components/error-boundary.tsx
   import React from 'react';

   interface ErrorBoundaryState {
     hasError: boolean;
     error?: Error;
     errorInfo?: React.ErrorInfo;
   }

   export class ErrorBoundary extends React.Component<
     React.PropsWithChildren<{}>,
     ErrorBoundaryState
   > {
     constructor(props: React.PropsWithChildren<{}>) {
       super(props);
       this.state = { hasError: false };
     }

     static getDerivedStateFromError(error: Error): ErrorBoundaryState {
       return {
         hasError: true,
         error
       };
     }

     componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
       console.error('Error Boundary caught an error:', error, errorInfo);
       this.setState({ error, errorInfo });
     }

     render() {
       if (this.state.hasError) {
         return (
           <div className="error-boundary">
             <h2>Something went wrong</h2>
             <details style={{ whiteSpace: 'pre-wrap' }}>
               <summary>Error Details</summary>
               {this.state.error && this.state.error.toString()}
               <br />
               {this.state.errorInfo.componentStack}
             </details>
             <button onClick={() => this.setState({ hasError: false })}>
               Try Again
             </button>
           </div>
         );
       }

       return this.props.children;
     }
   }
   ```

2. **Add database connection pooling optimization**
   ```javascript
   // File: /server/database-server.js (enhance existing pool)
   
   // Enhanced pool configuration with better error handling
   const pool = new Pool({
     host: process.env.DATABASE_HOST || 'localhost',
     port: parseInt(process.env.DATABASE_PORT || '5432', 10),
     database: process.env.DATABASE_NAME || process.env.PGDATABASE || 'dnd_app',
     user: process.env.DATABASE_USER || process.env.PGUSER || process.env.USER,
     password: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || '',
     ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
     
     // Optimized pool settings
     max: 20,                    // Maximum connections
     min: 2,                     // Minimum connections
     idleTimeoutMillis: 30000,   // 30 seconds
     connectionTimeoutMillis: 5000, // 5 seconds
     acquireTimeoutMillis: 10000,   // 10 seconds
     
     // Query timeout
     query_timeout: 30000,       // 30 seconds
     
     // Enable connection validation
     allowExitOnIdle: true
   });

   // Pool event handlers for monitoring
   pool.on('connect', (client) => {
     console.log('[Database] Client connected to pool');
   });

   pool.on('error', (err, client) => {
     console.error('[Database] Pool error:', err);
   });

   pool.on('remove', (client) => {
     console.log('[Database] Client removed from pool');
   });

   // Enhanced query wrapper with retries
   const queryWithRetry = async (text, params, maxRetries = 3) => {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
         const start = Date.now();
         const result = await pool.query(text, params);
         const duration = Date.now() - start;
         
         if (duration > 1000) {
           console.warn(`[Database] Slow query (${duration}ms):`, text.substring(0, 100));
         }
         
         return result;
       } catch (error) {
         console.error(`[Database] Query attempt ${attempt} failed:`, error.message);
         
         if (attempt === maxRetries) {
           throw error;
         }
         
         // Wait before retry (exponential backoff)
         await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
       }
     }
   };
   ```

3. **Add request caching and rate limiting**
   ```javascript
   import NodeCache from 'node-cache';
   import rateLimit from 'express-rate-limit';

   // Cache for frequently accessed data
   const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes default TTL

   // Rate limiting
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100, // Limit each IP to 100 requests per windowMs
     message: 'Too many requests from this IP',
     standardHeaders: true,
     legacyHeaders: false,
   });

   app.use('/api', limiter);

   // Caching middleware
   const cacheMiddleware = (ttl = 300) => (req, res, next) => {
     const key = req.originalUrl;
     const cached = cache.get(key);
     
     if (cached) {
       return res.json(cached);
     }
     
     // Override res.json to cache the response
     const originalJson = res.json.bind(res);
     res.json = function(data) {
       cache.set(key, data, ttl);
       return originalJson(data);
     };
     
     next();
   };

   // Apply caching to frequently accessed endpoints
   app.get('/api/campaigns/:campaignId/npcs', cacheMiddleware(600), async (req, res) => {
     // Existing NPC loading code
   });

   app.get('/api/maps/world', cacheMiddleware(1800), async (req, res) => {
     // Existing world map loading code
   });
   ```

4. **Add performance monitoring**
   ```typescript
   // File: /utils/performance.tsx
   export class PerformanceMonitor {
     private static timers = new Map<string, number>();

     static startTimer(label: string) {
       this.timers.set(label, performance.now());
     }

     static endTimer(label: string): number {
       const start = this.timers.get(label);
       if (!start) return 0;
       
       const duration = performance.now() - start;
       this.timers.delete(label);
       
       if (duration > 1000) {
         console.warn(`[Performance] Slow operation "${label}": ${duration.toFixed(2)}ms`);
       }
       
       return duration;
     }

     static measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
       this.startTimer(label);
       return fn().finally(() => {
         this.endTimer(label);
       });
     }
   }

   // Hook for measuring component render times
   export const usePerformanceMonitor = (componentName: string) => {
     useEffect(() => {
       PerformanceMonitor.startTimer(`${componentName}-mount`);
       
       return () => {
         PerformanceMonitor.endTimer(`${componentName}-mount`);
       };
     }, [componentName]);
   };
   ```

**Success Criteria:** Application has robust error handling, optimized database performance, and performance monitoring in place

---

### Task 9: Implement WebSocket Support for Real-time Features
**File:** `/server/database-server.js` (extend) and WebSocket client
**Priority:** High - Real-time Collaboration
**Dependencies:** Task 8 complete

1. **Add WebSocket server integration**
   ```javascript
   import { WebSocketServer } from 'ws';
   import { createServer } from 'http';

   // Create HTTP server for both Express and WebSocket
   const server = createServer(app);
   const wss = new WebSocketServer({ server, path: '/ws' });

   // WebSocket connection management
   const connections = new Map();
   const campaignRooms = new Map();

   wss.on('connection', (ws, req) => {
     const url = new URL(req.url, `http://${req.headers.host}`);
     const token = url.searchParams.get('token');
     const campaignId = url.searchParams.get('campaignId');
     
     // Validate connection (implement proper auth)
     if (!token || !campaignId) {
       ws.close(1008, 'Missing authentication or campaign ID');
       return;
     }

     const connectionId = Date.now() + '-' + Math.random();
     connections.set(connectionId, { ws, campaignId, userId: token });
     
     // Add to campaign room
     if (!campaignRooms.has(campaignId)) {
       campaignRooms.set(campaignId, new Set());
     }
     campaignRooms.get(campaignId).add(connectionId);

     console.log(`[WebSocket] Client connected to campaign ${campaignId}`);

     ws.on('message', async (data) => {
       try {
         const message = JSON.parse(data.toString());
         await handleWebSocketMessage(connectionId, message);
       } catch (error) {
         console.error('[WebSocket] Message handling error:', error);
         ws.send(JSON.stringify({ type: 'error', message: error.message }));
       }
     });

     ws.on('close', () => {
       console.log(`[WebSocket] Client disconnected from campaign ${campaignId}`);
       connections.delete(connectionId);
       if (campaignRooms.has(campaignId)) {
         campaignRooms.get(campaignId).delete(connectionId);
       }
     });

     // Send welcome message
     ws.send(JSON.stringify({ 
       type: 'connected', 
       message: 'Connected to campaign chat',
       campaignId 
     }));
   });

   // Handle different WebSocket message types
   const handleWebSocketMessage = async (connectionId, message) => {
     const connection = connections.get(connectionId);
     if (!connection) return;

     const { type, data } = message;

     switch (type) {
       case 'chat_message':
         await handleChatMessage(connection, data);
         break;
       case 'combat_update':
         await handleCombatUpdate(connection, data);
         break;
       case 'character_update':
         await handleCharacterUpdate(connection, data);
         break;
       default:
         connection.ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
     }
   };

   // Chat message handler
   const handleChatMessage = async (connection, data) => {
     try {
       // Save message to database
       const result = await pool.query(`
         INSERT INTO chat_messages (campaign_id, content, message_type, sender_id, sender_name, character_id, dice_roll)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *
       `, [connection.campaignId, data.content, data.type, connection.userId, data.sender_name, data.character_id, JSON.stringify(data.dice_roll)]);

       // Broadcast to all campaign members
       const savedMessage = result.rows[0];
       broadcastToCampaign(connection.campaignId, {
         type: 'new_message',
         data: savedMessage
       });
     } catch (error) {
       connection.ws.send(JSON.stringify({ type: 'error', message: 'Failed to send message' }));
     }
   };

   // Combat update handler
   const handleCombatUpdate = async (connection, data) => {
     try {
       // Update encounter in database
       await pool.query(`
         UPDATE encounters 
         SET current_round = $1, initiative_order = $2, updated_at = NOW()
         WHERE id = $3
       `, [data.current_round, JSON.stringify(data.initiative_order), data.encounter_id]);

       // Broadcast combat state to campaign
       broadcastToCampaign(connection.campaignId, {
         type: 'combat_update',
         data: data
       });
     } catch (error) {
       connection.ws.send(JSON.stringify({ type: 'error', message: 'Failed to update combat' }));
     }
   };

   // Broadcast message to all connections in a campaign
   const broadcastToCampaign = (campaignId, message) => {
     const room = campaignRooms.get(campaignId);
     if (!room) return;

     room.forEach(connectionId => {
       const connection = connections.get(connectionId);
       if (connection && connection.ws.readyState === 1) {
         connection.ws.send(JSON.stringify(message));
       }
     });
   };

   // Update server to use HTTP server
   server.listen(port, () => {
     console.log(`Server running on port ${port}`);
     console.log(`WebSocket available at ws://localhost:${port}/ws`);
   });
   ```

2. **Create WebSocket client hook**
   ```typescript
   // File: /hooks/useWebSocket.tsx
   import { useEffect, useRef, useState, useContext } from 'react';
   import { UserContext } from '../App';

   interface WebSocketMessage {
     type: string;
     data?: any;
     message?: string;
   }

   export const useWebSocket = (campaignId: string) => {
     const { user } = useContext(UserContext);
     const ws = useRef<WebSocket | null>(null);
     const [connected, setConnected] = useState(false);
     const [messages, setMessages] = useState<WebSocketMessage[]>([]);

     useEffect(() => {
       if (!campaignId || !user) return;

       const wsUrl = `ws://localhost:3001/ws?token=${user.id}&campaignId=${campaignId}`;
       ws.current = new WebSocket(wsUrl);

       ws.current.onopen = () => {
         console.log('[WebSocket] Connected');
         setConnected(true);
       };

       ws.current.onmessage = (event) => {
         const message = JSON.parse(event.data);
         setMessages(prev => [...prev, message]);
       };

       ws.current.onclose = () => {
         console.log('[WebSocket] Disconnected');
         setConnected(false);
       };

       ws.current.onerror = (error) => {
         console.error('[WebSocket] Error:', error);
         setConnected(false);
       };

       return () => {
         if (ws.current) {
           ws.current.close();
         }
       };
     }, [campaignId, user]);

     const sendMessage = (type: string, data: any) => {
       if (ws.current && connected) {
         ws.current.send(JSON.stringify({ type, data }));
       }
     };

     const sendChatMessage = (content: string, messageType: string, characterId?: string, diceRoll?: any) => {
       sendMessage('chat_message', {
         content,
         type: messageType,
         sender_name: user?.username,
         character_id: characterId,
         dice_roll: diceRoll
       });
     };

     const updateCombat = (encounterId: string, currentRound: number, initiativeOrder: any[]) => {
       sendMessage('combat_update', {
         encounter_id: encounterId,
         current_round: currentRound,
         initiative_order: initiativeOrder
       });
     };

     return {
       connected,
       messages,
       sendMessage,
       sendChatMessage,
       updateCombat
     };
   };
   ```

3. **Update chat system to use WebSocket**
   ```typescript
   // File: /components/chat-system.tsx (update existing)
   import { useWebSocket } from '../hooks/useWebSocket';

   export default function ChatSystem({ campaignId }: { campaignId: string }) {
     const { connected, messages, sendChatMessage } = useWebSocket(campaignId);
     const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

     // Listen for new messages from WebSocket
     useEffect(() => {
       const newChatMessages = messages.filter(m => m.type === 'new_message');
       if (newChatMessages.length > 0) {
         const latestMessage = newChatMessages[newChatMessages.length - 1];
         setChatMessages(prev => [...prev, latestMessage.data]);
       }
     }, [messages]);

     const sendMessage = () => {
       if (!newMessage.trim()) return;
       
       sendChatMessage(newMessage, 'text', selectedCharacter);
       setNewMessage('');
     };

     const rollDice = (diceExpression: string) => {
       const rollResult = evaluateDiceExpression(diceExpression);
       sendChatMessage(`rolled ${diceExpression}`, 'dice_roll', selectedCharacter, rollResult);
     };

     return (
       <div className="chat-system">
         <div className="connection-status">
           {connected ? '🟢 Connected' : '🔴 Disconnected'}
         </div>
         {/* Rest of chat UI */}
       </div>
     );
   }
   ```

**Success Criteria:** WebSocket integration provides real-time chat and combat updates across all connected users

---

### Task 10: Final Integration Testing and Documentation
**Files:** Multiple test files and documentation
**Priority:** Medium - Quality Assurance
**Dependencies:** Task 9 complete

1. **Create comprehensive integration tests**
   ```typescript
   // File: /tests/integration.test.ts
   import { describe, test, expect, beforeAll, afterAll } from 'vitest';

   describe('Phase 3 Integration Tests', () => {
     let server: any;
     let campaignId: string;
     let sessionId: string;
     let encounterId: string;

     beforeAll(async () => {
       // Setup test database and server
     });

     afterAll(async () => {
       // Cleanup test data
     });

     test('PostGIS world map integration', async () => {
       // Test world map loading and spatial queries
       const response = await fetch('/api/maps/world');
       const maps = await response.json();
       expect(maps).toBeDefined();

       if (maps.length > 0) {
         const burgsResponse = await fetch(`/api/maps/${maps[0].id}/burgs`);
         const burgs = await burgsResponse.json();
         expect(burgs).toBeInstanceOf(Array);
       }
     });

     test('Session management workflow', async () => {
       // Test session creation
       const sessionData = {
         title: 'Test Session',
         summary: 'Integration test session',
         scheduled_at: new Date().toISOString()
       };

       const createResponse = await fetch(`/api/campaigns/${campaignId}/sessions`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(sessionData)
       });

       expect(createResponse.ok).toBe(true);
       const session = await createResponse.json();
       sessionId = session.id;

       // Test session start
       const startResponse = await fetch(`/api/sessions/${sessionId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ status: 'active', started_at: new Date().toISOString() })
       });

       expect(startResponse.ok).toBe(true);
     });

     test('Combat encounter workflow', async () => {
       // Test encounter creation
       const encounterData = {
         name: 'Test Encounter',
         description: 'Integration test combat',
         type: 'combat',
         difficulty: 'medium',
         session_id: sessionId
       };

       const createResponse = await fetch(`/api/campaigns/${campaignId}/encounters`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(encounterData)
       });

       expect(createResponse.ok).toBe(true);
       const encounter = await createResponse.json();
       encounterId = encounter.id;

       // Test participant addition
       const participantData = {
         participant_id: 'test-character-id',
         participant_type: 'character',
         name: 'Test Character',
         hit_points: { max: 25, current: 25, temporary: 0 },
         armor_class: 15
       };

       const participantResponse = await fetch(`/api/encounters/${encounterId}/participants`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(participantData)
       });

       expect(participantResponse.ok).toBe(true);
     });

     test('File upload functionality', async () => {
       const formData = new FormData();
       const testFile = new Blob(['test image data'], { type: 'image/png' });
       formData.append('avatar', testFile, 'test-avatar.png');

       const response = await fetch('/api/upload/avatar', {
         method: 'POST',
         body: formData
       });

       expect(response.ok).toBe(true);
       const result = await response.json();
       expect(result.url).toBeDefined();
     });

     test('NPC management integration', async () => {
       const npcData = {
         name: 'Test NPC',
         description: 'Integration test NPC',
         race: 'Human',
         occupation: 'Merchant',
         personality: 'Friendly and talkative'
       };

       const response = await fetch(`/api/campaigns/${campaignId}/npcs`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(npcData)
       });

       expect(response.ok).toBe(true);
       const npc = await response.json();
       expect(npc.name).toBe('Test NPC');
     });
   });
   ```

2. **Update comprehensive documentation**
   ```markdown
   <!-- File: /docs/PHASE_3_FEATURES.md -->
   # Phase 3 Features Documentation

   ## PostGIS World Map Integration

   ### API Endpoints
   - `GET /api/maps/world` - List all world maps
   - `GET /api/maps/:worldId/burgs` - Get burgs with spatial filtering
   - `GET /api/maps/:worldId/rivers` - Get rivers in bounds
   - `GET /api/maps/:worldId/routes` - Get routes in bounds
   - `POST /api/campaigns/:campaignId/locations` - Create campaign locations

   ### Usage Examples
   ```typescript
   // Load burgs near a point
   const nearbyBurgs = await fetch('/api/database/spatial/get_burgs_near_point', {
     method: 'POST',
     body: JSON.stringify({ world_map_id: 'uuid', lat: 45.0, lng: -93.0, radius_km: 50 })
   });
   ```

   ## Session Management System

   ### Workflow
   1. DM creates session with `POST /api/campaigns/:campaignId/sessions`
   2. Players join session automatically when campaign starts
   3. DM starts session with `PUT /api/sessions/:sessionId` (status: 'active')
   4. Session tracks encounters, experience, and duration
   5. DM ends session with final summary and experience awards

   ### Journal Integration
   - Completed sessions automatically appear in player journals
   - Players can add personal notes and reflections
   - Session summaries include locations visited, NPCs encountered, treasure found

   ## Combat Encounter System

   ### Features
   - Persistent encounter state across page refreshes
   - Initiative tracking with round management
   - HP and condition tracking for all participants
   - Real-time updates via WebSocket

   ### API Endpoints
   - `POST /api/campaigns/:campaignId/encounters` - Create encounter
   - `POST /api/encounters/:encounterId/participants` - Add participant
   - `PUT /api/encounters/:encounterId` - Update encounter state
   - `PUT /api/encounter-participants/:participantId` - Update participant

   ## File Storage System

   ### Supported File Types
   - **Avatars**: JPEG, PNG, WebP (max 5MB)
   - **World Maps**: JSON (Azgaar's FMG format), PNG, JPEG (max 50MB)
   - **Campaign Assets**: Images, documents (max 25MB)

   ### Upload Endpoints
   - `POST /api/upload/avatar` - Upload user/character avatar
   - `POST /api/upload/map` - Upload world map file
   - `POST /api/campaigns/:campaignId/assets` - Upload campaign asset

   ## WebSocket Real-time Features

   ### Connection
   ```typescript
   const ws = new WebSocket('ws://localhost:3001/ws?token=USER_ID&campaignId=CAMPAIGN_ID');
   ```

   ### Message Types
   - `chat_message` - Real-time chat messages
   - `combat_update` - Combat state changes
   - `character_update` - Character changes
   - `session_update` - Session status changes

   ## Performance Optimizations

   ### Database
   - Connection pooling with retry logic
   - Query caching for frequently accessed data
   - Slow query logging and monitoring

   ### Frontend
   - Error boundaries for component isolation
   - Performance monitoring for slow operations
   - Optimized re-rendering with proper dependency arrays

   ### Server
   - Rate limiting on API endpoints
   - Gzip compression for responses
   - Static file serving optimization
   ```

3. **Create deployment guide**
   ```markdown
   <!-- File: /docs/DEPLOYMENT.md -->
   # Phase 3 Deployment Guide

   ## Prerequisites
   - PostgreSQL 17+ with PostGIS extension
   - Node.js 18+
   - 2GB+ RAM for optimal performance
   - 10GB+ disk space for file uploads

   ## Environment Variables
   ```bash
   # Database
   DATABASE_HOST=localhost
   DATABASE_PORT=5432
   DATABASE_NAME=dnd_app
   DATABASE_USER=your_username
   DATABASE_PASSWORD=your_password

   # Server
   DATABASE_SERVER_PORT=3001
   FRONTEND_URL=http://localhost:3000

   # File Storage
   UPLOAD_DIR=/path/to/uploads
   MAX_FILE_SIZE=52428800  # 50MB in bytes

   # WebSocket
   WS_ENABLED=true
   ```

   ## Database Setup
   ```sql
   -- Create database
   CREATE DATABASE dnd_app;

   -- Enable extensions
   \c dnd_app;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS postgis;

   -- Import schema
   \i database/schema.sql
   ```

   ## Production Considerations
   - Use environment variables for all configuration
   - Enable SSL in production
   - Set up database backups
   - Configure reverse proxy (nginx/Apache)
   - Set up monitoring and logging
   - Use PM2 or similar for process management
   ```

**Success Criteria:** Complete integration test suite passes, comprehensive documentation is available, deployment guide is functional

---

## Phase 3 Completion Criteria

### Functional Requirements Met:
- ✅ PostGIS world map integration with spatial queries
- ✅ Session management system with participant tracking  
- ✅ Combat encounter system with persistent state
- ✅ File storage system for avatars, maps, and assets
- ✅ NPC management with relationship tracking
- ✅ Journal system connected to completed sessions
- ✅ WebSocket real-time collaboration features
- ✅ Performance optimizations and error handling
- ✅ Comprehensive testing and documentation

### Technical Requirements Met:
- ✅ PostGIS spatial functions integrated with frontend
- ✅ Session workflow from creation to completion
- ✅ Combat state persistence across page refreshes
- ✅ File upload and storage with proper validation
- ✅ Real-time updates via WebSocket connections
- ✅ Database performance optimization with caching
- ✅ Error boundaries and robust error handling

### Success Validation:
1. DMs can upload world maps and create campaign locations
2. Sessions can be created, started, and completed with full tracking
3. Combat encounters persist state and update in real-time
4. File uploads work for avatars, maps, and campaign assets
5. NPCs can be created and managed with location tracking
6. Journal entries are automatically generated from completed sessions
7. Real-time chat and combat updates work across multiple users
8. Application handles errors gracefully and performs well under load
9. Full integration test suite passes
10. Documentation is comprehensive and deployment guide works

**Ready for Phase 4:** Final polish, security hardening, and production deployment