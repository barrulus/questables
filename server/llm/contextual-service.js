import { LLMContextManager } from './context/context-manager.js';
import { buildStructuredPrompt } from './context/prompt-builder.js';
import { LLMServiceError } from './errors.js';
import { getCampaignLLMSettings } from '../services/campaigns/llm-settings.js';

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

  /**
   * Resolve provider config for a campaign, merging caller overrides over
   * campaign LLM settings. Returns { providerConfig, campaignLLMSettings }.
   */
  const resolveCampaignProviderConfig = async ({ campaignId, providerOverride }) => {
    let campaignLLMSettings = null;
    try {
      campaignLLMSettings = await getCampaignLLMSettings(campaignId);
    } catch {
      // Non-fatal: proceed with defaults if settings table doesn't exist yet
    }

    // Merge provider overrides: caller takes precedence over campaign settings
    const effectiveProviderOverride = { ...providerOverride };
    if (campaignLLMSettings) {
      if (!effectiveProviderOverride.name && campaignLLMSettings.preferred_provider) {
        effectiveProviderOverride.name = campaignLLMSettings.preferred_provider;
      }
      if (!effectiveProviderOverride.model && campaignLLMSettings.preferred_model) {
        effectiveProviderOverride.model = campaignLLMSettings.preferred_model;
      }
      if (campaignLLMSettings.temperature != null || campaignLLMSettings.top_p != null) {
        effectiveProviderOverride.options = {
          ...effectiveProviderOverride.options,
          ...(campaignLLMSettings.temperature != null && { temperature: campaignLLMSettings.temperature }),
          ...(campaignLLMSettings.top_p != null && { top_p: campaignLLMSettings.top_p }),
        };
      }
    }

    const provider = resolveProvider(effectiveProviderOverride?.name);
    const providerConfig = extractProviderConfig(provider, effectiveProviderOverride);
    return { providerConfig, campaignLLMSettings };
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
    const { providerConfig, campaignLLMSettings } = await resolveCampaignProviderConfig({
      campaignId,
      providerOverride,
    });

    const llmSettings = campaignLLMSettings ? {
      chatHistoryDepth: campaignLLMSettings.chat_history_depth,
      npcMemoryDepth: campaignLLMSettings.npc_memory_depth,
      includeUndiscoveredLocations: campaignLLMSettings.include_undiscovered_locations,
    } : undefined;

    const gameContext = await contextManager.buildGameContext({ campaignId, sessionId, llmSettings });

    // Pass campaign LLM settings to prompt builder
    const enrichedRequest = {
      ...request,
      campaignLLMSettings,
    };

    const promptPayload = buildStructuredPrompt({
      type,
      context: gameContext,
      providerConfig,
      request: enrichedRequest,
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

  /**
   * Generate using a caller-supplied system prompt and user prompt verbatim.
   *
   * Bypasses `buildStructuredPrompt` and the generic context dump entirely.
   * Use this for action/social/combat/world-turn pipelines that already build
   * their own focused prompts via `action-prompt-builder.js`. Campaign LLM
   * settings (preferred provider, model, temperature) are still honored.
   */
  const generateDirect = async ({
    campaignId,
    sessionId,
    type,
    systemPrompt,
    prompt,
    provider: providerOverride,
    parameters,
    metadata = {},
  }) => {
    const { providerConfig } = await resolveCampaignProviderConfig({
      campaignId,
      providerOverride,
    });

    const result = await llmService.generate({
      type,
      providerName: providerConfig.name,
      model: providerConfig.model,
      prompt,
      systemPrompt,
      metadata: {
        ...metadata,
        campaignId,
        sessionId: sessionId ?? null,
        providerModel: providerConfig.model,
        providerName: providerConfig.name,
      },
      context: {
        provider: providerConfig,
      },
      parameters,
    });

    return {
      result,
      prompt: {
        system: systemPrompt,
        user: prompt,
      },
      provider: providerConfig,
    };
  };

  return {
    contextManager,
    generateFromContext,
    generateDirect,
  };
}

export default createContextualLLMService;
