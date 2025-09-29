#!/usr/bin/env node
import '../config/load-env.js';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REQUIRED_ENV_VARS = [
  'TEGOLA_DATABASE_HOST',
  'TEGOLA_DATABASE_PORT',
  'TEGOLA_DATABASE_NAME',
  'TEGOLA_DATABASE_USER',
  'TEGOLA_DATABASE_PASSWORD',
  'TEGOLA_DATABASE_SSLMODE',
  'TEGOLA_DATABASE_MAX_CONNECTIONS',
  'TEGOLA_WEB_LISTEN',
  'TEGOLA_PUBLIC_URL',
  'TEGOLA_CACHE_DIR',
  'TEGOLA_CACHE_MAX_FEATURES',
  'TEGOLA_MAX_ZOOM',
  'TEGOLA_CONFIG_PATH',
];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');
if (missing.length > 0) {
  console.error('[tegola] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const toNumber = (key) => {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value)) {
    console.error(`[tegola] Environment variable ${key} must be a finite number.`);
    process.exit(1);
  }
  return value;
};

const posixPath = (value) => value.replace(/\\/g, '/');

const projectRoot = resolve(__dirname, '..', '..');
const cacheDir = resolve(projectRoot, process.env.TEGOLA_CACHE_DIR);
const cacheFile = join(cacheDir, 'tegola-cache.sqlite');

const replacements = {
  TEGOLA_BIND: process.env.TEGOLA_WEB_LISTEN,
  TEGOLA_PUBLIC_URL: process.env.TEGOLA_PUBLIC_URL,
  TEGOLA_CACHE_FILE: posixPath(cacheFile),
  TEGOLA_CACHE_MAX_FEATURES: toNumber('TEGOLA_CACHE_MAX_FEATURES'),
  TEGOLA_DATABASE_HOST: process.env.TEGOLA_DATABASE_HOST,
  TEGOLA_DATABASE_PORT: toNumber('TEGOLA_DATABASE_PORT'),
  TEGOLA_DATABASE_NAME: process.env.TEGOLA_DATABASE_NAME,
  TEGOLA_DATABASE_USER: process.env.TEGOLA_DATABASE_USER,
  TEGOLA_DATABASE_PASSWORD: process.env.TEGOLA_DATABASE_PASSWORD,
  TEGOLA_DATABASE_SSLMODE: process.env.TEGOLA_DATABASE_SSLMODE,
  TEGOLA_DATABASE_MAX_CONNECTIONS: toNumber('TEGOLA_DATABASE_MAX_CONNECTIONS'),
  TEGOLA_MAX_ZOOM: toNumber('TEGOLA_MAX_ZOOM'),
};

const templatePath = join(__dirname, 'tegola.template.toml');
const template = await fs.readFile(templatePath, 'utf8');

let rendered = template;
for (const [key, value] of Object.entries(replacements)) {
  const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
  rendered = rendered.replace(pattern, String(value));
}

await fs.mkdir(cacheDir, { recursive: true });

const outputPath = resolve(projectRoot, process.env.TEGOLA_CONFIG_PATH);
await fs.mkdir(dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, rendered, 'utf8');

console.log(`[tegola] Config written to ${outputPath}`);
