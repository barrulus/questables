// Configuration management system for the application
import { z } from 'zod';

// Environment configuration schema
const envSchema = z.object({
  // Server configuration
  DATABASE_SERVER_PORT: z.string().default('3001'),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.string().default('5432'),
  DATABASE_NAME: z.string().default('dnd_app'),
  DATABASE_USER: z.string().optional(),
  DATABASE_PASSWORD: z.string().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  
  // Frontend configuration
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  VITE_DATABASE_URL: z.string().default('http://localhost:3001'),
  
  // Security configuration
  JWT_SECRET: z.string().default('your-super-secret-jwt-key-change-this-in-production'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  BCRYPT_ROUNDS: z.string().default('12'),
  
  // Application configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  
  // Feature flags
  ENABLE_WEBSOCKET: z.enum(['true', 'false']).default('true'),
  ENABLE_RATE_LIMITING: z.enum(['true', 'false']).default('true'),
  ENABLE_CACHING: z.enum(['true', 'false']).default('true'),
  ENABLE_PERFORMANCE_MONITORING: z.enum(['true', 'false']).default('true'),
  
  // File upload configuration
  MAX_AVATAR_SIZE: z.string().default('5242880'), // 5MB
  MAX_MAP_SIZE: z.string().default('52428800'), // 50MB
  MAX_ASSET_SIZE: z.string().default('26214400'), // 25MB
  
  // Cache configuration
  CACHE_TTL: z.string().default('300000'), // 5 minutes
  
  // WebSocket configuration
  WEBSOCKET_HEARTBEAT_INTERVAL: z.string().default('30000'), // 30 seconds
  WEBSOCKET_TIMEOUT: z.string().default('60000'), // 1 minute
});

// Application configuration type
export type AppConfig = z.infer<typeof envSchema>;

// Default configuration values
const DEFAULT_CONFIG: AppConfig = {
  DATABASE_SERVER_PORT: '3001',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'dnd_app',
  DATABASE_USER: undefined,
  DATABASE_PASSWORD: undefined,
  DATABASE_SSL: 'false',
  
  FRONTEND_URL: 'http://localhost:3000',
  VITE_DATABASE_URL: 'http://localhost:3001',
  
  JWT_SECRET: 'your-super-secret-jwt-key-change-this-in-production',
  JWT_EXPIRES_IN: '24h',
  BCRYPT_ROUNDS: '12',
  
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  
  ENABLE_WEBSOCKET: 'true',
  ENABLE_RATE_LIMITING: 'true',
  ENABLE_CACHING: 'true',
  ENABLE_PERFORMANCE_MONITORING: 'true',
  
  MAX_AVATAR_SIZE: '5242880',
  MAX_MAP_SIZE: '52428800',
  MAX_ASSET_SIZE: '26214400',
  
  CACHE_TTL: '300000',
  
  WEBSOCKET_HEARTBEAT_INTERVAL: '30000',
  WEBSOCKET_TIMEOUT: '60000'
};

// Feature flags
export const FEATURE_FLAGS = {
  ENABLE_WEBSOCKET: 'ENABLE_WEBSOCKET',
  ENABLE_RATE_LIMITING: 'ENABLE_RATE_LIMITING',
  ENABLE_CACHING: 'ENABLE_CACHING',
  ENABLE_PERFORMANCE_MONITORING: 'ENABLE_PERFORMANCE_MONITORING'
} as const;

// Configuration class
class Configuration {
  private config: AppConfig;
  private static instance: Configuration;

  constructor(initialConfig?: Partial<AppConfig>) {
    this.config = this.loadConfiguration(initialConfig);
  }

  static getInstance(initialConfig?: Partial<AppConfig>): Configuration {
    if (!Configuration.instance) {
      Configuration.instance = new Configuration(initialConfig);
    }
    return Configuration.instance;
  }

  private loadConfiguration(initialConfig?: Partial<AppConfig>): AppConfig {
    const envConfig: Record<string, string> = {};
    
    // Load from process.env (Node.js)
    if (typeof process !== 'undefined' && process.env) {
      Object.keys(DEFAULT_CONFIG).forEach(key => {
        if (process.env[key]) {
          envConfig[key] = process.env[key]!;
        }
      });
    }

    // Load from import.meta.env (Vite)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      Object.keys(DEFAULT_CONFIG).forEach(key => {
        const viteKey = key.startsWith('VITE_') ? key : `VITE_${key}`;
        if (import.meta.env[viteKey]) {
          envConfig[key] = import.meta.env[viteKey] as string;
        }
      });
    }

    // Merge with initial config and defaults
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...envConfig,
      ...initialConfig
    };

    // Validate configuration
    try {
      return envSchema.parse(mergedConfig);
    } catch (error) {
      console.error('Configuration validation failed:', error);
      console.warn('Using default configuration values');
      return DEFAULT_CONFIG;
    }
  }

  // Get configuration value
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  // Get all configuration
  getAll(): AppConfig {
    return { ...this.config };
  }

  // Check if feature is enabled
  isFeatureEnabled(featureFlag: keyof typeof FEATURE_FLAGS): boolean {
    const flagKey = FEATURE_FLAGS[featureFlag];
    return this.get(flagKey as keyof AppConfig) === 'true';
  }

  // Get numeric configuration value
  getNumber<K extends keyof AppConfig>(key: K): number {
    const value = this.config[key];
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  // Get boolean configuration value
  getBoolean<K extends keyof AppConfig>(key: K): boolean {
    const value = this.config[key];
    return value === 'true';
  }

  // Update configuration at runtime
  update<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config[key] = value;
  }

  // Bulk update configuration
  updateMany(updates: Partial<AppConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Validate current configuration
  validate(): { valid: boolean; errors?: string[] } {
    try {
      envSchema.parse(this.config);
      return { valid: true };
    } catch (error) {
      const errors = error instanceof z.ZodError 
        ? error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        : ['Unknown validation error'];
      return { valid: false, errors };
    }
  }

  // Get configuration for specific environment
  getEnvironmentConfig(): {
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
    environment: string;
  } {
    const env = this.get('NODE_ENV');
    return {
      isDevelopment: env === 'development',
      isProduction: env === 'production',
      isTest: env === 'test',
      environment: env
    };
  }

  // Get database configuration
  getDatabaseConfig(): {
    host: string;
    port: number;
    database: string;
    user?: string;
    password?: string;
    ssl: boolean;
    serverPort: number;
  } {
    return {
      host: this.get('DATABASE_HOST'),
      port: this.getNumber('DATABASE_PORT'),
      database: this.get('DATABASE_NAME'),
      user: this.get('DATABASE_USER'),
      password: this.get('DATABASE_PASSWORD'),
      ssl: this.getBoolean('DATABASE_SSL'),
      serverPort: this.getNumber('DATABASE_SERVER_PORT')
    };
  }

  // Get security configuration
  getSecurityConfig(): {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
  } {
    return {
      jwtSecret: this.get('JWT_SECRET'),
      jwtExpiresIn: this.get('JWT_EXPIRES_IN'),
      bcryptRounds: this.getNumber('BCRYPT_ROUNDS')
    };
  }

  // Get file upload limits
  getFileUploadLimits(): {
    avatar: number;
    map: number;
    asset: number;
  } {
    return {
      avatar: this.getNumber('MAX_AVATAR_SIZE'),
      map: this.getNumber('MAX_MAP_SIZE'),
      asset: this.getNumber('MAX_ASSET_SIZE')
    };
  }
}

// Create singleton instance
export const config = Configuration.getInstance();

// Export configuration functions for convenience
export const getConfig = <K extends keyof AppConfig>(key: K): AppConfig[K] => config.get(key);
export const isFeatureEnabled = (feature: keyof typeof FEATURE_FLAGS): boolean => config.isFeatureEnabled(feature);
export const getEnvironmentConfig = () => config.getEnvironmentConfig();
export const getDatabaseConfig = () => config.getDatabaseConfig();
export const getSecurityConfig = () => config.getSecurityConfig();
export const getFileUploadLimits = () => config.getFileUploadLimits();

// Configuration validation on startup
if (typeof window === 'undefined') { // Server-side
  const validation = config.validate();
  if (!validation.valid) {
    console.warn('Configuration validation warnings:', validation.errors);
  }
}

export default config;