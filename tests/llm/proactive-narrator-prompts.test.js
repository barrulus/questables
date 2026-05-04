/**
 * @jest-environment node
 *
 * Task 7 — anchor tests for the proactive-narrator system prompt overrides.
 * These prompts are the LLM's last line of defence against chat-history
 * priors and cross-scene roster bleed. The assertions below pin the
 * load-bearing phrases so a future tightening pass can't accidentally drop
 * them.
 */
import { describe, it, expect } from '@jest/globals';
import {
  AREA_DESCRIPTION_SYSTEM_PROMPT,
  WORLD_TURN_SYSTEM_PROMPT,
} from '../../server/services/narration/proactive-narrator.js';

describe('Narration system prompts — Task 7 anchors', () => {
  it('AREA_DESCRIPTION leads with anti-priors clause naming the geographic context', () => {
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/Current settlement.*authoritative/i);
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/recent chat.*different/i);
  });

  it('AREA_DESCRIPTION forbids party-roster bleed', () => {
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/Party in current scene/);
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/Full party roster.*reference/i);
  });

  it('AREA_DESCRIPTION forbids NPC-roster bleed', () => {
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/NPCs in current scene/);
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT).toMatch(/Campaign NPC roster.*reference/i);
  });

  it('WORLD_TURN leads with anti-priors clause', () => {
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/Current settlement.*authoritative/i);
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/recent chat.*different/i);
  });

  it('WORLD_TURN forbids party-roster and NPC-roster bleed', () => {
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/Party in current scene/);
    expect(WORLD_TURN_SYSTEM_PROMPT).toMatch(/NPCs in current scene/);
  });

  it('Both prompts stay under 15 lines', () => {
    expect(AREA_DESCRIPTION_SYSTEM_PROMPT.split('\n').length).toBeLessThan(15);
    expect(WORLD_TURN_SYSTEM_PROMPT.split('\n').length).toBeLessThan(15);
  });

  it('Anti-priors clause appears before narrative-shape guidance in both prompts', () => {
    const areaGroundIdx = AREA_DESCRIPTION_SYSTEM_PROMPT.indexOf('GROUND TRUTH');
    const areaShapeIdx = AREA_DESCRIPTION_SYSTEM_PROMPT.search(/sentence|prose|atmospheric/i);
    expect(areaGroundIdx).toBeGreaterThanOrEqual(0);
    expect(areaShapeIdx).toBeGreaterThanOrEqual(0);

    const worldGroundIdx = WORLD_TURN_SYSTEM_PROMPT.indexOf('GROUND TRUTH');
    expect(worldGroundIdx).toBeGreaterThanOrEqual(0);
  });
});
