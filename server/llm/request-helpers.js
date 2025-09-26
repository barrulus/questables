import { LLMServiceError } from './index.js';

export const ensureLLMReady = (req) => {
  const contextualService = req.app?.locals?.contextualLLMService;
  if (!contextualService) {
    throw new LLMServiceError('Enhanced LLM service is not available', {
      type: 'llm_not_initialized',
    });
  }
  return contextualService;
};

export const ensureLLMService = (req) => {
  const llmService = req.app?.locals?.llmService;
  if (!llmService) {
    throw new LLMServiceError('Enhanced LLM service is not available', {
      type: 'llm_not_initialized',
    });
  }
  return llmService;
};
