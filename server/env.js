import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Load env from server/.env, then repo root .env and .env.local (overrides)
export default function loadEnv() {
  dotenv.config();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = join(__dirname, '..');

  for (const name of ['.env', '.env.local']) {
    const p = join(repoRoot, name);
    if (existsSync(p)) {
      dotenv.config({ path: p, override: true });
    }
  }
}

