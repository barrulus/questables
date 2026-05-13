#!/usr/bin/env node
// One-shot CLI: issue a passkey enrolment link for an existing user.
//
// Usage:  npm run enrol-admin <username>
//
// Prints the enrolment URL to stdout and exits. The URL is single-use and
// expires in 72h (see ENROLMENT_TTL_HOURS in services/auth/webauthn.js).

import '../config/load-env.js';
import { query, pool } from '../db/pool.js';
import { hmacLookup, isEncryptionEnabled } from '../crypto.js';
import { createEnrolmentToken } from '../services/auth/webauthn.js';

const usage = () => {
  console.error('Usage: npm run enrol-admin <username>');
  process.exit(1);
};

const main = async () => {
  const username = process.argv[2];
  if (!username || !username.trim()) {
    usage();
  }
  if (!isEncryptionEnabled()) {
    console.error('ENCRYPTION_KEY is not set — refusing to look up users by lookup hash.');
    console.error('Set ENCRYPTION_KEY in your environment first.');
    process.exit(2);
  }

  const lookup = hmacLookup(username.trim());
  const { rows } = await query(
    `SELECT id FROM user_profiles WHERE username_lookup = $1 LIMIT 1`,
    [lookup],
  );

  if (rows.length === 0) {
    console.error(`User "${username}" not found.`);
    process.exit(3);
  }

  const userId = rows[0].id;
  const { token, expiresAt } = await createEnrolmentToken({ userId, createdBy: null });

  const origin = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000').split(',')[0].trim();
  const url = `${origin.replace(/\/$/, '')}/enrol/${token}`;

  console.log('');
  console.log('Enrolment link issued:');
  console.log('');
  console.log(`  ${url}`);
  console.log('');
  console.log(`Expires: ${new Date(expiresAt).toISOString()}`);
  console.log('Share this URL with the user — single-use, opens the passkey registration flow.');
  console.log('');
};

main()
  .catch((error) => {
    console.error('enrol-admin failed:', error);
    process.exit(10);
  })
  .finally(() => pool.end());
