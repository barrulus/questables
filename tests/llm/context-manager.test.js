/**
 * @jest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { LLMContextManager } from '../../server/llm/context/context-manager.js';
import { pool } from '../../server/db/pool.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

describe('LLMContextManager.buildGameContext — actingUserId', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
  });
  afterAll(async () => {
    await fixture.cleanup();
    await pool.end();
  });

  it('uses acting-player position for geography when actingUserId is supplied', async () => {
    const ctx = new LLMContextManager({ pool });
    const ctxBuiltForA = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerA.userId,
    });
    expect(ctxBuiltForA.geographic?.insideBurgId).toBe(fixture.playerA.burgId);
    // Prove the downstream PostGIS query keyed off the supplied position —
    // a bug where buildGeographicContext ignored insideBurgId would still pass
    // the assertion above, since insideBurgId is plumbed through directly.
    expect(ctxBuiltForA.geographic?.settlement?.name).toBeDefined();
    const burgNameA = ctxBuiltForA.geographic.settlement.name;

    const ctxBuiltForB = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
      actingUserId: fixture.playerB.userId,
    });
    expect(ctxBuiltForB.geographic?.insideBurgId).toBe(fixture.playerB.burgId);
    expect(ctxBuiltForB.geographic?.settlement?.name).toBeDefined();
    expect(ctxBuiltForB.geographic.settlement.name).not.toBe(burgNameA);
  });

  it('falls back to gameState.activePlayerId when actingUserId is omitted', async () => {
    const ctx = new LLMContextManager({ pool });
    const built = await ctx.buildGameContext({
      campaignId: fixture.campaignId,
      sessionId: fixture.sessionId,
    });
    expect(built.geographic?.insideBurgId).toBe(fixture.playerA.burgId);
  });
});
