import { LLMProviderError, LLMServiceError } from './index.js';

export const respondWithNarrativeError = (res, error) => {
  if (error instanceof LLMProviderError) {
    return res.status(error.statusCode || 502).json({
      error: 'narrative_provider_error',
      message: error.message,
      provider: error.provider ?? null,
      details: error.details ?? null,
    });
  }

  if (error instanceof LLMServiceError) {
    return res.status(error.statusCode || 503).json({
      error: 'narrative_service_error',
      message: error.message,
      provider: error.provider ?? null,
      type: error.type ?? null,
    });
  }

  return res.status(500).json({
    error: 'narrative_generation_failed',
    message: 'Failed to generate narrative response',
  });
};
