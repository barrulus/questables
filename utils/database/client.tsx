// PostgreSQL database client for local development
// Handles all database operations through the local database server
import { createAppError, ErrorType, ErrorSeverity, logError } from '../error-handler';

export interface DatabaseClient {
  query: (sql: string, params?: any[]) => Promise<{ data: any[] | null; error: any }>;
  spatial: (functionName: string, params: any) => Promise<{ data: any[] | null; error: any }>;
  auth: {
    login: (email: string, password?: string) => Promise<{ data?: { user: any }; error?: any }>;
    register: (username: string, email: string, password?: string, role?: string) => Promise<{ data?: { user: any }; error?: any }>;
  };
}

class PostgreSQLClient implements DatabaseClient {
  private baseUrl: string | null = null;
  private requestTimeout = 30000; // 30 seconds
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second

  private ensureInitialized() {
    if (this.baseUrl === null) {
      if (typeof import.meta === 'undefined' || !import.meta.env) {
        throw new Error('Environment variables not available. Make sure you have a .env file with VITE_DATABASE_SERVER_URL (e.g. http://localhost:3001 or https://quixote.tail3f19fe.ts.net:3001)');
      }
      
      const env = import.meta.env;
      if (!env.VITE_DATABASE_SERVER_URL) {
        throw new Error('VITE_DATABASE_SERVER_URL environment variable is required. Add VITE_DATABASE_SERVER_URL=http://localhost:3001 (or your HTTPS endpoint) to your .env file');
      }
      
      this.baseUrl = env.VITE_DATABASE_SERVER_URL;
      console.log('[Database] Initializing PostgreSQL client with server:', this.baseUrl);
    }
  }

  // Retry logic with exponential backoff
  private async retryOperation<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry on client errors (400-499)
        if (error.status && error.status >= 400 && error.status < 500) {
          break;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.warn(`[Database] ${operationName} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // Enhanced fetch with timeout
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw createAppError(
          'Request timeout',
          ErrorType.NETWORK,
          ErrorSeverity.MEDIUM,
          'The request took too long to complete. Please try again.',
          { code: 'TIMEOUT' }
        );
      }
      
      throw createAppError(
        error.message,
        ErrorType.NETWORK,
        ErrorSeverity.MEDIUM,
        'Unable to connect to the database server',
        { originalError: error }
      );
    }
  }

  async query(sql: string, params: any[] = []): Promise<{ data: any[] | null; error: any }> {
    this.ensureInitialized();
    
    try {
      const result = await this.retryOperation(async () => {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/api/database/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          
          const appError = createAppError(
            errorData.error || `Database query failed: ${response.statusText}`,
            ErrorType.DATABASE,
            response.status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
            undefined,
            { 
              status: response.status,
              statusText: response.statusText,
              query: sql.substring(0, 100) + (sql.length > 100 ? '...' : '')
            }
          );

          throw appError;
        }

        return await response.json();
      }, 'database query');

      return { data: result.rows, error: null };
    } catch (error) {
      const appError = error instanceof Error && 'type' in error 
        ? error 
        : createAppError(
            error.message || 'Database query failed',
            ErrorType.DATABASE,
            ErrorSeverity.HIGH
          );

      logError(appError, { query: sql, params });
      return { data: null, error: appError };
    }
  }

  async spatial(functionName: string, params: any): Promise<{ data: any[] | null; error: any }> {
    this.ensureInitialized();
    
    try {
      const result = await this.retryOperation(async () => {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/api/database/spatial/${functionName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          
          const appError = createAppError(
            errorData.error || `Spatial query failed: ${response.statusText}`,
            ErrorType.DATABASE,
            response.status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
            undefined,
            { 
              status: response.status,
              statusText: response.statusText,
              functionName,
              params
            }
          );

          throw appError;
        }

        return await response.json();
      }, 'spatial query');

      return { data: result.data, error: null };
    } catch (error) {
      const appError = error instanceof Error && 'type' in error 
        ? error 
        : createAppError(
            error.message || 'Spatial query failed',
            ErrorType.DATABASE,
            ErrorSeverity.HIGH
          );

      logError(appError, { functionName, params });
      return { data: null, error: appError };
    }
  }

  auth = {
    login: async (email: string, password?: string): Promise<{ data?: { user: any }; error?: any }> => {
      try {
        this.ensureInitialized();
        
        const response = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
          const errorData = await response.json();
          return { error: new Error(errorData.error || 'Login failed') };
        }

        const result = await response.json();
        return { data: { user: result.user } };
      } catch (error) {
        return { error };
      }
    },

    register: async (username: string, email: string, password?: string, role: string = 'player'): Promise<{ data?: { user: any }; error?: any }> => {
      try {
        this.ensureInitialized();
        
        const response = await fetch(`${this.baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, email, password, role })
        });

        if (!response.ok) {
          const errorData = await response.json();
          return { error: new Error(errorData.error || 'Registration failed') };
        }

        const result = await response.json();
        return { data: { user: result.user } };
      } catch (error) {
        return { error };
      }
    }
  };
}

// Export singleton instance
export const databaseClient = new PostgreSQLClient();

// Legacy compatibility - remove supabase references
export const db = databaseClient;
