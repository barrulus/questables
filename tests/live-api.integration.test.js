/**
 * @jest-environment node
 */
/* eslint-env node */

const { describe, it, expect, beforeAll } = globalThis;
const fetch = globalThis.fetch;
const env = globalThis.process?.env ?? {};

const DEFAULT_BASE_URL = 'https://quixote.tail3f19fe.ts.net:3001';

const resolveBaseUrl = () => {
  if (env.LIVE_API_BASE_URL) {
    return env.LIVE_API_BASE_URL;
  }

  if (env.VITE_DATABASE_SERVER_URL) {
    return env.VITE_DATABASE_SERVER_URL;
  }

  if (env.DATABASE_SERVER_PUBLIC_HOST) {
    return `https://${env.DATABASE_SERVER_PUBLIC_HOST}:3001`;
  }

  return DEFAULT_BASE_URL;
};

describe('Live Questables API smoke tests', () => {
  const baseUrl = resolveBaseUrl();
  const adminEmail = env.LIVE_API_ADMIN_EMAIL || env.DEFAULT_ADMIN_EMAIL;
  const adminPassword = env.LIVE_API_ADMIN_PASSWORD || env.DEFAULT_ADMIN_PASSWORD;
  let adminToken = null;

  const loginAsAdmin = async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Admin login failed (${response.status}): ${message}`);
    }

    const payload = await response.json();
    if (!payload.token) {
      throw new Error('Admin login succeeded but no token was returned');
    }

    adminToken = payload.token;
  };

  beforeAll(async () => {
    env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    if (!baseUrl) {
      throw new Error('Live API base URL could not be resolved');
    }
    if (!adminEmail || !adminPassword) {
      throw new Error('Admin credentials are required. Set LIVE_API_ADMIN_EMAIL and LIVE_API_ADMIN_PASSWORD or provide DEFAULT_ADMIN_* values.');
    }
    await loginAsAdmin();
  });

  it('reports healthy status from /api/health', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.ok).toBe(true);

    const payload = await response.json();
    expect(payload).toHaveProperty('status', 'healthy');
    expect(payload).toHaveProperty('database');
    expect(payload).toHaveProperty('timestamp');
  });

  it('returns a well-formed list of public campaigns', async () => {
    const response = await fetch(`${baseUrl}/api/campaigns/public`);
    expect(response.ok).toBe(true);

    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);

    if (payload.length > 0) {
      const campaign = payload[0];
      expect(campaign).toHaveProperty('id');
      expect(campaign).toHaveProperty('name');
      expect(campaign).toHaveProperty('status');
    }
  });

  it('exposes at least metadata for available world maps', async () => {
    const response = await fetch(`${baseUrl}/api/maps/world`);
    expect(response.ok).toBe(true);

    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);

    if (payload.length > 0) {
      const world = payload[0];
      expect(world).toHaveProperty('id');
      expect(world).toHaveProperty('name');
      expect(world).toHaveProperty('bounds');
    }
  });

  it('returns admin metrics when authenticated', async () => {
    if (!adminToken) {
      await loginAsAdmin();
    }

    const response = await fetch(`${baseUrl}/api/admin/metrics`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Admin metrics request failed (${response.status}): ${message}`);
    }

    const payload = await response.json();
    expect(payload).toHaveProperty('generatedAt');
    expect(payload).toHaveProperty('users');
    expect(payload).toHaveProperty('campaigns');
    expect(payload).toHaveProperty('sessions');
  });
});
