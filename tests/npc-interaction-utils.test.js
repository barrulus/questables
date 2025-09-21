import { describe, expect, it } from '@jest/globals';
import { deriveNpcInteraction, VALID_SENTIMENTS, clamp } from '../server/llm/npc-interaction-utils.js';

describe('npc-interaction-utils', () => {
  it('clamps values within range', () => {
    expect(clamp(5, -2, 2)).toBe(2);
    expect(clamp(-5, -2, 2)).toBe(-2);
    expect(clamp(1, -2, 2)).toBe(1);
  });

  it('derives summary and sentiment from response when none provided', () => {
    const result = { content: 'The scholar smiles warmly and thanks the heroes for their help.' };
    const interaction = deriveNpcInteraction({ result });

    expect(interaction.summary.length).toBeGreaterThan(0);
    expect(VALID_SENTIMENTS.has(interaction.sentiment)).toBe(true);
    expect(interaction.trustDelta).toBeGreaterThanOrEqual(-10);
    expect(interaction.trustDelta).toBeLessThanOrEqual(10);
  });

  it('honours explicit interaction overrides', () => {
    const result = { content: 'Placeholder text.' };
    const interaction = deriveNpcInteraction({
      result,
      interaction: {
        summary: 'Explicit summary',
        sentiment: 'negative',
        trustDelta: -3,
        tags: ['betrayal'],
        relationshipChanges: [{ targetId: '123', targetType: 'character', relationshipType: 'enemy', delta: -2 }],
      },
    });

    expect(interaction.summary).toBe('Explicit summary');
    expect(interaction.sentiment).toBe('negative');
    expect(interaction.trustDelta).toBe(-3);
    expect(interaction.tags).toContain('betrayal');
    expect(interaction.relationshipChanges[0].targetType).toBe('character');
    expect(interaction.relationshipChanges[0].delta).toBe(-2);
  });
});
