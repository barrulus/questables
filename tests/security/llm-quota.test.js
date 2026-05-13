/**
 * @jest-environment node
 *
 * Unit tests for per-user LLM quotas (F16 in pentest report).
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { consumeLLMQuota, __resetLLMQuota } from '../../server/utils/llm-quota.js';

const makeReq = (overrides = {}) => ({
  user: { id: 'user-1', roles: ['player'] },
  ...overrides,
});

describe('consumeLLMQuota', () => {
  beforeEach(() => __resetLLMQuota());

  it('rejects unauthenticated requests with 401', () => {
    expect(() => consumeLLMQuota({})).toThrow(
      expect.objectContaining({ type: 'llm_quota_unauthenticated', status: 401 }),
    );
  });

  it('lets admins bypass the limit', () => {
    const admin = makeReq({ user: { id: 'admin-1', roles: ['admin'] } });
    for (let i = 0; i < 100; i += 1) {
      expect(() => consumeLLMQuota(admin)).not.toThrow();
    }
  });

  it('throws 429 once the per-minute limit is exhausted', () => {
    const req = makeReq();
    // Default per-minute limit is 20.
    for (let i = 0; i < 20; i += 1) {
      consumeLLMQuota(req);
    }
    expect(() => consumeLLMQuota(req)).toThrow(
      expect.objectContaining({
        type: 'llm_quota_exceeded',
        status: 429,
        scope: 'minute',
      }),
    );
  });

  it('keeps per-user budgets independent', () => {
    const reqA = makeReq({ user: { id: 'user-a', roles: ['player'] } });
    const reqB = makeReq({ user: { id: 'user-b', roles: ['player'] } });
    for (let i = 0; i < 20; i += 1) consumeLLMQuota(reqA);
    expect(() => consumeLLMQuota(reqB)).not.toThrow();
  });
});
