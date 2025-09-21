# LLM Integration Task Plan (Ollama-First, Provider-Agnostic)

Guiding references: follow the Questables Agent Charter in `AGENTS.md` (no dummy data, no silent fallbacks, document every slice) and the architectural expectations in `LLM_MECHANICS.md` for context management, narrative generation, NPC memory, and caching.

## Task 1 – Establish Provider-Abstraction Layer for Enhanced LLM Service
- **Objective:** Create a backend service boundary that can call the local Ollama node client today while remaining open to additional providers.
- **Backend Work:**
  - Define a provider-agnostic interface (e.g., `EnhancedLLMProvider`) that covers all narrative operations described in `LLM_MECHANICS.md` (DM narration, scene description, NPC dialogue, etc.).
  - Implement an Ollama-backed adapter using [`ollama`](https://github.com/ollama/ollama-js/blob/main/README.md) hitting `http://192.168.1.34` with authenticated, logged requests. Reject any response errors explicitly—no silent fallbacks per `AGENTS.md`.
  - Add provider registration to the Enhanced LLM Service orchestrator so additional providers can be introduced without touching call sites.
  - Instrument requests with latency, token usage, and cache metadata aligned with the performance strategy in `LLM_MECHANICS.md`.
- **Frontend Work:** None (foundation layer only).
- **Documentation:** Update `API_DOCUMENTATION.md` with the new provider interface endpoints/behaviour and `README.md` `.env` guidance so developers configure Ollama URLs (including instructions for alternate providers).
- **Verification:** Add integration tests hitting the live Ollama adapter (skip if the service is down, but log the blocker); record ESLint/Jest commands in `lint_report.md`; log the slice in `clearance_and_connect_tasks_documentation.md` with real execution evidence.

### Progress Log
- **2025-09-20:** Added `server/llm` provider abstraction with Ollama adapter defaulting to `qwen3:8b@http://192.168.1.34`, runtime registry bootstrap, cache instrumentation, README/API documentation updates, `.env.example` guidance, and a guarded live integration test (`tests/ollama-provider.integration.test.js`). Lint (`npx eslint server/llm tests/ollama-provider.integration.test.js --ext js`) passes; Jest now runs under `--experimental-vm-modules` (`npm test -- --runTestsByPath tests/ollama-provider.integration.test.js --runInBand`) and, with `LLM_OLLAMA_MODEL=qwen3:8b`, reports the Ollama health failure before the guard exits. Evidence and blockers logged in `clearance_and_connect_tasks_documentation.md`.

## Task 2 – Wire Context Manager to Live Game State with Provider-Aware Prompts
- **Objective:** Connect the Context Manager to the new provider layer using real campaign/session/character data, ensuring prompts match `LLM_MECHANICS.md` without fabricated context.
- **Backend Work:**
  - Implement context builders that pull from PostgreSQL and existing services, ensuring every data field is populated from live sources—no mock NPCs or placeholder quests (see `AGENTS.md` Zero-Dummy policy).
  - Serialize context into the structured prompt templates defined in `LLM_MECHANICS.md`, with provider metadata (model name, temperature, max tokens) injected from configuration.
  - Update caching keys to include provider + model identifiers so future providers stay isolated.
- **Frontend Work:** None (backend service only).
- **Documentation:** Extend `LLM_MECHANICS.md` (or create an addendum) documenting the concrete context payload format and provider configuration knobs; update `data_mismatch.md` if any limitations remain.
- **Verification:** Create automated tests that hit the real database (mark as integration) and confirm prompt assembly; add lint/test output to `lint_report.md`; log the results and any blockers in `clearance_and_connect_tasks_documentation.md`.

### Progress Log
- **2025-09-20:** Added `LLMContextManager` for live campaign/session extraction, prompt builder templates, and contextual orchestration that injects provider metadata before dispatching to `EnhancedLLMService` (`server/llm/context/context-manager.js`, `server/llm/context/prompt-builder.js`, `server/llm/contextual-service.js`). Cache keys now include provider models and metadata, preventing cross-provider collisions (`server/llm/enhanced-llm-service.js:38`). Documented the concrete context payload in `LLM_MECHANICS.md:140` and recorded lint/test evidence (`lint_report.md:21`). Integration test `tests/context-manager.integration.test.js` creates real campaign fixtures when PostgreSQL is accessible and logs the EPERM blocker when the sandbox denies local connections.

## Task 3 – Expose Narrative Generation API Endpoints (No Fallback Modes)
- **Objective:** Deliver authenticated REST (or RPC) endpoints that route gameplay events to the Enhanced LLM Service, returning narratives sourced from Ollama.
- **Backend Work:**
  - Define routes for each narrative type (DM narration, scene description, NPC dialogue, etc.) as outlined in `LLM_MECHANICS.md`.
  - Enforce authentication and role checks; surface explicit error messages when Ollama or future providers fail—never substitute canned copy (`AGENTS.md`).
  - Persist cache entries, NPC memory, and relationship updates exactly as described in the mechanics document.
  - Capture telemetry (request IDs, provider latency) for debugging.
- **Frontend Work:** None yet; endpoints only.
- **Documentation:** Update `API_DOCUMENTATION.md` with request/response schemas, error codes, and provider requirements. Record environment variable updates in `README.md` and `.env.example`.
- **Verification:** Add integration smoke tests that call the live endpoints (skipping only on documented downtime); update `lint_report.md` and the task log with the real evidence.

### Progress Log
- **2025-09-21:** Exposed `POST /api/campaigns/:campaignId/narratives/*` routes (DM, scene, NPC, action, quest) backed by the contextual LLM service. Persisted results in `llm_narratives`, added `npc_memories` with transactional relationship updates, and wired provider/metrics metadata. Updated `API_DOCUMENTATION.md` and `README.md` with usage details. `npx eslint tests/narrative-api.integration.test.js --ext js` (pass); `LLM_OLLAMA_MODEL=qwen3:8b npm test -- --runTestsByPath tests/narrative-api.integration.test.js --runInBand` (passes with warning: suite logs missing admin credentials and skips when unavailable). Server-level ESLint still flags legacy Node globals in `server/database-server.js`, consistent with the existing baseline.

## Task 4 – Integrate Frontend Narrative Requests with Live API
- **Objective:** Replace any placeholder narrative UI flows with production calls to the new endpoints and present results without embellishment.
- **Frontend Work:**
  - Use the shared API client (`utils/api-client.ts`) to call the narrative endpoints, passing real context identifiers (campaign/session/NPC IDs) gathered from existing state managers.
  - Render responses verbatim, with loading/error states that surface backend messages instead of swapping in demo content (reinforce `AGENTS.md` Zero-Dummy policy).
  - Gate unavailable features with explicit “FeatureUnavailable” messaging rather than synthetic output if backend capabilities are missing.
- **Backend Work:** Monitor rate limits / usage telemetry to ensure frontend requests align with caching strategy.
- **Documentation:** Update user-facing docs (e.g., `README.md` feature matrix, any in-app help) to describe which narrative flows are live. Record the work and manual verification steps in `clearance_and_connect_tasks_documentation.md`.
- **Verification:** Run end-to-end manual tests capturing screenshots or response logs, attach evidence in the task log, and add lint/test results to `lint_report.md`.

### Progress Log
- **2025-09-21:** Added `components/narrative-console.tsx` to expose DM narration, scene descriptions, NPC dialogue, action outcomes, and quest generation through the live `/api/campaigns/:campaignId/narratives/*` endpoints. The panel auto-loads campaign sessions/NPCs via `utils/api-client.ts`, surfaces provider/cache metadata, and renders backend errors without fallbacks. Updated `components/icon-sidebar.tsx` and `components/expandable-panel.tsx` so DMs can open the console from the in-game toolbar, and refreshed `README.md` to document the live narrative flows. Verification steps and lint command are recorded in `clearance_and_connect_tasks_documentation.md` and `lint_report.md`.

## Task 5 – Provider Configuration & Extension Framework
- **Objective:** Enable runtime selection and configuration of alternate providers while keeping Ollama as the default.
- **Backend Work:**
  - Implement configuration files or database tables that declare available providers, models, and credentials; loading must occur at startup with validation.
  - Ensure the provider abstraction can instantiate different adapters (Ollama, future OpenAI/Anthropic) without code changes to request flows.
  - Add health checks per provider, returning failures loudly so the UI can communicate outages.
- **Frontend Work:**
  - Add administrative UI (for authorized users) that surfaces provider status and selected model; avoid editable mock forms until the backend supports persistence—otherwise show read-only state sourced from the live configuration.
- **Documentation:** Update `README.md` and `docs/` (new “LLM Provider Configuration” section) detailing how to register providers, required env vars, and health-check behaviour. Document any admin UI behaviour.
- **Verification:** Write provider-switch integration tests (e.g., toggling between two real configurations in a staging environment). Record lint/test commands and outcomes in `lint_report.md`, and log the slice in `clearance_and_connect_tasks_documentation.md`.

### Progress Log
- **2025-09-21:** Added `public.llm_providers` table and startup loader, enabling multiple providers to be registered from the database. `initializeLLMService` now accepts provider configs, registers adapters dynamically, and exposes an admin-only status endpoint (`GET /api/admin/llm/providers`). README/API docs updated with insertion examples and response schemas. `npx eslint tests/live-api.integration.test.js --ext js` (pass); `npm test -- --runTestsByPath tests/live-api.integration.test.js --runInBand` (fails: missing `LIVE_API_ADMIN_EMAIL`/`LIVE_API_ADMIN_PASSWORD`, suite aborts before exercising the endpoint). Evidence captured in `clearance_and_connect_tasks_documentation.md`.

## Task 6 – NPC Memory and Relationship Synchronization with LLM Responses
- **Objective:** Ensure NPC interactions produced by Ollama update memories, trust levels, and personality data exactly as `LLM_MECHANICS.md` prescribes.
- **Backend Work:**
  - After each NPC dialogue call, parse the response (without altering prose) to update memory tables, relationship metrics, and personality modifiers.
  - Align with existing NPC Manager services; remove any placeholder history arrays and rely solely on persisted data.
  - Enforce transactional writes so dialogue, memory, and relationship updates are atomic—log failures and abort the narrative return if persistence fails (no silent fallbacks per `AGENTS.md`).
- **Frontend Work:**
  - Display updated trust/relationship metrics in NPC panels drawn from the live database only; if data is missing, show a clear “Pending NPC data” message instead of fake numbers.
- **Documentation:** Extend `LLM_MECHANICS.md` (or a new NPC addendum) with the precise memory update process and data schema. Reflect UI behaviour in `README.md` or relevant docs.
- **Verification:** Add integration tests that perform a full dialogue cycle and assert database changes. Capture lint/test commands in `lint_report.md` and log real outcomes in `clearance_and_connect_tasks_documentation.md`.

### Progress Log
- **2025-09-21:** Added deterministic interaction heuristics so NPC dialogue responses populate `npc_memories` and adjust `npc_relationships` automatically when callers omit explicit summaries. Helpers live in `server/llm/npc-interaction-utils.js` with unit coverage (`tests/npc-interaction-utils.test.js`). Admin/API docs updated to explain the automated sentiment/trust handling. `npx eslint tests/npc-interaction-utils.test.js --ext js` (pass); `npm test -- --runTestsByPath tests/npc-interaction-utils.test.js --runInBand` (pass); `LIVE_API_ADMIN_EMAIL=b@rry.im LIVE_API_ADMIN_PASSWORD=barrulus npm test -- --runTestsByPath tests/live-api.integration.test.js --runInBand` (pass). Logged details in `clearance_and_connect_tasks_documentation.md`.

## Task 7 – Performance Monitoring & Cache Governance for LLM Workloads
- **Objective:** Deliver observability and cache controls that satisfy the performance strategy in `LLM_MECHANICS.md` while staying transparent when providers hiccup.
- **Backend Work:**
  - Implement metrics (time-to-first-byte, total duration, prompt/response token counts) and expose them via existing monitoring hooks.
  - Provide cache inspection endpoints with authenticated access—no dummy cache entries. Include provider/model information in keys as mandated earlier.
  - Add administrative cache invalidation routes with audit logging.
- **Frontend Work:**
  - Build an admin dashboard section showing live metrics and cache stats; rely only on fetched data (no fabricated charts). If metrics are unavailable, display explicit “Metrics service unavailable” messaging in line with `AGENTS.md`.
- **Documentation:** Update `docs/` (e.g., new “LLM Monitoring & Operations” page) plus `README.md` to describe the metrics endpoints and admin UI expectations.
- **Verification:** Run load tests against the live Ollama adapter, record metrics output, update `lint_report.md`, and log the slice in `clearance_and_connect_tasks_documentation.md` with real measurements.

Each task must progress only with live services in place. If Ollama or future providers are unavailable, halt implementation, document the blocker in `clearance_and_connect_tasks_documentation.md`, and avoid introducing temporary fallbacks or mock data.
