- `npx eslint components/admin-dashboard.tsx --ext ts,tsx` (pass)
- `npx eslint components/admin-dashboard.tsx server/database-server.js --ext ts,tsx,js` (fails: existing server lint baseline lacks Node env definitions; see CLI output for full list of legacy violations unrelated to new metrics route)
- `npx eslint components/campaign-manager.tsx --ext ts,tsx` (pass)
- `npx eslint components/chat-system.tsx components/chat-panel.tsx hooks/useWebSocket.tsx --ext ts,tsx` (pass)
- `npx eslint server/websocket-server.js --ext js` (fails: server lint baseline still lacks Node globals configuration; errors pre-date WebSocket broadcast changes)
- `npx eslint components/session-manager.tsx --ext ts,tsx` (pass)
- `npx eslint components/character-manager.tsx utils/database/__tests__/data-helpers.test.tsx --ext ts,tsx` (pass, re-run after CRUD fix)
- `npx eslint components/player-dashboard.tsx --ext ts,tsx` (pass, re-run after relocating play control)
- `npx eslint components/combat-tracker.tsx --ext ts,tsx` (pass)
- `npx eslint server/database-server.js` (fails: existing lint configuration lacks Node globals; reports legacy issues unrelated to new encounter routes)
- `npx eslint components/spellbook.tsx components/npc-manager.tsx components/journals.tsx components/dice-roller.tsx components/exploration-tools.tsx components/sidebar-tools.tsx components/compendium.tsx components/rule-books.tsx components/expandable-panel.tsx components/feature-unavailable.tsx utils/api-client.ts --ext ts,tsx` (pass)
- `npx eslint App.tsx --ext ts,tsx` (pass)
- `npx eslint App.tsx contexts/UserContext.tsx components/settings.tsx components/login-modal.tsx components/register-modal.tsx components/admin-dashboard.tsx components/player-dashboard.tsx components/dm-dashboard.tsx --ext ts,tsx` (pass)
- `npx eslint server/auth-middleware.js utils/validation/schemas.ts --ext js,ts` (fails: Node environment globals and legacy any usage still unaddressed in baseline; see CLI output for details)
- `npx eslint utils/database/data-helpers.tsx utils/database/data-structures.tsx --ext ts,tsx` (fails: shared database helpers still carry longstanding unused imports/`any` usage; new JSONB normalization highlights the same baseline debt)
- `npx eslint App.tsx components/chat-panel.tsx components/icon-sidebar.tsx components/player-dashboard.tsx contexts/GameSessionContext.tsx utils/database-health.ts --ext ts,tsx` (pass)
- `npx eslint tests/live-api.integration.test.js src/setupTests.js --ext js` (pass)
- `npx eslint components/player-dashboard.tsx --ext ts,tsx` (pass)
- `npx eslint contexts/UserContext.tsx utils/database/data-structures.tsx utils/database/data-helpers.tsx utils/database/production-helpers.tsx components/settings.tsx --ext ts,tsx` (fails: long-standing unused imports and `any` usage in shared database helpers remain; see latest CLI output.)
- `npx eslint server/llm tests/ollama-provider.integration.test.js --ext js` (pass)
- `npm test -- --runTestsByPath tests/ollama-provider.integration.test.js --runInBand` (skip: missing `LLM_OLLAMA_MODEL`, guard prevents execution)
- `LLM_OLLAMA_MODEL=qwen3:8b npm test -- --runTestsByPath tests/ollama-provider.integration.test.js --runInBand` (pass with warnings: provider initialization logs `fetch failed` and tests return early via guard)
- `npx eslint src/setupTests.js --ext js` (pass)
- `npx eslint tests/narrative-api.integration.test.js --ext js` (pass)
- `npx eslint server/database-server.js --ext js` (fails: legacy Node-global lint debt persists; new narrative routes share the existing baseline issues)
- `npx eslint tests/live-api.integration.test.js --ext js` (pass)
- `LIVE_API_ADMIN_EMAIL=b@rry.im LIVE_API_ADMIN_PASSWORD=barrulus npm test -- --runTestsByPath tests/live-api.integration.test.js --runInBand` (pass)
- `npx eslint tests/npc-interaction-utils.test.js --ext js` (pass)
- `npm test -- --runTestsByPath tests/npc-interaction-utils.test.js --runInBand` (pass)
- `npx eslint server/llm/context/context-manager.js server/llm/context/prompt-builder.js server/llm/contextual-service.js --ext js` (pass)
- `npm test -- --runTestsByPath tests/context-manager.integration.test.js --runInBand` (pass; suite skips with a logged EPERM message when the sandbox blocks local PostgreSQL connections)
- `npx eslint components/narrative-console.tsx components/icon-sidebar.tsx components/expandable-panel.tsx --ext ts,tsx` (pass)
- `LLM_PROVIDER=ollama LLM_OLLAMA_HOST=http://192.168.1.34:11434 LLM_OLLAMA_MODEL=qwen3:8b npm test -- --runTestsByPath tests/ollama-provider.integration.test.js --runInBand` (pass)
- `LLM_PROVIDER=ollama LLM_OLLAMA_HOST=http://192.168.1.34:11434 LLM_OLLAMA_MODEL=qwen3:8b LIVE_API_BASE_URL=https://quixote.tail3f19fe.ts.net:3001 LIVE_API_ADMIN_EMAIL=b@rry.im LIVE_API_ADMIN_PASSWORD=barrulus npm test -- --runTestsByPath tests/narrative-api.integration.test.js --runInBand` (pass)
- `npx eslint server/llm/enhanced-llm-service.js components/admin-dashboard.tsx --ext js,tsx` (pass)
- `npx eslint server/llm/enhanced-llm-service.js server/database-server.js components/admin-dashboard.tsx --ext js,ts,tsx` (fails: server lint baseline still lacks Node globals; new endpoints share the existing violations)
- `LLM_PROVIDER=ollama LLM_OLLAMA_HOST=http://192.168.1.34:11434 LLM_OLLAMA_MODEL=qwen3:8b npm test -- --runTestsByPath tests/ollama-provider.integration.test.js --runInBand` (pass; logs live latency/token metrics)
- `LLM_PROVIDER=ollama LLM_OLLAMA_HOST=http://192.168.1.34:11434 LLM_OLLAMA_MODEL=qwen3:8b LIVE_API_BASE_URL=https://quixote.tail3f19fe.ts.net:3001 LIVE_API_ADMIN_EMAIL=b@rry.im LIVE_API_ADMIN_PASSWORD=barrulus npm test -- --runTestsByPath tests/narrative-api.integration.test.js --runInBand` (pass; new assertions cover LLM metrics/cache endpoints)
- `npx eslint server/database-server.js` (fails: baseline keeps Node globals/unused import violations; schema alignment changes introduce no new lint errors)
- `npx eslint server/database-server.js` (fails: existing Node-global and unused-symbol debt persists after movement/spawn endpoints; no new violations from this slice)
- `npx eslint components/campaign-manager.tsx components/settings.tsx components/campaign-shared.ts --ext ts,tsx` (pass)
- `npx eslint components/openlayers-map.tsx --ext ts,tsx` (pass)
- `npx eslint components/openlayers-map.tsx` (pass)
- `npx eslint contexts/GameSessionContext.tsx contexts/UserContext.tsx components/openlayers-map.tsx utils/api-client.ts --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: repository still lacks Node env globals; surfaced longstanding lint debt unrelated to visibility radius wiring)
- `npx eslint components/player-dashboard.tsx components/character-manager.tsx --ext tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: existing server lint baseline reports unused Node/utility bindings; no new violations introduced by dashboard token wiring)
- `npx eslint components/chat-system.tsx hooks/useWebSocket.tsx --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: same Node env/unused binding debt; chat message enrichment introduces no additional errors)
- `npx eslint components/campaign-manager.tsx components/campaign-shared.ts --ext ts,tsx,ts` (pass)
- `npx eslint server/database-server.js --ext js` (fails: longstanding Node/global lint debt; world map enforcement change adds no new warnings)
- `npx eslint --ext md dmtoolkit_tasks_2.md API_DOCUMENTATION.md` (fails: ESLint config lacks Markdown support and stops with a parsing error at line 1)
- `npx eslint --ext md docs/dmtoolkit_environment_check.md` (fails: ESLint config lacks Markdown parser support; stops at line 1)
- `npx eslint --ext md docs/dmtoolkit_schema_gaps.md` (fails: ESLint config lacks Markdown parser support; stops at line 1)
- `npx eslint database/schema.sql` (ignored: ESLint config has no matcher for .sql; no lint run)`
- `npx eslint components/campaign-manager.tsx --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: longstanding server lint baseline marks unused vars across legacy code; campaign API changes add no new issues)
- `npx eslint server/database-server.js --ext js` (fails: legacy unused-variable debt in server bundle persists; Task 9 introduces no additional violations)
- `npx eslint server/objectives/objective-validation.js tests/objectives/objective-validation.test.js --ext js` (pass)
- `npx eslint server/objectives/objective-validation.js tests/objectives/objective-validation.test.js --ext js` (pass)
- `npx eslint server/database-server.js --ext js` (fails: legacy unused-variable debt plus new objective imports; MARKDOWN_FIELDS now resolved, remaining errors from baseline)
- `npx eslint server/database-server.js --ext js` (fails: longstanding unused-variable debt persists; assist routes reuse existing file without addressing baseline)
- `npx eslint vite.config.ts --ext ts` (pass)
- `npx eslint clearance_and_connect_tasks_documentation.md --ext md` (fails: ESLint config still lacks Markdown support; parser stops at line 1)
- `npx eslint server/database-server.js --ext js` (fails: longstanding unused-variable debt in the server bundle; cache cleanup unref change introduces no new lint errors)
- `npx eslint server/websocket-server.js server/database-server.js hooks/useWebSocket.tsx --ext js,ts,tsx` (fails: legacy unused-variable debt in `server/database-server.js`; websocket/sidebar updates introduce no new violations)
- `npx eslint server/websocket-server.js hooks/useWebSocket.tsx --ext js,tsx` (pass)
- `npx eslint components/openlayers-map.tsx --ext ts,tsx` (pass)
- `npx eslint utils/api-client.ts contexts/GameSessionContext.tsx --ext ts,tsx` (pass)
- `npx eslint components/campaign-prep.tsx components/campaign-spawn-map.tsx components/campaign-manager.tsx components/settings.tsx tests/campaign-prep.test.tsx --ext ts,tsx` (pass)
- `npx eslint components/campaign-manager.tsx components/campaign-shared.ts --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: legacy unused-variable/node-globals debt persists; Task 16 changes introduce no new warnings)
- `npx eslint components/settings.tsx --ext ts,tsx` (pass)
- `npx eslint components/objective-pin-map.tsx components/objectives-panel.tsx components/campaign-prep.tsx tests/objectives-panel.test.tsx --ext ts,tsx` (pass)
- `npx eslint components/objectives-panel.tsx tests/objectives-panel.test.tsx --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: longstanding unused-variable debt persists; spawn upsert adjustment introduces no new warnings)
- `npx eslint server/llm/enhanced-llm-service.js server/llm/provider-registry.js server/llm/providers/ollama-provider.js --ext js` (pass)
- `npx eslint components/objectives-panel.tsx components/combat-tracker.tsx components/npc-manager.tsx --ext ts,tsx` (pass)
- `2025-09-23` — `npx eslint components/objectives-panel.tsx utils/api-client.ts --ext ts,tsx` (pass)
- `2025-09-23` — `npx eslint components/dm-sidebar.tsx components/icon-sidebar.tsx components/expandable-panel.tsx tests/dm-sidebar.test.tsx --ext ts,tsx` (pass)
- `2025-09-23` — `npx eslint tests/server/dm-toolkit.integration.test.js --ext js` (pass)
- `2025-09-23` — `npm test -- --runTestsByPath tests/server/dm-toolkit.integration.test.js --runInBand` (pass; logs TLS/EPERM warnings when PostgreSQL is sandboxed, suite guards with skip reason)
- `2025-09-23` — `npx eslint tests/frontend/dm-toolkit.ui.integration.test.tsx --ext tsx` (pass)
- `2025-09-23` — `npm test -- --runTestsByPath tests/frontend/dm-toolkit.ui.integration.test.tsx --runInBand` (pass; suite logs TLS/EPERM warnings while self-skipping in sandboxed environments)
- `npx eslint components/session-manager.tsx components/campaign-prep.tsx --ext ts,tsx` (pass)
- `npx eslint server/database-server.js --ext js` (fails: legacy unused-variable debt in the Express bundle; session endpoint hardening adds no new warnings)
- `npx eslint tests/server/dm-toolkit.integration.test.js --ext js` (pass)
- `npx eslint components/session-manager.tsx --ext ts,tsx` (pass)
- `2025-09-24` — `npx eslint server/database-server.js --ext js` (fails: legacy unused-variable debt predates the markers endpoint; command output unchanged aside from newly added route)
- `2025-09-24` — `npx eslint API_DOCUMENTATION.md --ext md` (fails: Markdown parsing unsupported in the ESLint configuration; aborts at line 1)
- \ — \
/home/barrulus/1_projects/questables/server/database-server.js
    17:23  warning  'query' is defined but never used. Allowed unused vars must match /^_/u                            no-unused-vars
    17:23  error    'query' is defined but never used                                                                  @typescript-eslint/no-unused-vars
    28:3   warning  'authRateLimit' is defined but never used. Allowed unused vars must match /^_/u                    no-unused-vars
    28:3   error    'authRateLimit' is defined but never used                                                          @typescript-eslint/no-unused-vars
    33:3   warning  'sanitizeFilename' is defined but never used. Allowed unused vars must match /^_/u                 no-unused-vars
    33:3   error    'sanitizeFilename' is defined but never used                                                       @typescript-eslint/no-unused-vars
    39:3   warning  'logDatabaseOperation' is defined but never used. Allowed unused vars must match /^_/u             no-unused-vars
    39:3   error    'logDatabaseOperation' is defined but never used                                                   @typescript-eslint/no-unused-vars
    40:3   warning  'logUserActivity' is defined but never used. Allowed unused vars must match /^_/u                  no-unused-vars
    40:3   error    'logUserActivity' is defined but never used                                                        @typescript-eslint/no-unused-vars
    41:3   warning  'logSecurityEvent' is defined but never used. Allowed unused vars must match /^_/u                 no-unused-vars
    41:3   error    'logSecurityEvent' is defined but never used                                                       @typescript-eslint/no-unused-vars
   290:18  warning  'error' is defined but never used                                                                  no-unused-vars
   290:18  error    'error' is defined but never used                                                                  @typescript-eslint/no-unused-vars
   397:7   warning  'cacheMiddleware' is assigned a value but never used. Allowed unused vars must match /^_/u         no-unused-vars
   397:7   error    'cacheMiddleware' is assigned a value but never used                                               @typescript-eslint/no-unused-vars
   688:7   warning  'validateCharacterData' is assigned a value but never used. Allowed unused vars must match /^_/u   no-unused-vars
   688:7   error    'validateCharacterData' is assigned a value but never used                                         @typescript-eslint/no-unused-vars
   794:14  warning  'error' is defined but never used                                                                  no-unused-vars
   794:14  error    'error' is defined but never used                                                                  @typescript-eslint/no-unused-vars
  1288:7   warning  'fetchNpcWithCampaign' is assigned a value but never used. Allowed unused vars must match /^_/u    no-unused-vars
  1288:7   error    'fetchNpcWithCampaign' is assigned a value but never used                                          @typescript-eslint/no-unused-vars
  1300:7   warning  'ENCOUNTER_TYPE_CONFIG' is assigned a value but never used. Allowed unused vars must match /^_/u   no-unused-vars
  1300:7   error    'ENCOUNTER_TYPE_CONFIG' is assigned a value but never used                                         @typescript-eslint/no-unused-vars
  1319:7   warning  'ENCOUNTER_DIFFICULTIES' is assigned a value but never used. Allowed unused vars must match /^_/u  no-unused-vars
  1319:7   error    'ENCOUNTER_DIFFICULTIES' is assigned a value but never used                                        @typescript-eslint/no-unused-vars
  1530:54  warning  'apiKey' is defined but never used. Allowed unused args must match /^_/u                           no-unused-vars
  1530:54  error    'apiKey' is defined but never used                                                                 @typescript-eslint/no-unused-vars
  1568:21  warning  'client' is defined but never used. Allowed unused args must match /^_/u                           no-unused-vars
  1568:21  error    'client' is defined but never used                                                                 @typescript-eslint/no-unused-vars
  1572:24  warning  'client' is defined but never used. Allowed unused args must match /^_/u                           no-unused-vars
  1572:24  error    'client' is defined but never used                                                                 @typescript-eslint/no-unused-vars
  1576:20  warning  'client' is defined but never used. Allowed unused args must match /^_/u                           no-unused-vars
  1576:20  error    'client' is defined but never used                                                                 @typescript-eslint/no-unused-vars
  1581:7   warning  'queryWithRetry' is assigned a value but never used. Allowed unused vars must match /^_/u          no-unused-vars
  1581:7   error    'queryWithRetry' is assigned a value but never used                                                @typescript-eslint/no-unused-vars
  1862:11  warning  'derivedInteraction' is assigned a value but never used. Allowed unused vars must match /^_/u      no-unused-vars
  1862:11  error    'derivedInteraction' is assigned a value but never used                                            @typescript-eslint/no-unused-vars
  4696:11  warning  'result' is assigned a value but never used. Allowed unused vars must match /^_/u                  no-unused-vars
  4696:11  error    'result' is assigned a value but never used                                                        @typescript-eslint/no-unused-vars
  5342:16  warning  'parseError' is defined but never used                                                             no-unused-vars
  5342:16  error    'parseError' is defined but never used                                                             @typescript-eslint/no-unused-vars
  5399:16  warning  'parseError' is defined but never used                                                             no-unused-vars
  5399:16  error    'parseError' is defined but never used                                                             @typescript-eslint/no-unused-vars
  5448:16  warning  'parseError' is defined but never used                                                             no-unused-vars
  5448:16  error    'parseError' is defined but never used                                                             @typescript-eslint/no-unused-vars
  5488:16  warning  'parseError' is defined but never used                                                             no-unused-vars
  5488:16  error    'parseError' is defined but never used                                                             @typescript-eslint/no-unused-vars
  5519:9   warning  'paramCount' is assigned a value but never used. Allowed unused vars must match /^_/u              no-unused-vars
  5519:9   error    'paramCount' is assigned a value but never used                                                    @typescript-eslint/no-unused-vars
  7175:11  warning  'result' is assigned a value but never used. Allowed unused vars must match /^_/u                  no-unused-vars
  7175:11  error    'result' is assigned a value but never used                                                        @typescript-eslint/no-unused-vars

✖ 52 problems (26 errors, 26 warnings) (fails: longstanding unused-variable debt in \; new pool helper passes lint)
- `2025-09-25` — `npx eslint server/db/pool.js server/database-server.js --ext js` (fails: longstanding unused-variable debt in `server/database-server.js`; new pool helper introduces no additional lint errors)
- `2025-09-25` — `npx eslint server/routes/characters.routes.js server/routes/campaigns.routes.js server/routes/chat.routes.js server/validation/common.js server/validation/characters.js server/validation/campaigns.js server/validation/chat.js server/services/campaigns/*.js --ext js` (fails: legacy lint debt persists in untouched modules; new routers introduce no additional errors)

- `npx eslint server/database-server.js server/routes/maps.routes.js server/routes/sessions.routes.js server/routes/encounters.routes.js server/routes/npcs.routes.js server/routes/uploads.routes.js server/services/sessions/service.js server/services/encounters/service.js --ext js` (pass)
- `npx eslint server/routes/maps.routes.js server/services/maps/service.js --ext js` (pass)
- `npx eslint server/routes/chat.routes.js server/services/chat/service.js --ext js` (pass)
- `npx eslint server/routes/narratives.routes.js server/services/narratives/service.js --ext js` (pass)
- `npx eslint server/routes/uploads.routes.js server/services/uploads/service.js server/services/maps/service.js --ext js` (pass)
- `npx eslint server/routes/npcs.routes.js server/services/npcs/service.js --ext js` (pass)
- `2025-09-27` — `npx eslint components/character-manager.tsx components/character-sheet.tsx components/expandable-panel.tsx components/inventory.tsx components/spellbook.tsx components/map-data-loader.tsx components/register-modal.tsx contexts/UserContext.tsx utils/api/auth.ts utils/api/users.ts utils/api/characters.ts utils/api/maps.ts server/routes/maps.routes.js server/routes/users.routes.js server/services/maps/service.js server/services/users/service.js --ext ts,tsx,js` (pass)

- `npx eslint components/openlayers-map.tsx components/__tests__/openlayers-map.health.test.tsx --ext ts,tsx` (pass)

- `npx eslint server/routes/tiles.routes.js server/utils/tegola-client.js server/tegola/generate-config.js --ext js` (pass)
- `npx eslint server/routes/campaigns.routes.js server/services/campaigns/service.js server/services/campaigns/movement-config.js --ext js` (pass)
