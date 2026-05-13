/**
 * @jest-environment node
 *
 * Sanity coverage for the auth hardening limiters (F9 in pentest report).
 * Account-level lockout and bcrypt timing-safety no longer apply because
 * password login was replaced with passkeys — only the per-IP limiters
 * remain. We just assert they're constructed as Express middleware so
 * we'd notice if the upstream rate-limit API regressed.
 */
import { describe, it, expect } from '@jest/globals';
import {
  passkeyLimiter,
  refreshLimiter,
  enrolmentLimiter,
} from '../../server/utils/auth-rate-limit.js';

describe('auth limiters', () => {
  it('exports Express middleware for passkey, refresh, and enrolment', () => {
    expect(typeof passkeyLimiter).toBe('function');
    expect(typeof refreshLimiter).toBe('function');
    expect(typeof enrolmentLimiter).toBe('function');
    // express-rate-limit middleware is (req, res, next) → 3 formal args.
    expect(passkeyLimiter.length).toBe(3);
    expect(refreshLimiter.length).toBe(3);
    expect(enrolmentLimiter.length).toBe(3);
  });
});
