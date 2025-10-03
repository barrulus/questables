#!/usr/bin/env node
import '../config/load-env.js';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDatabaseConnectionSettings } from '../db/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isCheckMode = process.argv.includes('--check');

const requireEnv = (key, { allowEmpty = false } = {}) => {
  const value = process.env[key];
  if (value === undefined) {
    console.error(`[tegola] Missing required environment variable: ${key}`);
    process.exit(1);
  }
  if (!allowEmpty && value.trim() === '') {
    console.error(`[tegola] Environment variable ${key} must not be empty.`);
    process.exit(1);
  }
  return value.trim();
};

const requireNumberEnv = (key) => {
  const raw = requireEnv(key);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`[tegola] Environment variable ${key} must be a finite number.`);
    process.exit(1);
  }
  return value;
};

const databaseSettings = getDatabaseConnectionSettings();

const posixPath = (value) => value.replace(/\\/g, '/');

const projectRoot = resolve(__dirname, '..', '..');
const cacheDir = resolve(projectRoot, requireEnv('TEGOLA_CACHE_DIR'));
const cacheFile = join(cacheDir, 'tegola-cache.sqlite');

const replacements = {
  TEGOLA_BIND: requireEnv('TEGOLA_WEB_LISTEN'),
  TEGOLA_PUBLIC_URL: requireEnv('TEGOLA_PUBLIC_URL'),
  TEGOLA_CACHE_FILE: posixPath(cacheFile),
  TEGOLA_CACHE_MAX_FEATURES: requireNumberEnv('TEGOLA_CACHE_MAX_FEATURES'),
  DATABASE_HOST: databaseSettings.host,
  DATABASE_PORT: databaseSettings.port,
  DATABASE_NAME: databaseSettings.database,
  DATABASE_USER: databaseSettings.user,
  DATABASE_PASSWORD: databaseSettings.password,
  DATABASE_SSLMODE: databaseSettings.sslmode,
  DATABASE_MAX_CONNECTIONS: databaseSettings.maxConnections,
  TEGOLA_MAX_ZOOM: requireNumberEnv('TEGOLA_MAX_ZOOM'),
};

const templatePath = join(__dirname, 'tegola.template.toml');
const template = await fs.readFile(templatePath, 'utf8');

let rendered = template;
for (const [key, value] of Object.entries(replacements)) {
  const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
  rendered = rendered.replace(pattern, String(value));
}

const leftoverPlaceholderMatch = rendered.match(/\{\{[^}]+}}/);
if (leftoverPlaceholderMatch) {
  console.error('[tegola] Failed to replace template placeholder:', leftoverPlaceholderMatch[0]);
  process.exit(1);
}

const outputPath = resolve(projectRoot, requireEnv('TEGOLA_CONFIG_PATH'));

if (isCheckMode) {
  console.log('[tegola] Check succeeded. Configuration would be written to', outputPath);
  console.log('[tegola] Cache directory would be ensured at', cacheDir);
  process.exit(0);
}

await fs.mkdir(cacheDir, { recursive: true });
await fs.mkdir(dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, rendered, 'utf8');

console.log(`[tegola] Config written to ${outputPath}`);
