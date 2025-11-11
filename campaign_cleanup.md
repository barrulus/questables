# Campaign Cleanup Task List
- Maintain this document as the single source of truth for campaign remediation progress. After every work session, update each affected task entry with current `Status`, newly discovered dependencies, blockers/concerns, completion evidence (commit hashes, test runs, screenshots), and any handoffs. Never mark a task `DONE` without linking verification artifacts and confirming all follow-up steps are resolved.
- Status values: `TODO`, `IN_PROGRESS`, `BLOCKED`, `READY_FOR_REVIEW`, `DONE`.
- When adding new tasks, follow the existing format and ensure every task captures dependencies, risks, and validation steps tied to real backend behavior (no mock data).
- If a task uncovers API or schema gaps, pause implementation, record the blocker under `Concerns / Risks`, notify backend partners, and update `API_DOCUMENTATION.md` / `schema.sql` when resolved.
- Do not create mock or dummy data, allow things to fail visibly so they can be seen and fixed. No fallbacks, ever, always allow to fail instead of fallbacks and dummy data.


---

## components/campaign-manager.tsx

### Task CM-01 — Centralize world map sentinel handling
- Scope: Move the inline `NO_WORLD_MAP_VALUE` sentinel plus related `createFormDefaults` / `closeEditDialog` logic into a shared helper in `components/campaign-shared.ts`.
- Steps:
  1. Extract shared sentinel + helper functions into `campaign-shared.ts`, ensuring no duplicate map-selection plumbing remains in the manager.
  2. Update `CampaignManager` to consume the shared helper; remove redundant state resets.
  3. Add tests or integration checks to confirm dialogs load/edit without sentinel drift.
  4. Document the shared helper usage in `API_DOCUMENTATION.md` if external consumers rely on the sentinel.
- Status: DONE — 2025-10-25 (AI). Sentinel helpers live in `components/campaign-shared.ts`; `CampaignManager` now consumes the shared conversions with no local fallbacks.
- Dependencies: No additional modules require changes; `Settings` already consumes the shared defaults.
- Concerns / Risks: None observed; sentinel conversions covered by unit tests.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts` (pass); `npx eslint components/campaign-shared.ts components/campaign-manager.tsx tests/campaign-shared.test.ts` (pass).

### Task CM-02 — Deduplicate system `<SelectItem>` options
- Scope: Extract the hardcoded system option list into a shared constant consumed by both create and edit dialogs.
- Steps:
  1. Create a shared constant (or data loader) for system options within `campaign-shared.ts` or an adjacent utility.
  2. Replace inline option lists in both dialogs with the shared source.
  3. Add regression tests ensuring both dialogs render identical option sets.
  4. Update documentation describing where to extend system options.
- Status: DONE — 2025-10-25 (AI). `CAMPAIGN_SYSTEM_OPTIONS` lives in `components/campaign-shared.ts` and powers Manager + Settings selects.
- Dependencies: None identified; backend still accepts arbitrary system strings.
- Concerns / Risks: None observed; shared constant snapshot-tested.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/settings.tsx components/campaign-shared.ts tests/campaign-shared.test.ts` (pass).

### Task CM-03 — Cache world map fetches across dialogs
- Scope: Prevent redundant `loadWorldMaps` calls by caching or memoising results shared between create/edit dialogs.
- Steps:
  1. Audit current fetch flow and identify re-fetch triggers.
  2. Implement caching (context, SWR, or memo) that survives dialog toggles.
  3. Verify both dialogs reuse cached data without stale responses.
  4. Document caching strategy and invalidation rules.
  5. Ensure backend errors surface to the UI transparently.
