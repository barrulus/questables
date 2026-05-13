import crypto from 'node:crypto';
import { logError, logWarn } from './utils/logger.js';

const SENTINEL_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';
const HMAC_ALGORITHM = 'sha256';

let cachedKey = null;
let cachedHmacKey = null;
let warnedDisabled = false;

const decodeKey = () => {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (!warnedDisabled) {
      logWarn(
        'ENCRYPTION_KEY is not set — PII encryption is disabled. ' +
          'Generate one with `openssl rand -hex 32` and set ENCRYPTION_KEY before deploying to production.',
      );
      warnedDisabled = true;
    }
    return null;
  }
  let buf;
  try {
    buf = Buffer.from(raw.trim(), 'hex');
  } catch (error) {
    throw new Error('ENCRYPTION_KEY must be a hex-encoded 32-byte value');
  }
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
};

const getKey = () => {
  if (cachedKey === null) {
    cachedKey = decodeKey();
  }
  return cachedKey;
};

const getHmacKey = () => {
  if (cachedHmacKey === null) {
    const key = getKey();
    if (!key) {
      return null;
    }
    cachedHmacKey = crypto.createHash('sha256').update(Buffer.concat([key, Buffer.from('hmac', 'utf8')])).digest();
  }
  return cachedHmacKey;
};

export const isEncryptionEnabled = () => getKey() !== null;

export const isEncryptedValue = (value) =>
  typeof value === 'string' && value.startsWith(SENTINEL_PREFIX);

export const encryptField = (plaintext) => {
  if (plaintext === null || plaintext === undefined) {
    return plaintext;
  }
  if (typeof plaintext !== 'string') {
    plaintext = String(plaintext);
  }
  if (isEncryptedValue(plaintext)) {
    return plaintext;
  }
  const key = getKey();
  if (!key) {
    return plaintext;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SENTINEL_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

export const decryptField = (value) => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }
  if (!isEncryptedValue(value)) {
    return value;
  }
  const key = getKey();
  if (!key) {
    return value;
  }
  const parts = value.slice(SENTINEL_PREFIX.length).split(':');
  if (parts.length !== 3) {
    logError('decryptField: malformed ciphertext', null, { length: value.length });
    return value;
  }
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      logError('decryptField: invalid iv/tag length', null);
      return value;
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    logError('decryptField: decryption failed', error);
    return value;
  }
};

export const decryptRow = (row, columns) => {
  if (!row || !columns || columns.length === 0) {
    return row;
  }
  const clone = { ...row };
  for (const col of columns) {
    if (col in clone) {
      clone[col] = decryptField(clone[col]);
    }
  }
  return clone;
};

export const decryptRows = (rows, columns) => {
  if (!Array.isArray(rows)) {
    return rows;
  }
  return rows.map((row) => decryptRow(row, columns));
};

export const hmacLookup = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const key = getHmacKey();
  if (!key) {
    return trimmed;
  }
  return crypto.createHmac(HMAC_ALGORITHM, key).update(trimmed, 'utf8').digest('hex');
};
