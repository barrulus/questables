import { logError } from './logger.js';

const REQUIRED_ENV = ['TEGOLA_PUBLIC_URL'];

const readEnv = () => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key] || process.env[key].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing Tegola environment variables: ${missing.join(', ')}`);
  }

  const baseUrl = process.env.TEGOLA_PUBLIC_URL.replace(/\/$/, '');
  return {
    baseUrl,
  };
};

export const getTegolaSettings = () => {
  if (!getTegolaSettings.cache) {
    getTegolaSettings.cache = readEnv();
  }
  return getTegolaSettings.cache;
};

const serializeQuery = (query = {}) => {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }
  const params = new URLSearchParams();
  entries.forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
    } else {
      params.append(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const fetchTegola = async ({ path, query, headers = {}, signal } = {}) => {
  const { baseUrl } = getTegolaSettings();
  const requestUrl = `${baseUrl}${path}${serializeQuery(query)}`;

  let response;
  try {
    response = await fetch(requestUrl, {
      headers,
      signal,
    });
  } catch (error) {
    logError('Tegola request failed', error, { requestUrl });
    const err = new Error('Tegola service unreachable');
    err.status = 502;
    throw err;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Tegola responded with ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.requestUrl = requestUrl;
    throw error;
  }

  return response;
};

export const fetchTegolaJson = async (options) => {
  const response = await fetchTegola({
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return response.json();
};
