import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envCandidates = [
  join(__dirname, '..', '..', '.env'),
  join(__dirname, '..', '..', '.env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '.env.local'),
  join(__dirname, '.env'),
  join(__dirname, '.env.local'),
].filter((value, index, self) => self.indexOf(value) === index);

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

export const loadedEnvFiles = envCandidates.filter((envPath) => existsSync(envPath));
