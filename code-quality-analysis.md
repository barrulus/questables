# Questables Code Quality Analysis

**Date**: 2026-03-28
**Scope**: Full codebase — server, frontend, schema, architecture, LLM pipeline

---

## Critical Issues

### 1. DM_RESPONSE_SCHEMA not passed to Ollama

**Severity**: CRITICAL
**File**: `server/services/dm-action/service.js:149`

`DM_RESPONSE_SCHEMA` is imported but never passed to the LLM. Both `invokeDmForAction()` and `invokeDmForSocialAction()` call `contextualService.generateFromContext()` without `parameters: { schema: DM_RESPONSE_SCHEMA }`. Ollama never receives the structured output format, so the DM response returns plain text. The code silently degrades via manual `JSON.parse()` fallback.

**Fix**: Add `parameters: { schema: DM_RESPONSE_SCHEMA }` to both invocations.

### 2. Enhanced LLM Service switch statement incomplete

**Severity**: CRITICAL
**File**: `server/llm/enhanced-llm-service.js:345-387`

The switch only handles 10 original narrative types (DM_NARRATION, SCENE_DESCRIPTION, etc.). These types fall through to a generic default:

- `PLAYER_ACTION_RESPONSE` — used by dm-action/service.js
- `SOCIAL_DIALOGUE` — used by dm-action/service.js
- `ENEMY_COMBAT_TURN` — used by enemy-turn-service.js
- `CHAT_ACTION_PARSE` — used by action-interceptor.js
- `SESSION_OPENING`, `AREA_DESCRIPTION`, `WORLD_TURN_NARRATION` — new Phase 3 types
- `DM_WORLD_TURN`, `SHOP_AUTO_STOCK`

The generic fallback added in Phase 1 (`provider.generate(type, options)`) handles these, but schemas may not propagate correctly since the generic path doesn't have per-type schema awareness.

**Fix**: Either add dedicated cases with explicit schema passing, or ensure the generic fallback preserves `options.schema` through to the Ollama provider.

---

## Dead Code

### Frontend — 12 unused components

| Component | Lines | Status |
|---|---|---|
| `components/combat-tracker.tsx` | 1221 | Never imported |
| `components/npc-manager.tsx` | 746 | Never imported |
| `components/main-content.tsx` | 317 | Never imported |
| `components/compendium.tsx` | ~300 | Superseded by `compendium/` subdirectory |
| `components/dice-roller.tsx` | ~200 | Never imported |
| `components/exploration-tools.tsx` | ~200 | Never imported |
| `components/file-upload.tsx` | ~150 | Never imported |
| `components/level-up-modal.tsx` | ~200 | Never imported |
| `components/report-dialog.tsx` | ~150 | Never imported |
| `components/rule-books.tsx` | ~150 | Never imported |
| `components/sidebar-tools.tsx` | ~100 | Never imported |
| `components/figma/ImageWithFallback.tsx` | ~50 | Never imported |

**Estimated dead code**: ~3,800 lines

### Server — Unused WebSocket events

- `REALTIME_EVENTS.dmNarration` defined in `websocket-server.js:25` — never emitted
- `emitSessionFocusUpdated` / `emitSessionContextUpdated` — legacy session focus controls, likely redundant with LLM-as-DM

### Frontend — Unused type exports

- `LiveCharacterState` and `LiveStateChanges` in `contexts/LiveStateContext.tsx` — exported, never imported elsewhere
- `ActionPayload` and `PendingAction` in `contexts/ActionContext.tsx` — potentially unused

---

## Stale Code from "Human DM" Era

### ActionPanel / ActionGrid (`components/action-panel/`)

Still imported and rendered, but represents the old button-driven action system. Now that chat is the primary interface:
- `action-grid.tsx` — grid of action buttons (move, attack, search)
- `social-action-grid.tsx` — social interaction buttons
- `combat-budget-bar.tsx` — action/bonus/movement budget display
- `npc-picker.tsx` — NPC selection for social actions

**Status**: Kept as optional fallback per Phase 1 plan, but should be clearly marked as legacy or deprecated.

### NarrativeConsole (`components/narrative-console.tsx`, 897 lines)

Generates narration to a separate `llm_narratives` table, not through chat. Fully superseded by the dm-narrator.js → chat flow.

**Status**: May still be useful as a debugging/admin tool, but should not be the primary narration interface.

### DM Sidebar Legacy Controls

The new Director Controls accordion was added in Phase 4, but the old sections remain:
- **Session Focus / Context** — manual scene-setting, redundant with LLM auto-narration
- **Unplanned Encounter** — manual encounter creation, redundant with proactive encounter generator
- **NPC Sentiment** — manual sentiment manipulation
- **Teleport Player/NPC** — still useful as override tools

### ActionContext dm-narration listener

