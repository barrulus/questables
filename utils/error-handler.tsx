import { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

// Error types for classification
export const ERROR_TYPE = {
  NETWORK: 'network',
  VALIDATION: 'validation',
  SERVER: 'server',
  DATABASE: 'database',
  WEBSOCKET: 'websocket',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  UNKNOWN: 'unknown',
} as const;

export type ErrorType = typeof ERROR_TYPE[keyof typeof ERROR_TYPE];

// Error severity levels
export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type ErrorSeverity = typeof ERROR_SEVERITY[keyof typeof ERROR_SEVERITY];

// Enhanced error interface
export interface AppError extends Error {
  type: ErrorType;
  severity: ErrorSeverity;
  userMessage: string;
  technicalMessage?: string;
  code?: string | number;
  context?: Record<string, unknown>;
  timestamp?: Date;
  retryable?: boolean;
  reportable?: boolean;
}

// Error boundary state
interface ErrorBoundaryState {
  hasError: boolean;
  error: AppError | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (_error: AppError, _reset: () => void) => ReactNode;
  onError?: (_error: AppError, _errorInfo: ErrorInfo, _errorId: string) => void;
}

// Global error logging function
export const logError = (error: AppError, context?: Record<string, unknown>) => {
  const errorId = generateErrorId();
  const combinedContext = {
    ...(error.context ?? {}),
    ...(context ?? {}),
  };
  const currentUrl = typeof window !== 'undefined' ? window.location.href : undefined;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  const logEntry = {
    id: errorId,
    timestamp: new Date().toISOString(),
    message: error.message,
    userMessage: error.userMessage,
    type: error.type,
    severity: error.severity,
    stack: error.stack,
    code: error.code,
    context: combinedContext,
    url: currentUrl,
    userAgent,
  };

  // Log to console
  console.error('[ErrorHandler]', logEntry);

  // In production, you would send this to your logging service
  if (process.env.NODE_ENV === 'production' && error.reportable !== false) {
    // sendToLoggingService(logEntry);
  }

  return errorId;
};

// Generate unique error ID
const generateErrorId = (): string => {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Create app error with proper classification
export const createAppError = (
  message: string,
  type: ErrorType = ERROR_TYPE.UNKNOWN,
  severity: ErrorSeverity = ERROR_SEVERITY.MEDIUM,
  userMessage?: string,
  options?: Partial<AppError>
): AppError => {
  const error = new Error(message) as AppError;
  error.type = type;
  error.severity = severity;
  error.userMessage = userMessage || getUserFriendlyMessage(type, message);
  error.timestamp = new Date();
  error.retryable = options?.retryable ?? isRetryableError(type);
  error.reportable = options?.reportable ?? true;
  error.context = options?.context;
  error.code = options?.code;
  error.technicalMessage = options?.technicalMessage;

  return error;
};

// Get user-friendly error messages
const getUserFriendlyMessage = (type: ErrorType, originalMessage: string): string => {
  const errorMessages: Record<ErrorType, string> = {
    [ERROR_TYPE.NETWORK]: 'Unable to connect to the server. Please check your internet connection and try again.',
    [ERROR_TYPE.VALIDATION]: 'Please check your input and try again.',
    [ERROR_TYPE.SERVER]: 'Something went wrong on our end. Please try again in a moment.',
    [ERROR_TYPE.DATABASE]: 'Unable to save or retrieve your data right now. Please try again.',
    [ERROR_TYPE.WEBSOCKET]: 'Lost connection to real-time updates. Attempting to reconnect...',
    [ERROR_TYPE.AUTHENTICATION]: 'You need to sign in to access this feature.',
    [ERROR_TYPE.AUTHORIZATION]: 'You don\'t have permission to perform this action.',
    [ERROR_TYPE.UNKNOWN]: 'An unexpected error occurred. Please try again.'
  };

  const fallback = errorMessages[type] || errorMessages[ERROR_TYPE.UNKNOWN];
  const normalizedOriginal = originalMessage?.trim();

  if (type === ERROR_TYPE.UNKNOWN && normalizedOriginal && normalizedOriginal !== fallback) {
    return `${fallback} (details: ${normalizedOriginal})`;
  }

  return fallback;
};

interface ErrorDetails {
  message?: string;
  status?: number;
  code?: string | number;
}

const parseStatus = (status: unknown): number | undefined => {
  if (typeof status === 'number') {
    return status;
  }

  if (typeof status === 'string' && status.trim().length > 0) {
    const parsed = Number.parseInt(status, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const normalizeError = (value: unknown): ErrorDetails => {
  if (value instanceof Error) {
    const enriched = value as Error & { status?: unknown; code?: unknown };
    return {
      message: enriched.message,
      status: parseStatus(enriched.status),
      code:
        typeof enriched.code === 'string' || typeof enriched.code === 'number'
          ? enriched.code
          : undefined,
    };
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      message: typeof record.message === 'string' ? record.message : undefined,
      status: parseStatus(record.status),
      code:
        typeof record.code === 'string' || typeof record.code === 'number'
          ? (record.code as string | number)
          : undefined,
    };
  }

  if (typeof value === 'string' && value.length > 0) {
    return { message: value };
  }

  return {};
};

// Determine if error is retryable
const isRetryableError = (type: ErrorType): boolean => {
  const retryableTypes: ErrorType[] = [
    ERROR_TYPE.NETWORK,
    ERROR_TYPE.SERVER,
    ERROR_TYPE.DATABASE,
    ERROR_TYPE.WEBSOCKET,
  ];
  return retryableTypes.includes(type);
};

// Error classification helper
export const classifyError = (error: unknown): AppError => {
  const details = normalizeError(error);
  const message = details.message ?? 'Unknown error';
  const messageLower = details.message?.toLowerCase() ?? '';

  // Network errors
  if (details.code === 'NETWORK_ERROR' || messageLower.includes('fetch')) {
    return createAppError(message, ERROR_TYPE.NETWORK, ERROR_SEVERITY.MEDIUM);
  }

  // HTTP status code based classification
  if (typeof details.status === 'number') {
    if (details.status === 401) {
      return createAppError(message, ERROR_TYPE.AUTHENTICATION, ERROR_SEVERITY.MEDIUM);
    }

    if (details.status === 403) {
      return createAppError(message, ERROR_TYPE.AUTHORIZATION, ERROR_SEVERITY.MEDIUM);
    }

    if (details.status >= 400 && details.status < 500) {
      return createAppError(message, ERROR_TYPE.VALIDATION, ERROR_SEVERITY.LOW);
    }

    if (details.status >= 500) {
      return createAppError(message, ERROR_TYPE.SERVER, ERROR_SEVERITY.HIGH);
    }
  }

  // Database errors
  if (messageLower.includes('database') || messageLower.includes('query')) {
    return createAppError(message, ERROR_TYPE.DATABASE, ERROR_SEVERITY.HIGH);
  }

  // WebSocket errors
  if (messageLower.includes('websocket') || messageLower.includes('socket')) {
    return createAppError(message, ERROR_TYPE.WEBSOCKET, ERROR_SEVERITY.MEDIUM);
  }

  // Default classification
  return createAppError(message, ERROR_TYPE.UNKNOWN, ERROR_SEVERITY.MEDIUM);
};

// React Error Boundary Component
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const appError = error instanceof Error && 'type' in error 
      ? error as AppError 
      : classifyError(error);

    return {
      hasError: true,
      error: appError
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const appError = this.state.error || classifyError(error);
    const errorId = logError(appError, { componentStack: errorInfo.componentStack });
    
    this.setState({
      errorInfo,
      errorId
    });

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(appError, errorInfo, errorId);
    }
  }

  reset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <AlertTriangle className="w-12 h-12 text-red-500" />
              </div>
              <CardTitle className="text-red-700">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600 text-center">
                {this.state.error.userMessage}
              </p>
              
              {this.state.errorId && (
                <p className="text-xs text-gray-400 text-center">
                  Error ID: {this.state.errorId}
                </p>
              )}

              <div className="flex gap-2 justify-center">
                {this.state.error.retryable && (
                  <Button onClick={this.reset} variant="default">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Try Again
                  </Button>
                )}
                
                <Button 
                  onClick={() => window.location.href = '/'}
                  variant="outline"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Button>
              </div>

              {process.env.NODE_ENV === 'development' && this.state.error.stack && (
                <details className="mt-4">
                  <summary className="text-xs text-gray-500 cursor-pointer">
                    Technical Details (Dev Mode)
                  </summary>
                  <pre className="text-xs bg-gray-100 p-2 mt-2 rounded overflow-auto max-h-40">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for handling async errors
export const useErrorHandler = () => {
  const handleError = (error: unknown, context?: Record<string, unknown>) => {
    const appError = error instanceof Error && 'type' in error
      ? (error as AppError)
      : classifyError(error);

    logError(appError, context);
    
    // You could also show a toast notification here
    // toast.error(appError.userMessage);
    
    return appError;
  };

  const handleAsyncError = async <T,>(
    promise: Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> => {
    try {
      return await promise;
    } catch (error) {
      throw handleError(error, context);
    }
  };

  return { handleError, handleAsyncError };
};

// Utility to wrap async functions with error handling
export const withErrorHandling = <T extends unknown[], R>(
  fn: (..._args: T) => Promise<R>,
  context?: Record<string, unknown>
) => {
  return async (...callArgs: T): Promise<R> => {
    try {
      return await fn(...callArgs);
    } catch (error) {
      const appError = classifyError(error);
      logError(appError, context);
      throw appError;
    }
  };
};
