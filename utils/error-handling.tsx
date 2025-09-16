// Centralized error handling utilities for consistent error management
import React from 'react';

export interface ErrorState {
  error: string | null;
  isLoading: boolean;
  hasError: boolean;
}

export const createErrorState = (): ErrorState => ({
  error: null,
  isLoading: false,
  hasError: false
});

export const handleAsyncError = (error: unknown): string => {
  console.error('Application error:', error);
  
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An unexpected error occurred';
};

export const createAsyncHandler = <T extends any[]>(
  asyncFn: (...args: T) => Promise<void>,
  setError: (error: string | null) => void,
  setLoading: (loading: boolean) => void
) => {
  return async (...args: T) => {
    try {
      setLoading(true);
      setError(null);
      await asyncFn(...args);
    } catch (error) {
      setError(handleAsyncError(error));
    } finally {
      setLoading(false);
    }
  };
};

export const withErrorBoundary = <T extends object>(
  Component: React.ComponentType<T>
): React.ComponentType<T> => {
  return (props: T) => {
    return (
      <ErrorBoundary>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
};

// Error Boundary Component
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-red-200 bg-red-50 rounded">
          <h3 className="text-red-800 font-medium">Something went wrong</h3>
          <p className="text-red-600 text-sm mt-2">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button 
            className="mt-3 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}