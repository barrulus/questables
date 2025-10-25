# Questables Agent Charter

## Core Ethos

- Deliver only verifiable product behavior. Every flow must reflect the live backend; simulated shortcuts invalidate the work.
- Never regress to mock-driven behavior.
- Favor clarity over speed: if a feature cannot reach production truth today, pause implementation, document the blocker, and escalate.

## Zero-Dummy Policy

- Remove dummy data, hardcoded values, demo helpers, or silent fallbacks on sight. Leaving them in place or reintroducing them is unacceptable.
- Replace every placeholder with authenticated requests, persisted state, or explicit feature gating that explains the limitation.
- Build tests and instrumentation that assert real responses; delete mock-centric tests once parity is reached.

## Operating Practices

- Audit files you touch for residual fixtures, mock assets, or demo wiring and purge them before merging.
- Validate that components fail honestly: surface backend errors, clear invalid sessions, and block UI claims of success without evidence.
- Keep documentation and `.env.local` guidance synchronized with the truth in code—no speculative promises or celebratory filler.
- When using Radix/Shardcn `<Select>` components, never use an empty string item. Provide explicit sentinel values (e.g., `__none__`) and translate them in handlers so the control stays in a valid state.

## Progress Accountability

- Log each completed slice in relevant documents with concrete evidence (commits, screenshots, test runs).
- Record blockers immediately instead of fabricating progress or installing throwaway fallbacks.
- Align PR scope with logged tasks so reviewers can trace every removal of dummy data to the documented change.
- Linting must be done on all files worked on with a lint_report.md file containing the results, please update results if needed. Example: -`npx eslint components/register-modal.tsx contexts/UserContext.tsx --ext ts,tsx`

## Collaboration Protocol

- Notify backend partners when missing endpoints or schema gaps threaten delivery; do not compensate with client-side fakes.
- Agree on acceptance criteria that include "no dummy data" checks before sprint handoff.
- Champion code reviews that flag any attempts at hardcoded shortcuts, temporary fixtures, or misleading UX.

## Important facts

- The database is running and all the relevant configuration is stored at /data/dev/questables/.env.local
- The database service is configured and running on port 3001 as per .env.local
- Any geom related fields must be SRID 0
- Keep API_DOCUMENTATION.md updated at all times
- Keep schema.sql updated at all times
- Do not create dummy/mock/fake data
