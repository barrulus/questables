/**
 * @jest-environment node
 *
 * Real-DB tests for the lore-extractor's post-LLM gate. Stubs the LLM
 * response (no real provider call) so we can assert on prompt contents
 * and which facts get persisted.
 *
 * NOTE on ON CONFLICT DO NOTHING: campaign_world_lore has no unique constraint
 * on (campaign_id, section, subsection, content) — only the PK (id) is unique.
 * So ON CONFLICT DO NOTHING is effectively inert and every insert creates a new
 * row. Test 3 uses a fabricated subsection ('Definitely Fabricated') rather than
 * burgAName to avoid ambiguity: the resolver gate should drop it regardless of
 * whether the index is empty.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { pool } from '../../server/db/pool.js';
import { extractAndPersistLore } from '../../server/services/world-building/lore-extractor.js';
import { createTestCampaignWithTwoPlayers } from '../fixtures/llm-context-fixtures.js';

const buildStubLlm = (facts) => {
  const captured = { lastPrompt: null, lastSystemPrompt: null };
  const llmService = {
    generate: jest.fn(async ({ prompt, systemPrompt }) => {
      captured.lastPrompt = prompt;
      captured.lastSystemPrompt = systemPrompt;
      return { parsed: { facts }, content: JSON.stringify({ facts }) };
    }),
  };
  return { llmService, captured };
};

const LONG_NARRATION =
  'A long enough narration to clear the 50-character minimum length filter for the lore extractor.';

describe('lore-extractor — post-LLM gate', () => {
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
    await pool.end();
  });

  it('persists a fact whose subsection resolves to a real burg', async () => {
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: burgAName, content: 'Has a notable bell tower.' },
    ]);

    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: LONG_NARRATION,
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it('drops a fact whose subsection does not resolve to any entity', async () => {
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: 'Toprak Village (fabricated)', content: 'A made-up place.' },
    ]);
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: LONG_NARRATION,
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('drops every fact when the entity index is empty (no scope)', async () => {
    // Uses a fabricated subsection rather than burgAName to test the gate clearly:
    // even if burgAName resolves globally, the gate validates against the index,
    // and with an empty index the resolver should return null for any name.
    const { llmService } = buildStubLlm([
      { section: 'location', subsection: 'Definitely Fabricated', content: 'Anything.' },
    ]);
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: LONG_NARRATION,
      llmService,
      // no insideBurgId, no coords — entity index will be empty
    });
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.campaign_world_lore WHERE campaign_id = $1`,
      [fixture.campaignId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('injects a ## Known entities block into the user prompt', async () => {
    const { llmService, captured } = buildStubLlm([]);
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: LONG_NARRATION,
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastPrompt).toMatch(/## Known entities/);
    expect(captured.lastPrompt).toContain(burgAName);
  });

  it('extends the system prompt with the Zero-Dummy clause', async () => {
    const { llmService, captured } = buildStubLlm([]);
    await extractAndPersistLore({
      campaignId: fixture.campaignId,
      narrationContent: LONG_NARRATION,
      llmService,
      insideBurgId: fixture.playerA.burgId,
    });
    expect(captured.lastSystemPrompt).toMatch(/not in the Known entities list/i);
  });
});
