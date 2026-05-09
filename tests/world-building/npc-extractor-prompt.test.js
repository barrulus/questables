/**
 * @jest-environment node
 *
 * The NPC extractor's hard-gate behaviour (population cap, dedup, PC-name reject)
 * is unchanged by this work. These tests pin the *prompt-side* changes:
 * the new ## Known entities block and the new system-prompt clause.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { extractAndPersistNpcs } from '../../server/services/world-building/npc-extractor.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

const buildStubLlm = () => {
  const captured = { lastPrompt: null, lastSystemPrompt: null };
  const llmService = {
    generate: jest.fn(async ({ prompt, systemPrompt }) => {
      captured.lastPrompt = prompt;
      captured.lastSystemPrompt = systemPrompt;
      return { parsed: { npcs: [] }, content: JSON.stringify({ npcs: [] }) };
    }),
  };
  return { llmService, captured };
};

describe('npc-extractor — prompt injection', () => {
  let fixture;
  let burgAName;

  beforeAll(async () => {
    fixture = await createTestCampaignWithTwoPlayers();
    const { rows } = await pool.query(
      `SELECT name FROM public.maps_burgs WHERE id = $1`,
      [fixture.playerA.burgId],
    );
    burgAName = rows[0].name;
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  it('injects ## Known entities into the user prompt', async () => {
    const { llmService, captured } = buildStubLlm();
    await extractAndPersistNpcs({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration text for the NPC extractor minimum length, including some incidental detail to mimic real prose.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastPrompt).toMatch(/## Known entities/);
    expect(captured.lastPrompt).toContain(burgAName);
  });

  it('system prompt forbids extracting NPCs anchored to fabricated places', async () => {
    const { llmService, captured } = buildStubLlm();
    await extractAndPersistNpcs({
      campaignId: fixture.campaignId,
      narrationContent: 'A long enough narration text for the NPC extractor minimum length, including some incidental detail to mimic real prose.',
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastSystemPrompt).toMatch(/anchors an NPC to a place not in Known/i);
  });
});

// Single global pool teardown — runs after all describe blocks finish.
afterAll(async () => {
  await pool.end();
});
