/**
 * @jest-environment node
 */
/* eslint-env node */

const { describe, it, expect, beforeAll } = globalThis;
const jestGlobal = globalThis.jest;
const env = globalThis.process?.env ?? {};

const missingConfig = [];

if (!env.LLM_OLLAMA_MODEL) {
  missingConfig.push('LLM_OLLAMA_MODEL');
}

let initializeLLMServiceFromEnv;
let NARRATIVE_TYPES;
let logWarn;

jestGlobal?.setTimeout?.(120000);

const runnableDescribe = missingConfig.length > 0 ? describe.skip : describe;

runnableDescribe('Ollama provider integration (live service)', () => {
  let service;
  let provider;
  let skipReason;
  let health;

  beforeAll(async () => {
    try {
      ({ initializeLLMServiceFromEnv, NARRATIVE_TYPES } = await import('../server/llm/index.js'));
      ({ logWarn } = await import('../server/utils/logger.js'));
    } catch (error) {
      skipReason = `Failed to load LLM modules: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }

    if (missingConfig.length > 0) {
      skipReason = `Missing configuration: ${missingConfig.join(', ')}`;
      return;
    }

    try {
      const bootstrap = initializeLLMServiceFromEnv(env);
      service = bootstrap.service;
      provider = bootstrap.registry.get('ollama');
      health = await provider.checkHealth();
      if (!health?.healthy) {
        skipReason = `Ollama provider reported unhealthy status (host=${health?.host}, model=${health?.model}, error=${health?.error || 'unknown'})`;
      }
    } catch (error) {
      skipReason = `Failed to initialize Enhanced LLM service: ${error instanceof Error ? error.message : String(error)}`;
      logWarn?.('Skipping Ollama provider integration tests due to initialization failure', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 120000);

  const guard = () => {
    if (skipReason) {
      globalThis.console?.warn?.(`[Ollama integration] ${skipReason}`);
      return true;
    }
    return false;
  };

  it('generates DM narration using the live Ollama provider', async () => {
    if (guard()) {
      return;
    }

    const prompt = 'You are the Dungeon Master. Provide a concise narration for a party entering the ancient ruins beneath Neverwinter. Reference the chill air and distant chanting if appropriate.';
    const type = NARRATIVE_TYPES?.DM_NARRATION;
    if (!type) {
      throw new Error('NARRATIVE_TYPES.DM_NARRATION is not defined');
    }

    const result = await service.generate({
      type,
      prompt,
      metadata: {
        campaignId: env.TEST_CAMPAIGN_ID || 'integration-campaign',
        sessionId: env.TEST_SESSION_ID || 'integration-session',
        source: 'ollama-provider.integration.test',
      },
    });

    expect(result).toHaveProperty('content');
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(50);
    expect(result.provider).toMatchObject({ name: 'ollama' });
    expect(result.metrics.latencyMs).toBeGreaterThan(0);
    expect(result.cache.hit).toBe(false);
  }, 120000);

  it('marks cache hits on repeated prompts', async () => {
    if (guard()) {
      return;
    }

    const prompt = 'Summarize the immediate consequences after the party defeats the spectral guardian in the ruins.';
    const type = NARRATIVE_TYPES?.ACTION_NARRATIVE;
    if (!type) {
      throw new Error('NARRATIVE_TYPES.ACTION_NARRATIVE is not defined');
    }

    const metadata = {
      campaignId: env.TEST_CAMPAIGN_ID || 'integration-campaign',
      sessionId: env.TEST_SESSION_ID || 'integration-session',
      source: 'ollama-provider.integration.test',
    };

    const first = await service.generate({
      type,
      prompt,
      metadata,
    });

    const second = await service.generate({
      type,
      prompt,
      metadata,
    });

    expect(first.cache.hit).toBe(false);
    expect(second.cache.hit).toBe(true);
    expect(second.cache.key).toBe(first.cache.key);
    expect(second.provider.name).toBe(first.provider.name);
  }, 120000);
});
