import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { query, withTransaction } from '../../db/pool.js';
import { decryptField } from '../../crypto.js';
import { logError, logInfo } from '../../utils/logger.js';

const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Questables';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const expectedOrigins = ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

const sha256Hex = (input) =>
  crypto.createHash('sha256').update(input, 'utf8').digest('hex');

const newOpaqueId = () => crypto.randomBytes(16).toString('base64url');

const persistChallenge = async ({ userId, purpose, challenge }) => {
  const challengeId = newOpaqueId();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await query(
    `INSERT INTO webauthn_challenges (challenge_id, user_id, purpose, challenge, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [challengeId, userId ?? null, purpose, challenge, expiresAt],
  );
  return challengeId;
};

const consumeChallenge = async ({ challengeId, purpose }) => {
  const { rows } = await query(
    `DELETE FROM webauthn_challenges
       WHERE challenge_id = $1
         AND purpose = $2
         AND expires_at > NOW()
       RETURNING user_id, challenge`,
    [challengeId, purpose],
  );
  // Best-effort: also clean up anything stale on the way out so the table stays small.
  await query(`DELETE FROM webauthn_challenges WHERE expires_at <= NOW()`).catch(() => {});
  return rows[0] ?? null;
};

const decodeBase64Url = (value) => Buffer.from(value, 'base64url');

const credentialIdToBuffer = (storedCredentialId) =>
  decodeBase64Url(storedCredentialId);

export const generateRegistrationChallenge = async ({ userId, username, excludeCredentialIds = [] }) => {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userId, 'utf8'),
    userName: username || userId,
    userDisplayName: username || userId,
    attestationType: 'none',
    excludeCredentials: excludeCredentialIds.map((id) => ({
      id,
      transports: ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  const challengeId = await persistChallenge({
    userId,
    purpose: 'registration',
    challenge: options.challenge,
  });

  return { options, challengeId };
};

export const verifyRegistration = async ({ userId, challengeId, response, deviceName }) => {
  const stored = await consumeChallenge({ challengeId, purpose: 'registration' });
  if (!stored) {
    throw Object.assign(new Error('Challenge expired or already used'), { status: 400 });
  }
  if (stored.user_id !== userId) {
    throw Object.assign(new Error('Challenge does not match user'), { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (error) {
    logError('webauthn: registration verification failed', error);
    throw Object.assign(new Error('Passkey registration could not be verified'), { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Passkey registration was not verified'), { status: 400 });
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential?.id;
  const publicKey = info.credential?.publicKey;
  const counter = info.credential?.counter ?? 0;
  const transports = response.response?.transports ?? null;

  if (!credentialId || !publicKey) {
    throw Object.assign(new Error('Passkey registration response missing fields'), { status: 400 });
  }

  await query(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, counter, transports, device_name, backup_eligible, backup_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      credentialId,
      Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey),
      counter,
      transports,
      deviceName ?? null,
      Boolean(info.credentialBackedUp ?? info.credential?.backedUp ?? false),
      Boolean(info.credentialBackedUp ?? info.credential?.backedUp ?? false),
    ],
  );

  logInfo('webauthn: credential registered', {
    telemetryEvent: 'auth.passkey.registered',
    userId,
  });

  return { verified: true };
};

export const generateAuthenticationChallenge = async () => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials: [],
  });

  const challengeId = await persistChallenge({
    userId: null,
    purpose: 'authentication',
    challenge: options.challenge,
  });

  return { options, challengeId };
};

export const verifyAuthentication = async ({ challengeId, response }) => {
  const stored = await consumeChallenge({ challengeId, purpose: 'authentication' });
  if (!stored) {
    throw Object.assign(new Error('Challenge expired or already used'), { status: 400 });
  }

  const rawId = response?.rawId ?? response?.id;
  if (!rawId) {
    throw Object.assign(new Error('Missing credential identifier'), { status: 400 });
  }

  const { rows } = await query(
    `SELECT c.id, c.user_id, c.credential_id, c.public_key, c.counter, c.transports,
            u.username, u.email, u.roles, u.status
       FROM webauthn_credentials c
       JOIN user_profiles u ON u.id = c.user_id
      WHERE c.credential_id = $1
      LIMIT 1`,
    [rawId],
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('Unknown passkey'), { status: 401 });
  }
  const cred = rows[0];

  if (cred.status === 'banned' || cred.status === 'suspended') {
    throw Object.assign(new Error('Account suspended'), { status: 403 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credential_id,
        publicKey: cred.public_key,
        counter: Number(cred.counter),
        transports: cred.transports ?? undefined,
      },
      requireUserVerification: false,
    });
  } catch (error) {
    logError('webauthn: authentication verification failed', error);
    throw Object.assign(new Error('Passkey authentication could not be verified'), { status: 401 });
  }

  if (!verification.verified) {
    throw Object.assign(new Error('Passkey authentication was not verified'), { status: 401 });
  }

  const newCounter = verification.authenticationInfo?.newCounter ?? Number(cred.counter);
  await query(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2`,
    [newCounter, cred.id],
  );

  return {
    userId: cred.user_id,
    username: decryptField(cred.username),
    email: decryptField(cred.email),
    roles: cred.roles,
    status: cred.status,
  };
};

