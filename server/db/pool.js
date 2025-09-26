import { Pool } from 'pg';
import '../config/load-env.js';
import { logInfo, logError, logWarn, logDatabaseOperation } from '../utils/logger.js';
import { incrementCounter, setGauge } from '../utils/telemetry.js';

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

const poolConfig = {
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

export const pool = new Pool(poolConfig);

pool.on('connect', () => {
  logInfo('[Database] Client connected to pool');
  incrementCounter('database.pool.connect');
  setGauge('database.pool.total', pool.totalCount);
  setGauge('database.pool.idle', pool.idleCount);
  setGauge('database.pool.waiting', pool.waitingCount);
});

pool.on('error', (error) => {
  logError('[Database] Pool error', error);
  incrementCounter('database.pool.error');
});

pool.on('remove', () => {
  logInfo('[Database] Client removed from pool');
  incrementCounter('database.pool.remove');
  setGauge('database.pool.total', pool.totalCount);
  setGauge('database.pool.idle', pool.idleCount);
  setGauge('database.pool.waiting', pool.waitingCount);
});

export const query = async (text, params = [], { label } = {}) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logDatabaseOperation({ text, duration, rowCount: result.rowCount, label });
    if (duration > 1000) {
      logWarn('[Database] Slow query detected', { duration, label, text: text.slice(0, 120) });
    }
    return result;
  } catch (error) {
    logError('[Database] Query failed', error, { text: text.slice(0, 120), label });
    incrementCounter('database.query.error');
    throw error;
  }
};


export const getClient = async ({ label } = {}) => {
  const client = await pool.connect();
  let released = false;
  const originalRelease = client.release.bind(client);

  client.release = () => {
    if (released) {
      logWarn('[Database] Client released multiple times', { label });
      return;
    }
    released = true;
    originalRelease();
    setGauge('database.pool.idle', pool.idleCount);
    setGauge('database.pool.waiting', pool.waitingCount);
  };

  const leakTimer = setTimeout(() => {
    if (!released) {
      logWarn('[Database] Client checkout exceeded watchdog threshold', { label });
    }
  }, Number.parseInt(process.env.DATABASE_POOL_WATCHDOG_MS || '60000', 10));
  if (typeof leakTimer.unref === 'function') {
    leakTimer.unref();
  }

  client.once('end', () => {
    clearTimeout(leakTimer);
  });

  return client;
};

export const withClient = async (callback, { label } = {}) => {
  const client = await pool.connect();
  try {
    return await callback(client);
  } catch (error) {
    logError('[Database] Client operation failed', error, { label });
    throw error;
  } finally {
    client.release();
    setGauge('database.pool.idle', pool.idleCount);
    setGauge('database.pool.waiting', pool.waitingCount);
  }
};

export const withTransaction = async (callback, { isolationLevel, label } = {}) => {
  return withClient(async (client) => {
    const isolationClause = isolationLevel ? ` ISOLATION LEVEL ${isolationLevel}` : '';
    try {
      await client.query(`BEGIN${isolationClause}`);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logError('[Database] Transaction rollback failed', rollbackError, { label });
      }
      throw error;
    }
  }, { label });
};

export const getPoolStats = () => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
});
