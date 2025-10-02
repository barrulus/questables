// Performance monitoring and tracking utilities
import { logPerformance, logInfo, logWarn, logError } from "./logger";

interface TimedRequest {
  method?: string;
}

interface TimedResponse {
  statusCode?: number;
  end: (..._args: unknown[]) => unknown;
}

type NextHandler = () => void;

export interface PerformanceSnapshot {
  count: number;
  average: number;
  min: number;
  max: number;
  p95: number;
}

// Performance measurement utilities
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private measurements: Map<string, number> = new Map();
  private metrics: Map<string, number[]> = new Map();
  private metricUpdatedAt: Map<string, number> = new Map();

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
    this.metricUpdatedAt.set(name, Date.now());

    return duration;
  }

  // Get performance statistics for an operation
  getStats(operationName: string): PerformanceSnapshot | null {
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
  clearOldMetrics(maxAge: number = 300000): void {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [name, lastUpdated] of this.metricUpdatedAt.entries()) {
      if (lastUpdated < cutoff) {
        this.metricUpdatedAt.delete(name);
        if (this.metrics.delete(name)) {
          removed += 1;
        }
      }
    }

    if (removed > 0) {
      logInfo("Performance metrics pruned", { removed, maxAge });
    }
  }

  // Get all performance statistics
  getAllStats(): Record<string, PerformanceSnapshot> {
    const stats: Record<string, PerformanceSnapshot> = {};
    for (const [name] of this.metrics) {
      const summary = this.getStats(name);
      if (summary) {
        stats[name] = summary;
      }
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
    getAllStats: () => monitor.getAllStats(),
  };
};

// Database query performance monitoring
export const monitorDatabaseQuery = async <T,>(
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
  return <Req extends TimedRequest, Res extends TimedResponse>(
    req: Req,
    res: Res,
    next: NextHandler
  ) => {
    const monitor = PerformanceMonitor.getInstance();
    const operationId = `api-${endpointName}-${Date.now()}`;

    monitor.startTiming(operationId);

    const originalEnd = res.end;
    if (typeof originalEnd !== "function") {
      logWarn(`Response object missing end handler for ${endpointName}`);
      next();
      return;
    }

    res.end = ((...args: unknown[]) => {
      const duration = monitor.endTiming(operationId, `API: ${endpointName}`);

      // Log slow endpoints
      if (duration > 2000) {
        logWarn(`Slow API endpoint: ${endpointName}`, {
          duration,
          statusCode: res.statusCode,
          method: req.method,
        });
      }

      return originalEnd.apply(res, args as Parameters<Res["end"]>);
    }) as Res["end"];

    next();
  };
};

// Memory usage monitoring
interface PerformanceMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export const monitorMemoryUsage = () => {
  if (
    typeof window !== "undefined" &&
    "performance" in window &&
    "memory" in window.performance
  ) {
    const performanceWithMemory = window.performance as Performance & {
      memory?: PerformanceMemory;
    };
    const memory = performanceWithMemory.memory;

    if (!memory) {
      logWarn("Performance memory API unavailable in this browser");
      return;
    }

    logInfo("Memory usage", {
      usedJSHeapSize: `${Math.round(memory.usedJSHeapSize / 1024 / 1024)} MB`,
      totalJSHeapSize: `${Math.round(memory.totalJSHeapSize / 1024 / 1024)} MB`,
      jsHeapSizeLimit: `${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)} MB`,
    });

    // Warning for high memory usage
    const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
    if (usagePercent > 80) {
      logWarn(`High memory usage detected: ${usagePercent.toFixed(1)}%`);
    }
  } else if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
    const usage = process.memoryUsage();

    logInfo("Memory usage", {
      rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(usage.external / 1024 / 1024)} MB`,
    });
  }
};

// WebSocket latency monitoring
interface LatencySocket {
  emit: (_event: string, _payload: unknown) => unknown;
  on: (_event: string, _handler: (_timestamp: number) => void) => unknown;
}

export const monitorWebSocketLatency = (socket: LatencySocket) => {
  const startTime = Date.now();

  socket.emit("ping", startTime);

  socket.on("pong", (timestamp: number) => {
    const latency = Date.now() - timestamp;
    logPerformance("WebSocket latency", latency);

    if (latency > 500) {
      logWarn(`High WebSocket latency detected: ${latency}ms`);
    }
  });
};

// Resource loading performance
export const monitorResourceLoading = () => {
  if (typeof window !== "undefined" && "performance" in window) {
    const entries = performance.getEntriesByType("resource");

    entries.forEach((entry) => {
      if (entry instanceof PerformanceResourceTiming && entry.duration > 2000) {
        // Resources taking more than 2 seconds
        logWarn(`Slow resource loading: ${entry.name}`, {
          duration: `${Math.round(entry.duration)}ms`,
          size: entry.transferSize
            ? `${Math.round(entry.transferSize / 1024)}KB`
            : undefined,
        });
      }
    });
  }
};

// Bundle size analysis (development only)
export const analyzeBundleSize = () => {
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    const scripts = document.querySelectorAll("script[src]");
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');

    logInfo("Bundle analysis", {
      scriptCount: scripts.length,
      stylesheetCount: stylesheets.length,
      scripts: Array.from(scripts).map(
        (script) => (script as HTMLScriptElement).src
      ),
      stylesheets: Array.from(stylesheets).map(
        (link) => (link as HTMLLinkElement).href
      ),
    });
  }
};

// Performance report generation
export const generatePerformanceReport = () => {
  const monitor = PerformanceMonitor.getInstance();
  const stats = monitor.getAllStats();

  const apiStats = Object.entries(stats).filter(([name]) => name.startsWith("API:"));
  const totalApiAverage = apiStats.reduce((sum, [, stat]) => sum + stat.average, 0);
  const averageApiResponseTime = apiStats.length ? totalApiAverage / apiStats.length : 0;

  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    metrics: stats,
    summary: {
      totalOperations: Object.values(stats).reduce((sum, stat) => sum + stat.count, 0),
      averageResponseTime: averageApiResponseTime,
      slowOperations: Object.entries(stats)
        .filter(([, stat]) => stat.p95 > 1000)
        .map(([name, stat]) => ({ name, p95: stat.p95 })),
    },
  };

  logInfo("Performance Report Generated", report);
  return report;
};

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();

// Auto-cleanup timer (runs every 5 minutes)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    performanceMonitor.clearOldMetrics();
    monitorMemoryUsage();
  }, 300000);
}
