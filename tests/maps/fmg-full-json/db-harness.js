import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Client } = pg;

export const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/fmg-full-json/tiny.json'
);

export async function loadTinyFixture() {
  return JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf8'));
}

export function describeWithDb(name, fn) {
  const canRun = !!(process.env.PGUSER || process.env.DATABASE_URL || process.env.PGDATABASE);
  const d = canRun ? describe : describe.skip;
  d(name, fn);
}

export async function openTxClient() {
  const client = new Client({
    database: process.env.PGDATABASE || process.env.DATABASE_NAME || 'questables',
  });
  await client.connect();
  await client.query('BEGIN');
  return client;
}

export async function rollbackAndClose(client) {
  if (!client) return;
  try { await client.query('ROLLBACK'); } catch {}
  await client.end();
}

export async function seedWorld(client, { name = 'Tiny test world' } = {}) {
  const { rows } = await client.query(
    `INSERT INTO public.maps_world (name, width_pixels, height_pixels, bounds)
     VALUES ($1, 100, 100, $2) RETURNING id`,
    [name, JSON.stringify({ minX: 0, minY: 0, maxX: 100, maxY: 100 })],
  );
  return rows[0].id;
}
