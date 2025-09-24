import { randomUUID } from 'node:crypto';

const counters = new Map();
const gauges = new Map();
const events = [];
const MAX_EVENTS = 200;

const sanitizeDetails = (details) => {
  if (!details || typeof details !== 'object') {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(details));
  } catch {
    return { note: 'non-serializable payload dropped' };
  }
};

export const incrementCounter = (name, value = 1) => {
  if (!name || typeof value !== 'number' || Number.isNaN(value)) {
    return;
  }
  const nextValue = (counters.get(name) ?? 0) + value;
  counters.set(name, nextValue);
};

export const setGauge = (name, value) => {
  if (!name || typeof value !== 'number' || Number.isNaN(value)) {
    return;
  }
  gauges.set(name, value);
};

export const recordEvent = (type, details = {}) => {
  if (!type) {
    return null;
  }
  const payload = sanitizeDetails(details);
  const event = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    details: payload,
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
  return event;
};

export const getTelemetrySnapshot = () => {
  const countersObject = Object.fromEntries(counters.entries());
  const gaugesObject = Object.fromEntries(gauges.entries());
  return {
    generatedAt: new Date().toISOString(),
    counters: countersObject,
    gauges: gaugesObject,
    recentEvents: events.slice(),
  };
};

export const resetTelemetry = () => {
  counters.clear();
  gauges.clear();
  events.length = 0;
};

export default {
  incrementCounter,
  setGauge,
  recordEvent,
  getTelemetrySnapshot,
  resetTelemetry,
};