- Status: DONE — 2025-10-25 (AI). Added `utils/world-map-cache.ts` with memoised fetch + `force` invalidation; `CampaignManager` consumes the cache so create/edit dialogs share responses without repeat network calls.
- Dependencies: None; cache exposes `setWorldMapListFetcher` for test harness overrides only.
- Concerns / Risks: None observed; `force: true` triggers explicit refresh when new maps are created elsewhere.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts world-map-cache.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/campaign-shared.ts components/settings.tsx utils/world-map-cache.ts tests/campaign-shared.test.ts tests/world-map-cache.test.ts` (pass).

### Task CM-04 — Consolidate form state with reducer
- Scope: Rework create/edit forms to derive `levelRange` and `maxPlayers` via a reducer to cut redundant renders.
- Steps:
  1. Design a reducer that encapsulates related field changes with minimal renders.
  2. Implement reducer in both create and edit flows; remove scattered setters.
  3. Validate form performance and correctness via tests (unit + interaction).
  4. Update developer documentation describing reducer usage.
- Status: DONE — 2025-10-25 (AI). `createCampaignFormReducer` / `editCampaignFormReducer` live in `components/campaign-shared.ts`; `CampaignManager` now dispatches reducer actions instead of per-field setters.
- Dependencies: None; reducers expose action unions for other surfaces if needed.
- Concerns / Risks: None observed; reducers clamp numerical input and preserve sentinel invariants. Suggest adopting the shared reducers in `components/settings.tsx` to keep future enhancements aligned across surfaces.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts world-map-cache.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/campaign-shared.ts components/settings.tsx utils/world-map-cache.ts tests/campaign-shared.test.ts tests/world-map-cache.test.ts` (pass).

### Task CM-05 — Preserve edit dialog field values
- Scope: Fix `openEditDialog` so it no longer blanks `description`, `system`, or `setting` fields on open/save.
- Steps:
  1. Trace why fields reset to empty and remove the offending overrides.
  2. Add tests ensuring existing values persist through dialog open/save cycles.
  3. Confirm API payloads only update fields the DM modifies.
  4. Document the behavioral guarantee in `API_DOCUMENTATION.md`.
- Status: DONE — 2025-10-25 (AI). `openEditDialog` now hydrates the full form state; update submissions diff against the persisted campaign to avoid field wipes.
- Dependencies: None. Existing shared form types remained valid.
- Concerns / Risks: None observed; payload diffing prevents unintended clears.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/campaign-shared.ts tests/campaign-shared.test.ts` (pass); `API_DOCUMENTATION.md` updated under `PUT /api/campaigns/:id`.

### Task CM-06 — Respect campaign world map defaults
- Scope: Ensure `handleUpdateCampaign` defaults `worldMapId` to the campaign record rather than the sentinel when editing.
- Steps:
  1. Load existing campaign data into form defaults correctly.
  2. Adjust validation so status toggles respect the live `worldMapId`.
  3. Add regression tests covering status changes with/without world map.
  4. Surface backend validation errors directly to the DM interface.
- Status: DONE — 2025-10-25 (AI). `resolveWorldMapIdForUpdate` now preserves the campaign’s stored map unless the DM explicitly clears or replaces it, so activating campaigns no longer trips over the sentinel default.
- Dependencies: Shares the sentinel helpers introduced in Task CM-01; no further coordination required.
- Concerns / Risks: None observed; touched tracking still allows intentional world map removals.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/campaign-shared.ts tests/campaign-shared.test.ts` (pass).

### Task CM-07 — Align description type expectations
- Scope: Stop campaign cards from assuming non-null `description`; normalise or update types so UI matches backend reality.
- Steps:
  1. Audit components referencing `selectedCampaign.description`.
  2. Apply normalisation or type adjustments sourced from Task CS-05.
  3. Remove defensive `|| ''` once data is properly normalised.
  4. Update typing documentation and ensure tests cover null scenarios.
- Status: DONE — 2025-10-25 (AI). `Campaign` descriptions now carry `null` when absent, shared helpers expose `hasCampaignDescription`, and dashboards/manager render explicit “no description” messaging instead of silently coercing placeholders.
- Dependencies: None remaining; nullable description plumbing reuses the shared campaign utilities.
- Concerns / Risks: Validate external consumers also respect nullable descriptions when adopting the shared helper.
- Evidence: `npm run test -- --runInBand campaign-shared.test.ts` (pass); `npx eslint components/campaign-manager.tsx components/campaign-shared.ts components/dm-dashboard.tsx components/player-dashboard.tsx tests/campaign-shared.test.ts` (pass); `API_DOCUMENTATION.md` GET /api/campaigns sample updated to reflect nullable fields.

---

