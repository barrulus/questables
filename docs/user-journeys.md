# User Journeys & UI Inventory

Complete mapping of every screen, form, state transition, and user flow in Questables.

---

## Table of Contents

1. [App State Machine](#app-state-machine)
2. [Authentication](#1-authentication)
3. [Dashboards](#2-dashboards)
4. [Character Creation](#3-character-creation-wizard)
5. [Campaign Management](#4-campaign-management)
6. [Joining Campaigns](#5-joining-campaigns)
7. [Game Window](#6-game-window)
8. [Chat & Real-Time](#7-chat--real-time)
9. [Sessions](#8-session-management)
10. [Encounters & Combat](#9-encounters--combat)
11. [Narrative System](#10-narrative-system)
12. [NPC Management](#11-npc-management)
13. [SRD Compendium](#12-srd-compendium)
14. [Map Upload](#13-map-upload-wizard)
14. [Navigation Tree](#complete-navigation-tree)
15. [API Endpoint Reference](#api-endpoint-reference)

---

## App State Machine

The app uses a top-level state machine with four states. There is no client-side router — all navigation is state-driven.

```
type AppState = "landing" | "dashboard" | "game" | "character-create"
```

```
┌──────────┐   login    ┌───────────┐  select campaign  ┌──────┐
│ LANDING  │──────────→ │ DASHBOARD │──────────────────→│ GAME │
│          │←──────────  │           │←──────────────────│      │
└──────────┘   logout   └─────┬─────┘   exit game       └──────┘
                              │  ↑
                   create     │  │  finish/cancel
                   character  │  │
                              ↓  │
                        ┌─────────────┐
                        │  CHARACTER  │
                        │   CREATE    │
                        └─────────────┘
```

| Transition | Trigger | Mechanism |
|------------|---------|-----------|
| landing → dashboard | Login/register success | `UserContext.login()` → `setAppState("dashboard")` |
| dashboard → landing | Logout or 401 | `UserContext.logout()` → `setAppState("landing")` |
| dashboard → game | Select campaign + enter | `selectCampaign(id)` → `setAppState("game")` |
| game → dashboard | Exit game | `setAppState("dashboard")` |
| dashboard → character-create | Create character button | `setAppState("character-create")` |
| character-create → dashboard | Finish or cancel | `setAppState("dashboard")` |

### Provider Stack

```
<ErrorBoundary>
  <DatabaseProvider>
    <UserProvider>          ← Auth state, user object, login/logout
      <GameSessionProvider> ← Active campaign, session, viewer role
        <GameStateProvider> ← Game phase, turn order, active player (WS1)
          <ActionProvider>    ← Player action lifecycle (WS3)
            <LiveStateProvider> ← Session-scoped mutable character state (WS3)
              <AppContent />
            </LiveStateProvider>
          </ActionProvider>
        </GameStateProvider>
      </GameSessionProvider>
    </UserProvider>
  </DatabaseProvider>
</ErrorBoundary>
```

### Dashboard Sub-Views

When `appState === "dashboard"`, a secondary state selects the dashboard variant:

```typescript
type DashboardView = "player" | "dm" | "admin";
```

- **Player Dashboard** — always available
- **DM Dashboard** — visible if `user.roles.includes("dm")`
- **Admin Dashboard** — visible if `user.roles.includes("admin")`

Tabs in the header switch between variants. Each user always has at least `"player"` role.

---

## 1. Authentication

### Files

| File | Purpose |
|------|---------|
| `components/login-modal.tsx` | Login form |
| `components/register-modal.tsx` | Registration form |
| `contexts/UserContext.tsx` | Auth state, session persistence |
| `utils/api-client.ts` | Token injection, 401 handling |
| `server/routes/auth.routes.js` | Login/register endpoints |
| `server/auth-middleware.js` | JWT verification, role checks |

### Login Flow

**Screen: Login Modal** (overlay on landing page)

| Field | Type | Validation |
|-------|------|------------|
| Email | email input | Required, HTML5 email validation |
| Password | password input | Required, show/hide toggle |

1. User enters credentials and submits
2. `POST /api/auth/login` with `{ email, password }`
3. Server validates against bcrypt hash in `user_profiles`
4. Returns `{ user, token (JWT 24h), refreshToken (7d) }`
5. Client stores user + token in `localStorage` (`dnd-user`, `dnd-auth-token`)
6. `appState` transitions to `"dashboard"`

**Error states:** Invalid credentials (401), rate limited (429, 5 attempts per 15 min)

### Registration Flow

**Screen: Register Modal** (overlay on landing page)

| Field | Type | Validation |
|-------|------|------------|
| Username | text | Required, non-empty |
| Email | email | Required, unique (checked server-side) |
| Account Type | select | Player / Dungeon Master / Administrator |
| Password | password | Required, min 6 characters |
| Confirm Password | password | Must match password |
| Terms & Conditions | checkbox | Must be checked |

1. Client-side validation runs first
2. `POST /api/auth/register` with `{ username, email, password, roles }`
3. Server hashes password (bcrypt, 12 rounds), inserts `user_profiles`
4. Returns `{ user, token, refreshToken }`
5. Auto-login after registration

**Error states:** Email already in use (409), validation errors (400)

### Session Persistence

On app startup:
1. Check `localStorage` for stored user + token
2. Validate session via `GET /api/users/profile` with Bearer token
3. If valid, restore session; if expired/invalid, clear and show landing

### Logout

- Clears `localStorage` keys: `dnd-user`, `dnd-auth-token`, `dnd-active-campaign`
- Sets user to null, `appState` reverts to `"landing"`
- No server-side logout endpoint (stateless JWT)
- Automatic logout on any 401 response via `AUTH_LOGOUT_EVENT` custom event

### Role System

| Role | Access |
|------|--------|
| `player` | Join campaigns, create characters, play |
| `dm` | All player features + create campaigns, manage NPCs, prep maps |
| `admin` | All DM features + system metrics, user management, LLM admin |

Roles stored as `TEXT[]` in `user_profiles` with CHECK constraint. Server middleware: `requireAuth`, `requireRole(['dm'])`, `requireCampaignOwnership`, `requireCampaignParticipation`.

---

## 2. Dashboards

### Player Dashboard

**File:** `components/player-dashboard.tsx`

**Header:** Welcome message, avatar, "Enter Game" button (disabled without active campaign), Refresh, Logout.

**Stats bar** (4 columns):
- Characters (count)
- Joined Campaigns (count)
- Active Right Now (count)
- Total Character Levels (sum)

**Tabs:**

#### My Characters Tab
- Character cards showing: level, race, class, background, HP/max with progress bar, AC, last played
- Campaign assignments with visibility state (visible/stealthed/hidden) and coordinates
- **[+ Create Character]** → `setAppState("character-create")`
- **[Edit]** → Character edit flow

#### My Campaigns Tab
- Cards for joined campaigns showing: status dot, name, DM name, player count, system, level range, next session
- Current character with **[Switch]** option (opens character selector dialog)
- **[Play]** → `selectCampaign(id)` + `setAppState("game")`

#### Browse Campaigns Tab
- Search bar (name, description, DM, system)
- Campaign cards with availability status (recruiting/active/paused/completed/full)
- "Joined" badge on campaigns user is in
- **[Request to Join]** → Character selector dialog → `POST /api/campaigns/{id}/players`
- **[Play]** → For already-joined active campaigns

### DM Dashboard

**File:** `components/dm-dashboard.tsx`

**Header:** Same layout as player dashboard.

**Stats bar** (4 columns):
- Total Campaigns
- Active Campaigns
- Players Across Campaigns
- Locations in Selected Campaign

**Tabs:**

#### Campaigns Tab
- `<CampaignManager>` component with create/edit/delete/settings dialogs
- Campaign Overview card with live data (locations, NPCs, routes) from selected campaign
- Campaign selector dropdown

#### Player Slots Tab
- "My Player Campaigns" — campaigns where DM is a player
- "Public Campaigns" — searchable list of recruiting campaigns

#### Characters Tab
- Character roster grid for all DM's characters
- Cards with: level, race, class, HP, AC, background, campaigns, last played

#### Maps Tab
- `<MapsTab>` component — upload and manage world maps
- Upload wizard for AFMG SVG + GeoJSON layers

### Admin Dashboard

**File:** `components/admin-dashboard.tsx`

**Tabs:**
- **System Metrics** — Users, campaigns, sessions, activity counts
- **LLM Usage** — Provider stats, cache metrics, latency
- **Database Health** — Connection status, pool stats

---

## 3. Character Creation Wizard

### Files

| File | Purpose |
|------|---------|
| `components/character-wizard/character-creation-wizard.tsx` | Shell, draft loading/saving, finalization |
| `components/character-wizard/wizard-context.tsx` | State management via useReducer |
| `components/character-wizard/wizard-layout.tsx` | Two-column layout (form + preview) |
| `components/character-wizard/wizard-sidebar.tsx` | Step navigation with lock/complete indicators |
| `components/character-wizard/wizard-footer.tsx` | Back/Next/Save Draft/Create buttons |
| `components/character-wizard/steps/step-species.tsx` | Step 0 |
| `components/character-wizard/steps/step-class.tsx` | Step 1 |
| `components/character-wizard/steps/step-ability-scores.tsx` | Step 2 |
| `components/character-wizard/steps/step-background.tsx` | Step 3 |
| `components/character-wizard/steps/step-equipment-spells.tsx` | Step 4 |
| `components/character-wizard/steps/step-identity.tsx` | Step 5 |
| `components/character-wizard/steps/step-review.tsx` | Step 6 |
| `components/character-wizard/preview/character-preview.tsx` | Live preview panel |

### Flow

```
Step 0: Species → Step 1: Class → Step 2: Abilities → Step 3: Background →
Step 4: Equipment/Spells → Step 5: Identity → Step 6: Review → [CREATE]
```

Navigation: can jump backward to any completed step, cannot skip forward.

### Step 0: Species

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Species | Card grid selection | No | Data from `GET /api/srd/species` |
| Subrace | Dropdown | Conditional | Shows if selected species has subspecies |

SRD detail modal available for each species. Selecting species resets `computedStats`.

### Step 1: Class

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Class | Card grid selection | Yes | Data from `GET /api/srd/classes`, filters out subclasses |

Cards show hit die + caster type. Selecting class resets equipment, cantrips, spells, and computedStats.

### Step 2: Ability Scores

| Field | Type | Notes |
|-------|------|-------|
| Method | Radio: Standard Array / Point Buy / 4d6 Drop Lowest | Changing method resets scores to 10 |
| 6 Ability Scores | Method-specific UI | See below |

**Standard Array** (`[15, 14, 13, 12, 10, 8]`): Assign each value to one ability via dropdowns. Pool management prevents reuse.

**Point Buy** (27 points): Start at 8 each, range 8-15. Cost table: `{8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9}`. +/- buttons with real-time point tracking.

**4d6 Drop Lowest**: Roll 4d6 six times, drop lowest die. "Roll All" button, then assign via dropdowns with pool management.

Modifier formula: `Math.floor((score - 10) / 2)`

### Step 3: Background

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Background | Card grid selection | Yes | Data from `GET /api/srd/backgrounds` |

Cards show first 2 benefit names. Selecting background resets chosenSkills.

### Step 4: Equipment & Spells

Two tabs: Equipment | Spells (spells tab only for caster classes).

**Equipment Tab:**

| Field | Type | Notes |
|-------|------|-------|
| Equipment pack | Radio options (A, B, C...) | Parsed from class "Core Traits" feature |
| Equipment shop | Item browser with cart | Opens when "Starting Gold" option selected |

Equipment shop: Category dropdown → scrollable item list → +/- quantity → cart with running GP total.

**Spells Tab** (caster classes only):

| Field | Type | Limits |
|-------|------|--------|
| Cantrips | Checkbox list | Class-dependent (2-4) |
| 1st Level Spells | Checkbox list | Class-dependent (varies with ability modifier for prepared casters) |

Data from `GET /api/srd/spells?class={classKey}`. Spell limits auto-adjust when ability scores change.

### Step 5: Identity

| Field | Type | Required |
|-------|------|----------|
| Character Name | Text input | Yes (for finalization) |
| Alignment | Dropdown (9 options: LG through CE) | No |
| Personality Traits | Textarea (3 rows) | No |
| Ideals | Textarea (3 rows) | No |
| Bonds | Textarea (3 rows) | No |
| Flaws | Textarea (3 rows) | No |
| Backstory | Textarea (6 rows) | No |

All fields debounced at 300ms.

### Step 6: Review

Displays all selections with validation warnings:
- Required: species, class, ability scores, background, name
- Green alert if all valid, red alert listing missing items

Shows computed stats: HP, AC, Initiative, Speed, Proficiency, Passive Perception, saving throws, skills, spellcasting.

### Draft Saving

- On mount: checks `GET /api/users/{userId}/characters/draft` for existing draft
- If found, restores wizard state from `creation_state` JSONB column
- Manual save via "Save Draft" button → `POST /api/users/{userId}/characters/draft`
- On finalize: `creation_state` set to `null`, character becomes permanent

### Character Preview (Right Panel)

Live-updating display showing: name, species, class, alignment, ability scores with modifiers, combat stats, proficient saves/skills, languages, spellcasting info, chosen spells.

---

## 4. Campaign Management

### Files

| File | Purpose |
|------|---------|
| `components/campaign-manager.tsx` | Campaign CRUD, settings, player management |
| `components/campaign-prep.tsx` | DM campaign prep (map, objectives, regions, spawns) |
| `server/routes/campaigns.routes.js` | Campaign API endpoints |
| `server/services/campaigns/service.js` | Campaign business logic |

### Campaign Creation

**Screen:** Create Campaign Dialog (from DM Dashboard)

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| Campaign Name | Text | — | Required, non-empty |
| Description | Textarea (3 rows) | — | Optional |
| Game System | Select | D&D 5e | Options: D&D 5e, Pathfinder 2e, Call of Cthulhu, Vampire: The Masquerade, Other |
| Setting | Text | — | Optional (e.g. "Fantasy", "Modern") |
| World Map | Select | No world map | Available maps from user's uploads |
| Max Players | Number (1-20) | 6 | Integer, 1-20 |
| Min Level | Number (1-20) | 1 | Must not exceed max level |
| Max Level | Number (1-20) | 20 | Must not be below min level |
| Public Campaign | Toggle | false | Allow discovery in public listings |

API: `POST /api/campaigns` → Creates with status `"recruiting"`.

### Campaign Statuses

| Status | Color | Description |
|--------|-------|-------------|
| `recruiting` | Blue | Open for players, world map optional |
| `active` | Green | Live gameplay, **world map required** |
| `paused` | Orange | Suspended |
| `completed` | Gray | Ended |

No enforced status progression — can transition to any status. Transitioning to `active` requires a world map.

### Campaign Editing

**Screen:** Edit Campaign Dialog

Same fields as creation, plus:
- **Status** dropdown (recruiting/active/paused/completed)
- Validation: `active` requires `world_map_id`

API: `PUT /api/campaigns/{id}` — partial updates supported.

### Campaign Settings

**Screen:** Settings Dialog

| Setting | Type | Description |
|---------|------|-------------|
| Public campaign | Toggle | Allow discovery in public listings |
| Allow spectators | Toggle | View-only seats |
| Auto-approve join requests | Toggle | Auto-approve new join requests |
| Experience model | Select | Milestone / Experience points |
| Resting rules | Select | Standard / Gritty realism / Heroic |
| Death save difficulty | Select | Standard / Hardcore / Forgiving |

### Campaign Deletion

DM only. Confirmation dialog → `DELETE /api/campaigns/{id}` with `{ dmUserId }`.

### Campaign Prep (DM Only)

**Screen:** Campaign Details Panel → CampaignPrep component

Features:
- **Campaign Prep Map** — OpenLayers map with editing overlays
- **Spawn Points** — Create/update default spawn for auto-placing joining players
- **Objectives** — CRUD with AI-assisted generation (description, treasure, combat, NPCs, rumours)
- **Regions** — Polygon annotations (encounter, rumour, narrative, travel, custom)
- **Location Linking** — Link objectives to map coordinates, burgs, markers, or regions

---

## 5. Joining Campaigns

### Player Join Flow

1. Player browses campaigns in **Browse Campaigns** tab (Player Dashboard)
2. Clicks **[Request to Join]** on a `recruiting` campaign with open slots
3. **Character Selection Dialog** opens:
   - Title: "Select a character"
   - Dropdown: Choose from user's character roster
   - [Cancel] / [Confirm Join]
4. `POST /api/campaigns/{campaignId}/players` with `{ userId, characterId }`
5. Server auto-places player at:
   - Default spawn point (if exists), OR
   - Latest spawn point (by `updated_at` DESC), OR
   - Map center (if `world_map_id` set)
6. Placement logged in `player_movement_audit`
7. Response: `{ message, playerId, autoPlaced }`
8. Campaign appears in "My Campaigns" tab

**Note:** Currently no explicit approval workflow — players are auto-added as `active`. The `auto_approve_join_requests` setting exists but approval flow is not yet implemented.

### Character Switching

1. Player clicks **[Switch]** on campaign card
2. Dialog: Select different character from dropdown
3. `PATCH /api/campaigns/{campaignId}/my-character` with `{ characterId }`

### Participant Roles

| Role | Permissions |
|------|-------------|
| DM (campaign creator) | Full control: edit campaign, manage players, move/teleport, create objectives, prep map |
| co-dm | Same as DM (enforced via `ensureDmControl`) |
| player | Move own token, view visible players, see party trail |
| spectator | View-only (if allowed) |

Player visibility states: `visible`, `stealthed`, `hidden`.

---

## 6. Game Window

### Entry

From any dashboard: select a campaign → click **[Enter Game]** / **[Play]** / **[Launch]**.

Requires `activeCampaignId` in `GameSessionContext`. If no campaign selected, shows a "Select a campaign" card.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ HEADER: [Menu] Campaign Name • System • Setting         │
│         Status Badge • Session # • Phase Badge • DB     │
├─────────────────────────────────────────────────────────┤
│ TURN BANNER: "[Player]'s turn" / "Your turn!" /         │
│              "Waiting for DM world turn..." + controls  │
├─────────────────────────────────────────────────────────┤
│ LIVE STATE BAR: HP bar (color-coded) • Temp HP • Conditions │
│                 Inspiration indicator                    │
├─────┬───────────────────────────────┬───────────────────┤
│     │                               │                   │
│ I   │  EXPANDABLE PANEL             │   CHAT PANEL      │
│ C   │  (if tool selected)           │                   │
│ O   │                               │   Campaign chat   │
│ N   ├───────────────────────────────┤   with tabs,      │
│     │                               │   dice rolling,   │
│ S   │  OPENLAYERS MAP               │   typing          │
│ I   │                               │   indicators      │
│ D   │  Tile layers, burgs, routes,  │                   │
│ E   │  rivers, markers, cells,      │                   │
│ B   │  regions, NPC positions       │                   │
│ A   │                               │                   │
│ R   ├───────────────────────────────┤                   │
│     │  ACTION PANEL (on your turn)  │                   │
│     │  Action grid / Roll prompt    │                   │
└─────┴───────────────────────────────┴───────────────────┘
```

Default split: 60% map / 40% chat (resizable).

### Icon Sidebar (md+ only, 64px)

| Icon | Panel ID | Access |
|------|----------|--------|
| Crown | `dm-sidebar` | DM / co-DM / admin only |
| User | `character` | All (requires active character) |
| Package | `inventory` | All (requires active character) |
| Book | `spells` | All (requires active character) |
| Library | `compendium` | All |
| Sparkles | `narratives` | All |
| Scroll | `journals` | All |
| Cog | `settings` | All |

Clicking an icon toggles the expandable panel above the map. Panels that require a character show "No character enrolled" if none assigned.

### Map Interactions

- Click features for tooltips (settlement names, NPC details)
- Zoom-dependent layer visibility (e.g., burg labels at higher zoom)
- DM: drawing/annotation tools
- Hover reveals feature info
- Player positions tracked with visibility states

### Character Sheet Panel

Accordion sections: Basic info, Combat (HP/AC/Initiative/Speed), Abilities (6 scores + modifiers), Skills (with proficiency markers), Background (personality/ideals/bonds/flaws/backstory), Equipment.

---

## 7. Chat & Real-Time

### Files

| File | Purpose |
|------|---------|
| `components/chat-panel.tsx` | Campaign selector + ChatSystem wrapper |
| `components/chat-system.tsx` | Core chat UI and logic (channel-aware) |
| `components/chat-channel-tabs.tsx` | Channel tab bar with unread badges |
| `hooks/useWebSocket.tsx` | WebSocket client hook |
| `server/websocket-server.js` | Socket.IO server (channel-aware routing) |
| `server/routes/chat.routes.js` | Message persistence + channel endpoints |

### Message Types

| Type | Description |
|------|-------------|
| `text` | In-character dialogue |
| `dice_roll` | Dice roll results with breakdown |
| `system` | DM announcements |
| `ooc` | Out-of-character (prefixed `[OOC]`) |

### Communication Channels

| Channel | Participants | Visual Style |
|---------|-------------|--------------|
| **Party** | All players + DM | Default |
| **DM Whisper** | One player + DM | Indigo background |
| **DM Narration** | DM → all (broadcast) | Amber/parchment, italic |
| **Private** | Two specific players | Emerald background |

Channel tabs appear above the message list. Unread badges show on inactive tabs when new messages arrive.

### Chat Features

- Toggle IC (in-character) / OOC mode — shows character name or username
- **Channel tabs** — Party (default), DM Whisper, DM Narration (DM only), dynamic Private tabs
- **Unread tracking** — Read cursors stored server-side, badges on inactive channel tabs
- Typing indicators via WebSocket (channel-aware — private typing only sent to target)
- Message history loaded from `GET /api/campaigns/{id}/messages` (paginated, filterable by channel)
- New messages via `POST /api/campaigns/{id}/messages` (with channel_type + channel_target_user_id)
- Delete via `DELETE /api/campaigns/{id}/messages/{messageId}` (owner/DM only)
- **Visibility enforcement** — private/whisper messages only returned to sender or target

### Dice Rolling

- "Roll Dice" button opens expression prompt
- Syntax: `1d20+5`, `2d6`, `3d10-2`
- Parser: `/(\d+)?d(\d+)(?:([+-])(\d+))?/i`
- Posts as `message_type: "dice_roll"` with individual rolls + total
- Visible to entire party

### WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `join-campaign` | Client → Server | campaignId |
| `leave-campaign` | Client → Server | campaignId |
| `chat-message` | Bidirectional | Message data |
| `user-joined` / `user-left` | Server → Campaign | userId, username, timestamp |
| `user-typing` / `user-stopped-typing` | Bidirectional | userId, username |
| `combat-update` | Bidirectional | Encounter state changes |
| `character-update` | Bidirectional | Character data changes |
| `session-update` | Bidirectional | Session state changes |
| `spawn-updated` / `spawn-deleted` | Server → Campaign | Spawn data |
| `objective-created` | Server → Campaign | Objective data |
| `player-moved` | Server → Campaign | Position data |
| `npc-sentiment-adjusted` | Server → Campaign | NPC sentiment change |

Auto-reconnect with exponential backoff (up to 5 attempts, max 30s delay). Shows "Offline" / "Reconnecting (X/5)" status.

---

## 8. Session Management

**File:** `components/session-manager.tsx`

### Session States

| Status | Description |
|--------|-------------|
| `scheduled` | Upcoming, has scheduled time |
| `active` | Currently running, `started_at` set |
| `completed` | Finished, `ended_at` set, duration calculated |
| `cancelled` | Cancelled by DM |

### DM Actions

- **Create session:** Title, summary, DM notes, optional scheduled time
- **Start session:** `scheduled` → `active`, records `started_at`
- **End session:** Records `ended_at`, calculates duration, awards XP
- **Manage participants:** Add campaign members, track attendance (`present`, `absent`, `late`, `left_early`), record character level at start/end

### API

- `GET /api/campaigns/{campaignId}/sessions` — List sessions
- `POST /api/campaigns/{campaignId}/sessions` — Create session
- `PUT /api/sessions/{sessionId}` — Update status/summary
- `GET /api/sessions/{sessionId}/participants` — List participants
- `POST /api/sessions/{sessionId}/participants` — Add participant

---

## 9. Encounters & Combat

**File:** `components/combat-tracker.tsx`

### Encounter Types

`combat`, `social`, `exploration`, `puzzle`

### Encounter Difficulties

`easy`, `medium`, `hard`, `deadly`

### Combat Tracker Features

- **Initiative tracking:** Roll via `POST /api/encounters/{id}/initiative`, tracks order and round counter
- **Participant management:** Add PCs or NPCs as combatants, track HP (current/max/temp), AC, conditions
- **HP adjustments:** +/- buttons (DM only)
- **Conditions:** 15 D&D 5e conditions (Blinded, Charmed, Deafened, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious, Exhaustion)
- **Real-time sync:** `combat-update` WebSocket events broadcast state to all players
- **Connection indicator:** Green pulse when connected

### Integrated Combat Phase (WS4)

When the DM transitions to combat phase, the server auto-creates an encounter, populates participants (PCs + enemy NPCs), rolls initiative, and sets turn order. The turn order supports mixed PC/NPC entries.

**Combat Action Economy:**

| Budget Slot | Actions |
|-------------|---------|
| Action | Attack, Cast Spell, Dash, Dodge, Disengage, Help, Hide, Ready, Use Item, Pass |
| Bonus Action | (spell-dependent) |
| Movement | 30ft default, doubled by Dash |
| Reaction | Opportunity attacks, etc. |

Budget is tracked per-turn in `game_state.combatTurnBudget` and reset on turn advance.

**Enemy Turns:** When initiative advances to an NPC, the server auto-fires an LLM-controlled enemy turn. Clients see a spinner and narration broadcast. Consecutive NPC turns chain automatically.

**Concentration:** Spells requiring concentration are tracked in `session_live_states.concentration`. When a concentrating character takes damage, the server auto-prompts a CON save (DC = max(10, floor(damage/2))).

**Ending Combat:** DM clicks "End Combat" in the sidebar with an end condition (Victory, Enemies Fled, Party Fled, Parley). XP is calculated from defeated enemies and distributed equally among surviving PCs. Phase returns to exploration (or social for parley).

### API

- `POST /api/campaigns/{campaignId}/encounters` — Create
- `GET /api/campaigns/{campaignId}/encounters` — List
- `POST /api/encounters/{id}/participants` — Add combatant
- `POST /api/encounters/{id}/initiative` — Roll initiatives
- `PUT /api/encounters/{id}` — Update (rounds, turn order)
- `PUT /api/encounter-participants/{participantId}` — Update HP/conditions
- `POST /api/campaigns/{campaignId}/combat/end` — End combat (DM only), distributes XP, transitions phase

### Social Phase (WS5)

When the DM transitions to social phase, players can interact with NPCs through dialogue:

1. **NPC Selection** — Player selects `talk_to_npc` action → `NpcPicker` component shows campaign NPCs (name, occupation)
2. **Social Actions** — After selecting an NPC, `SocialActionGrid` replaces the standard action grid:
   - **Speak** — Free text dialogue input
   - **Persuade** / **Deceive** / **Intimidate** / **Insight** — Skill-based social actions
   - **Leave** — Exit social interaction (submits `pass`)
3. **LLM Resolution** — Server uses `DM_SOCIAL_SYSTEM_PROMPT` to have the LLM respond in-character as the NPC, using personality, memories, and relationship context
4. **Memory Auto-Write** — After dialogue, the server automatically records an NPC memory with trust delta and sentiment
5. **Turn Bypass** — During social phase, any player can speak to the NPC without waiting for their turn (for `talk_to_npc`, `pass`, `free_action`)

### Rest Phase (WS5)

**Short Rest:**
1. DM clicks "Short Rest" in DM sidebar → `POST /rest/start` with `restType: 'short'`
2. Phase transitions to `rest`, `RestPanel` replaces action grid
3. Each PC sees their HP bar + hit dice remaining (e.g., "3/5 d8")
4. Players click "Spend Hit Die" → rolls hit die + CON modifier → heals HP
5. DM clicks "Complete Rest" → `POST /rest/complete` → phase returns to exploration

**Long Rest:**
1. DM clicks "Long Rest" → `POST /rest/start` with `restType: 'long'`
2. Server rolls for random encounter (15% chance on d20 roll 1-3)
3. `RestPanel` shows "Resting..." with DM "Complete Rest" button
4. On completion: full HP restored, all spell slots reset, half hit dice regained (min 1), death saves cleared, concentration cleared

### Death Saves (WS6)

When a character drops to 0 HP:
1. **Instant death check** — if damage exceeds `hp_max`, character dies immediately
2. **Already unconscious** — taking damage at 0 HP = automatic death save failure (2 on critical hit)
3. **Newly at 0 HP** — `unconscious` condition added, death saves reset to `{successes: 0, failures: 0}`

On the unconscious character's turn, `DeathSavePanel` replaces the action grid:
- Shows skull icons (failures) and heart icons (successes), 0-3 each
- "Roll Death Save" button → rolls d20 client-side → `POST /death-save`
- **Nat 20** — regain 1 HP, remove unconscious, reset death saves
- **Nat 1** — 2 failures (may trigger death)
- **10+** — 1 success (3 successes = stabilized)
- **2-9** — 1 failure (3 failures = dead)

**Healing at Zero:** When healed above 0 HP, unconscious is removed and death saves reset.

### Levelling (WS6)

**XP-Based Level-Up:**
1. After combat ends or rest completes, server calls `checkLevelUps()`
2. If character XP exceeds D&D 5e threshold for next level, `level-up-available` WS event sent privately
3. `LevelUpModal` appears with:
   - "Roll Hit Die" (1dN + CON) or "Take Average" (ceil(N/2) + 1 + CON)
   - New class features at this level
   - New spell slots if applicable
   - ASI/Feat notification at levels 4, 8, 12, 16, 19
4. Player confirms → `POST /level-up` → character level, HP, spell slots updated

**Milestone Level-Up (DM Only):**
1. DM clicks "Level Up" button next to a player in the DM sidebar
2. Same modal flow but bypasses XP check
3. `POST /milestone-level-up` (DM auth required)

---

## 10. Narrative System

**File:** `components/narrative-console.tsx`

### Narrative Types (AI-Generated)

| Type | Input | Output |
|------|-------|--------|
| `dm` | Focus text | DM narration |
| `scene` | Focus on location/atmosphere | Scene description |
| `npc` | NPC, interaction summary, sentiment, trust delta, tags | NPC dialogue |
| `action` | Action type, actor, summary, result | Action outcome narration |
| `quest` | Focus and seed themes | Quest hook/description |

### Request via `POST /api/campaigns/{campaignId}/narratives/{type}`

Uses configured LLM provider (Ollama by default). Features: response caching, provider/model display, latency telemetry, thinking annotation stripping, narrative history.

---

## 11. NPC Management

**File:** `components/npc-manager.tsx`

### NPC Data

- Identity: Name, race, occupation/role
- Personality: Personality traits, appearance, motivations, secrets
- Location: Linked to map locations, movable by DM
- Combat: AC, HP, speed, ability scores, challenge rating, custom actions
- Relationships: ally, enemy, neutral, romantic, family, business
- Avatar image support

### Gameplay Integration

- NPC markers visible on game map
- DM can teleport NPCs: `POST /api/campaigns/{campaignId}/teleport/npc`
- Add NPCs as encounter combatants
- AI dialogue generation via narrative system
- Sentiment tracking with trust delta adjustments

### API

- `GET /api/campaigns/{campaignId}/npcs` — List
- `POST /api/campaigns/{campaignId}/npcs` — Create
- `PUT /api/npcs/{npcId}` — Update
- `DELETE /api/npcs/{npcId}` — Delete

---

## 12. SRD Compendium

### Files

| File | Purpose |
|------|---------|
| `components/compendium/compendium-panel.tsx` | Tabbed container (Items/Spells/Shops/Loot) |
| `components/compendium/item-browser.tsx` | Searchable/filterable SRD item list |
| `components/compendium/spell-browser.tsx` | Searchable/filterable SRD spell list |
| `components/compendium/item-detail-card.tsx` | Rich item detail view |
| `components/compendium/spell-detail-card.tsx` | Rich spell detail view |
| `components/compendium/shop-view.tsx` | Player-facing shop browser with purchase |
| `components/compendium/shop-editor.tsx` | DM shop CRUD + LLM auto-stock |
| `components/compendium/loot-table-editor.tsx` | DM loot table builder with weighted rolls |
| `utils/api/srd.ts` | SRD API client (items, spells, search) |
| `utils/api/loot.ts` | Loot table API client |
| `server/routes/srd.routes.js` | SRD endpoints with search and pagination |
| `server/routes/shop.routes.js` | Shop CRUD, inventory, purchase endpoints |
| `server/routes/loot.routes.js` | Loot table CRUD, roll endpoint |
| `server/services/shop/service.js` | Shop business logic |
| `server/services/loot/service.js` | Loot table business logic |

### Compendium Browser

Accessed via the Library icon in the icon sidebar. Four tabs:

- **Items** — Search SRD items by name, filter by category (10 types) and rarity (6 tiers). Paginated results with expandable detail cards.
- **Spells** — Search SRD spells by name, filter by level/school/class. Expandable cards with casting info, damage, components.
- **Shops** — Player view: browse active campaign shops, purchase items. DM view: create/edit shops, add items via SRD search, toggle active state, LLM auto-stock.
- **Loot** (DM only) — Create loot tables with weighted item entries and currency entries. Roll on tables with configurable count.

### NPC Shop — Player Purchase Flow

1. Player opens Compendium → Shops tab
2. Active shops listed with name, type, location
3. Click "Browse Shop" → inventory with prices (SRD cost × shop modifier)
4. Click buy button → `POST /shops/:shopId/purchase`
5. Server validates stock, computes price, deducts gold from character inventory
6. `shop-purchase` WebSocket event broadcast to campaign

### NPC Shop — DM Auto-Stock

1. DM creates shop (name, type, price modifier, location)
2. Opens shop detail → clicks "Auto-Stock" button
3. `POST /shops/:shopId/auto-stock` calls LLM with shop context
4. LLM suggests 15-25 level-appropriate items for the shop type
5. Server validates suggestions against SRD item database
6. Valid items added to shop inventory automatically

### Loot Table — Roll Flow

1. DM creates loot table with CR range
2. Adds item entries (from SRD search) and currency entries
3. Each entry has a probability weight
4. Clicks "Roll 1/3/5" → weighted random selection
5. Results displayed with item names and quantities

### Spellbook Enhancement

The Spellbook panel (`components/spellbook.tsx`) resolves spell details from the SRD API via `fetchSpellByKey()`. Each spell in the character's known spells list shows:
- Resolved name, level, and school
- Expandable detail card with full spell statistics (casting time, range, components, duration, damage, save info, description)

---

## 13. Map Upload Wizard

**File:** `components/map-upload-wizard/`

See [Mapping System > Map Upload](./mapping-system.md#map-upload) for full details.

### Steps

1. **SVG Upload** — Name, description, meters-per-pixel, SVG file → creates `maps_world`
2. **Cells** — GeoJSON layer (optional, skip allowed)
3. **Burgs** — GeoJSON layer (optional)
4. **Routes** — GeoJSON layer (optional)
5. **Rivers** — GeoJSON layer (optional)
6. **Markers** — GeoJSON layer (optional)
7. **Summary** — Feature counts per layer

---

## Complete Navigation Tree

```
ROOT
├─ Loading (spinner while initializing user session)
│
├─ LANDING (no user)
│  ├─ Hero section, feature cards, call-to-action
│  ├─ [Login] → LoginModal
│  │  ├─ Email + Password → [Sign In] → dashboard
│  │  ├─ [Forgot Password] (non-functional)
│  │  └─ [Switch to Register]
│  └─ [Register] → RegisterModal
│     ├─ Username + Email + Password + Confirm + Role + Terms
│     ├─ [Create Account] → auto-login → dashboard
│     └─ [Switch to Login]
│
├─ DASHBOARD (user logged in)
│  ├─ Dashboard selector tabs (role-based)
│  │
│  ├─ PLAYER DASHBOARD
│  │  ├─ My Characters tab
│  │  │  ├─ Character cards (level, class, HP, AC)
│  │  │  ├─ [+ Create Character] → character-create
│  │  │  └─ [Edit Character]
│  │  ├─ My Campaigns tab
│  │  │  ├─ Joined campaign cards
│  │  │  ├─ [Switch Character] → dialog
│  │  │  └─ [Play] → game
│  │  └─ Browse Campaigns tab
│  │     ├─ Search bar + filterable cards
│  │     ├─ [Request to Join] → character selector → join
│  │     └─ [Play] → game (if already joined)
│  │
│  ├─ DM DASHBOARD
│  │  ├─ Campaigns tab
│  │  │  ├─ CampaignManager (create/edit/delete/settings)
│  │  │  ├─ Campaign Overview (locations, NPCs, routes)
│  │  │  └─ [Launch] → game
│  │  ├─ Player Slots tab
│  │  ├─ Characters tab (DM's own characters)
│  │  └─ Maps tab (upload wizard)
│  │
│  └─ ADMIN DASHBOARD
│     ├─ System Metrics tab
│     ├─ LLM Usage tab
│     └─ Database Health tab
│
├─ CHARACTER CREATION (7-step wizard)
│  ├─ Step 0: Species selection
│  ├─ Step 1: Class selection
│  ├─ Step 2: Ability scores (3 methods)
│  ├─ Step 3: Background selection
│  ├─ Step 4: Equipment & Spells (2 tabs)
│  ├─ Step 5: Identity (name, alignment, personality)
│  ├─ Step 6: Review + [Create Character] → dashboard
│  ├─ Live preview panel (right side)
│  └─ [Save Draft] / [Back to Dashboard]
│
└─ GAME (requires active campaign)
   ├─ Header: campaign info, status, session badge, phase indicator badge
   ├─ Turn Banner: active player display, End Turn / Complete World Turn buttons
   ├─ Live State Bar: HP progress bar, temp HP shield, inspiration, concentration, condition badges
   ├─ Icon Sidebar (7 tool buttons)
   │  ├─ DM Sidebar (DM/co-DM/admin only)
   │  ├─ Character Sheet (requires character)
   │  ├─ Inventory (requires character)
   │  ├─ Spells (requires character)
   │  ├─ Compendium (Items/Spells/Shops/Loot tabs)
   │  ├─ Narratives
   │  ├─ Session Notes
   │  └─ Settings
   ├─ Map Panel (OpenLayers with feature layers)
   ├─ Action Panel (visible on player's turn)
   │  ├─ Action Grid: Move, Interact, Search, Use Item, Cast Spell, Talk to NPC, Pass, Free Action
   │  │  └─ Combat actions (phase=combat): Attack, Dash, Dodge, Disengage, Help, Hide, Ready
   │  ├─ NPC Picker: NPC selection grid (social phase only)
   │  ├─ Social Action Grid: Speak/Persuade/Deceive/Intimidate/Insight/Leave (social + NPC selected)
   │  ├─ Rest Panel: Hit dice spending (short) / rest completion (long) (rest phase)
   │  ├─ Death Save Panel: Death save rolls at 0 HP (unconscious + your turn)
   │  ├─ Combat Budget Bar: Action/Bonus Action/Movement/Reaction status (combat only)
   │  ├─ Enemy Turn Indicator: spinner when NPC is acting (combat only)
   │  ├─ Roll Prompt: natural/modifier/total inputs when DM requests a roll
   │  └─ Processing indicator while LLM resolves action
   ├─ Chat Panel (real-time messaging, dice rolling)
   │  ├─ Channel Tabs: Party | DM Whisper | DM Narration (DM) | Private (dynamic)
   │  ├─ Unread badges per channel
   │  └─ Channel-specific message rendering with visual differentiation
   └─ [Exit Game] → dashboard
```

---

## API Endpoint Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/register` | Register |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/profile` | Current user profile |
| GET | `/api/users/{userId}/campaigns` | User's campaigns (DM + player) |
| GET | `/api/users/{userId}/characters` | User's characters |
| GET | `/api/users/{userId}/characters/draft` | Most recent draft |
| POST | `/api/users/{userId}/characters/draft` | Save draft |

### Characters
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/characters` | Create character |
| GET | `/api/characters/{id}` | Get character |
| PUT | `/api/characters/{id}` | Update character |
| DELETE | `/api/characters/{id}` | Delete character |

### SRD Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/srd/species` | List species |
| GET | `/api/srd/species/{key}` | Get species by key |
| GET | `/api/srd/classes` | List classes |
| GET | `/api/srd/classes/{key}` | Get class by key |
| GET | `/api/srd/backgrounds` | List backgrounds |
| GET | `/api/srd/backgrounds/{key}` | Get background by key |
| GET | `/api/srd/spells?class={key}` | Spells for class |
| GET | `/api/srd/items?category={cat}` | Items by category |
| POST | `/api/srd/compute-stats` | Compute character stats |

### Campaigns
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns` | Create campaign |
| GET | `/api/campaigns/{id}` | Get campaign |
| GET | `/api/campaigns/public` | List public recruiting campaigns |
| PUT | `/api/campaigns/{id}` | Update campaign |
| DELETE | `/api/campaigns/{id}` | Delete campaign |

### Campaign Players
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/players` | Join campaign |
| GET | `/api/campaigns/{id}/players` | List players (DM only) |
| GET | `/api/campaigns/{id}/characters` | Campaign characters |
| PATCH | `/api/campaigns/{id}/my-character` | Switch character |
| DELETE | `/api/campaigns/{id}/players/{userId}` | Leave campaign |
| GET | `/api/campaigns/{id}/players/visible` | Visible player positions |
| GET | `/api/campaigns/{id}/players/{playerId}/trail` | Movement trail |

### Movement
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/players/{playerId}/move` | Move player |
| POST | `/api/campaigns/{id}/teleport/player` | Teleport player |
| POST | `/api/campaigns/{id}/teleport/npc` | Teleport NPC |
| GET | `/api/campaigns/{id}/movement-audit` | Movement history |

### Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns/{id}/sessions` | List sessions |
| POST | `/api/campaigns/{id}/sessions` | Create session |
| PUT | `/api/sessions/{sessionId}` | Update session |
| GET | `/api/sessions/{sessionId}/participants` | List participants |
| POST | `/api/sessions/{sessionId}/participants` | Add participant |

### Encounters
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/encounters` | Create encounter |
| GET | `/api/campaigns/{id}/encounters` | List encounters |
| PUT | `/api/encounters/{id}` | Update encounter |
| POST | `/api/encounters/{id}/participants` | Add combatant |
| POST | `/api/encounters/{id}/initiative` | Roll initiative |
| PUT | `/api/encounter-participants/{id}` | Update combatant |

### Game State
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns/{id}/game-state` | Current game state (phase, turn, round) |
| PUT | `/api/campaigns/{id}/game-state/phase` | Change phase (DM only) |
| POST | `/api/campaigns/{id}/game-state/end-turn` | End current turn (active player or DM) |
| POST | `/api/campaigns/{id}/game-state/dm-world-turn` | Execute DM world turn (DM only) |
| PUT | `/api/campaigns/{id}/game-state/turn-order` | Reorder turns (DM only) |
| POST | `/api/campaigns/{id}/game-state/skip-turn` | Skip a player's turn (DM only) |
| POST | `/api/campaigns/{id}/combat/end` | End combat, distribute XP, return to exploration (DM only) |
| POST | `/api/campaigns/{id}/death-save` | Roll death save for unconscious character, body: `{ characterId, roll }` |

### Actions & Live State
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/actions` | Submit player action for DM resolution (non-blocking) |
| POST | `/api/campaigns/{id}/actions/{actionId}/roll-result` | Submit roll result for awaiting action |
| GET | `/api/campaigns/{id}/actions` | List actions for current session/round |
| GET | `/api/campaigns/{id}/live-states` | All live states for active session |
| PATCH | `/api/campaigns/{id}/live-state` | Patch live state (DM any char, player own char) |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/messages` | Send message (with channel_type, channel_target_user_id) |
| GET | `/api/campaigns/{id}/messages` | Load history (filterable by channel_type, channel_target_user_id) |
| DELETE | `/api/campaigns/{id}/messages/{msgId}` | Delete message |
| GET | `/api/campaigns/{id}/channels/unread` | Unread counts per channel |
| POST | `/api/campaigns/{id}/channels/read` | Mark channel as read |

### Narratives
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/narratives/{type}` | Generate narrative (dm/scene/npc/action/quest) |

### Rest
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/rest/start` | Start rest (DM only), body: `{ restType: 'short'\|'long' }` |
| POST | `/api/campaigns/{id}/rest/spend-hit-die` | Spend hit die during short rest, body: `{ characterId }` |
| POST | `/api/campaigns/{id}/rest/complete` | Complete rest and return to exploration (DM only) |

### Levelling
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/characters/{charId}/level-up` | Level up character, body: `{ hpChoice: 'roll'\|'average' }` |
| POST | `/api/campaigns/{id}/characters/{charId}/milestone-level-up` | Milestone level up (DM only) |

### SRD Compendium
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/srd/items?q=&category=&rarity=&limit=&offset=` | Search items with pagination |
| GET | `/api/srd/spells?q=&school=&level=&class=&concentration=&limit=&offset=` | Search spells with pagination |
| GET | `/api/srd/spells/{key}` | Get spell by key |
| GET | `/api/srd/compendium/search?q=&type=&limit=` | Unified search across items + spells |

### Shops
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/shops` | Create shop (DM only) |
| GET | `/api/campaigns/{id}/shops` | List shops (DM sees all, players see active only) |
| GET | `/api/campaigns/{id}/shops/{shopId}` | Get shop with inventory |
| PUT | `/api/campaigns/{id}/shops/{shopId}` | Update shop (DM only) |
| DELETE | `/api/campaigns/{id}/shops/{shopId}` | Delete shop (DM only) |
| POST | `/api/campaigns/{id}/shops/{shopId}/inventory` | Add item to shop (DM only) |
| PUT | `/api/campaigns/{id}/shops/{shopId}/inventory/{entryId}` | Update inventory entry (DM only) |
| DELETE | `/api/campaigns/{id}/shops/{shopId}/inventory/{entryId}` | Remove item from shop (DM only) |
| POST | `/api/campaigns/{id}/shops/{shopId}/purchase` | Purchase item (player), body: `{ characterId, itemKey, quantity }` |
| POST | `/api/campaigns/{id}/shops/{shopId}/auto-stock` | LLM auto-stock shop (DM only) |

### Loot Tables
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns/{id}/loot-tables` | Create loot table (DM only) |
| GET | `/api/campaigns/{id}/loot-tables` | List loot tables (DM only) |
| GET | `/api/campaigns/{id}/loot-tables/{tableId}` | Get loot table with entries (DM only) |
| PUT | `/api/campaigns/{id}/loot-tables/{tableId}` | Update loot table (DM only) |
| DELETE | `/api/campaigns/{id}/loot-tables/{tableId}` | Delete loot table (DM only) |
| POST | `/api/campaigns/{id}/loot-tables/{tableId}/entries` | Add entry (DM only) |
| PUT | `/api/campaigns/{id}/loot-tables/{tableId}/entries/{entryId}` | Update entry (DM only) |
| DELETE | `/api/campaigns/{id}/loot-tables/{tableId}/entries/{entryId}` | Remove entry (DM only) |
| POST | `/api/campaigns/{id}/loot-tables/{tableId}/roll` | Roll on table (DM only), body: `{ count }` |

### NPCs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns/{id}/npcs` | List NPCs |
| POST | `/api/campaigns/{id}/npcs` | Create NPC |
| PUT | `/api/npcs/{npcId}` | Update NPC |
| DELETE | `/api/npcs/{npcId}` | Delete NPC |
| GET | `/api/campaigns/{id}/npcs/{npcId}/memories` | NPC memories and relationships |

### Campaign Prep
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns/{id}/spawns` | List spawn points |
| PUT | `/api/campaigns/{id}/spawn` | Upsert default spawn |
| GET | `/api/campaigns/{id}/objectives` | List objectives |
| POST | `/api/campaigns/{id}/objectives` | Create objective |
| PUT | `/api/objectives/{id}` | Update objective |
| PUT | `/api/objectives/{id}/location` | Link to map location |
| DELETE | `/api/objectives/{id}` | Delete objective |
| POST | `/api/objectives/{id}/assist/{field}` | AI assist (description/treasure/combat/npcs/rumours) |
| GET | `/api/campaigns/{id}/map-regions` | List regions |
| POST | `/api/campaigns/{id}/map-regions` | Create region |
| PUT | `/api/campaigns/{id}/map-regions/{regionId}` | Update region |
| DELETE | `/api/campaigns/{id}/map-regions/{regionId}` | Delete region |

### Maps
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/maps/world` | List world maps |
| GET | `/api/maps/world/{id}` | Get world map |
| GET | `/api/maps/world/{id}/status` | Feature counts per layer |
| POST | `/api/maps/world` | Create world map |
| GET | `/api/maps/{worldId}/burgs` | List burgs (with bounds filter) |
| GET | `/api/maps/{worldId}/burgs/search` | Search burgs by name |
| GET | `/api/maps/{worldId}/markers` | List markers |
| GET | `/api/maps/{worldId}/rivers` | List rivers |
| GET | `/api/maps/{worldId}/routes` | List routes |
| GET | `/api/maps/{worldId}/cells` | List cells (bounds required) |
| GET | `/api/maps/tilesets` | List tile sets |
| POST | `/api/upload/map/svg` | Upload SVG map |
| POST | `/api/upload/map/{worldId}/layer` | Upload GeoJSON layer |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/metrics` | System metrics |
| GET | `/api/admin/telemetry` | Telemetry snapshot |
| GET | `/api/admin/llm/metrics` | LLM metrics |
| GET | `/api/admin/llm/cache` | LLM cache snapshot |
| DELETE | `/api/admin/llm/cache` | Clear LLM cache |
| DELETE | `/api/admin/llm/cache/{key}` | Invalidate cache entry |
| GET | `/api/admin/llm/providers` | List LLM providers |
