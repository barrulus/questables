import { createHash, randomUUID } from 'crypto';
import { ensureSupportedType, LLMProviderRegistry } from './provider-registry.js';
import { NARRATIVE_TYPES } from './narrative-types.js';
import { LLMCacheMissError, LLMProviderError, LLMServiceError } from './errors.js';
import { logDebug, logError, logInfo, logWarn } from '../utils/logger.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CACHE_ENTRIES = 500;

const now = () => Date.now();

export class EnhancedLLMService {
  constructor(options = {}) {
    if (!(options.registry instanceof LLMProviderRegistry)) {
      throw new Error('EnhancedLLMService requires a provider registry instance');
    }

    this.registry = options.registry;
    this.defaultProviderName = options.defaultProvider;
    this.cacheTtlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = typeof options.maxCacheEntries === 'number' ? options.maxCacheEntries : DEFAULT_MAX_CACHE_ENTRIES;
    this.cache = new Map();
  }

  getProvider(name) {
    const providerName = name || this.defaultProviderName;
    if (!providerName) {
      throw new LLMServiceError('No provider configured for EnhancedLLMService', {
        type: 'configuration',
      });
    }
    return this.registry.get(providerName);
  }

  buildCacheKey({ providerName, providerModel, type, prompt, metadata }) {
    ensureSupportedType(type);

    const payload = {
      provider: providerName || this.defaultProviderName,
      model: providerModel || null,
      type,
      prompt,
      metadata,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(payload));
    return hash.digest('hex');
  }

  getFromCache(cacheKey) {
    if (!cacheKey) return null;
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;
    if (now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      throw new LLMCacheMissError('Cache entry expired', { cacheKey });
    }
    return entry.value;
  }

  setCache(cacheKey, value, ttlMs = this.cacheTtlMs) {
    if (!cacheKey) return;

    if (this.cache.size >= this.maxCacheEntries) {
      const oldestEntry = Array.from(this.cache.entries()).reduce((oldest, entry) => {
        if (!oldest) return entry;
        return entry[1].expiresAt < oldest[1].expiresAt ? entry : oldest;
      }, null);
      if (oldestEntry) {
        this.cache.delete(oldestEntry[0]);
      }
    }

    this.cache.set(cacheKey, {
      value,
      expiresAt: now() + ttlMs,
    });
  }

  pruneExpiredEntries() {
    const currentTime = now();
    for (const [key, entry] of this.cache.entries()) {
      if (currentTime > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  async generate(options) {
    const { type, prompt, providerName, skipCache, cacheKey: providedCacheKey } = options;
    const initialMetadata = options.metadata ?? {};
    ensureSupportedType(type);

    const provider = this.getProvider(providerName);
    const providerModel = options.model || provider?.model || initialMetadata.providerModel || null;
    const metadata = {
      ...initialMetadata,
      providerModel,
      providerName: provider?.name || providerName || this.defaultProviderName,
    };

    const cacheKey = providedCacheKey || this.buildCacheKey({
      providerName: provider?.name,
      providerModel,
      type,
      prompt,
      metadata,
    });

    if (!skipCache) {
      try {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          logDebug('EnhancedLLMService cache hit', { cacheKey, provider: provider?.name, type });
          const cachedResult = {
            ...cached,
            cache: {
              key: cacheKey,
              hit: true,
              expiresAt: this.cache.get(cacheKey)?.expiresAt,
            },
          };
          return cachedResult;
        }
      } catch (error) {
        if (!(error instanceof LLMCacheMissError)) {
          logWarn('Cache retrieval failed for EnhancedLLMService', { cacheKey, error: error?.message });
        }
      }
    }

    const requestId = randomUUID();
    const startedAt = now();

    try {
      let result;
      switch (type) {
        case NARRATIVE_TYPES.DM_NARRATION:
          result = await provider.generateDMNarration({ ...options, metadata, cacheKey, requestId });
          break;
        case NARRATIVE_TYPES.SCENE_DESCRIPTION:
          result = await provider.generateSceneDescription({ ...options, metadata, cacheKey, requestId });
          break;
        case NARRATIVE_TYPES.NPC_DIALOGUE:
          result = await provider.generateNPCDialogue({ ...options, metadata, cacheKey, requestId });
          break;
        case NARRATIVE_TYPES.ACTION_NARRATIVE:
          result = await provider.generateActionNarrative({ ...options, metadata, cacheKey, requestId });
          break;
        case NARRATIVE_TYPES.QUEST:
          result = await provider.generateQuest({ ...options, metadata, cacheKey, requestId });
          break;
        default:
          throw new LLMServiceError(`Unsupported narrative type ${type}`, {
            provider: provider?.name,
            type,
          });
      }

      const durationMs = now() - startedAt;

      const enrichedResult = {
        ...result,
        type,
        cache: {
          key: cacheKey,
          hit: false,
          expiresAt: now() + this.cacheTtlMs,
        },
        request: {
          id: requestId,
          metadata,
          submittedAt: new Date(startedAt).toISOString(),
          durationMs,
          promptLength: prompt?.length ?? null,
        },
      };

      if (!skipCache) {
        this.setCache(cacheKey, enrichedResult);
      }

      logInfo('EnhancedLLMService generation success', {
        provider: provider?.name,
        type,
        requestId,
        cacheKey,
        durationMs,
      });

      return enrichedResult;
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      logError('EnhancedLLMService generation failed', error, {
        provider: provider?.name,
        type,
        requestId,
        cacheKey,
      });

      throw new LLMServiceError('Enhanced LLM service failed to generate narrative', {
        provider: provider?.name,
        type,
        cause: error,
      });
    } finally {
      this.pruneExpiredEntries();
    }
  }
}

export function createEnhancedLLMService(options = {}) {
  const registry = options.registry || new LLMProviderRegistry();
  return new EnhancedLLMService({
    registry,
    defaultProvider: options.defaultProvider,
    cacheTtlMs: options.cacheTtlMs,
    maxCacheEntries: options.maxCacheEntries,
  });
}

export default EnhancedLLMService;