`contexts/ActionContext.tsx:114` still listens for `dm-narration` WebSocket events. Narration now flows through `new-message` events in the chat system. The old listener should be removed or redirected.

### Dual narration output in actions.routes.js

`server/routes/actions.routes.js` now calls BOTH `postNarrationToChat()` (new) AND `wsServer.emitDmNarration()` (legacy). The legacy emits should be removed once the ActionPanel frontend is confirmed to receive narration via chat.

---

## Duplication

### Repeated loading/error state pattern (~68 instances)

Nearly every data-fetching component recreates:
```typescript
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
useEffect(() => {
  try { setLoading(true); /* fetch */ }
  finally { setLoading(false); }
}, [deps]);
```

**Fix**: Create `useAsync<T>(fetcher, deps)` hook returning `{ data, loading, error, retry }`.

### Inconsistent error handling — two patterns

- **Pattern A**: `Object.assign(error, { statusCode: 400 })` — used in `llm-settings.js`
- **Pattern B**: `error.status = 403; error.code = 'dm_action_forbidden'` — used in `campaigns/service.js`
- Routes must handle both `.status` and `.statusCode`

**Fix**: Standardise on `error.status` + `error.code`. Consider a `createHttpError(status, code, message)` utility.

### Mixed logging — console.* vs logger

- `server/database-server.js` — 6 instances of `console.log/error`
- `server/auth-middleware.js` — 10 instances of `console.error`
- Rest of codebase uses `logInfo/logError/logWarn` correctly

**Fix**: Replace all `console.*` with logger functions.

### Routes bypassing service layer

237 direct `client.query()` calls in route files vs 127 in service files. Routes should delegate to services.

**Worst offenders**:
- `actions.routes.js` — direct session queries, action INSERTs, status UPDATEs
- `rest.routes.js` — direct session/character queries
- `shop.routes.js` — mixed service + direct queries

---

## Large Components Needing Decomposition

| Component | Lines | Concern |
|---|---|---|
| `openlayers-map.tsx` | 2405 | Map init + events + layers + settlement transition all in one |
| `dm-sidebar.tsx` | 1901 | 7 accordion sections, each a distinct feature |
| `objectives-panel.tsx` | 1707 | CRUD + editing + location linking + LLM assist |
| `character-manager.tsx` | 1397 | Character list + detail editing + form validation |
| `session-manager.tsx` | 1282 | Session CRUD + participants + combat setup |
| `player-dashboard.tsx` | 1266 | Campaign list + character list + session display |
| `admin-dashboard.tsx` | 1244 | Metrics + LLM config + user management |
| `campaign-prep.tsx` | 1042 | Map + region editor + objectives + lore tabs |

---

## Schema Issues

### Missing indexes on high-query columns

```sql
-- These foreign keys are queried frequently but lack dedicated single-column indexes
CREATE INDEX idx_spa_campaign_id ON public.session_player_actions(campaign_id);
CREATE INDEX idx_sls_campaign_id ON public.session_live_states(campaign_id);
CREATE INDEX idx_npc_relationships_npc_id ON public.npc_relationships(npc_id);
```

### Inconsistent error response formats across routes

- Some: `{ error: 'code', message: 'text' }`
- Others: `{ error: 'text' }` (no code)
- Status code accessed as both `error.status` and `error.statusCode`

---

## LLM Pipeline Issues

### Schema not propagated for structured output

The Ollama provider respects `options.schema` as its `format` parameter, but only `CHAT_ACTION_PARSE` currently passes a schema. DM action resolution, social dialogue, enemy combat turns, and world turn narration all generate without structured output, falling back to text parsing.

### Campaign LLM settings partially applied

`contextual-service.js` loads campaign LLM settings (tone, voice, temperature, model) and passes them to `prompt-builder.js`. However, `action-prompt-builder.js` builds prompts independently and may not consistently apply world tone or narrative voice to action resolution prompts.

---

## Summary by Priority

### Immediate (fix now)

1. Pass `DM_RESPONSE_SCHEMA` to DM action invocations
2. Delete 12 dead frontend components (~3,800 lines)
3. Remove dual narration emission in `actions.routes.js`
4. Replace `console.*` with logger (16 instances)

### Short-term (next sprint)

5. Create `useAsync` hook to consolidate 68 loading patterns
6. Standardise error handling (status/statusCode, response format)
7. Add missing database indexes (3 indexes)
8. Remove/deprecate ActionContext `dm-narration` listener
9. Clean up unused WebSocket events

### Medium-term (backlog)

10. Move route-level queries to service layer (237 calls)
11. Decompose large components (8 components >1000 lines)
12. Split complex services (dm-action, action-interceptor, npcs)
13. Clarify which DM sidebar sections are still needed vs legacy
14. Standardise named exports across all modules
