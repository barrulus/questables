import '../config/load-env.js';

const resolveBoolean = (value, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return defaultValue;
};

const requireConfig = (keys, description) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }

  throw new Error(
    `[Database] Missing required environment configuration for ${description}. ` +
    `Set one of: ${keys.join(', ')}`
  );
};

export const poolConfig = {
  host: requireConfig(['DATABASE_HOST', 'PGHOST'], 'database host'),
  port: parseInt(process.env.DATABASE_PORT || process.env.PGPORT || '5432', 10),
  database: requireConfig(['DATABASE_NAME', 'PGDATABASE'], 'database name'),
  user: requireConfig(['DATABASE_USER', 'PGUSER'], 'database user'),
  password: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || '',
  ssl: resolveBoolean(process.env.DATABASE_SSL, false)
    ? { rejectUnauthorized: false }
    : false,
  max: Number.parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  min: Number.parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
  idleTimeoutMillis: Number.parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: Number.parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  acquireTimeoutMillis: Number.parseInt(process.env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS || '10000', 10),
  query_timeout: Number.parseInt(process.env.DATABASE_POOL_QUERY_TIMEOUT_MS || '30000', 10),
  allowExitOnIdle: resolveBoolean(process.env.DATABASE_POOL_ALLOW_EXIT_ON_IDLE, true),
};

export const getDatabaseConnectionSettings = () => ({
  host: poolConfig.host,
  port: poolConfig.port,
  database: poolConfig.database,
  user: poolConfig.user,
  password: poolConfig.password,
  sslmode: poolConfig.ssl ? 'require' : 'disable',
  maxConnections: poolConfig.max,
});
