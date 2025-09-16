import { useEffect } from 'react';

export class PerformanceMonitor {
  private static timers = new Map<string, number>();

  static startTimer(label: string) {
    this.timers.set(label, performance.now());
  }

  static endTimer(label: string): number {
    const start = this.timers.get(label);
    if (!start) return 0;
    
    const duration = performance.now() - start;
    this.timers.delete(label);
    
    if (duration > 1000) {
      console.warn(`[Performance] Slow operation "${label}": ${duration.toFixed(2)}ms`);
    }
    
    return duration;
  }

  static measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.startTimer(label);
    return fn().finally(() => {
      this.endTimer(label);
    });
  }

  static measureSync<T>(label: string, fn: () => T): T {
    this.startTimer(label);
    try {
      return fn();
    } finally {
      this.endTimer(label);
    }
  }
}

// Hook for measuring component render times
export const usePerformanceMonitor = (componentName: string) => {
  useEffect(() => {
    PerformanceMonitor.startTimer(`${componentName}-mount`);
    
    return () => {
      PerformanceMonitor.endTimer(`${componentName}-mount`);
    };
  }, [componentName]);
};

// Database query performance wrapper
export const withQueryPerformance = async <T,>(
  label: string, 
  queryFn: () => Promise<T>
): Promise<T> => {
  return PerformanceMonitor.measureAsync(`DB-${label}`, queryFn);
};

// API request performance wrapper
export const withApiPerformance = async <T,>(
  endpoint: string,
  requestFn: () => Promise<T>
): Promise<T> => {
  return PerformanceMonitor.measureAsync(`API-${endpoint}`, requestFn);
};