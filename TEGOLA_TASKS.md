# Tegola Cutover Task List

> Every task **must** be executed in line with the Questables Agent Charter (`AGENTS.md`). Do not introduce mock data, do not add silent fallbacks, and record real verification evidence (lint/test output, command logs). After completing any slice, update this file with the outcome and link to the supporting proof.

## Working Agreement
- Treat this checklist as the source of truth while we rip out the legacy PostGIS JSON flows and migrate to Tegola-only delivery.
- Each assignee must append a short update (result, blockers, command references) under the relevant task when work lands.
- Keep `schema.sql`, `API_DOCUMENTATION.md`, and `.env.local` guidance synchronized as you touch them.

---

### 1. Provision Tegola Prerequisites
- The Tegola binary is installed in the runtime environment that hosts the database/API.
- Ensure `.env.local` provides the Tegola settings (`TEGOLA_PUBLIC_URL`, cache paths).
- All Tegola database interactions should be written as modules of `database-server.js`
- Acceptance: `node server/tegola/generate-config.js --check` (add a `--check` mode if needed) validates inputs without writing files. Log command and results in `lint_report.md`.

- [AI 2025-10-03] Verified Tegola binary at `/nix/store/l9arb540bvrisbdraj2sgk3dpj540ai9-tegola-0.21.2/bin/tegola`, added a `--check` dry-run mode to `server/tegola/generate-config.js`, and routed all database parameter resolution through `server/db/config.js` so Tegola shares the live database-server settings (no duplicated env keys or fallbacks). Commands: `which tegola`; `npx eslint server/tegola/generate-config.js server/db/config.js server/db/pool.js --ext js`; `node server/tegola/generate-config.js --check`. Residual risks: none.

### 2. Generate Production Tegola Config
- Run `node server/tegola/generate-config.js` against live `.env.local` and inspect the emitted `server/tegola/tegola.toml` for SRID 0 compliance.
- Document any schema assumptions in `API_DOCUMENTATION.md` and update this task with the exact command run.
- Do not manually edit the generated config; adjust templates/env if changes are needed.

### 3. Deploy Tegola Service
- Launch Tegola with the generated config (systemd/container/etc.) and capture operational notes in `server/tegola/README.md`.
- Verify `/healthz` and `/capabilities` via the running service. Record curl output under this task and surface blockers immediately.

### 4. Wire Backend Exclusively Through Tegola
- Update `/api/tiles` routes (or add new ones) so **all** map tile requests proxy the live Tegola instance; remove any fallback logic.
- Delete unused PostGIS map endpoints, services, and loaders (e.g., `listWorldBurgs`, `map-data-loader` helpers) once the frontend migration is ready.
- Ensure `API_DOCUMENTATION.md` reflects only Tegola-backed endpoints.

### 5. Migrate Frontend Map Rendering to Tegola Vector Tiles
- Replace the raster `XYZ` sources in OpenLayers components with `VectorTile` sources pointed at `/api/tiles/vector/...`.
- Reimplement styling using vector feature properties; remove JSON fetches and state hydrating `burgs`, `routes`, etc.
- Verify behavior against the live backend (no mock data) and document test steps in this file.

### 6. Purge Legacy Map Data Plumbing
- Remove obsolete utilities (`map-data-loader.tsx`, redundant React contexts, CSV converters) that fed the old JSON pipeline.
- Drop corresponding server routes/services and update TypeScript types, ensuring `npm run build` stays green.
- Record the deletions and supporting lint/test commands under this task.

### 7. Hardening & Telemetry
- Extend logging/metrics so Tegola failures surface clearly (backend logs + UI error toasts).
- Add integration tests that hit `/api/tiles/health` and fetch a sample vector tile (skip automatically if Tegola is unreachable, but log the skip per AGENTS.md).
- Capture the new test commands in `lint_report.md` and reference them here.

### 8. Documentation & Operational Handoff
- Update `server/tegola/README.md`, `API_DOCUMENTATION.md`, `.env.local` templates, and any runbooks to match the Tegola-only architecture.
- Add a summary section to this file noting the production cutover date, verification steps, and any follow-up work.
- Ensure every modified doc notes the removal of the legacy PostGIS JSON flows.

---

_Log every completed slice directly below the relevant task with your initials, date (YYYY-MM-DD), commands run, and residual risks or follow-up tickets._