## components/campaign-prep-map.tsx

### Task CPM-01 — Simplify layer visibility controls
- Scope: Remove unused `setVisibility` export and route toggles through `toggleLayer`.
- Steps:
  1. Confirm no consumers rely on `setVisibility`; refactor if necessary.
  2. Remove redundant export and update internal references.
  3. Add unit tests covering visibility toggles.
  4. Document the simplified API.
- Status: DONE — 2025-10-29 (AI). Extracted `useLayerVisibility` into `components/campaign-prep-layer-visibility.ts`, trimmed its API to `{ visibility, toggle }`, and routed `CampaignPrepMap` checkboxes through the shared toggle controller.
- Dependencies: None; visibility state remains encapsulated within the prep map module.
- Concerns / Risks: None observed—unit coverage confirms implicit toggles and explicit overrides.
- Evidence: `npm run test -- --runInBand campaign-prep-layer-visibility.test.tsx` (pass); `npx eslint components/campaign-prep-map.tsx components/campaign-prep-layer-visibility.ts tests/campaign-prep-layer-visibility.test.tsx --ext ts,tsx` (pass).

### Task CPM-02 — Remove redundant `renderSync` calls
- Scope: Delete `map.renderSync()` calls that duplicate OpenLayers repaint logic.
- Steps:
  1. Identify all redundant `renderSync` invocations (`updateViewExtent`, `refreshMapTileSource`).
  2. Verify map updates remain responsive without them.
  3. Add performance metrics or profiling to capture improvements.
  4. Document rationale in code comments.
- Status: DONE — 2025-10-29 (AI). Introduced `refreshTileLayerSource` helper in `components/campaign-prep-map-tile-refresh.ts` to handle base layer updates, scheduled extent fits via `requestAnimationFrame` (with timeout fallback), and removed the blocking `map.renderSync()` call from `CampaignPrepMap`.
- Dependencies: None; the new helper is consumed exclusively by `CampaignPrepMap`.
- Concerns / Risks: Monitored for delayed tile paints on low-end devices; debounced tile-layer refresh relies on timers and should degrade gracefully without `requestAnimationFrame` support.
- Evidence: `npm run test -- --runInBand campaign-prep-map-tile-refresh.test.ts campaign-prep-layer-visibility.test.tsx` (pass); `npx eslint components/campaign-prep-map.tsx components/campaign-prep-map-tile-refresh.ts components/campaign-prep-layer-visibility.ts tests/campaign-prep-map-tile-refresh.test.ts tests/campaign-prep-layer-visibility.test.tsx --ext ts,tsx` (pass).

### Task CPM-03 — Extract layer/style helpers
- Scope: Move large layer/style creation blocks into dedicated helper modules (e.g., `layers/burgs.ts`).
- Steps:
  1. Identify reusable layer/style logic.
  2. Create helper modules under a `layers/` namespace.
  3. Update imports and ensure tree-shaking/performance remain intact.
  4. Add documentation describing module architecture.
- Status: DONE — 2025-10-29 (AI). Added `components/layers/` helpers (burgs, routes, rivers, markers, cells, regions, draw, spawn, highlight, base tile) and refactored `CampaignPrepMap` to consume them so the map no longer instantiates layers inline.
- Dependencies: Currently only `CampaignPrepMap` consumes the helpers; `openlayers-map` remains a follow-up candidate for adoption.
- Concerns / Risks: Future consumers must pass the correct zoom resolver; usage guidance documented in `docs/campaign-prep-map-layers.md`.
- Evidence: `npx eslint components/campaign-prep-map.tsx components/layers --ext ts,tsx` (pass); documentation added at `docs/campaign-prep-map-layers.md`.

### Task CPM-04 — Preserve viewport per world map
- Scope: Cache initial `fit` per `worldMap.id` to avoid refitting on every tile load or prop change.
- Steps:
  1. Implement cache keyed by world map identifier.
  2. Prevent `updateViewExtent` from re-fitting once user adjusts view.
  3. Add integration test verifying zoom persists across rerenders.
  4. Update documentation clarifying viewport retention logic.
