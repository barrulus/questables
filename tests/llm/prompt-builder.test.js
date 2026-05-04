/**
 * @jest-environment node
 *
 * Unit tests for buildStructuredPrompt's request-shape handling. These don't
 * touch the DB — they pass a hand-built context object directly. The goal is
 * to lock in the systemPromptOverride and string-extraSections fixes so they
 * can't silently regress.
 */
import { describe, it, expect } from '@jest/globals';
import { buildStructuredPrompt } from '../../server/llm/context/prompt-builder.js';
import { NARRATIVE_TYPES } from '../../server/llm/narrative-types.js';

const makeContext = () => ({
  campaign: {
    name: 'Test Campaign',
    status: 'active',
    system: 'D&D 5e',
    dm: { username: 'dm', email: 'dm@test' },
  },
  session: null,
  party: [],
  partyInScene: [],
  npcs: [],
  npcsInScene: [],
  locations: [],
  encounters: [],
  chat: { recentMessages: [] },
  worldLore: [],
  directorWhispers: [],
});

describe('buildStructuredPrompt — systemPromptOverride', () => {
  it('uses systemPromptOverride verbatim when supplied', () => {
    const override = `Line 1
Line 2 with multi-line content
Line 3`;
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: { systemPromptOverride: override },
    });
    expect(out.systemPrompt).toBe(override);
    // Multi-line whitespace must survive — sanitize() would have collapsed it.
    expect(out.systemPrompt.split('\n').length).toBe(3);
  });

  it('falls back to buildSystemPrompt when systemPromptOverride is omitted', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: {},
    });
    expect(out.systemPrompt).toContain('Questables Narrative Engine');
  });

  it('falls back to buildSystemPrompt when systemPromptOverride is empty/whitespace', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: { systemPromptOverride: '   \n  ' },
    });
    expect(out.systemPrompt).toContain('Questables Narrative Engine');
  });
});

describe('buildStructuredPrompt — extraSections', () => {
  it('honours string-form extraSections', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: { extraSections: '## Movement Context\nThe party climbed down a well.' },
    });
    expect(out.prompt).toContain('### Additional Details');
    expect(out.prompt).toContain('The party climbed down a well.');
  });

  it('still honours array-form extraSections', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: {
        extraSections: [
          { title: 'Custom Header', content: 'Custom body' },
        ],
      },
    });
    expect(out.prompt).toContain('### Custom Header');
    expect(out.prompt).toContain('Custom body');
  });

  it('drops empty-string extraSections silently', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: { extraSections: '   ' },
    });
    expect(out.prompt).not.toContain('### Additional Details');
  });
});

describe('buildStructuredPrompt — scene-presence sections', () => {
  it('renders all four scene/roster sections with their canonical headers', () => {
    const ctx = makeContext();
    ctx.npcsInScene = [
      { id: 'n1', name: 'Mira', race: 'human', occupation: 'innkeeper', personality: 'gruff', gender: 'female', ageGroup: 'adult' },
    ];
    ctx.npcs = [
      { id: 'n1', name: 'Mira', race: 'human', occupation: 'innkeeper', personality: 'gruff', relationships: [], voiceConfig: null },
      { id: 'n2', name: 'Asmodeus', race: 'devil', occupation: 'archfiend', personality: 'cunning', relationships: [], voiceConfig: null },
    ];
    ctx.party = [
      { character: { id: 'c1', name: 'Sora', level: 3, race: 'Elf', class: 'Wizard' }, isInCurrentSession: true },
      { character: { id: 'c2', name: 'Brom', level: 3, race: 'Dwarf', class: 'Fighter' }, isInCurrentSession: false },
    ];
    ctx.partyInScene = [
      { character: { id: 'c1', name: 'Sora', level: 3, race: 'Elf', class: 'Wizard' }, isInCurrentSession: true },
    ];

    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: ctx,
      providerConfig: { name: 'test', model: 'test-model' },
      request: {},
    });

    expect(out.prompt).toContain('### NPCs in current scene');
    expect(out.prompt).toContain('Mira');
    expect(out.prompt).toContain('### Campaign NPC roster');
    expect(out.prompt).toContain('Asmodeus');
    expect(out.prompt).toContain('### Party in current scene');
    expect(out.prompt).toContain('Sora');
    expect(out.prompt).toContain('### Full party roster');
    expect(out.prompt).toContain('Brom');
  });

  it('renders explicit "no NPCs present" when the scene is empty', () => {
    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: makeContext(),
      providerConfig: { name: 'test', model: 'test-model' },
      request: {},
    });
    expect(out.prompt).toContain('### NPCs in current scene');
    expect(out.prompt).toContain('No NPCs present');
    expect(out.prompt).toContain('### Party in current scene');
    expect(out.prompt).toContain('alone');
  });
});

describe('buildStructuredPrompt — section ordering', () => {
  it('renders geographic context before scene/roster sections and before recent chat', () => {
    const ctx = {
      ...makeContext(),
      geographic: {
        currentBurg: {
          id: 'burg-1',
          name: 'Yelensaz',
          statefull: 'Some State',
          provincefull: null,
          population: 100,
          culture: 'Some Culture',
        },
        isInsideSettlement: true,
      },
      npcsInScene: [
        { id: 'n1', name: 'Mira', race: 'human', occupation: 'innkeeper', personality: 'gruff', gender: 'female', ageGroup: 'adult' },
      ],
      party: [
        { character: { id: 'c1', name: 'Sora', level: 3, race: 'Elf', class: 'Wizard' }, isInCurrentSession: true },
      ],
      partyInScene: [
        { character: { id: 'c1', name: 'Sora', level: 3, race: 'Elf', class: 'Wizard' }, isInCurrentSession: true },
      ],
      chat: {
        recentMessages: [
          {
            messageType: 'text',
            sender: { username: 'tester' },
            content: 'I remember Toprak',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    };

    const out = buildStructuredPrompt({
      type: NARRATIVE_TYPES.DM_NARRATION,
      context: ctx,
      providerConfig: { name: 'test', model: 'test-model' },
      request: {},
    });

    const geoIdx = out.prompt.indexOf('Current settlement');
    const npcIdx = out.prompt.indexOf('### NPCs in current scene');
    const partyIdx = out.prompt.indexOf('### Party in current scene');
    const chatIdx = out.prompt.indexOf('Recent chat messages:');

    expect(geoIdx).toBeGreaterThan(-1);
    expect(npcIdx).toBeGreaterThan(-1);
    expect(partyIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeGreaterThan(-1);

    // Geographic must precede every roster + chat block — that's the whole
    // point of the move; chat references prior burgs and the LLM needs the
    // structured anchor first.
    expect(geoIdx).toBeLessThan(npcIdx);
    expect(geoIdx).toBeLessThan(partyIdx);
    expect(geoIdx).toBeLessThan(chatIdx);
  });
});