export const listUserPasskeys = async (userId) => {
  const { rows } = await query(
    `SELECT id, credential_id, device_name, transports, created_at, last_used_at
       FROM webauthn_credentials
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
};

export const deleteUserPasskey = async (userId, credentialDbId) => {
  const { rows } = await query(
    `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2 RETURNING id`,
    [credentialDbId, userId],
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('Passkey not found'), { status: 404 });
  }
  return rows[0];
};

export const userExcludeCredentials = async (userId) => {
  const { rows } = await query(
    `SELECT credential_id FROM webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.credential_id);
};

const ENROLMENT_TTL_HOURS = 72;

export const createEnrolmentToken = async ({ userId, createdBy }) => {
  const plain = crypto.randomBytes(24).toString('base64url');
  const tokenHash = sha256Hex(plain);
  const expiresAt = new Date(Date.now() + ENROLMENT_TTL_HOURS * 60 * 60 * 1000);

  await withTransaction(async (client) => {
    // Invalidate any outstanding tokens for this user so old links can't race the new one.
    await client.query(
      `UPDATE enrolment_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId],
    );
    await client.query(
      `INSERT INTO enrolment_tokens (user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, expiresAt, createdBy ?? null],
    );
  }, { label: 'webauthn.enrolment.create' });

  logInfo('webauthn: enrolment token issued', {
    telemetryEvent: 'auth.enrolment.issued',
    userId,
    issuedBy: createdBy,
  });

  return { token: plain, expiresAt };
};

export const lookupEnrolmentToken = async (plainToken) => {
  if (!plainToken || typeof plainToken !== 'string') {
    return null;
  }
  const tokenHash = sha256Hex(plainToken);
  const { rows } = await query(
    `SELECT id, user_id, expires_at, consumed_at
       FROM enrolment_tokens
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  if (rows.length === 0) {
    return null;
  }
  const token = rows[0];
  if (token.consumed_at) {
    return { ...token, invalid: 'consumed' };
  }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { ...token, invalid: 'expired' };
  }
  return token;
};

export const consumeEnrolmentToken = async (plainToken) => {
  const tokenHash = sha256Hex(plainToken);
  const { rows } = await query(
    `UPDATE enrolment_tokens
        SET consumed_at = NOW()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING id, user_id`,
    [tokenHash],
  );
  return rows[0] ?? null;
};

export const getEnrolmentTokenUser = async (plainToken) => {
  const lookup = await lookupEnrolmentToken(plainToken);
  if (!lookup || lookup.invalid) {
    return null;
  }
  const { rows } = await query(
    `SELECT id, username, email, roles, status FROM user_profiles WHERE id = $1 LIMIT 1`,
    [lookup.user_id],
  );
  if (rows.length === 0) {
    return null;
  }
  const u = rows[0];
  return {
    id: u.id,
    username: decryptField(u.username),
    email: decryptField(u.email),
    roles: u.roles,
    status: u.status,
  };
};

export { credentialIdToBuffer };
