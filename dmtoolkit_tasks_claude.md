# DM Toolkit Integration Task List

This document provides a detailed, sequential task breakdown for integrating the DM Toolkit Campaign Manager into the existing Questables system. Each task is designed to be handled independently while maintaining strict adherence to AGENTS.md principles and the Zero-Dummy Policy.

## Prerequisites & Environment

- PostgreSQL 17 + PostGIS running on localhost
- Database credentials configured in `.env.local`
- All geometries must use SRID 0 (unitless/pixel-space)
- Express API server on port 3001
- Authentication system (`requireAuth`, `requireRole`) operational
- Existing schema tables: `campaigns`, `sessions`, `npcs`, `locations`, etc.

---

## MILESTONE M0: FOUNDATIONS - DATABASE MIGRATIONS & API STUBS

### Task M0-01: Database Schema Extensions
**Adherence to AGENTS.md:** No dummy data, verify against live database, update schema.sql
**Prerequisites:** PostgreSQL running, schema.sql current
**Exact Implementation:**
1. Add unique constraint for campaign names per DM:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_name_per_dm
     ON public.campaigns (dm_user_id, lower(name));
   ```
2. Create `campaign_spawns` table:
   ```sql
   CREATE TABLE IF NOT EXISTS public.campaign_spawns (
     id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
     campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
     name TEXT NOT NULL DEFAULT 'Default Spawn',
     note TEXT,
     world_position geometry(Point, 0) NOT NULL,
     is_default BOOLEAN DEFAULT true,
     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
     updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_spawns_default
     ON public.campaign_spawns (campaign_id) WHERE is_default = true;
   ```
3. Create `campaign_objectives` table:
   ```sql
   CREATE TABLE IF NOT EXISTS public.campaign_objectives (
     id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
     campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
     parent_id UUID REFERENCES public.campaign_objectives(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     description_md TEXT,
     location_type TEXT CHECK (location_type IN ('pin','burg','marker')),
     location_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL,
     location_marker_id UUID REFERENCES public.maps_markers(id) ON DELETE SET NULL,
     location_pin geometry(Point, 0),
     treasure_md TEXT,
     combat_md TEXT,
     npcs_md TEXT,
     rumours_md TEXT,
     order_index INTEGER DEFAULT 0,
     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
     updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_objectives_campaign ON public.campaign_objectives(campaign_id);
   CREATE INDEX IF NOT EXISTS idx_objectives_parent ON public.campaign_objectives(parent_id);
   CREATE INDEX IF NOT EXISTS idx_objectives_pin_gix ON public.campaign_objectives USING GIST(location_pin);
   ```
4. Add session DM fields:
   ```sql
   ALTER TABLE public.sessions
     ADD COLUMN IF NOT EXISTS dm_focus TEXT,
     ADD COLUMN IF NOT EXISTS dm_context_md TEXT;
   ```
5. Update `database/schema.sql` with all changes
6. Create rollback migration script in `database/migrations/`
7. Test schema application against live PostgreSQL instance

**Verification:** Run schema against database, verify all tables/indexes created, no errors
**Documentation Update:** Update `clearance_and_connect_tasks_documentation.md` with completion

### Task M0-02: Campaign CRUD API Endpoints
**Adherence to AGENTS.md:** Real database operations, no mock data, proper error handling
**Prerequisites:** M0-01 complete, auth middleware working
**Exact Implementation:**
1. Add to `server/database-server.js`:
   ```javascript
   // POST /api/campaigns
   app.post('/api/campaigns', requireAuth, requireRole(['dm', 'admin']), [
     body('name').isLength({ min: 1, max: 255 }).trim(),
     body('description').optional().isString(),
     body('world_map_id').optional().isUUID(),
     body('max_players').isInt({ min: 1, max: 20 }),
     body('level_range').isObject(),
     body('is_public').isBoolean()
   ], async (req, res) => {
     // Implementation with duplicate name validation
     // Insert with dm_user_id = req.user.id
   });
   ```
2. Add PUT `/api/campaigns/:id` with ownership validation
3. Add GET `/api/campaigns/:id` with visibility rules
4. Add PUT `/api/campaigns/:campaignId/spawn` with SRID 0 geometry validation
5. Add objectives CRUD: POST/GET/PUT/DELETE with parent_id tree validation
6. Add session focus/context endpoints: PUT `/api/sessions/:sessionId/focus`, `/api/sessions/:sessionId/context`
7. Add DM sidebar endpoints for unplanned encounters, NPC sentiment, teleport actions
8. Test each endpoint with curl/Postman against live database
9. Verify auth failures return 401/403, not 500
10. Update `API_DOCUMENTATION.md` with all new endpoints

**Verification:** All endpoints respond correctly, database changes persist
**Documentation Update:** Log in `clearance_and_connect_tasks_documentation.md`

### Task M0-03: Permission Guards Implementation
**Adherence to AGENTS.md:** Real authentication, no bypasses or fallbacks
**Prerequisites:** M0-02 complete
**Exact Implementation:**
1. Create `requireCampaignDM` middleware in `server/auth-middleware.js`:
   ```javascript
   export const requireCampaignDM = async (req, res, next) => {
     const campaignId = req.params.campaignId || req.params.id;
     const result = await pool.query(`
       SELECT c.dm_user_id, cp.role 
       FROM campaigns c 
       LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.user_id = $1
       WHERE c.id = $2
     `, [req.user.id, campaignId]);
     
     if (!result.rows.length) return res.status(404).json({error: 'Campaign not found'});
     
     const campaign = result.rows[0];
     if (campaign.dm_user_id !== req.user.id && campaign.role !== 'co-dm' && !req.user.roles?.includes('admin')) {
       return res.status(403).json({error: 'DM access required'});
     }
     
     next();
   };
   ```
2. Apply to all campaign modification endpoints
3. Add session ownership validation for DM sidebar actions
4. Test permission enforcement with different user roles
5. Verify non-DM users get proper 403 responses

**Verification:** Permission system blocks unauthorized access correctly
**Documentation Update:** Record completion in `clearance_and_connect_tasks_documentation.md`

---

## MILESTONE M1: CAMPAIGN CRUD UI

### Task M1-01: Campaign Create/Edit Forms
**Adherence to AGENTS.md:** Real form validation, backend integration, no dummy data
**Prerequisites:** M0 complete, frontend API client configured
**Exact Implementation:**
1. Create `components/dmtoolkit/campaign-form.tsx`:
   ```typescript
   interface CampaignFormData {
     name: string;
     description: string;
     world_map_id?: string;
     max_players: number;
     level_range: { min: number; max: number };
     is_public: boolean;
   }
   ```
2. Implement form with validation:
   - Name: required, 1-255 characters, check uniqueness on blur
   - Description: optional markdown support
   - World map: dropdown from `/api/maps/world`
   - Max players: 1-20 slider/input
   - Level range: dual range slider 1-20
   - Public/private toggle
3. Wire form submission to POST/PUT `/api/campaigns`
4. Handle validation errors from backend
5. Show success/error toasts
6. Add to campaign manager component

**Verification:** Forms create/update real campaigns in database
**Documentation Update:** Log in `clearance_and_connect_tasks_documentation.md`

### Task M1-02: Campaign List & Details Views
**Adherence to AGENTS.md:** Load from real API, no mock data, handle empty states
**Prerequisites:** M1-01 complete
**Exact Implementation:**
1. Create `components/dmtoolkit/campaign-list.tsx`:
   - Load from GET `/api/users/:userId/campaigns` 
   - Filter by DM status
   - Show campaign status, player count, last activity
   - Handle loading/error states honestly
2. Create `components/dmtoolkit/campaign-details.tsx`:
   - Load from GET `/api/campaigns/:id`
   - Show full campaign configuration
   - Display "Enter Campaign View" button for DMs
   - Show current session status
3. Integrate into existing dashboard navigation
4. Add campaign switching capability

**Verification:** Lists show real campaigns, details load correctly
**Documentation Update:** Record in `clearance_and_connect_tasks_documentation.md`

---

## MILESTONE M2: CAMPAIGN VIEW (PREP TOOLS)

### Task M2-01: Map Integration with Spawn Tools
**Adherence to AGENTS.md:** Real map data, SRID 0 coordinates, no dummy pins
**Prerequisites:** M1 complete, OpenLayers map component operational
**Exact Implementation:**
1. Extend `components/openlayers-map.tsx` with spawn mode:
   ```typescript
   const [spawnMode, setSpawnMode] = useState(false);
   const [spawnPin, setSpawnPin] = useState<{x: number, y: number, note: string} | null>(null);
   ```
2. Add click handler for spawn placement:
   - Convert click coordinates to SRID 0
   - Show spawn note modal
   - POST to `/api/campaigns/:campaignId/spawn`
3. Load existing spawn from GET `/api/campaigns/:campaignId/spawn`
4. Render spawn pin for DM-only visibility
5. Add spawn controls to campaign view toolbar
6. Verify coordinates are correctly stored/retrieved as SRID 0

**Verification:** Spawn pins persist in database at correct coordinates
**Documentation Update:** Update `clearance_and_connect_tasks_documentation.md`

### Task M2-02: Objectives Management Panel
**Adherence to AGENTS.md:** Real database operations, no mock objectives
**Prerequisites:** M2-01 complete
**Exact Implementation:**
1. Create `components/dmtoolkit/objectives-panel.tsx`:
   ```typescript
   interface Objective {
     id: string;
     campaign_id: string;
     parent_id?: string;
     title: string;
     description_md: string;
     location_type: 'pin' | 'burg' | 'marker';
     location_burg_id?: string;
     location_marker_id?: string;
     location_pin?: [number, number];
     treasure_md: string;
     combat_md: string;
     npcs_md: string;
     rumours_md: string;
     order_index: number;
     children?: Objective[];
   }
   ```
2. Implement tree structure rendering with drag/drop reordering
3. Add objective creation modal with LLM assist buttons
4. Create location picker (pin on map vs burg/marker selection)
5. Wire to objectives CRUD endpoints
6. Add tree expansion/collapse
7. Handle parent/child relationships correctly

**Verification:** Objective trees persist correctly with proper hierarchy
**Documentation Update:** Record completion in `clearance_and_connect_tasks_documentation.md`

### Task M2-03: LLM Assist Integration
**Adherence to AGENTS.md:** Real LLM API calls, no fake content generation
**Prerequisites:** M2-02 complete, LLM service operational
**Exact Implementation:**
1. Add LLM assist endpoints to `server/database-server.js`:
   ```javascript
   app.post('/api/objectives/:objectiveId/assist/:field', requireAuth, requireCampaignDM, async (req, res) => {
     // Call LLM service with objective context
     // Persist in llm_narratives table
     // Return generated content
   });
   ```
2. Create `components/dmtoolkit/llm-assist-button.tsx`:
   - Show loading state during generation
   - Display generated content
   - Allow accept/reject/regenerate
3. Wire assists for: description_md, treasure_md, combat_md, npcs_md, rumours_md
4. Add context building from campaign/objective data
5. Handle LLM service errors gracefully

**Verification:** LLM assists generate real content, persist to database
**Documentation Update:** Log in `clearance_and_connect_tasks_documentation.md`

---

## MILESTONE M3: DM SIDEBAR (ACTIVE SESSION)

### Task M3-01: Session-Aware Sidebar UI
**Adherence to AGENTS.md:** Real session data, no mock sidebar state
**Prerequisites:** M2 complete, session management operational
**Exact Implementation:**
1. Create `components/dmtoolkit/dm-sidebar.tsx`:
   - Load current session from context
   - Show session metadata (title, participants, duration)
   - Only render for active sessions
   - Display for DM/co-DM roles only
2. Add focus/context inputs:
   ```typescript
   const [dmFocus, setDmFocus] = useState('');
   const [dmContext, setDmContext] = useState('');
   const [contextMode, setContextMode] = useState<'append' | 'replace'>('append');
   ```
3. Wire to PUT `/api/sessions/:sessionId/focus` and `/api/sessions/:sessionId/context`
4. Add real-time updates via WebSocket
5. Integrate into game view layout

**Verification:** Sidebar shows real session data, updates persist
**Documentation Update:** Update `clearance_and_connect_tasks_documentation.md`

### Task M3-02: Live Action Controls
**Adherence to AGENTS.md:** Real database effects, no simulated actions
**Prerequisites:** M3-01 complete
**Exact Implementation:**
1. Add unplanned encounter creation:
   ```typescript
   const createUnplannedEncounter = async (type: 'combat' | 'social' | 'exploration', seed: string) => {
     const response = await apiFetch(`/api/sessions/${sessionId}/unplanned-encounter`, {
       method: 'POST',
       body: JSON.stringify({ type, seed, llm: true })
     });
     // Refresh encounters list
   };
   ```
2. Add NPC sentiment adjustment:
   - Select NPC from campaign roster
   - Adjust trust delta (-5 to +5)
   - Add interaction summary
   - POST to `/api/npcs/:npcId/sentiment`
3. Add teleport controls:
   - Player teleport with reason logging
   - NPC location updates
   - Movement audit trail
4. Wire all actions to real API endpoints
5. Add confirmation dialogs for destructive actions

**Verification:** All actions create real database changes
**Documentation Update:** Record in `clearance_and_connect_tasks_documentation.md`

### Task M3-03: Real-Time Feedback System
**Adherence to AGENTS.md:** Real state updates, no fake notifications
**Prerequisites:** M3-02 complete, WebSocket system operational
**Exact Implementation:**
1. Add WebSocket subscriptions for:
   - Session focus/context updates
   - New unplanned encounters
   - NPC relationship changes
   - Player movement/teleportation
2. Implement optimistic updates with rollback:
   ```typescript
   const optimisticUpdate = async (action: () => Promise<void>, rollback: () => void) => {
     try {
       await action();
     } catch (error) {
       rollback();
       showToast(`Action failed: ${error.message}`, 'error');
     }
   };
   ```
3. Add success/error toast notifications
4. Disable controls during pending operations
5. Show loading states for async actions

**Verification:** Feedback reflects real backend state changes
**Documentation Update:** Log completion in `clearance_and_connect_tasks_documentation.md`

---

## MILESTONE M4: POLISH & QA

### Task M4-01: Audit Logging & Security
**Adherence to AGENTS.md:** Real audit trail, no mock security
**Prerequisites:** M3 complete
**Exact Implementation:**
1. Add comprehensive logging to all DM toolkit operations:
   ```javascript
   const logDMAction = async (userId, campaignId, action, details) => {
     await pool.query(`
       INSERT INTO dm_audit_log (user_id, campaign_id, action, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())
     `, [userId, campaignId, action, JSON.stringify(details)]);
   };
   ```
2. Create audit log table:
   ```sql
   CREATE TABLE IF NOT EXISTS public.dm_audit_log (
     id BIGSERIAL PRIMARY KEY,
     user_id UUID NOT NULL REFERENCES public.user_profiles(id),
     campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
     action TEXT NOT NULL,
     details JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
   );
   ```
3. Log all key actions: campaign CRUD, spawn changes, objective modifications, sidebar actions
4. Add audit log viewer for admins
5. Implement retention policy

**Verification:** All DM actions generate audit entries
**Documentation Update:** Update `clearance_and_connect_tasks_documentation.md`

### Task M4-02: Error Handling & Empty States
**Adherence to AGENTS.md:** Honest error messages, no fake success states
**Prerequisites:** M4-01 complete
**Exact Implementation:**
1. Add comprehensive error boundaries:
   ```typescript
   class DMToolkitErrorBoundary extends React.Component {
     componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
       logError('DMToolkit Error', { error: error.message, stack: error.stack, errorInfo });
     }
   }
   ```
2. Implement proper loading states for all async operations
3. Add empty states with clear calls-to-action:
   - No campaigns: "Create your first campaign"
   - No objectives: "Add objectives to guide your story"
   - No spawns: "Set a spawn point for players"
4. Handle offline/connection errors gracefully
5. Add retry mechanisms for failed operations

**Verification:** All error states display helpful messages
**Documentation Update:** Record in `clearance_and_connect_tasks_documentation.md`

### Task M4-03: Integration Testing Suite
**Adherence to AGENTS.md:** Test against real backend, no mock tests
**Prerequisites:** M4-02 complete
**Exact Implementation:**
1. Create DM toolkit integration tests:
   ```javascript
   // tests/dmtoolkit.integration.test.js
   describe('DM Toolkit Integration', () => {
     test('Campaign creation flow', async () => {
       // Create campaign via API
       // Verify database record
       // Test UI reflects creation
     });
     
     test('Objective management', async () => {
       // Create parent objective
       // Add child objectives
       // Verify tree structure
       // Test reordering
     });
   });
   ```
2. Add database cleanup between tests
3. Test all CRUD operations end-to-end
4. Verify WebSocket updates work correctly
5. Test permission enforcement
6. Add performance benchmarks for large campaigns

**Verification:** All tests pass against live system
**Documentation Update:** Update `clearance_and_connect_tasks_documentation.md`

### Task M4-04: Documentation & API Coverage
**Adherence to AGENTS.md:** Document actual behavior, no speculative features
**Prerequisites:** M4-03 complete
**Exact Implementation:**
1. Update `API_DOCUMENTATION.md` with all new endpoints:
   - Complete request/response examples
   - Error codes and messages
   - Authentication requirements
   - Rate limiting information
2. Create DM Toolkit user guide:
   ```markdown
   # DM Toolkit User Guide
   
   ## Campaign Management
   - Creating campaigns
   - Setting spawn points
   - Managing objectives
   
   ## Session Tools
   - DM sidebar usage
   - Live action controls
   - Real-time collaboration
   ```
3. Add troubleshooting section
4. Update README.md with DM toolkit features
5. Create migration guide for existing campaigns

**Verification:** Documentation matches implemented functionality
**Documentation Update:** Final entry in `clearance_and_connect_tasks_documentation.md`

---

## INTEGRATION CHECKLIST

For each task, ensure:

- [ ] **Zero-Dummy Policy**: No mock data, hardcoded values, or placeholder content
- [ ] **Real Backend Integration**: All operations hit live database/API
- [ ] **SRID 0 Compliance**: All geometry operations use SRID 0 coordinates
- [ ] **Authentication**: All endpoints properly authenticated and authorized
- [ ] **Error Handling**: Real errors surfaced to UI, no silent failures
- [ ] **Schema Updates**: `database/schema.sql` kept current with changes
- [ ] **API Documentation**: `API_DOCUMENTATION.md` updated with new endpoints
- [ ] **Testing**: Integration tests verify real behavior
- [ ] **Logging**: All significant actions logged to `clearance_and_connect_tasks_documentation.md`
- [ ] **Lint Compliance**: Code passes lint checks without introducing technical debt

## SUCCESS CRITERIA

The DM Toolkit integration is complete when:

1. DMs can create/edit campaigns with real world map selection
2. Spawn points persist at correct SRID 0 coordinates
3. Objective trees function with full CRUD operations and LLM assistance
4. DM sidebar provides live session controls with real backend effects
5. All features work only with authenticated users and proper permissions
6. No dummy data, mock responses, or placeholder content remains
7. Integration tests verify all functionality against live backend
8. Documentation accurately reflects implemented capabilities

This task list ensures methodical, verifiable integration of the DM Toolkit while maintaining strict adherence to the Zero-Dummy Policy and real backend integration principles outlined in AGENTS.md.