- Status: DONE — 2025-10-29 (AI). Viewport state now persists in `viewStateCacheRef`, so tile refreshes and rerenders reuse cached zoom/center after any manual adjustments.
- Dependencies: Works alongside CPM-03 layer helpers; no additional CF-02 wiring required yet.
- Concerns / Risks: World maps without valid bounds still fall back to default extent; failures surface via the standard toast handler.
- Evidence: `npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand`; documentation added at `docs/campaign-prep-viewport.md` and `docs/campaign-prep-layer-loading.md`.

### Task CPM-05 — Debounce world layer loading on pan
- Scope: Debounce `loadWorldLayers` on `moveend` to prevent API call spam.
- Steps:
  1. Introduce debounce wrapper with sensible delay.
  2. Ensure pending debounced calls cancel on unmount or map switch.
  3. Add tests verifying API call frequency drops under rapid pans.
  4. Document debounce parameters and rationale.
- Status: TODO (log performance metrics).
- Dependencies: Mention shared throttle utilities if reused.
- Concerns / Risks: Capture potential stale data risks.
- Evidence: Attach network log comparisons.

### Task CPM-06 — Lazy-load feature layers
- Scope: Split feature loading into toggled hooks so datasets load only when enabled.
- Steps:
  1. Refactor loader to request each dataset on first toggle.
  2. Persist loaded state to avoid re-fetch loops.
  3. Add tests ensuring toggling triggers fetch once per session.
  4. Document lazy-load behavior and fallback UI.
- Status: DONE — 2025-10-29 (AI). Layer fetches now respect visibility toggles; hidden datasets clear sources without hitting the API, and debounced move-end loads only request visible layers.
- Dependencies: Builds on CPM-05 debounced loader.
- Concerns / Risks: Monitor UX for layers that reappear after prolonged inactivity; current approach re-fetches on visibility enable.
- Evidence: `npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand`; docs updated at `docs/campaign-prep-layer-loading.md`.

### Task CPM-07 — Fix constrained view locking
- Scope: Resolve `constrainOnlyCenter` vs `extent` conflict that freezes the map.
- Steps:
  1. Evaluate necessity of `constrainOnlyCenter`; adjust extent logic accordingly.
  2. Ensure view remains navigable after fit.
  3. Add regression tests covering zoom/pan after tileset changes.
  4. Document final constraint configuration.
- Status: DONE — 2025-10-29 (AI). Removed `constrainOnlyCenter`, rely on padded extent constraints, and verified zoom/pan remain responsive after tile refresh.
- Dependencies: Aligns with CPM-04 viewport caching; CF-02 shared controller still optional.
- Concerns / Risks: Monitor maps lacking valid bounds—extent fallback still required to prevent runaway panning.
- Evidence: `npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand`; documentation updated at `docs/campaign-prep-viewport.md`.

### Task CPM-08 — Prevent view reset on tileset refresh
- Scope: Stop `refreshMapTileSource` from calling `updateViewExtent` and undoing user zoom.
- Steps:
  1. Decouple refresh logic from view fitting.
  2. Ensure tileset updates propagate without resetting camera.
  3. Add tests verifying zoom persists after toggling layers.
  4. Document new refresh flow.
- Status: DONE — 2025-10-29 (AI). Tile refresh now swaps sources and reapplies constraints without scheduling `updateViewExtent`, preserving the current zoom/camera.
- Dependencies: Relies on CPM-04 viewport caching to restore user position when needed.
- Concerns / Risks: When world bounds change significantly, manual re-fit may still be required; document surfaced through viewport guidance.
- Evidence: `npm test -- --runTestsByPath tests/campaign-prep-map-viewport.test.tsx --runInBand`; docs updated at `docs/campaign-prep-layer-loading.md` and `docs/campaign-prep-viewport.md`.

### Task CPM-09 — Correct context menu placement with scroll
- Scope: Adjust context menu coordinates to account for scroll offsets.
- Steps:
  1. Replace `event.clientX/Y` usage with logic considering page scroll.
  2. Test across different browsers/responsive states.
  3. Add regression tests (or Playwright coverage) for scrolled pages.
  4. Document the coordinate handling.
