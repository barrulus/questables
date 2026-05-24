# FMG Full-JSON ingest tests

Unit and orchestrator tests run as part of the normal `npm test` suite.

## End-to-end test (`e2e-jolliariana.test.js`)

Gated behind `RUN_E2E=1`; skipped by default because it ingests a real 66k-cell
FMG export and takes ~5 minutes.

### To run

1. Drop an FMG full-JSON export at the **repo root** with the filename
   `Jolliariana Full 2026-05-22-20-48.json`. The file is gitignored
   (`/*Full *-*-*-*-*.json`) so it never gets committed. Ask Barry for the
   exact fixture used by the EXPECTED counts — using a different export will
   fail the count assertions.
2. Ensure a writable Postgres at `$PGDATABASE` (default `questables`) with
   the migrations applied.
3. Run:
   ```bash
   RUN_E2E=1 npm test -- tests/maps/fmg-full-json/e2e-jolliariana.test.js --testTimeout=900000
   ```

The test inserts a `maps_world` row, calls `ingestFullJson(...,
{ skipSettlemaker: true })`, asserts per-table row counts, and verifies a few
burgs land inside their owning state polygons. The world row (and everything
keyed off it) is deleted in `afterAll`.

### Why `skipSettlemaker: true`

The settlemaker auto-trigger uses a dynamic `import()` of an ESM-only package
that Jest's CJS pipeline can't load. Production (plain Node ESM) handles it
fine; settlemaker integration is covered by its own tests.
