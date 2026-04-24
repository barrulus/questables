#!/usr/bin/env node
// Smoke test for Plan 3c (settlemaker 0.4.0 contract).
// Re-ingests a small set of burgs with { force: true } and reports:
//   - whether the 5 historically-broken burgs now generate
//   - gate count + multi-route gate count for a coastal burg
//   - row counts in maps_burg_entrances + maps_burg_entrance_routes
//
// Usage: node server/scripts/smoke-plan3c.js [<additional-burg-uuid> ...]

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ingestBurg } from '../services/settlemaker/ingestor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
for (const f of [
  join(__dirname, '..', '.env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '.env.local'),
  join(__dirname, '..', '..', '.env'),
]) {
  if (existsSync(f)) dotenv.config({ path: f, override: true });
}

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME || process.env.PGDATABASE,
  user: process.env.DATABASE_USER || process.env.PGUSER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const PROBLEM_BURGS = [
  '9b14bd4d-ab12-4952-9d09-5f2e4c81e4da', // Atarten
  '9cb09c49-ae10-492f-b98b-94a79213fe72', // Monmouth
  '20aeab18-2704-4d5b-9f62-1c5cef9bb626', // Wargmore
  '3428da8e-8640-4138-8dcf-e9fed721b63c', // Skipton
  '92f1131d-a736-4cf6-8472-57c993040e26', // Undraladrynn
];

const FOLIVE = '5d6f84aa-a673-4cae-881d-022c6ac4a766'; // baseline non-problem

async function summarize(client, burgId) {
  const { rows: [b] } = await client.query(
    `SELECT name, population, walls, citadel, port FROM public.maps_burgs WHERE id = $1`,
    [burgId],
  );
  const { rows: [s] } = await client.query(
    `SELECT has_harbour, ocean_bearing_deg, diameter_local, degraded_flags
       FROM public.maps_burg_settlements WHERE burg_id = $1`,
    [burgId],
  );
  const { rows: [g] } = await client.query(
    `SELECT COUNT(*)::int AS gates,
            COUNT(*) FILTER (WHERE sub_kind='harbour')::int AS harbours
       FROM public.maps_burg_entrances WHERE burg_id = $1`,
    [burgId],
  );
  const { rows: [r] } = await client.query(
    `SELECT COUNT(*)::int AS rows,
            COUNT(DISTINCT entrance_id)::int AS gates_with_routes,
            COUNT(*) FILTER (WHERE entrance_id IN (
              SELECT entrance_id FROM public.maps_burg_entrance_routes
                GROUP BY entrance_id HAVING COUNT(*) > 1))::int AS multi_route_rows
       FROM public.maps_burg_entrance_routes
      WHERE entrance_id IN (
        SELECT id FROM public.maps_burg_entrances WHERE burg_id = $1)`,
    [burgId],
  );
  return { burg: b, sidecar: s, gates: g, joinRows: r };
}

async function reingestOne(burgId) {
  const client = await pool.connect();
  try {
    const result = await ingestBurg(client, { burgId, force: true });
    return { ok: true, count: result.count };
  } catch (err) {
    return { ok: false, code: err.code ?? '', message: err.message };
  } finally {
    client.release();
  }
}

async function main() {
  const extra = process.argv.slice(2);
  const targets = [...PROBLEM_BURGS, FOLIVE, ...extra];

  console.log(`[smoke-plan3c] re-ingesting ${targets.length} burgs (force=true)\n`);

  const summaryClient = await pool.connect();
  try {
    for (const burgId of targets) {
      const res = await reingestOne(burgId);
      const tag = res.ok ? `OK count=${res.count}` : `ERROR ${res.code} ${res.message}`;
      const s = await summarize(summaryClient, burgId).catch(() => null);
      const name = s?.burg?.name ?? burgId;
      const meta = s
        ? `pop=${s.burg.population} walls=${s.burg.walls} citadel=${s.burg.citadel} port=${s.burg.port}`
        : 'meta_unavailable';
      const sc = s?.sidecar
        ? `harbour=${s.sidecar.has_harbour} ocean=${s.sidecar.ocean_bearing_deg ?? '-'} degraded=${(s.sidecar.degraded_flags ?? []).join(',') || '-'}`
        : 'no_sidecar';
      const gates = s?.gates
        ? `gates=${s.gates.gates} harbours=${s.gates.harbours}`
        : '';
      const join = s?.joinRows
        ? `join_rows=${s.joinRows.rows} gates_with_routes=${s.joinRows.gates_with_routes} multi_route_rows=${s.joinRows.multi_route_rows}`
        : '';
      console.log(`  ${name.padEnd(20)} ${tag}`);
      console.log(`    ${meta}`);
      console.log(`    ${sc}  ${gates}  ${join}\n`);
    }
  } finally {
    summaryClient.release();
  }

  // Global counts
  const { rows: [tot] } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.maps_burgs`);
  const { rows: [sc] } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.maps_burg_settlements`);
  console.log(`[smoke-plan3c] sidecars ${sc.n}/${tot.n} (missing ${tot.n - sc.n})`);

  await pool.end();
}

main().catch((err) => {
  console.error('[smoke-plan3c] fatal', err);
  process.exit(1);
});
