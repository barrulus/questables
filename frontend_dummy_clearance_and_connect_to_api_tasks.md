# Frontend Dummy Clearance & API Integration Task List

All tasks below are required to eliminate dummy data from the Questables frontend and connect every feature to the real backend services. **No fabricated progress is permitted.** Every task owner must:

- Perform the implementation work described.
- Remove or archive redundant mocks, fixtures, demo helpers, and unused assets introduced by the cleanup.
- Update user-facing docs and internal notes so they match reality.
- Record factual progress in `clearance_and_connect_tasks_documentation.md` (see that file for the logging template) immediately after work is verified. If work is attempted but blocked, log the block instead of claiming completion.
- Submit or link to evidence (commits, screenshots, test runs) in the central log—again, only for work that actually happened.

---

## Task 1 – Restore Authentic Authentication Flow
- Eliminate the "demo account" fallback in `components/register-modal.tsx:83-96` and any similar shortcuts elsewhere.
- Verify `databaseClient.auth.login/register` hit the live `/api/auth/*` endpoints; implement error UX that surfaces backend failures without faking success.
- Confirm `UserContext` persists only real users; add defensive handling for invalid sessions (clear storage, display message).
- Remove any unused helpers related to demo accounts or mock auth.
- Update onboarding/setup docs (`README.md`, env examples) with accurate prerequisites (TLS, `VITE_DATABASE_SERVER_URL`, etc.).
- Report all attempts, outcomes, and resulting cleanups in the central log.

## Task 2 – Wire Player Dashboard to Real Data
- Replace the hardcoded character/campaign arrays in `components/player-dashboard.tsx` with hooks that load the signed-in user's data via the database helpers or REST endpoints.
- Support loading, error, and empty states tied to real responses; add optimistic updates for actions (join campaign, launch game) if needed.
- Delete unused dummy avatars, placeholder data, and any dead UI branches once real data flows exist.
- Document exactly what API endpoints were used, any new helper functions, and residual gaps in the central log.

## Task 3 – Wire DM Dashboard to Real Campaign, NPC, and Location Data
- Refactor `components/dm-dashboard.tsx` to source campaigns, locations, NPCs, routes, etc. from backend APIs.
- Ensure DM-specific actions (create campaign, manage NPCs) persist to the database and reflect immediately in UI.
- Remove dummy Middle-earth fixtures and associated assets.
- Update component-level docs/comment blocks to describe the true workflow.
- Log implementation details, including deleted files and any backend gaps uncovered.

## Task 4 – Wire Admin Dashboard to Real Metrics (or Disable It Honestly)
- Audit `components/admin-dashboard.tsx`; replace fabricated metrics with real analytics endpoints. If metrics do not exist server-side, redesign the UI to state the limitation explicitly instead of displaying fake numbers.
- Remove all sample data structures.
- Clean up unused chart utilities or assets created solely for dummy visuals.
- Document the true state (implemented metrics vs. feature flag/off) in the central log.

## Task 5 – Character Manager CRUD Integration
- Connect `components/character-manager.tsx` to real character CRUD APIs (`characterHelpers` or REST endpoints). Allow creation, editing, deletion, and selection tied to user/campaign context.
- Replace in-memory skills/equipment lists with live data; ensure JSON fields are parsed/mapped correctly.
- Delete local placeholder data and helper functions made redundant by database integration.
- Add integration tests (or expand existing ones) that hit the real helpers with mocked network responses.
- Record implementation steps, tests executed, and code removal in the central log.

## Task 6 – Campaign Manager & Selection Flow Fixes
- Make `components/campaign-manager.tsx` resilient: ensure authenticated requests succeed, add retry/refresh controls, and persist membership changes to backend.
- Filter campaigns by active user/campaign context using actual API data.
- Remove fallback code paths that silently ignore failures or inject demo campaigns.
- Update documentation on how campaigns are fetched/filtered.
- Log results and lingering issues in the central log.

## Task 7 – Chat Systems (ChatPanel & ChatSystem) Real-Time + Persistence
- Replace static message arrays and party member lists with live data from `/api/campaigns/:id/messages` plus WebSocket updates.
- Make `useWebSocket` configurable (respect env host/TLS) and ensure messages persist server-side.
- Remove mock data, demo quick actions that no longer apply, and unused helper code.
- Document the tested scenarios (online/offline mode, reconnection) and note any limitations in the central log.

## Task 8 – Session Manager Integration
- Ensure `components/session-manager.tsx` receives valid `campaignId` from context and loads real session data.
- Wire create/start/end flows to backend endpoints; add proper form validation and error handling.
- Remove spinner loops caused by unauthenticated calls; add user feedback when backend rejects the action.
- Clean up unused placeholder states.
- Log the implemented flows, API coverage, and follow-up work in the central log.

## Task 9 – Combat Tracker Integration
- Connect `components/combat-tracker.tsx` to real encounter data (fetch, create, update participants) and ensure WebSocket updates broadcast to all clients.
- Replace `Math.random()` initiative placeholders with backend-driven initiative or a documented deterministic approach that persists results.
- Remove mock condition arrays if the backend supplies alternatives; otherwise document why they remain.
- Record test results (including multi-user scenarios if possible) in the central log.

## Task 10 – Inventory, Spellbook, NPC, Journals, Dice Roller & Misc Tools
- For each tool component backed by dummy data (`inventory.tsx`, `spellbook.tsx`, `npc-manager.tsx`, `journals.tsx`, `dice-roller.tsx`, etc.), connect to the appropriate backend endpoints or explicitly mark the feature as unavailable.
- Consolidate shared data-fetching hooks to avoid duplication.
- Remove stale fixtures/assets.
- Update README or feature docs to reflect the real capability set post-cleanup.
- Log every sub-component addressed and any remaining TODOs in the central log.

## Task 11 – App Shell & Context Finalization
- Ensure `App.tsx` uses live session/campaign names instead of hardcoded "The Fellowship of the Ring" labels; fetch session metadata dynamically.
- Audit `UserContext`, `DatabaseProvider`, and global providers to confirm they expose real data and surfaced errors.
- Remove unused context fields introduced for demo features.
- Verify startup/shutdown flows (connection tests, offline mode) behave correctly and document actual behavior.
- Log findings, modifications, and any design deviations in the central log.

## Task 12 – Documentation & Test Coverage Cleanup
- Update `data_mismatch.md`, `docs/PHASE_*`, and README to reflect the true project status after fixes. Remove celebratory fabrication.
- Ensure `.env.example` and setup guides list only required variables with accurate descriptions.
- Add automated tests (unit/integration/e2e) that cover the newly wired flows; remove obsolete mock-based tests that no longer apply.
- Log documentation updates, tests added/removed, and remaining doc debt in the central log.

## Task 13 – Role-Aware Dashboard Landing & Navigation
- When a user logs in, always land them on the player dashboard regardless of elevated roles so personal play sessions are immediately accessible.
- Introduce clear navigation (button or menu) that lets DMs jump into DM tooling and admins open the system dashboard without logging out.
- Ensure admin dashboard lives on a secondary page; remove any assumptions that admin role replaces the player view entirely.
- Surface the navigation changes in documentation (`README.md`, onboarding guides) and update contexts/App shell accordingly.
- Log implementation details and navigation decisions in the central log once verified.

---

## Working Agreement
- No task is considered complete until the central log entry is written with verifiable details.
- If you hit a blocker (e.g., missing backend endpoint), log the issue, notify the backend team, and mark the task as "blocked" with next steps—do **not** fabricate progress.
- Keep branches/PRs scoped to the tasks above to maintain traceability between code changes and logged activities.
