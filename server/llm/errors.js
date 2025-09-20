export class LLMProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LLMProviderError';
    this.code = options.code || 'LLM_PROVIDER_ERROR';
    this.provider = options.provider;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export class LLMConfigurationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LLMConfigurationError';
    this.missing = options.missing || [];
    this.provider = options.provider;
  }
}

export class LLMCacheMissError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LLMCacheMissError';
    this.cacheKey = options.cacheKey;
  }
}

export class LLMServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LLMServiceError';
    this.provider = options.provider;
    this.type = options.type;
    this.cause = options.cause;
  }
}
