import { createHash, randomUUID } from 'crypto';
import { ensureSupportedType, LLMProviderRegistry } from './provider-registry.js';
import { NARRATIVE_TYPES } from './narrative-types.js';
import { LLMCacheMissError, LLMProviderError, LLMServiceError } from './errors.js';
import { logDebug, logError, logInfo, logWarn } from '../utils/logger.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const MAX_RECENT_REQUESTS = 25;

const now = () => Date.now();

const createProviderMetrics = ({ providerName, providerModel }) => ({
  providerName,
  providerModel,
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  latencyTotalMs: 0,
  latencyCount: 0,
  ttfbTotalMs: 0,
  ttfbCount: 0,
  totalTokens: 0,
  lastRequestAt: null,
});

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
    this.metrics = {
      generatedAt: new Date().toISOString(),
      totals: {
        requests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: 0,
        cacheEvictions: 0,
      },
      perProvider: new Map(),
      recentRequests: [],
    };
  }

  #getProviderMetrics(providerName, providerModel) {
    const key = `${providerName || this.defaultProviderName || 'unknown'}::${providerModel || 'default'}`;
    if (!this.metrics.perProvider.has(key)) {
      this.metrics.perProvider.set(key, createProviderMetrics({ providerName, providerModel }));
    }
    return this.metrics.perProvider.get(key);
  }

  #recordRequestMetrics({
    providerName,
    providerModel,
    type,
    latencyMs,
    ttfbMs,
    totalTokens,
    cacheHit,
    error,
    requestId,
  }) {
    this.metrics.generatedAt = new Date().toISOString();
    this.metrics.totals.requests += 1;
    if (cacheHit) {
      this.metrics.totals.cacheHits += 1;
    } else {
      this.metrics.totals.cacheMisses += 1;
    }
    if (error) {
      this.metrics.totals.errors += 1;
    }

    const providerMetrics = this.#getProviderMetrics(providerName, providerModel);
    if (!providerMetrics.providerName && providerName) {
      providerMetrics.providerName = providerName;
    }
    if (!providerMetrics.providerModel && providerModel) {
      providerMetrics.providerModel = providerModel;
    }
    providerMetrics.requests += 1;
    providerMetrics.lastRequestAt = new Date().toISOString();
    if (cacheHit) {
      providerMetrics.cacheHits += 1;
    } else {
      providerMetrics.cacheMisses += 1;
    }
    if (error) {
      providerMetrics.errors += 1;
    }
    if (!cacheHit && typeof latencyMs === 'number') {
      providerMetrics.latencyTotalMs += latencyMs;
      providerMetrics.latencyCount += 1;
    }
    if (!cacheHit && typeof ttfbMs === 'number') {
      providerMetrics.ttfbTotalMs += ttfbMs;
      providerMetrics.ttfbCount += 1;
    }
    if (typeof totalTokens === 'number') {
      providerMetrics.totalTokens += totalTokens;
    }

    this.metrics.recentRequests.unshift({
      id: requestId,
      occurredAt: new Date().toISOString(),
      providerName: providerName || this.defaultProviderName || null,
      providerModel: providerModel || null,
      type,
      cacheHit,
      latencyMs: typeof latencyMs === 'number' ? latencyMs : null,
      ttfbMs: typeof ttfbMs === 'number' ? ttfbMs : null,
      totalTokens: typeof totalTokens === 'number' ? totalTokens : null,
      error: Boolean(error),
    });
    if (this.metrics.recentRequests.length > MAX_RECENT_REQUESTS) {
      this.metrics.recentRequests.length = MAX_RECENT_REQUESTS;
    }
  }

  getMetrics() {
    const providers = Array.from(this.metrics.perProvider.values()).map((entry) => ({
      providerName: entry.providerName || this.defaultProviderName || null,
      providerModel: entry.providerModel || null,
      requests: entry.requests,
      cacheHits: entry.cacheHits,
      cacheMisses: entry.cacheMisses,
      errors: entry.errors,
      averageLatencyMs: entry.latencyCount > 0 ? entry.latencyTotalMs / entry.latencyCount : null,
      averageTimeToFirstByteMs: entry.ttfbCount > 0 ? entry.ttfbTotalMs / entry.ttfbCount : null,
      totalTokens: entry.totalTokens,
      lastRequestAt: entry.lastRequestAt,
    }));

    return {
      generatedAt: this.metrics.generatedAt,
      totals: {
        ...this.metrics.totals,
        cacheSize: this.cache.size,
        cacheTtlMs: this.cacheTtlMs,
        maxCacheEntries: this.maxCacheEntries,
      },
      providers,
      recentRequests: this.metrics.recentRequests,
    };
  }

  getCacheSnapshot() {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => {
      const value = entry.value || {};
      const providerName = value?.provider?.name || value?.request?.metadata?.providerName || this.defaultProviderName || null;
      const providerModel = value?.provider?.model || value?.request?.metadata?.providerModel || null;
      return {
        key,
        type: value?.type || null,
        providerName,
        providerModel,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : value?.request?.submittedAt ?? null,
        lastAccessedAt: entry.lastAccessedAt ? new Date(entry.lastAccessedAt).toISOString() : null,
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
        ttlRemainingMs: entry.expiresAt ? Math.max(0, entry.expiresAt - now()) : null,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      size: this.cache.size,
      maxEntries: this.maxCacheEntries,
      defaultTtlMs: this.cacheTtlMs,
      entries,
    };
  }

  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    if (size > 0) {
      this.metrics.totals.cacheEvictions += size;
    }
    return size;
  }

  deleteCacheEntry(cacheKey) {
    if (!this.cache.has(cacheKey)) {
      return false;
    }
    this.cache.delete(cacheKey);
    this.metrics.totals.cacheEvictions += 1;
    return true;
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
      this.metrics.totals.cacheEvictions += 1;
      throw new LLMCacheMissError('Cache entry expired', { cacheKey });
    }
    entry.lastAccessedAt = now();
    return {
      value: entry.value,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
      lastAccessedAt: entry.lastAccessedAt,
    };
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
        this.metrics.totals.cacheEvictions += 1;
      }
    }

    const expiresAt = now() + ttlMs;

    this.cache.set(cacheKey, {
      value,
      expiresAt,
      createdAt: now(),
      lastAccessedAt: now(),
    });
  }

  pruneExpiredEntries() {
    const currentTime = now();
    for (const [key, entry] of this.cache.entries()) {
      if (currentTime > entry.expiresAt) {
        this.cache.delete(key);
        this.metrics.totals.cacheEvictions += 1;
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
        const cachedEntry = this.getFromCache(cacheKey);
        if (cachedEntry) {
          const cachedValue = cachedEntry.value || {};
          const cacheProviderName = cachedValue?.provider?.name || metadata.providerName;
          const cacheProviderModel = cachedValue?.provider?.model || metadata.providerModel;
          const cachedResult = {
            ...cachedValue,
            cache: {
              ...(cachedValue.cache || {}),
              key: cacheKey,
              hit: true,
              expiresAt: cachedEntry.expiresAt ? new Date(cachedEntry.expiresAt).toISOString() : cachedValue.cache?.expiresAt ?? null,
              createdAt: cachedEntry.createdAt ? new Date(cachedEntry.createdAt).toISOString() : cachedValue.cache?.createdAt ?? null,
              lastAccessedAt: cachedEntry.lastAccessedAt ? new Date(cachedEntry.lastAccessedAt).toISOString() : null,
            },
          };

          logDebug('EnhancedLLMService cache hit', { cacheKey, provider: cacheProviderName, type });
          this.#recordRequestMetrics({
            providerName: cacheProviderName,
            providerModel: cacheProviderModel,
            type,
            latencyMs: null,
            ttfbMs: null,
            totalTokens: cachedResult?.metrics?.totalTokens ?? null,
            cacheHit: true,
            error: false,
            requestId: cachedResult?.request?.id || cacheKey,
          });

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

      const cacheExpiresAt = now() + this.cacheTtlMs;
      const enrichedResult = {
        ...result,
        type,
        cache: {
          key: cacheKey,
          hit: false,
          createdAt: new Date(startedAt).toISOString(),
          expiresAt: new Date(cacheExpiresAt).toISOString(),
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

      this.#recordRequestMetrics({
        providerName: provider?.name,
        providerModel,
        type,
        latencyMs: durationMs,
        ttfbMs: typeof result?.metrics?.loadDurationMs === 'number' ? result.metrics.loadDurationMs : null,
        totalTokens: result?.metrics?.totalTokens ?? result?.metrics?.completionTokens ?? null,
        cacheHit: false,
        error: false,
        requestId,
      });

      return enrichedResult;
    } catch (error) {
      if (error instanceof LLMProviderError) {
        this.#recordRequestMetrics({
          providerName: provider?.name,
          providerModel,
          type,
          latencyMs: now() - startedAt,
          ttfbMs: null,
          totalTokens: null,
          cacheHit: false,
          error: true,
          requestId,
        });
        throw error;
      }

      logError('EnhancedLLMService generation failed', error, {
        provider: provider?.name,
        type,
        requestId,
        cacheKey,
      });

      this.#recordRequestMetrics({
        providerName: provider?.name,
        providerModel,
        type,
        latencyMs: now() - startedAt,
        ttfbMs: null,
        totalTokens: null,
        cacheHit: false,
        error: true,
        requestId,
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
