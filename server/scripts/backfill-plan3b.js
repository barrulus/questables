#!/usr/bin/env node
// One-shot backfill for Plan 3b. Iterates every burg in maps_burgs and
// re-runs the settlemaker ingester with { force: true }. Each burg runs
// in its own transaction. Exits non-zero if any burg errors.
//
// Usage:  node server/scripts/backfill-plan3b.js
//
// Safe to re-run.

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

async function main() {
  const client = await pool.connect();
  let burgIds;
  try {
    const { rows } = await client.query(`SELECT id FROM public.maps_burgs ORDER BY id`);
    burgIds = rows.map((r) => r.id);
  } finally {
    client.release();
  }

  console.log(`[plan3b-backfill] ${burgIds.length} burgs to process`);
  let written = 0;
  let errored = 0;

  for (const burgId of burgIds) {
    const txClient = await pool.connect();
    try {
      const result = await ingestBurg(txClient, { burgId, force: true });
      console.log(`[plan3b-backfill] ${burgId}: written (count=${result.count})`);
      written += 1;
    } catch (err) {
      console.error(`[plan3b-backfill] ${burgId}: ERROR ${err.code ?? ''} ${err.message}`);
      errored += 1;
    } finally {
      txClient.release();
    }
  }

  console.log(`[plan3b-backfill] done — written=${written}, errored=${errored}`);
  await pool.end();
  if (errored > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[plan3b-backfill] fatal', err);
  process.exit(1);
});
