# Campaign Review

## components/campaign-manager.tsx
- **Removals / Simplifications**  
  - Inline sentinel `NO_WORLD_MAP_VALUE` and its coupled `createFormDefaults`/`closeEditDialog` logic can move into `campaign-shared.ts` so the manager stops duplicating map-selection plumbing.  
  - The hardcoded system `<SelectItem>` list appears in both create and edit dialogs; extract to a shared constant to avoid keeping two copies in sync.
- **Efficiency Opportunities**  
  - `loadCampaignData` and `loadWorldMaps` run eagerly on every mount; cache world-map fetches or coalesce refresh calls so both dialogs reuse the same list instead of reloading after every edit/save.  
  - Rework the create/edit forms to derive `levelRange` and `maxPlayers` from a reducer – the current scattered setters trigger multiple renders as each field updates.
- **Errors / Bugs**  
  - `openEditDialog` explicitly blanks `description`, `system`, and `setting`, so opening the dialog wipes existing values and pushes empty payloads on save. Users effectively can’t edit these fields without retyping everything.  
  - `handleUpdateCampaign` requires a world map before allowing “active” status, but the edit dialog defaults `worldMapId` to `__none`; switching the status first leaves the user trapped behind the toast. Set the default based on the campaign record instead of the sentinel.
- **Conflicts**  
  - Campaign cards display `selectedCampaign.description` even though `Campaign` treats it as a required string. Backend responses still emit `null`; the type mismatch leaks into `CampaignPrep`, which guards defensively. Align the type or normalise responses once to avoid divergent handling.

## components/campaign-prep-map.tsx
- **Removals / Simplifications**  
  - `useLayerVisibility` now exposes `{ visibility, toggle }` only; the prep map checkboxes route through `toggleLayer`, and hook-level tests cover implicit flips and explicit overrides.  
  - Tile source refresh now flows through `refreshTileLayerSource`, which drops the synchronous `map.renderSync()` call and schedules extent updates via `requestAnimationFrame` (with a timeout fallback) so the UI stays responsive.  
  - Large blocks for layer/style creation can move into helper modules (e.g., `layers/burgs.ts`) so this file isn’t responsible for every vector style definition.
- **Efficiency Opportunities**  
  - `updateViewExtent` refits the view every time tiles load, every resize, and whenever a world map prop changes. Cache the initial `fit` per `worldMap.id` and skip re-fitting so user-controlled zoom persists.  
  - Debounce `loadWorldLayers` on the `moveend` listener; right now tiny pans spam API calls because the guard flag clears before the next animation frame.  
  - Split feature-loading into “burgs/routes/etc.” hooks so layers initialize only when toggled on—most campaigns don’t need all five datasets at once.
- **Errors / Bugs**  
  - The view still locks because we keep `constrainOnlyCenter: true` while forcing `view.setProperties({ extent })`. At the fit level the center cannot move, so the user experiences the same “stuck at full zoom” behaviour. Drop the center constraint or widen the extent relative to the map bounds.  
  - `refreshMapTileSource` immediately calls `updateViewExtent`, undoing any zoom/pan the DM just made whenever a tileset flag flips or a re-render occurs.  
  - Context menu placement uses `event.clientX/Y` without compensating for scroll offsets, so right-clicking after the page scrolls renders the menu far from the cursor.
- **Conflicts**  
  - `CampaignPrep` tracks highlight context state, but `updateViewExtent` + `map.fit` fire after every spawn/region update and reset the view, which clears the highlight animation. The two components fight over view state.  
  - Tileset zoom ranges come from the API, yet `applyTileSetConstraints` silently invents `maxZoom = minZoom + 1` on bad data. That hides upstream schema bugs and leaves `CampaignManager` believing a tileset is healthy when the map still feels wrong.

## components/campaign-prep.tsx
- **Removals / Simplifications**  
  - Several pieces of dialog state (`objectiveError`, `objectiveSelection`, `objectiveLocationKind`) could live inside a reducer keyed by dialog status—resetting everything manually across five callbacks is brittle.  
  - `SessionManager` mounts for every campaign view; guard the component behind `canManageSessions` to avoid allocating it for viewers who can’t use the controls.
- **Efficiency Opportunities**  
  - `loadSpawn` ignores `loadSpawnsOverride` in its dependency array, so prop overrides never refetch; include the override or memoise it higher up.  
  - Both `loadWorldMap` and `loadSpawn` refetch whenever `campaign` changes, even if the selected ID is identical. Track the last-loaded IDs to skip redundant API calls during parent re-renders.  
  - Burg search fires on every keystroke without throttle; wrap the API call in a debounce hook so the backend isn’t hit for each character.
- **Errors / Bugs**  
  - `handleConfirmObjectiveLink` trusts that burg/marker features expose `data.id`. When the tile loader returns geojson without that field we throw a toast-loop; guard by fetching the ID from the feature’s OL-provided identifier.  
  - Region creation sends `worldMap?.id ?? null`; when a DM removes the world map inside the manager the prep view keeps offering region tools but the POST now lacks `worldMapId`, yielding server 400s. Disable region drawing if the map is absent.
- **Conflicts**  
  - `CampaignPrep` assumes a stable `worldMap` once loaded, but `CampaignManager` clearing the map during edits propagates `null`, which tears down the map while the DM is still in the prep screen. Provide a loading state or prompt before nuking the map state.

## components/campaign-shared.ts
- **Removals / Simplifications**  
  - The boolean coercion helpers (`asBoolean`, `toExperienceType`, etc.) repeat simple casts. Centralise them in a `normalizeCampaignRecord` utility so other components stop open-coding the same conversions.  
  - `DEFAULT_LEVEL_RANGE` and clamping live here already; expose a `parseLevelRange` helper so the manager/prep modules don’t each reimplement range validation.
- **Efficiency Opportunities**  
  - `coerceLevelRange` parses strings on every call; pre-normalise `Campaign.level_range` when ingesting API data so downstream components work with a consistent `{min,max}` payload.  
  - Export a derived `CAMPAIGN_STATUS_OPTIONS` list (and similar enums) so form components reuse the same arrays instead of duplicating string literals.
- **Errors / Bugs**  
  - `Campaign` currently marks `description`, `system`, and `setting` as required strings. The API delivers `null` frequently, which is why consumers defensively use `|| ''`. Update the type (or normaliser) to reflect backend truth and stop the silent divergence.
- **Conflicts**  
  - `CampaignManager` builds edit defaults via `buildEditFormState`, but then overrides fields—because the type promises non-null strings, TypeScript never warns about the subsequent blanking. Aligning the type would surface the regression noted above.

## Cross-File Conflicts & Next Steps
- `CampaignManager`’s edit dialog resets descriptive fields to empty while `CampaignPrep` renders those values live; the two UIs disagree about the source of truth and DMs see their campaign description vanish mid-session.  
- `CampaignPrep` relies on `CampaignPrepMap` to preserve viewport state, but the map keeps re-fitting whenever shared state changes. Introduce a shared “view controller” (or at least a memoised `fit`) so prep operations do not reset the map.  
- Tileset metadata (`min_zoom`/`max_zoom`) originates from the backend but fails validation in the client. Push the clamp/normalisation into a shared utility so both the manager and map modules respond consistently—and raise a visible error when the backend sends invalid ranges instead of masking it.
