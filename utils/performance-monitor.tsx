// Performance monitoring and tracking utilities
import { logPerformance, logInfo, logWarn, logError } from './logger';

// Performance measurement utilities
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private measurements: Map<string, number> = new Map();
  private metrics: Map<string, number[]> = new Map();

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // Start timing an operation
  startTiming(operationId: string): void {
    this.measurements.set(operationId, performance.now());
  }

  // End timing and log the result
  endTiming(operationId: string, operationName?: string): number {
    const startTime = this.measurements.get(operationId);
    if (!startTime) {
      logWarn(`No start time found for operation: ${operationId}`);
      return 0;
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    this.measurements.delete(operationId);
    
    const name = operationName || operationId;
    logPerformance(name, duration);
    
    // Store metric for analysis
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(duration);
    
    return duration;
  }

  // Get performance statistics for an operation
  getStats(operationName: string): {
    count: number;
    average: number;
    min: number;
    max: number;
    p95: number;
  } | null {
    const measurements = this.metrics.get(operationName);
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / count);
    const min = sorted[0];
    const max = sorted[count - 1];
    const p95Index = Math.ceil(count * 0.95) - 1;
    const p95 = sorted[p95Index];

    return { count, average, min, max, p95 };
  }

  // Clear old metrics to prevent memory leaks
  clearOldMetrics(maxAge: number = 300000): void { // 5 minutes default
    this.metrics.clear();
    logInfo('Performance metrics cleared');
  }

  // Get all performance statistics
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name] of this.metrics) {
      stats[name] = this.getStats(name);
    }
    return stats;
  }
}

// React component performance monitoring
export const usePerformanceMonitor = () => {
  const monitor = PerformanceMonitor.getInstance();

  const startTiming = (operationId: string) => {
    monitor.startTiming(operationId);
  };

  const endTiming = (operationId: string, operationName?: string) => {
    return monitor.endTiming(operationId, operationName);
  };

  const measureRender = (componentName: string) => {
    const operationId = `render-${componentName}-${Date.now()}`;
    monitor.startTiming(operationId);
    
    return () => {
      monitor.endTiming(operationId, `${componentName} render`);
    };
  };

  return {
    startTiming,
    endTiming,
    measureRender,
    getStats: (name: string) => monitor.getStats(name),
    getAllStats: () => monitor.getAllStats()
  };
};

// Database query performance monitoring
export const monitorDatabaseQuery = async <T>(
  queryName: string,
  queryFn: () => Promise<T>
): Promise<T> => {
  const monitor = PerformanceMonitor.getInstance();
  const operationId = `db-${queryName}-${Date.now()}`;
  
  monitor.startTiming(operationId);
  
  try {
    const result = await queryFn();
    const duration = monitor.endTiming(operationId, `Database: ${queryName}`);
    
    // Log slow queries
    if (duration > 1000) {
      logWarn(`Slow database query detected: ${queryName}`, { duration });
    }
    
    return result;
  } catch (error) {
    monitor.endTiming(operationId, `Database: ${queryName} (ERROR)`);
    logError(`Database query failed: ${queryName}`, error);
    throw error;
  }
};

// API endpoint performance monitoring
export const monitorAPIEndpoint = (endpointName: string) => {
  return (req: any, res: any, next: any) => {
    const monitor = PerformanceMonitor.getInstance();
    const operationId = `api-${endpointName}-${Date.now()}`;
    
    monitor.startTiming(operationId);
    
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      const duration = monitor.endTiming(operationId, `API: ${endpointName}`);
      
      // Log slow endpoints
      if (duration > 2000) {
        logWarn(`Slow API endpoint: ${endpointName}`, {
          duration,
          statusCode: res.statusCode,
          method: req.method
        });
      }
      
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

// Memory usage monitoring
export const monitorMemoryUsage = () => {
  if (typeof window !== 'undefined' && 'performance' in window && 'memory' in window.performance) {
    const memory = (window.performance as any).memory;
    
    logInfo('Memory usage', {
      usedJSMemory: `${Math.round(memory.usedJSMemory / 1024 / 1024)} MB`,
      totalJSMemory: `${Math.round(memory.totalJSMemory / 1024 / 1024)} MB`,
      jsMemoryLimit: `${Math.round(memory.jsMemoryLimit / 1024 / 1024)} MB`
    });
    
    // Warning for high memory usage
    const usagePercent = (memory.usedJSMemory / memory.jsMemoryLimit) * 100;
    if (usagePercent > 80) {
      logWarn(`High memory usage detected: ${usagePercent.toFixed(1)}%`);
    }
  } else if (typeof process !== 'undefined') {
    const usage = process.memoryUsage();
    
    logInfo('Memory usage', {
      rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(usage.external / 1024 / 1024)} MB`
    });
  }
};

// WebSocket latency monitoring
export const monitorWebSocketLatency = (socket: any) => {
  const startTime = Date.now();
  
  socket.emit('ping', startTime);
  
  socket.on('pong', (timestamp: number) => {
    const latency = Date.now() - timestamp;
    logPerformance('WebSocket latency', latency);
    
    if (latency > 500) {
      logWarn(`High WebSocket latency detected: ${latency}ms`);
    }
  });
};

// Resource loading performance
export const monitorResourceLoading = () => {
  if (typeof window !== 'undefined' && 'performance' in window) {
    const entries = performance.getEntriesByType('resource');
    
    entries.forEach((entry: any) => {
      if (entry.duration > 2000) { // Resources taking more than 2 seconds
        logWarn(`Slow resource loading: ${entry.name}`, {
          duration: `${Math.round(entry.duration)}ms`,
          size: entry.transferSize ? `${Math.round(entry.transferSize / 1024)}KB` : undefined
        });
      }
    });
  }
};

// Bundle size analysis (development only)
export const analyzeBundleSize = () => {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const scripts = document.querySelectorAll('script[src]');
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
    
    logInfo('Bundle analysis', {
      scriptCount: scripts.length,
      stylesheetCount: stylesheets.length,
      scripts: Array.from(scripts).map(script => (script as HTMLScriptElement).src),
      stylesheets: Array.from(stylesheets).map(link => (link as HTMLLinkElement).href)
    });
  }
};

// Performance report generation
export const generatePerformanceReport = () => {
  const monitor = PerformanceMonitor.getInstance();
  const stats = monitor.getAllStats();
  
  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    metrics: stats,
    summary: {
      totalOperations: Object.values(stats).reduce((sum, stat) => sum + (stat?.count || 0), 0),
      averageResponseTime: Object.entries(stats)
        .filter(([name]) => name.startsWith('API:'))
        .reduce((sum, [, stat]) => sum + (stat?.average || 0), 0) / 
        Object.keys(stats).filter(name => name.startsWith('API:')).length || 0,
      slowOperations: Object.entries(stats)
        .filter(([, stat]) => stat && stat.p95 > 1000)
        .map(([name, stat]) => ({ name, p95: stat.p95 }))
    }
  };
  
  logInfo('Performance Report Generated', report);
  return report;
};

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();

// Auto-cleanup timer (runs every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    performanceMonitor.clearOldMetrics();
    monitorMemoryUsage();
  }, 300000);
}