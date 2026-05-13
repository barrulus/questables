// Auth rate limits (F9 in pentest report).
//
// Password login has been replaced with WebAuthn passkeys, so account-level
// lockout and bcrypt timing-safety no longer apply. What still does:
//
// - Per-IP rate limits on the public passkey ceremony endpoints, so an
//   attacker on the network can't burn server CPU / DB time spinning up
//   challenges in a loop.
// - Per-IP rate limit on /api/auth/refresh and on the enrolment routes.
//
// Tunables are env-overridable.

import rateLimit from 'express-rate-limit';

const PASSKEY_WINDOW_MS = Number(process.env.AUTH_PASSKEY_WINDOW_MS) || 60 * 1000;
const PASSKEY_MAX_PER_IP = Number(process.env.AUTH_PASSKEY_MAX_PER_IP) || 20;

const REFRESH_WINDOW_MS = Number(process.env.AUTH_REFRESH_WINDOW_MS) || 60 * 1000;
const REFRESH_MAX_PER_IP = Number(process.env.AUTH_REFRESH_MAX_PER_IP) || 30;

const ENROLMENT_WINDOW_MS = Number(process.env.AUTH_ENROLMENT_WINDOW_MS) || 60 * 60 * 1000;
const ENROLMENT_MAX_PER_IP = Number(process.env.AUTH_ENROLMENT_MAX_PER_IP) || 20;

export const passkeyLimiter = rateLimit({
  windowMs: PASSKEY_WINDOW_MS,
  max: PASSKEY_MAX_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_attempts',
    message: 'Too many passkey attempts from this IP. Please wait a minute and try again.',
  },
});

export const refreshLimiter = rateLimit({
  windowMs: REFRESH_WINDOW_MS,
  max: REFRESH_MAX_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_attempts',
    message: 'Too many refresh attempts from this IP. Please wait a minute and try again.',
  },
});

export const enrolmentLimiter = rateLimit({
  windowMs: ENROLMENT_WINDOW_MS,
  max: ENROLMENT_MAX_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_attempts',
    message: 'Too many enrolment attempts from this IP. Please try again later.',
  },
});
