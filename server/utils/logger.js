// Lightweight logger for the Node server

const fmt = (level, message, meta) => {
  const ts = new Date().toISOString();
  const base = `${ts} [${level.toUpperCase()}] ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
};

export const logError = (message, error, meta) => {
  const merged = { ...(meta || {}) };
  if (error instanceof Error) {
    merged.error = { name: error.name, message: error.message, stack: error.stack };
  } else if (error) {
    merged.error = error;
  }
  console.error(fmt('error', message, merged));
};

export const logWarn = (message, meta) => console.warn(fmt('warn', message, meta));
export const logInfo = (message, meta) => console.info(fmt('info', message, meta));
export const logHttp = (message, meta) => console.log(fmt('http', message, meta));
export const logDebug = (message, meta) => console.debug(fmt('debug', message, meta));

export const logDatabaseOperation = (operation, table, duration, meta) => {
  logInfo(`Database ${operation} on ${table}`, { duration: duration ? `${duration}ms` : undefined, ...(meta || {}) });
};

export const logUserActivity = (userId, action, details) => {
  logInfo('User activity', { userId, action, details, timestamp: new Date().toISOString() });
};

export const logSecurityEvent = (event, severity = 'low', details) => {
  const logger = severity === 'high' || severity === 'critical' ? logError : logWarn;
  logger(`Security event: ${event}`, { severity, details, timestamp: new Date().toISOString() });
};

export const createRequestLogger = () => (req, res, next) => {
  const start = Date.now();
  logHttp(`${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });
  const origEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    logHttp(`${req.method} ${req.originalUrl} - ${res.statusCode}`, { duration: `${duration}ms` });
    origEnd.apply(this, args);
  };
  next();
};

export const logApplicationStart = (config) => logInfo('Database server starting', config);
export const logApplicationShutdown = (reason) => logWarn('Database server stopping', { reason });

export default {
  logError,
  logWarn,
  logInfo,
  logHttp,
  logDebug,
  logDatabaseOperation,
  logUserActivity,
  logSecurityEvent,
  createRequestLogger,
  logApplicationStart,
  logApplicationShutdown,
};

