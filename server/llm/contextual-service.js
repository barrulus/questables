import { LLMContextManager } from './context/context-manager.js';
import { buildStructuredPrompt } from './context/prompt-builder.js';
import { LLMServiceError } from './errors.js';

const extractProviderConfig = (provider, overrides = {}) => {
  if (!provider) {
    return {
      name: overrides.name || null,
      model: overrides.model || null,
      options: overrides.options || null,
    };
  }

  return {
    name: provider.name || overrides.name || null,
    model: overrides.model || provider.model || null,
    options: {
      ...provider.defaultOptions,
      ...overrides.options,
    },
  };
};

export function createContextualLLMService({ pool, llmService, providerName, providerRegistry }) {
  if (!pool) {
    throw new Error('createContextualLLMService requires a PostgreSQL pool');
  }
  if (!llmService) {
    throw new Error('createContextualLLMService requires an EnhancedLLMService instance');
  }

  const contextManager = new LLMContextManager({ pool });

  const resolveProvider = (name) => {
    const targetName = name || providerName;
    try {
      if (typeof llmService.getProvider === 'function') {
        return llmService.getProvider(targetName);
      }
      if (providerRegistry?.has?.(targetName)) {
        return providerRegistry.get(targetName);
      }
      return null;
    } catch (error) {
      throw new LLMServiceError('Requested LLM provider is not registered', {
        provider: targetName,
        cause: error,
      });
    }
  };

  const generateFromContext = async ({
    campaignId,
    sessionId,
    type,
    provider: providerOverride,
    parameters,
    metadata = {},
    request = {},
  }) => {
    const gameContext = await contextManager.buildGameContext({ campaignId, sessionId });
    const provider = resolveProvider(providerOverride?.name);
    const providerConfig = extractProviderConfig(provider, providerOverride);

    const promptPayload = buildStructuredPrompt({
      type,
      context: gameContext,
      providerConfig,
      request,
    });

    const result = await llmService.generate({
      type,
      providerName: providerConfig.name,
      model: providerConfig.model,
      prompt: promptPayload.prompt,
      systemPrompt: promptPayload.systemPrompt,
      metadata: {
        ...metadata,
        campaignId,
        sessionId: gameContext.session?.id ?? sessionId ?? null,
        providerModel: providerConfig.model,
        providerName: providerConfig.name,
        contextGeneratedAt: gameContext.generatedAt,
      },
      context: {
        game: gameContext,
        provider: providerConfig,
      },
      parameters,
    });

    return {
      result,
      prompt: {
        system: promptPayload.systemPrompt,
        user: promptPayload.prompt,
      },
      provider: providerConfig,
      context: gameContext,
    };
  };

  return {
    contextManager,
    generateFromContext,
  };
}

export default createContextualLLMService;
