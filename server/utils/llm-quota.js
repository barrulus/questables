// Per-user LLM quota (F16 in pentest report).
//
// Authentication on the LLM-invoking routes is already in place, but
// without a quota any enrolled-but-bored player can still burn the DM's
// Anthropic / Ollama budget. We keep two sliding windows per user:
// short-term (per-minute) to absorb bursts and long-term (per-hour) to
// cap sustained abuse. Admins bypass the check.
//
// In-memory state is fine for the current single-node deployment; if the
// server ever scales horizontally, swap for a Redis-backed counter.

import { LLMServiceError } from '../llm/errors.js';
import { logSecurityEvent } from './logger.js';

const PER_MINUTE_LIMIT = Number(process.env.LLM_QUOTA_PER_MINUTE) || 20;
const PER_HOUR_LIMIT = Number(process.env.LLM_QUOTA_PER_HOUR) || 200;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const buckets = new Map();

const trim = (timestamps, now) => {
  while (timestamps.length && now - timestamps[0] > HOUR_MS) {
    timestamps.shift();
  }
};

const countSince = (timestamps, now, windowMs) => {
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i -= 1) {
    if (now - timestamps[i] <= windowMs) count += 1;
    else break;
  }
  return count;
};

const reserveSlot = (userId, now) => {
  const list = buckets.get(userId) ?? [];
  trim(list, now);
  if (countSince(list, now, MINUTE_MS) >= PER_MINUTE_LIMIT) {
    return { ok: false, scope: 'minute', limit: PER_MINUTE_LIMIT };
  }
  if (list.length >= PER_HOUR_LIMIT) {
    return { ok: false, scope: 'hour', limit: PER_HOUR_LIMIT };
  }
  list.push(now);
  buckets.set(userId, list);
  return { ok: true };
};

const isAdmin = (user) => Array.isArray(user?.roles) && user.roles.includes('admin');

// Centralised quota enforcement. Throws an LLMServiceError that the route's
// error mapper turns into a 429 (see callers). If the request has no
// authenticated user we deliberately deny — every LLM-invoking surface
// should already require auth at the router level after the F3/F16 fixes.
export const consumeLLMQuota = (req) => {
  const user = req?.user;
  if (!user?.id) {
    throw new LLMServiceError('Authentication required to invoke the LLM service', {
      type: 'llm_quota_unauthenticated',
      status: 401,
    });
  }
  if (isAdmin(user)) return;
  const result = reserveSlot(user.id, Date.now());
  if (!result.ok) {
    logSecurityEvent('llm.quota_exceeded', 'medium', {
      userId: user.id,
      scope: result.scope,
      limit: result.limit,
    });
    throw new LLMServiceError(`LLM quota exceeded (${result.scope}). Try again later.`, {
      type: 'llm_quota_exceeded',
      status: 429,
      scope: result.scope,
      limit: result.limit,
    });
  }
};

export const __resetLLMQuota = () => {
  buckets.clear();
};
