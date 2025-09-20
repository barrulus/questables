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

export function initializeLLMServiceFromEnv(env = process.env) {
  const registry = new LLMProviderRegistry();
  const defaultProvider = env.LLM_PROVIDER || 'ollama';

  if (defaultProvider === 'ollama') {
    const host = env.LLM_OLLAMA_HOST || 'http://192.168.1.34';
    const model = env.LLM_OLLAMA_MODEL || 'qwen3:8b';
    const apiKey = env.LLM_OLLAMA_API_KEY;
    const timeoutMs = parseInteger(env.LLM_OLLAMA_TIMEOUT_MS, 60000);

    try {
      const provider = new OllamaProvider({
        name: 'ollama',
        host,
        model,
        apiKey,
        timeoutMs,
        defaultOptions: {
          temperature: env.LLM_OLLAMA_TEMPERATURE ? Number(env.LLM_OLLAMA_TEMPERATURE) : undefined,
          top_p: env.LLM_OLLAMA_TOP_P ? Number(env.LLM_OLLAMA_TOP_P) : undefined,
        },
      });

      registry.register('ollama', provider);
      logInfo('Registered Ollama provider for EnhancedLLMService', {
        host,
        model,
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof LLMConfigurationError) {
        logError('Failed to configure Ollama provider', error, {
          host,
          model,
        });
        throw error;
      }
      throw error;
    }
  } else {
    logWarn('No provider registered for EnhancedLLMService: unsupported provider configured', {
      provider: defaultProvider,
    });
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
  };
}

export * from './enhanced-llm-service.js';
export * from './provider-registry.js';
export * from './providers/ollama-provider.js';
export * from './narrative-types.js';
export * from './errors.js';
export { LLMContextManager } from './context/context-manager.js';
export { buildStructuredPrompt } from './context/prompt-builder.js';
export { createContextualLLMService } from './contextual-service.js';
