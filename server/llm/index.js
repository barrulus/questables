import process from 'node:process';
import { LLMProviderRegistry } from './provider-registry.js';
import { createEnhancedLLMService } from './enhanced-llm-service.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { LLMConfigurationError } from './errors.js';

const parseInteger = (value, fallback) => {
  if (typeof value === 'undefined') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ADAPTERS = {
  ollama: (config) => {
    const missing = [];
    if (!config.host) missing.push('host');
    if (!config.model) missing.push('model');

    if (missing.length > 0) {
      throw new LLMConfigurationError('Ollama provider configuration is incomplete', {
        provider: config.name,
        missing,
      });
    }

    return new OllamaProvider({
      name: config.name,
      host: config.host,
      model: config.model,
      apiKey: config.apiKey,
      timeoutMs: parseInteger(config.timeoutMs, parseInteger(process.env.LLM_OLLAMA_TIMEOUT_MS, 60000)),
      defaultOptions: {
        temperature: config.options?.temperature ?? (process.env.LLM_OLLAMA_TEMPERATURE ? Number(process.env.LLM_OLLAMA_TEMPERATURE) : undefined),
        top_p: config.options?.top_p ?? (process.env.LLM_OLLAMA_TOP_P ? Number(process.env.LLM_OLLAMA_TOP_P) : undefined),
        ...config.options,
      },
    });
  },
};

const sanitizeProviderConfig = (rawConfig = {}) => ({
  name: rawConfig.name || 'ollama',
  adapter: rawConfig.adapter || 'ollama',
  host: rawConfig.host || null,
  model: rawConfig.model || null,
  apiKey: rawConfig.apiKey || null,
  timeoutMs: rawConfig.timeoutMs || rawConfig.timeout_ms || null,
  options: rawConfig.options || {},
  enabled: rawConfig.enabled !== false,
  defaultProvider: rawConfig.defaultProvider || rawConfig.default_provider || false,
});

const buildEnvProviderConfig = (env) => sanitizeProviderConfig({
  name: env.LLM_PROVIDER_NAME || 'ollama',
  adapter: env.LLM_PROVIDER_ADAPTER || 'ollama',
  host: env.LLM_OLLAMA_HOST || 'http://192.168.1.34',
  model: env.LLM_OLLAMA_MODEL || 'qwen3:8b',
  apiKey: env.LLM_OLLAMA_API_KEY,
  timeoutMs: env.LLM_OLLAMA_TIMEOUT_MS ? Number(env.LLM_OLLAMA_TIMEOUT_MS) : undefined,
  options: {
    temperature: env.LLM_OLLAMA_TEMPERATURE ? Number(env.LLM_OLLAMA_TEMPERATURE) : undefined,
    top_p: env.LLM_OLLAMA_TOP_P ? Number(env.LLM_OLLAMA_TOP_P) : undefined,
  },
  enabled: true,
  defaultProvider: true,
});

export function initializeLLMService({ env = process.env, providerConfigs = [] } = {}) {
  const registry = new LLMProviderRegistry();
  const sanitizedConfigs = Array.isArray(providerConfigs)
    ? providerConfigs.map(sanitizeProviderConfig).filter((cfg) => cfg.enabled)
    : [];

  const configsToUse = sanitizedConfigs.length > 0
    ? sanitizedConfigs
    : [buildEnvProviderConfig(env)];

  let defaultProvider = configsToUse.find((cfg) => cfg.defaultProvider)?.name
    || env.LLM_PROVIDER
    || configsToUse[0]?.name
    || 'ollama';

  for (const config of configsToUse) {
    const adapterFactory = ADAPTERS[config.adapter];
    if (!adapterFactory) {
      logWarn('Skipping unsupported LLM adapter', {
        adapter: config.adapter,
        name: config.name,
      });
      continue;
    }

    try {
      const provider = adapterFactory(config);
      registry.register(config.name, provider);
      logInfo('Registered LLM provider', {
        name: config.name,
        adapter: config.adapter,
        host: config.host,
        model: config.model,
      });
    } catch (error) {
      if (error instanceof LLMConfigurationError) {
        logError('Failed to configure LLM provider', error, {
          name: config.name,
          adapter: config.adapter,
        });
        throw error;
      }
      throw error;
    }
  }

  if (!registry.has(defaultProvider)) {
    const fallback = registry.list()[0];
    if (fallback) {
      logWarn('Configured default provider missing; falling back to first registered provider', {
        requestedDefault: defaultProvider,
        fallback,
      });
      defaultProvider = fallback;
    } else {
      throw new LLMConfigurationError('No LLM providers are registered', {
        provider: defaultProvider,
      });
    }
  }

  const cacheTtlMs = parseInteger(env.LLM_CACHE_TTL_MS, undefined);
  const maxCacheEntries = parseInteger(env.LLM_CACHE_MAX_ENTRIES, undefined);

  const service = createEnhancedLLMService({
    registry,
    defaultProvider,
    cacheTtlMs,
    maxCacheEntries,
  });

  return {
    service,
    registry,
    defaultProvider,
    providers: configsToUse,
  };
}

export function initializeLLMServiceFromEnv(env = process.env) {
  return initializeLLMService({ env });
}

export * from './enhanced-llm-service.js';
export * from './provider-registry.js';
export * from './providers/ollama-provider.js';
export * from './narrative-types.js';
export * from './errors.js';
export { LLMContextManager } from './context/context-manager.js';
export { buildStructuredPrompt } from './context/prompt-builder.js';
export { createContextualLLMService } from './contextual-service.js';
