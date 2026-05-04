/**
 * @jest-environment node
 *
 * Unit tests for EnhancedLLMService.clearCacheForCampaign — the campaign-scoped
 * cache buster wired into movement code paths so a 5-min-TTL prompt hash can't
 * serve stale narration after the world state shifts.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { EnhancedLLMService } from '../../server/llm/enhanced-llm-service.js';
import { LLMProviderRegistry, EnhancedLLMProvider } from '../../server/llm/provider-registry.js';
import { NARRATIVE_TYPES } from '../../server/llm/narrative-types.js';

class FakeProvider extends EnhancedLLMProvider {
  constructor() {
    super({ name: 'fake' });
    this.model = 'fake-model';
    this.generate = jest.fn().mockImplementation(async (_type, options) => ({
      content: 'hello',
      metrics: {
        latencyMs: 1,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      provider: { name: this.name, model: this.model },
      raw: {},
    }));
  }
}

const buildSvc = () => {
  const provider = new FakeProvider();
  const registry = new LLMProviderRegistry();
  registry.register('fake', provider);
  const svc = new EnhancedLLMService({ registry, defaultProvider: 'fake' });
  return { svc, provider };
};

const TYPE = NARRATIVE_TYPES.PLAYER_ACTION_RESPONSE;

describe('EnhancedLLMService.clearCacheForCampaign', () => {
  it("busts only the targeted campaign's cache entries", async () => {
    const { svc, provider } = buildSvc();

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p',
      metadata: { campaignId: 'A' },
    });
    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p',
      metadata: { campaignId: 'A' },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1); // 2nd was a cache hit

    const deleted = svc.clearCacheForCampaign('A');
    expect(deleted).toBe(1);

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p',
      metadata: { campaignId: 'A' },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2); // bust => miss
  });

  it("leaves other campaigns' caches alone", async () => {
    const { svc, provider } = buildSvc();

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'q',
      metadata: { campaignId: 'A' },
    });
    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'q',
      metadata: { campaignId: 'B' },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);

    const deleted = svc.clearCacheForCampaign('A');
    expect(deleted).toBe(1);

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'q',
      metadata: { campaignId: 'A' },
    });
    expect(provider.generate).toHaveBeenCalledTimes(3); // A re-invoked

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'q',
      metadata: { campaignId: 'B' },
    });
    expect(provider.generate).toHaveBeenCalledTimes(3); // B still cached
  });

  it('returns 0 when the campaign has no cached entries', () => {
    const { svc } = buildSvc();
    expect(svc.clearCacheForCampaign('nonexistent')).toBe(0);
  });

  it('returns 0 and is a no-op when campaignId is falsy', () => {
    const { svc } = buildSvc();
    expect(svc.clearCacheForCampaign(null)).toBe(0);
    expect(svc.clearCacheForCampaign('')).toBe(0);
    expect(svc.clearCacheForCampaign(undefined)).toBe(0);
  });

  it('increments metrics.totals.cacheEvictions by the deleted count', async () => {
    const { svc } = buildSvc();

    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p1',
      metadata: { campaignId: 'X' },
    });
    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p2',
      metadata: { campaignId: 'X' },
    });
    await svc.generate({
      type: TYPE, providerName: 'fake', prompt: 'p3',
      metadata: { campaignId: 'Y' },
    });

    const evictionsBefore = svc.getMetrics().totals.cacheEvictions;
    const deleted = svc.clearCacheForCampaign('X');
    expect(deleted).toBe(2);
    const evictionsAfter = svc.getMetrics().totals.cacheEvictions;
    expect(evictionsAfter - evictionsBefore).toBe(2);
  });
});
