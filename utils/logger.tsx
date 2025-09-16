// Application logging utility using Winston
import winston from 'winston';
import path from 'path';

// Log levels
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Log colors for console output
const LOG_COLORS = {
  error: 'red',
  warn: 'yellow', 
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(LOG_COLORS);

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...extra } = info;
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (stack) {
      log += `\nStack: ${stack}`;
    }
    
    if (Object.keys(extra).length > 0) {
      log += `\nExtra: ${JSON.stringify(extra, null, 2)}`;
    }
    
    return log;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    return `${info.timestamp} [${info.level}]: ${info.message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels: LOG_LEVELS,
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'questables-app',
    version: '1.0.0'
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
      silent: process.env.NODE_ENV === 'test'
    })
  ]
});

// Add file transport for production
if (process.env.NODE_ENV === 'production') {
  // Ensure logs directory exists
  const logsDir = path.join(process.cwd(), 'logs');
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }));
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }));
}

// Helper functions for structured logging
export const logError = (message: string, error?: Error | any, meta?: object) => {
  logger.error(message, {
    error: error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error,
    ...meta
  });
};

export const logWarn = (message: string, meta?: object) => {
  logger.warn(message, meta);
};

export const logInfo = (message: string, meta?: object) => {
  logger.info(message, meta);
};

export const logHttp = (message: string, meta?: object) => {
  logger.http(message, meta);
};

export const logDebug = (message: string, meta?: object) => {
  logger.debug(message, meta);
};

// Database operation logging
export const logDatabaseOperation = (operation: string, table: string, duration?: number, meta?: object) => {
  logInfo(`Database ${operation} on ${table}`, {
    operation,
    table,
    duration: duration ? `${duration}ms` : undefined,
    ...meta
  });
};

// User activity logging
export const logUserActivity = (userId: string, action: string, details?: object) => {
  logInfo('User activity', {
    userId,
    action,
    details,
    timestamp: new Date().toISOString()
  });
};

// Security event logging
export const logSecurityEvent = (event: string, severity: 'low' | 'medium' | 'high' | 'critical', details?: object) => {
  const logFunction = severity === 'critical' || severity === 'high' ? logError : logWarn;
  
  logFunction(`Security event: ${event}`, {
    event,
    severity,
    details,
    timestamp: new Date().toISOString()
  });
};

// Performance logging
export const logPerformance = (operation: string, duration: number, meta?: object) => {
  const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
  
  logger.log(level, `Performance: ${operation} took ${duration}ms`, {
    operation,
    duration,
    performance: true,
    ...meta
  });
};

// API request logging middleware
export const createRequestLogger = () => {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    
    // Log request
    logHttp(`${req.method} ${req.originalUrl}`, {
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.id
    });
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      const duration = Date.now() - start;
      
      logHttp(`${req.method} ${req.originalUrl} - ${res.statusCode}`, {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userId: req.user?.id
      });
      
      // Log slow requests
      if (duration > 1000) {
        logWarn(`Slow request detected`, {
          method: req.method,
          url: req.originalUrl,
          duration: `${duration}ms`,
          statusCode: res.statusCode
        });
      }
      
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

// WebSocket event logging
export const logWebSocketEvent = (event: string, userId?: string, campaignId?: string, meta?: object) => {
  logInfo(`WebSocket event: ${event}`, {
    event,
    userId,
    campaignId,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

// Application startup logging
export const logApplicationStart = (config?: object) => {
  logInfo('Application starting', {
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform,
    config: config ? JSON.stringify(config, null, 2) : undefined,
    timestamp: new Date().toISOString()
  });
};

// Graceful shutdown logging
export const logApplicationShutdown = (reason?: string) => {
  logInfo('Application shutting down', {
    reason,
    timestamp: new Date().toISOString()
  });
};

// Export the main logger instance
export default logger;