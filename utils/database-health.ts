// Database health monitoring utilities

export interface DatabaseHealth {
  isConnected: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastCheck: Date;
  error?: string;
  latency?: number;
}

export interface DatabaseHealthMonitorOptions {
  checkInterval: number; // milliseconds
  timeout: number; // milliseconds
  retryAttempts: number;
  onStatusChange?: (health: DatabaseHealth) => void;
}

export class DatabaseHealthMonitor {
  private health: DatabaseHealth = {
    isConnected: false,
    status: 'disconnected',
    lastCheck: new Date()
  };
  
  private checkInterval?: NodeJS.Timeout;
  private retryTimeout?: NodeJS.Timeout;
  private retryCount = 0;
  
  constructor(private options: DatabaseHealthMonitorOptions) {}

  public getHealth(): DatabaseHealth {
    return { ...this.health };
  }

  public start(): void {
    this.checkConnection();
    this.checkInterval = setInterval(
      () => this.checkConnection(),
      this.options.checkInterval
    );
  }

  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }
  }

  private async checkConnection(): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.updateHealth({
        status: 'connecting',
        lastCheck: new Date()
      });

      // Test database connection with a simple query
      const response = await fetch('/api/health', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.options.timeout)
      });

      const endTime = Date.now();
      const latency = endTime - startTime;

      if (response.ok) {
        this.updateHealth({
          isConnected: true,
          status: 'connected',
          lastCheck: new Date(),
          latency,
          error: undefined
        });
        this.retryCount = 0;
      } else {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.updateHealth({
        isConnected: false,
        status: 'error',
        lastCheck: new Date(),
        error: errorMessage
      });

      // Implement exponential backoff retry
      if (this.retryCount < this.options.retryAttempts) {
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry(): void {
    this.retryCount++;
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000); // Max 30 seconds
    
    this.retryTimeout = setTimeout(() => {
      this.checkConnection();
    }, delay);
  }

  private updateHealth(updates: Partial<DatabaseHealth>): void {
    const previousStatus = this.health.status;
    this.health = { ...this.health, ...updates };
    
    // Notify listeners of status changes
    if (previousStatus !== this.health.status && this.options.onStatusChange) {
      this.options.onStatusChange(this.health);
    }
  }
}

// React hook for database health monitoring
import { useState, useEffect } from 'react';

export function useDatabaseHealth(options?: Partial<DatabaseHealthMonitorOptions>): DatabaseHealth {
  const [health, setHealth] = useState<DatabaseHealth>({
    isConnected: false,
    status: 'disconnected',
    lastCheck: new Date()
  });

  useEffect(() => {
    const monitor = new DatabaseHealthMonitor({
      checkInterval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      retryAttempts: 3,
      onStatusChange: setHealth,
      ...options
    });

    monitor.start();
    setHealth(monitor.getHealth());

    return () => {
      monitor.stop();
    };
  }, []);

  return health;
}