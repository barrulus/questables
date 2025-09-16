import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

// Error types for classification
export enum ErrorType {
  NETWORK = 'network',
  VALIDATION = 'validation',
  SERVER = 'server',
  DATABASE = 'database',
  WEBSOCKET = 'websocket',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  UNKNOWN = 'unknown'
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Enhanced error interface
export interface AppError extends Error {
  type: ErrorType;
  severity: ErrorSeverity;
  userMessage: string;
  technicalMessage?: string;
  code?: string | number;
  context?: Record<string, any>;
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
  fallback?: (error: AppError, reset: () => void) => ReactNode;
  onError?: (error: AppError, errorInfo: ErrorInfo, errorId: string) => void;
}

// Global error logging function
export const logError = (error: AppError, context?: Record<string, any>) => {
  const errorId = generateErrorId();
  const logEntry = {
    id: errorId,
    timestamp: new Date().toISOString(),
    message: error.message,
    userMessage: error.userMessage,
    type: error.type,
    severity: error.severity,
    stack: error.stack,
    code: error.code,
    context: { ...error.context, ...context },
    url: window.location.href,
    userAgent: navigator.userAgent,
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
  type: ErrorType = ErrorType.UNKNOWN,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM,
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
    [ErrorType.NETWORK]: 'Unable to connect to the server. Please check your internet connection and try again.',
    [ErrorType.VALIDATION]: 'Please check your input and try again.',
    [ErrorType.SERVER]: 'Something went wrong on our end. Please try again in a moment.',
    [ErrorType.DATABASE]: 'Unable to save or retrieve your data right now. Please try again.',
    [ErrorType.WEBSOCKET]: 'Lost connection to real-time updates. Attempting to reconnect...',
    [ErrorType.AUTHENTICATION]: 'You need to sign in to access this feature.',
    [ErrorType.AUTHORIZATION]: 'You don\'t have permission to perform this action.',
    [ErrorType.UNKNOWN]: 'An unexpected error occurred. Please try again.'
  };

  return errorMessages[type] || errorMessages[ErrorType.UNKNOWN];
};

// Determine if error is retryable
const isRetryableError = (type: ErrorType): boolean => {
  const retryableTypes = [ErrorType.NETWORK, ErrorType.SERVER, ErrorType.DATABASE, ErrorType.WEBSOCKET];
  return retryableTypes.includes(type);
};

// Error classification helper
export const classifyError = (error: any): AppError => {
  // Network errors
  if (error.code === 'NETWORK_ERROR' || error.message?.includes('fetch')) {
    return createAppError(error.message, ErrorType.NETWORK, ErrorSeverity.MEDIUM);
  }

  // HTTP status code based classification
  if (error.status) {
    const status = parseInt(error.status);
    
    if (status === 401) {
      return createAppError(error.message, ErrorType.AUTHENTICATION, ErrorSeverity.MEDIUM);
    }
    
    if (status === 403) {
      return createAppError(error.message, ErrorType.AUTHORIZATION, ErrorSeverity.MEDIUM);
    }
    
    if (status >= 400 && status < 500) {
      return createAppError(error.message, ErrorType.VALIDATION, ErrorSeverity.LOW);
    }
    
    if (status >= 500) {
      return createAppError(error.message, ErrorType.SERVER, ErrorSeverity.HIGH);
    }
  }

  // Database errors
  if (error.message?.includes('database') || error.message?.includes('query')) {
    return createAppError(error.message, ErrorType.DATABASE, ErrorSeverity.HIGH);
  }

  // WebSocket errors
  if (error.message?.includes('websocket') || error.message?.includes('socket')) {
    return createAppError(error.message, ErrorType.WEBSOCKET, ErrorSeverity.MEDIUM);
  }

  // Default classification
  return createAppError(error.message || 'Unknown error', ErrorType.UNKNOWN, ErrorSeverity.MEDIUM);
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
  const handleError = (error: any, context?: Record<string, any>) => {
    const appError = error instanceof Error && 'type' in error 
      ? error as AppError 
      : classifyError(error);
    
    logError(appError, context);
    
    // You could also show a toast notification here
    // toast.error(appError.userMessage);
    
    return appError;
  };

  const handleAsyncError = async <T,>(
    promise: Promise<T>,
    context?: Record<string, any>
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
export const withErrorHandling = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context?: Record<string, any>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const appError = classifyError(error);
      logError(appError, context);
      throw appError;
    }
  };
};