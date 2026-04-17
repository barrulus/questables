import { jest } from '@jest/globals';

const applyNarrativeMoveMock = jest.fn(async () => ({
  playerId: 'p1', mapLevel: 'settlement', insideBurgId: 'b1', resolvedName: 'Harrowick',
}));

jest.unstable_mockModule('../../server/services/movement/narrative-movement.js', () => ({
  applyNarrativeMove: applyNarrativeMoveMock,
}));

const { applyMechanicalOutcome } = await import('../../server/services/dm-action/service.js');

function makeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM public\.sessions/.test(sql)) return { rows: [{ campaign_id: 'c1' }] };
      if (/FROM public\.campaign_players/.test(sql)) return { rows: [{ id: 'p1', user_id: 'u1' }] };
      return { rows: [] };
    }),
  };
}

test('move_player outcome calls applyNarrativeMove with resolved ids', async () => {
  const client = makeClient();
  const wsServer = { broadcastToCampaign: jest.fn() };

  await applyMechanicalOutcome(client, {
    sessionId: 's1',
    actingCharacterId: 'char-1',
    mechanicalOutcome: {
      type: 'move_player',
      destination: { kind: 'burg', ref: 'Harrowick' },
    },
    wsServer,
  });

  expect(applyNarrativeMoveMock).toHaveBeenCalledWith(client, expect.objectContaining({
    campaignId: 'c1',
    playerId: 'p1',
    destination: { kind: 'burg', ref: 'Harrowick' },
    wsServer,
  }));
});

test('move_player with missing destination returns null and logs', async () => {
  const client = makeClient();
  const result = await applyMechanicalOutcome(client, {
    sessionId: 's1',
    actingCharacterId: 'char-1',
    mechanicalOutcome: { type: 'move_player' },
  });
  expect(result).toBeNull();
});