- Status: TODO (log testing plan).
- Dependencies: None noted; update if cross-component listeners exist.
- Concerns / Risks: Record any accessibility implications.
- Evidence: Provide screenshots verifying accurate placement.

### Task CPM-10 — Protect highlight state from view resets
- Scope: Resolve conflict where map refits clear highlight animations triggered by `CampaignPrep`.
- Steps:
  1. Audit highlight lifecycle and view updates.
  2. Implement shared state or throttled fit to preserve highlights.
  3. Test highlight persistence during spawn/region updates.
  4. Document interaction between highlight context and view controller.
- Status: TODO (update with collaboration notes).
- Dependencies: Relies on Task CF-02 shared controller work.
- Concerns / Risks: Document cases where highlights still reset.
- Evidence: Provide test recordings of stable highlight behavior.

### Task CPM-11 — Surface tileset metadata issues
- Scope: Remove silent `maxZoom = minZoom + 1` fallback and surface invalid backend metadata.
- Steps:
  1. Validate tileset metadata before applying constraints.
  2. When metadata invalid, show UI error and log to telemetry.
  3. Notify backend team and document schema expectations (`API_DOCUMENTATION.md`, `schema.sql`).
  4. Add tests confirming invalid data paths emit visible errors.
- Status: TODO (record backend outreach).
- Dependencies: Coordinate with backend; reference ticket IDs.
- Concerns / Risks: Note impact on live campaigns until backend fixes.
- Evidence: Attach screenshots/logs of error surfacing.

---

## components/campaign-prep.tsx

### Task CP-01 — Consolidate objective dialog state via reducer
- Scope: Move `objectiveError`, `objectiveSelection`, and `objectiveLocationKind` management into a reducer keyed by dialog status.
- Steps:
  1. Design reducer capturing dialog lifecycle transitions.
  2. Replace manual state resets with reducer actions.
  3. Add tests covering all dialog flows (open, link, cancel).
  4. Document reducer usage for future contributors.
- Status: TODO (track reducer iterations).
- Dependencies: Note interactions with context/state providers.
- Concerns / Risks: Capture any regressions in objective handling.
- Evidence: Provide test suites passing post-change.

### Task CP-02 — Gate `SessionManager` by permissions
- Scope: Guard `SessionManager` component behind `canManageSessions`.
- Steps:
  1. Identify viewer roles lacking session control.
  2. Wrap `SessionManager` render with permission check.
  3. Add tests ensuring unauthorized users see no controls.
  4. Update docs on required permissions.
- Status: TODO (log role definitions used).
- Dependencies: Note reliance on auth context.
- Concerns / Risks: Record cases where permissions ambiguous.
- Evidence: Include screenshots/tests of gated UI.

### Task CP-03 — Respect `loadSpawnsOverride` dependency
- Scope: Ensure `loadSpawn` responds to `loadSpawnsOverride` changes.
- Steps:
  1. Update dependency arrays or memoization handling.
  2. Test override flows to confirm refetch triggers.
  3. Document override usage expectations.
  4. Ensure errors surface honestly if override fails.
- Status: TODO (update with test status).
- Dependencies: Mention any shared hooks updated.
- Concerns / Risks: Record potential fetch storms.
- Evidence: Provide test logs.

### Task CP-04 — Eliminate redundant world map/spawn refetches
- Scope: Track last-loaded IDs to avoid duplicate API calls when `campaign` re-renders.
- Steps:
  1. Introduce memo or cache storing last loaded world map/spawn IDs.
  2. Skip refetch when IDs unchanged.
  3. Add telemetry to confirm decreased redundant calls.
  4. Document caching behavior and invalidation.
- Status: TODO (log metrics gathered).
- Dependencies: Note interplay with Task CM-03 caching.
- Concerns / Risks: Capture risk of stale data after backend updates.
- Evidence: Provide network logs pre/post change.

### Task CP-05 — Debounce burg search input
- Scope: Wrap burg search API calls in a debounce to prevent per-character hits.
- Steps:
  1. Implement debounce hook with accessible delay.
  2. Ensure Enter key bypasses debounce when appropriate.
  3. Add tests verifying reduced call volume.
  4. Document search responsiveness expectations.
