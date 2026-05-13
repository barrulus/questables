import { encryptField, hmacLookup, isEncryptedValue, isEncryptionEnabled } from '../crypto.js';
import { logInfo, logWarn } from '../utils/logger.js';

// Idempotent migration that brings an existing user_profiles table into the
// AES-GCM + HMAC-lookup shape. Safe to run on fresh installs (no-op) and on
// already-migrated databases (no-op).
//
// Steps:
//   1. ALTER email / username from CITEXT to TEXT so ciphertext fits cleanly
//   2. Drop the old UNIQUE constraints on email / username
//   3. Add email_lookup / username_lookup columns + unique indexes
//   4. For each row: encrypt email + username (if not already), populate _lookup
//   5. NOT NULL the lookup columns once backfill is done
//
// Bail out (with a warning) if ENCRYPTION_KEY is not set — running without a key
// would leave the database in an inconsistent state (plaintext rows + empty lookups).

export async function migrateUserPii(client) {
  if (!isEncryptionEnabled()) {
    logWarn('[migrate-pii] ENCRYPTION_KEY not set — skipping PII encryption migration');
    return { skipped: true };
  }

  const existing = await client.query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profiles'`,
  );
  const columnTypes = new Map(existing.rows.map((r) => [r.column_name, r.udt_name]));

  if (!columnTypes.has('email')) {
    logInfo('[migrate-pii] user_profiles missing — nothing to migrate');
    return { skipped: true };
  }

  if (columnTypes.get('email') === 'citext') {
    await client.query(`ALTER TABLE public.user_profiles ALTER COLUMN email TYPE TEXT`);
    logInfo('[migrate-pii] email column converted CITEXT -> TEXT');
  }
  if (columnTypes.get('username') === 'citext') {
    await client.query(`ALTER TABLE public.user_profiles ALTER COLUMN username TYPE TEXT`);
    logInfo('[migrate-pii] username column converted CITEXT -> TEXT');
  }

  await dropUniqueConstraint(client, 'user_profiles', 'email');
  await dropUniqueConstraint(client, 'user_profiles', 'username');

  if (!columnTypes.has('email_lookup')) {
    await client.query(`ALTER TABLE public.user_profiles ADD COLUMN email_lookup TEXT`);
    logInfo('[migrate-pii] added email_lookup column');
  }
  if (!columnTypes.has('username_lookup')) {
    await client.query(`ALTER TABLE public.user_profiles ADD COLUMN username_lookup TEXT`);
    logInfo('[migrate-pii] added username_lookup column');
  }

  const { rows } = await client.query(
    `SELECT id, email, username, email_lookup, username_lookup FROM public.user_profiles`,
  );

  let encryptedEmails = 0;
  let encryptedUsernames = 0;
  let lookupsBackfilled = 0;

  for (const row of rows) {
    const updates = [];
    const values = [];

    if (row.email && !isEncryptedValue(row.email)) {
      const plain = row.email;
      values.push(encryptField(plain));
      updates.push(`email = $${values.length}`);
      values.push(hmacLookup(plain));
      updates.push(`email_lookup = $${values.length}`);
      encryptedEmails++;
      lookupsBackfilled++;
    } else if (row.email && !row.email_lookup) {
      // Already encrypted but lookup was never populated — recover from a half-applied migration.
      // We can't recompute the lookup without plaintext, so flag it loudly and skip.
      logWarn('[migrate-pii] row has encrypted email but no email_lookup — manual repair needed', {
        userId: row.id,
      });
    }

    if (row.username && !isEncryptedValue(row.username)) {
      const plain = row.username;
      values.push(encryptField(plain));
      updates.push(`username = $${values.length}`);
      values.push(hmacLookup(plain));
      updates.push(`username_lookup = $${values.length}`);
      encryptedUsernames++;
    } else if (row.username && !row.username_lookup) {
      logWarn('[migrate-pii] row has encrypted username but no username_lookup — manual repair needed', {
        userId: row.id,
      });
    }

    if (updates.length === 0) {
      continue;
    }

    values.push(row.id);
    await client.query(
      `UPDATE public.user_profiles SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values,
    );
  }

  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email_lookup ON public.user_profiles(email_lookup)`,
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_lookup ON public.user_profiles(username_lookup)`,
  );

  await client.query(`DROP INDEX IF EXISTS idx_user_profiles_email`);
  await client.query(`DROP INDEX IF EXISTS idx_user_profiles_username`);

  const nullCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.user_profiles WHERE email_lookup IS NULL OR username_lookup IS NULL`,
  );
  if ((nullCount.rows[0]?.n ?? 0) === 0) {
    await client.query(`ALTER TABLE public.user_profiles ALTER COLUMN email_lookup SET NOT NULL`);
    await client.query(`ALTER TABLE public.user_profiles ALTER COLUMN username_lookup SET NOT NULL`);
  } else {
    logWarn('[migrate-pii] some rows have NULL lookup columns — leaving NOT NULL off until repaired', {
      remaining: nullCount.rows[0]?.n,
    });
  }

  logInfo('[migrate-pii] PII migration complete', {
    encryptedEmails,
    encryptedUsernames,
    lookupsBackfilled,
    rowsScanned: rows.length,
  });

  return {
    skipped: false,
    encryptedEmails,
    encryptedUsernames,
    rowsScanned: rows.length,
  };
}

async function dropUniqueConstraint(client, table, column) {
  const { rows } = await client.query(
    `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.contype = 'u'
        AND att.attname = $2`,
    [table, column],
  );
  for (const row of rows) {
    await client.query(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${row.conname}`);
    logInfo(`[migrate-pii] dropped unique constraint ${row.conname}`);
  }
}
