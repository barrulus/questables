import { SUPPORTED_TYPES } from './narrative-types.js';
import { LLMConfigurationError, LLMProviderError } from './errors.js';

/**
 * @typedef {Object} NarrativeGenerationOptions
 * @property {string} type - Narrative type identifier.
 * @property {string} prompt - Fully constructed prompt string (no placeholders).
 * @property {object} [context] - Structured context payload supplied by callers.
 * @property {object} [metadata] - Additional metadata (campaign/session identifiers, cache hints, etc.).
 * @property {string} [cacheKey] - Optional precomputed cache key to reuse.
 * @property {string} [model] - Provider-specific model override.
 * @property {AbortSignal} [signal] - Optional abort signal for cancellation.
 */

/**
 * @typedef {Object} ProviderMetrics
 * @property {number} latencyMs
 * @property {number|null} promptTokens
 * @property {number|null} completionTokens
 * @property {number|null} totalTokens
 * @property {number|null} totalDurationMs
 * @property {number|null} loadDurationMs
 * @property {number|null} promptEvalDurationMs
 * @property {number|null} generationDurationMs
 */

/**
 * @typedef {Object} NarrativeResult
 * @property {string} content - Provider response content.
 * @property {ProviderMetrics} metrics - Timing and token usage metrics.
 * @property {object} provider - Provider metadata (name, model, host, requestId, etc.).
 * @property {object} raw - Raw provider payload for audit/trace (never nullified silently).
 */

/**
 * Abstract provider interface; implementations must override every narrative method.
 */
export class EnhancedLLMProvider {
  constructor(options = {}) {
    this.name = options.name;
    if (!this.name) {
      throw new LLMConfigurationError('EnhancedLLMProvider requires a unique name', {
        missing: ['name'],
      });
    }
  }

  assertPrompt(options) {
    if (!options || typeof options.prompt !== 'string' || options.prompt.trim().length === 0) {
      throw new LLMProviderError('Narrative generation requires a non-empty prompt', {
        provider: this.name,
        code: 'INVALID_PROMPT',
      });
    }
  }

  async generateDMNarration(/* options */) {
    throw new LLMProviderError('Provider does not implement DM narration generation', {
      provider: this.name,
      code: 'NOT_IMPLEMENTED',
    });
  }

  async generateSceneDescription(/* options */) {
    throw new LLMProviderError('Provider does not implement scene description generation', {
      provider: this.name,
      code: 'NOT_IMPLEMENTED',
    });
  }

  async generateNPCDialogue(/* options */) {
    throw new LLMProviderError('Provider does not implement NPC dialogue generation', {
      provider: this.name,
      code: 'NOT_IMPLEMENTED',
    });
  }

  async generateActionNarrative(/* options */) {
    throw new LLMProviderError('Provider does not implement action narrative generation', {
      provider: this.name,
      code: 'NOT_IMPLEMENTED',
    });
  }

  async generateQuest(/* options */) {
    throw new LLMProviderError('Provider does not implement quest generation', {
      provider: this.name,
      code: 'NOT_IMPLEMENTED',
    });
  }

  /**
   * Optional health check hook. Providers can override.
   */
  async checkHealth() {
    return { healthy: true };
  }
}

export class LLMProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(name, provider) {
    if (!name || typeof name !== 'string') {
      throw new Error('Provider name is required for registration');
    }
    if (!provider) {
      throw new Error(`Provider instance is required for ${name}`);
    }
    if (this.providers.has(name)) {
      throw new Error(`Provider with name ${name} is already registered`);
    }
    this.providers.set(name, provider);
    return provider;
  }

  get(name) {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} is not registered`);
    }
    return this.providers.get(name);
  }

  has(name) {
    return this.providers.has(name);
  }

  list() {
    return Array.from(this.providers.keys());
  }
}

export function ensureSupportedType(type) {
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`Unsupported narrative type: ${type}`);
  }
}
