import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { EnhancedLLMProvider } from '../provider-registry.js';
import { NARRATIVE_TYPES } from '../narrative-types.js';
import { LLMConfigurationError, LLMProviderError } from '../errors.js';
import { logDebug, logError, logInfo, logWarn } from '../../utils/logger.js';

// 400 is enough for the chat_action_parse classifier but truncates anything
// narrative — world lore, scene description, NPC dialogue all blow past it
// and come back as unparseable half-JSON. Anthropic Haiku supports 8K+ tokens
// out, so default to a value that fits the heavy generators and let chat
// classifier callers override down where they care about cost/latency.
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider extends EnhancedLLMProvider {
  constructor(options = {}) {
    super({ name: options.name || 'anthropic' });

    const missing = [];
    if (!options.apiKey) missing.push('apiKey');
    if (!options.model) missing.push('model');

    if (missing.length > 0) {
      throw new LLMConfigurationError('Anthropic provider configuration is incomplete', {
        provider: this.name,
        missing,
      });
    }

    this.model = options.model;
    this.timeoutMs = options.timeoutMs || 60000;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.defaultOptions = {
      temperature: 0.7,
      ...options.defaultOptions,
    };

    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: this.timeoutMs,
    });
  }

  async checkHealth() {
    // Anthropic SDK has no list endpoint; assume healthy if a key is configured.
    return {
      healthy: true,
      model: this.model,
    };
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

  async generateObjectiveDescription(options) {
    return this.#generate(NARRATIVE_TYPES.OBJECTIVE_DESCRIPTION, options);
  }

  async generateObjectiveTreasure(options) {
    return this.#generate(NARRATIVE_TYPES.OBJECTIVE_TREASURE, options);
  }

  async generateObjectiveCombat(options) {
    return this.#generate(NARRATIVE_TYPES.OBJECTIVE_COMBAT, options);
  }

  async generateObjectiveNPCs(options) {
    return this.#generate(NARRATIVE_TYPES.OBJECTIVE_NPCS, options);
  }

  async generateObjectiveRumours(options) {
    return this.#generate(NARRATIVE_TYPES.OBJECTIVE_RUMOURS, options);
  }

  async generateShopAutoStock(options) {
    return this.#generate(NARRATIVE_TYPES.SHOP_AUTO_STOCK, options);
  }

  async generate(type, options) {
    return this.#generate(type, options);
  }

  /**
   * When the caller provides a JSON schema, append a forceful instruction to the system
   * prompt so the model emits valid JSON. Anthropic supports tool-use for strict JSON,
   * but a system-prompt instruction works well enough for our schemas and is simpler.
   */
  #buildSystemPrompt(systemPrompt, schema) {
    if (!schema) return systemPrompt;
    const schemaInstruction = `\n\nYou MUST respond with a single valid JSON object matching this schema. Do not wrap the JSON in markdown code blocks. Do not include any text before or after the JSON.\n\nSchema:\n${JSON.stringify(schema)}`;
    return (systemPrompt || '') + schemaInstruction;
  }

  #extractJson(content) {
    if (!content) return null;
    // Strip markdown code fences if present
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : content;
    try {
      return JSON.parse(raw.trim());
    } catch {
      // Try to find a JSON object in the text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { return null; }
      }
      return null;
    }
  }

  async #generate(type, options = {}) {
    this.assertPrompt(options);

    const requestId = randomUUID();
    const startedAt = Date.now();

    const schema = options.schema ?? options.parameters?.schema ?? null;
    const systemPrompt = this.#buildSystemPrompt(options.systemPrompt, schema);
    const model = options.model || this.model;
    const temperature = options.parameters?.temperature ?? this.defaultOptions.temperature;
    const maxTokens = options.maxTokens ?? options.parameters?.maxTokens ?? this.maxTokens;

    try {
      logDebug('Dispatching Anthropic generation request', {
        provider: this.name,
        model,
        type,
        requestId,
      });

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt || undefined,
        messages: [
          {
            role: 'user',
            content: options.prompt,
          },
        ],
      });

      const latencyMs = Date.now() - startedAt;
      const promptTokens = response?.usage?.input_tokens ?? null;
      const completionTokens = response?.usage?.output_tokens ?? null;
      const totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0) || null;

      const metrics = {
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens,
        totalDurationMs: latencyMs,
        loadDurationMs: null,
        promptEvalDurationMs: null,
        generationDurationMs: null,
      };

      // Concatenate all text blocks from the response content
      const content = (response?.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      let parsed = null;
      if (schema && content) {
        parsed = this.#extractJson(content);
        if (!parsed) {
          logWarn('Anthropic structured output failed to parse as JSON', {
            provider: this.name,
            type,
            requestId,
            contentLength: content.length,
          });
        }
      }

      logInfo('Anthropic generation completed', {
        provider: this.name,
        model: response?.model || model,
        type,
        requestId,
        latencyMs,
        promptTokens,
        completionTokens,
        stopReason: response?.stop_reason,
      });

      return {
        content,
        parsed,
        metrics,
        provider: {
          name: this.name,
          model: response?.model || model,
          requestId,
          createdAt: new Date().toISOString(),
        },
        raw: response,
      };
    } catch (error) {
      logError('Anthropic generation failed', error, {
        provider: this.name,
        model,
        type,
        requestId,
      });
      throw new LLMProviderError('Anthropic provider failed to generate narrative', {
        provider: this.name,
        type,
        code: 'ANTHROPIC_GENERATION_FAILED',
        details: {
          model,
          promptLength: options.prompt?.length,
        },
        cause: error,
      });
    }
  }
}

export default AnthropicProvider;