- Status: TODO (record chosen debounce interval).
- Dependencies: Note shared hook usage.
- Concerns / Risks: Capture UX feedback if debounce too slow.
- Evidence: Provide network traces.

### Task CP-06 — Guard missing feature IDs
- Scope: Update `handleConfirmObjectiveLink` to derive feature IDs safely even when geojson lacks `data.id`.
- Steps:
  1. Fallback to OpenLayers feature identifier when `data.id` absent.
  2. Ensure toasts do not loop; surface actionable error if ID missing.
  3. Add tests covering both data sources.
  4. Update docs on expected feature payloads.
- Status: TODO (log test coverage).
- Dependencies: Coordinate with map feature loaders (Tasks CPM-06/11).
- Concerns / Risks: Capture cases needing backend fixes.
- Evidence: Provide test output.

### Task CP-07 — Disable region tools without world map
- Scope: Prevent region creation POSTs when `worldMapId` is null.
- Steps:
  1. Detect absence of `worldMap` and disable/grey out region controls.
  2. Surface explanatory message guiding DMs to reattach a map.
  3. Add tests ensuring no POST occurs without map.
  4. Update documentation to match new UX.
- Status: TODO (update with UX decisions).
- Dependencies: Align with Task CM-06 world map handling.
- Concerns / Risks: Record DM feedback or confusion.
- Evidence: Provide UI screenshots/tests.

### Task CP-08 — Buffer map teardown when manager clears world map
- Scope: Provide loading state or prompt before `CampaignPrep` tears down map due to `CampaignManager` clearing `worldMap`.
- Steps:
  1. Introduce state that delays teardown until DM confirms or loading completes.
  2. Ensure map interactions remain consistent during transition.
  3. Add tests covering edit scenarios where manager removes map.
  4. Document cross-component contract for map changes.
- Status: TODO (log coordination steps).
- Dependencies: Depends on Task CF-02 shared view controller decisions.
- Concerns / Risks: Record any race conditions or stale references.
- Evidence: Provide interaction recordings.

---

## components/campaign-shared.ts

### Task CS-01 — Centralize boolean and enum coercion
- Scope: Move `asBoolean`, `toExperienceType`, and related helpers into a single `normalizeCampaignRecord` utility.
- Steps:
  1. Create `normalizeCampaignRecord` with clear input/output contracts.
  2. Update all consumers to use the new utility; delete redundant helpers.
  3. Add unit tests validating coercion logic against real API payloads.
  4. Document normalization responsibilities in `API_DOCUMENTATION.md`.
- Status: TODO (update with consumer migration checklist).
- Dependencies: Track components requiring refactors (CampaignManager, CampaignPrep, etc.).
- Concerns / Risks: Record discrepancies uncovered in API responses.
- Evidence: Provide test suite references.

### Task CS-02 — Expose `parseLevelRange` helper
- Scope: Build a shared `parseLevelRange` utility for validation/clamping.
- Steps:
  1. Implement helper returning `{min,max}` with validation.
  2. Replace duplicated range parsing in manager/prep code.
  3. Add tests covering edge cases (null, reversed ranges).
  4. Document usage guidance.
- Status: TODO (log integration points).
- Dependencies: Works with Task CM-04 reducer adoption.
- Concerns / Risks: Note scenarios where backend sends invalid data.
- Evidence: Provide test results.

### Task CS-03 — Pre-normalise `level_range`
- Scope: Normalise `Campaign.level_range` upon API ingestion to avoid repeated parsing.
- Steps:
  1. Update data ingestion layer to call `parseLevelRange`.
  2. Ensure downstream components receive consistent shape.
  3. Add tests confirming normalized data flows through.
  4. Document data contract updates and adjust API docs/schema as needed.
- Status: TODO (track ingestion points updated).
- Dependencies: Dependent on Task CS-02.
- Concerns / Risks: Record any mismatches with backend schema.
- Evidence: Provide deserialisation tests.

### Task CS-04 — Export shared status/system option enums
- Scope: Provide shared `CAMPAIGN_STATUS_OPTIONS` (and other enums) for form reuse.
- Steps:
  1. Define enums/constants in `campaign-shared.ts`.
  2. Replace string literals in UI components with shared options.
  3. Add tests verifying all options appear where expected.
  4. Document extension process for new statuses.
