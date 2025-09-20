import { randomUUID } from 'crypto';
import { Ollama } from 'ollama';
import { EnhancedLLMProvider } from '../provider-registry.js';
import { NARRATIVE_TYPES } from '../narrative-types.js';
import { LLMConfigurationError, LLMProviderError } from '../errors.js';
import { logDebug, logError, logInfo } from '../../utils/logger.js';

const NANOS_IN_MS = 1_000_000;

const toMilliseconds = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return value / NANOS_IN_MS;
};

export class OllamaProvider extends EnhancedLLMProvider {
  constructor(options = {}) {
    super({ name: options.name || 'ollama' });

    const missing = [];
    if (!options.host) missing.push('host');
    if (!options.model) missing.push('model');

    if (missing.length > 0) {
      throw new LLMConfigurationError('Ollama provider configuration is incomplete', {
        provider: this.name,
        missing,
      });
    }

    this.host = options.host;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs || 60000;
    this.defaultOptions = {
      temperature: 0.7,
      top_p: 0.9,
      ...options.defaultOptions,
    };

    const headers = { ...options.headers };
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    this.client = new Ollama({
      host: this.host,
      headers,
    });
  }

  async checkHealth() {
    try {
      const models = await this.client.list();
      const modelNames = models?.models?.map((entry) => entry?.name) ?? [];
      const isModelAvailable = modelNames.includes(this.model);
      return {
        healthy: isModelAvailable,
        host: this.host,
        model: this.model,
        availableModels: modelNames,
      };
    } catch (error) {
      logError('Failed to check Ollama health', error, { host: this.host });
      return {
        healthy: false,
        host: this.host,
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateDMNarration(options) {
    return this.#generate(NARRATIVE_TYPES.DM_NARRATION, options);
  }

  async generateSceneDescription(options) {
    return this.#generate(NARRATIVE_TYPES.SCENE_DESCRIPTION, options);
  }

  async generateNPCDialogue(options) {
    return this.#generate(NARRATIVE_TYPES.NPC_DIALOGUE, options);
  }

  async generateActionNarrative(options) {
    return this.#generate(NARRATIVE_TYPES.ACTION_NARRATIVE, options);
  }

  async generateQuest(options) {
    return this.#generate(NARRATIVE_TYPES.QUEST, options);
  }

  async #generate(type, options = {}) {
    this.assertPrompt(options);

    const requestId = randomUUID();
    const startedAt = Date.now();

    const generationOptions = {
      model: options.model || this.model,
      prompt: options.prompt,
      stream: false,
      options: {
        ...this.defaultOptions,
        ...(options.parameters || {}),
      },
      system: options.systemPrompt,
      context: options.context?.conversationState,
      temperature: undefined,
      top_p: undefined,
      ...options.extra,
    };

    // Clean undefined values to avoid API complaints
    Object.keys(generationOptions).forEach((key) => {
      if (generationOptions[key] === undefined) {
        delete generationOptions[key];
      }
    });

    try {
      logDebug('Dispatching Ollama generation request', {
        provider: this.name,
        host: this.host,
        model: generationOptions.model,
        type,
        requestId,
      });

      const response = await this.client.generate(generationOptions, {
        signal: options.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const promptTokens = typeof response?.prompt_eval_count === 'number' ? response.prompt_eval_count : null;
      const completionTokens = typeof response?.eval_count === 'number' ? response.eval_count : null;
      const totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0) || null;

      const metrics = {
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens,
        totalDurationMs: toMilliseconds(response?.total_duration),
        loadDurationMs: toMilliseconds(response?.load_duration),
        promptEvalDurationMs: toMilliseconds(response?.prompt_eval_duration),
        generationDurationMs: toMilliseconds(response?.eval_duration),
      };

      const content = typeof response?.response === 'string' ? response.response.trim() : '';

      logInfo('Ollama generation completed', {
        provider: this.name,
        host: this.host,
        model: response?.model || generationOptions.model,
        type,
        requestId,
        latencyMs,
        promptTokens,
        completionTokens,
      });

      return {
        content,
        metrics,
        provider: {
          name: this.name,
          host: this.host,
          model: response?.model || generationOptions.model,
          requestId,
          createdAt: response?.created_at,
        },
        raw: response,
      };
    } catch (error) {
      logError('Ollama generation failed', error, {
        provider: this.name,
        host: this.host,
        model: generationOptions.model,
        type,
        requestId,
      });
      throw new LLMProviderError('Ollama provider failed to generate narrative', {
        provider: this.name,
        type,
        code: 'OLLAMA_GENERATION_FAILED',
        details: {
          host: this.host,
          model: generationOptions.model,
          promptLength: options.prompt?.length,
        },
        cause: error,
      });
    }
  }
}

export default OllamaProvider;
