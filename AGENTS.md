# Repository Guidelines

## Project Structure & Module Organization
- Frontend (Vite + React + TS): root `App.tsx`, entry `main.tsx`, UI in `components/`, contexts in `contexts/`, assets in `public/`, styles in `styles/`.
- Backend: `server/` (Express + DB helpers). Schema lives in `database/schema.sql`.
- Tests: UI in `components/__tests__/`; additional suites in `tests/`. Jest setup in `src/setupTests.ts`.
- Docs: `API_DOCUMENTATION.md`, assorted tech notes in `docs/`.

## Build, Test, and Development Commands
- `npm run dev` — Start frontend dev server.
- `npm run db:dev` — Start backend/database service.
- `npm run dev:local` — Run backend and frontend together for local work.
- `npm run build` — Type-check and build the frontend.
- `npm run preview` — Preview built app.
- `npm run lint` — ESLint over TS/TSX.
- `npm test` / `npm run test:watch` / `npm run test:coverage` — Jest test runs.
- `npm run db:setup` — Install server deps and initialize DB schema.

## Coding Style & Naming Conventions
- TypeScript throughout; 2-space indentation; React functional components and hooks.
- Filenames: kebab-case (e.g., `campaign-prep-map.tsx`); components export PascalCase.
- Run `npm run lint` before pushing. If touching code, update `lint_report.md` with the command and result (e.g., `npx eslint components/register-modal.tsx contexts/UserContext.tsx --ext ts,tsx`).
- Radix/Shadcn Selects: do not use empty string items; use `__none__` and translate in handlers.
- Never introduce dummy/mock data. Surface backend errors honestly; no silent fallbacks.

## Testing Guidelines
- Framework: Jest + @testing-library/react. Name tests `*.test.ts` or `*.test.tsx` near the module or under `components/__tests__/`.
- Prefer integration against the live dev server when feasible; if stubbing, remove mocks once the real endpoint is available.
- Ensure changed components have meaningful tests; run `npm run test:coverage` locally.

## Commit & Pull Request Guidelines
- Commit messages: imperative mood, concise scope, reference issue IDs (e.g., `fix(dm-map): prevent layer flicker`).
- PRs include: summary, linked issues, screenshots for UI changes, and notes on data/endpoint impacts.
- Keep `API_DOCUMENTATION.md` and `database/schema.sql` synchronized with any backend-affecting changes.
- Security & config: store environment in `.env.local`; DB runs on port `3001`. Any geometry fields must be SRID 0.