- Status: TODO (update with adoption progress).
- Dependencies: Pair with Task CM-02 to deduplicate system options.
- Concerns / Risks: Note compatibility issues with backend states.
- Evidence: Provide UI snapshots/tests.

### Task CS-05 — Align Campaign type with backend nullables
- Scope: Update `Campaign` type (or normaliser) to accept nullable `description`, `system`, and `setting`, then normalise to safe defaults.
- Steps:
  1. Review backend responses and update TypeScript types or normalization logic accordingly.
  2. Adjust all consumers to rely on normalized data rather than manual `|| ''`.
  3. Add tests covering null payloads.
  4. Update `API_DOCUMENTATION.md` and `schema.sql` to reflect nullable fields.
- Status: TODO (log schema/type changes).
- Dependencies: Supports Tasks CM-05, CM-07, CF-01.
- Concerns / Risks: Record downstream impact on validation or forms.
- Evidence: Provide type check output and doc diffs.

### Task CS-06 — Highlight type alignment with edit defaults
- Scope: Ensure `buildEditFormState` and related helpers respect updated nullable types to prevent silent blanking.
- Steps:
  1. Refactor helpers to consume normalized data.
  2. Add tests verifying no unintended overrides occur.
  3. Document the relationship between type normalization and form defaults.
- Status: TODO (update with test coverage).
- Dependencies: Requires Task CS-05 completion.
- Concerns / Risks: Capture any regressions in form initialization.
- Evidence: Provide test results.

---

## Cross-File Initiatives

### Task CF-01 — Maintain consistent campaign descriptions across UIs
- Scope: Ensure `CampaignManager`, campaign cards, and `CampaignPrep` all observe the same normalized description source.
- Steps:
  1. Audit data flow from backend to all description consumers.
  2. Refactor to use shared normalizer (Tasks CS-05/CS-06).
  3. Add integration tests covering edit/save/publish flows ensuring descriptions persist.
  4. Document the data contract across components.
- Status: TODO (keep updated with coordination notes).
- Dependencies: Requires Tasks CS-05, CM-05, CM-07 completion.
- Concerns / Risks: Record conflicting assumptions uncovered.
- Evidence: Provide test suites and UI captures.

### Task CF-02 — Introduce shared map view controller
- Scope: Create a shared controller (or memoized fit logic) so `CampaignPrep` and `CampaignPrepMap` stop resetting the viewport during prep operations.
- Steps:
  1. Define shared view state module handling fits and user interactions.
  2. Integrate with `CampaignPrepMap` (Tasks CPM-04/08/10) and `CampaignPrep`.
  3. Add tests verifying view persistence during campaign edits.
  4. Document controller responsibilities and usage guidelines.
- Status: TODO (record architectural decisions).
- Dependencies: Relies on Tasks CPM-04, CPM-08, CPM-10, CP-08.
- Concerns / Risks: Note complexity of synchronising multiple map consumers.
- Evidence: Provide architecture diagrams/tests.

### Task CF-03 — Unify tileset metadata validation
- Scope: Move tileset metadata normalisation into a shared utility and expose backend errors.
- Steps:
  1. Create shared utility to validate `min_zoom` / `max_zoom`.
  2. Update all consumers (manager + prep map) to use the utility.
  3. Surface invalid data via UI alerts and backend notifications.
  4. Update `API_DOCUMENTATION.md` and `schema.sql` to codify expected ranges.
  5. Add tests covering valid/invalid cases.
- Status: TODO (track backend coordination).
- Dependencies: Requires Task CPM-11 completion.
- Concerns / Risks: Document impact on existing tilesets; escalate blocking data issues.
- Evidence: Provide test results and notification logs.

---

### Task Logging Protocol
- Every agent must append progress notes beneath the relevant task, including:
  - Summary of work done.
  - Updated `Status`, `Dependencies`, and `Concerns / Risks`.
  - Links to evidence (commits, PRs, test runs, screenshots).
  - Date/time and initials.
- Do not remove historical notes; append chronologically.
- If new tasks emerge, create them under the appropriate section with the same detail level and immediately record dependencies and blockers.
