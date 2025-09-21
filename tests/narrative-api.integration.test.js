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

describe('Narrative API endpoints', () => {
  const baseUrl = resolveBaseUrl();
  const adminEmail = env.LIVE_API_ADMIN_EMAIL || env.DEFAULT_ADMIN_EMAIL;
  const adminPassword = env.LIVE_API_ADMIN_PASSWORD || env.DEFAULT_ADMIN_PASSWORD;

  let adminToken = null;
  let adminUserId = null;
  let campaignId = null;
  let skipReason = null;

  beforeAll(async () => {
    env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    if (!adminEmail || !adminPassword) {
      skipReason = 'Admin credentials are required for narrative endpoint tests';
      return;
    }

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    if (!loginResponse.ok) {
      const message = await loginResponse.text();
      throw new Error(`Failed to log in as admin: ${loginResponse.status} ${message}`);
    }

    const loginPayload = await loginResponse.json();
    adminToken = loginPayload.token;
    adminUserId = loginPayload.user?.id;

    if (!adminToken || !adminUserId) {
      throw new Error('Login succeeded but no token or user ID was returned');
    }

    const createCampaignResponse = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: `LLM Narrative Test ${Date.now()}`,
        description: 'Automated narrative test campaign',
        dmUserId: adminUserId,
        system: 'D&D 5e',
        setting: 'Automated Suite',
        status: 'recruiting',
        maxPlayers: 4,
        levelRange: { min: 1, max: 10 },
        isPublic: false,
      }),
    });

    if (!createCampaignResponse.ok) {
      const message = await createCampaignResponse.text();
      throw new Error(`Failed to create narrative test campaign: ${createCampaignResponse.status} ${message}`);
    }

    const campaignPayload = await createCampaignResponse.json();
    campaignId = campaignPayload.campaign?.id;

    if (!campaignId) {
      throw new Error('Campaign creation response did not include an ID');
    }
  });

  const guard = () => {
    if (skipReason) {
      globalThis.console?.warn?.(`[Narrative endpoints] ${skipReason}`);
      return true;
    }
    return false;
  };

  it('requires authentication for DM narrative endpoint', async () => {
    if (guard()) {
      return;
    }
    const response = await fetch(`${baseUrl}/api/campaigns/${campaignId}/narratives/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focus: 'Unauthenticated request should fail' }),
    });

    expect(response.status).toBe(401);
  });

  it('surfaces provider errors when the narrative service cannot reach Ollama', async () => {
    if (guard()) {
      return;
    }
    const response = await fetch(`${baseUrl}/api/campaigns/${campaignId}/narratives/dm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        focus: 'Smoke test narrative generation failure path',
        metadata: { suite: 'narrative-api.integration' },
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(500);

    const payload = await response.json();
    expect(payload).toHaveProperty('error');
    expect(payload.error === 'narrative_provider_error' || payload.error === 'narrative_service_error').toBe(true);
  });

  it('validates NPC dialogue payload requires npcId', async () => {
    if (guard()) {
      return;
    }
    const response = await fetch(`${baseUrl}/api/campaigns/${campaignId}/narratives/npc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        focus: 'Missing npcId should trigger validation error',
        interaction: {
          summary: 'Player attempted to converse without specifying an NPC.',
        },
      }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toHaveProperty('error', 'Validation failed');
  });
});
