import { jest } from '@jest/globals';

jest.unstable_mockModule('../../server/services/movement/destination-resolver.js', () => ({
  resolveDestination: jest.fn(async () => ({
    x: 500, y: 600, burgId: 'burg-1', mapLevel: 'settlement', resolvedName: 'Harrowick',
  })),
}));

jest.unstable_mockModule('../../server/services/campaigns/service.js', () => ({
  performPlayerMovement: jest.fn(async () => ({
    player: {
      id: 'p1', visibility_state: 'visible',
      geometry: { type: 'Point', coordinates: [500, 600] },
      last_located_at: new Date('2026-04-17T12:00:00Z'),
    },
    requestedDistance: 123,
    requestedTarget: { x: 500, y: 600 },
    snappedTarget: { x: 500, y: 600 },
    grid: { type: 'none', size: 1, origin: { x: 0, y: 0 } },
    pathId: 'path-1',
  })),
}));

const { applyNarrativeMove } = await import('../../server/services/movement/narrative-movement.js');
const { resolveDestination } = await import('../../server/services/movement/destination-resolver.js');
const { performPlayerMovement } = await import('../../server/services/campaigns/service.js');

test('resolves destination, calls performPlayerMovement with source=llm, returns summary', async () => {
  const client = { query: jest.fn() };
  const wsServer = { broadcastToCampaign: jest.fn() };

  const result = await applyNarrativeMove(client, {
    campaignId: 'c1',
    playerId: 'p1',
    requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
    reason: 'narrative travel',
    wsServer,
  });

  expect(resolveDestination).toHaveBeenCalledWith(client, {
    campaignId: 'c1',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });

  expect(performPlayerMovement).toHaveBeenCalledWith(expect.objectContaining({
    campaignId: 'c1',
    playerId: 'p1',
    targetX: 500,
    targetY: 600,
    source: 'llm',
    requestorRole: 'llm',
  }));

  expect(wsServer.broadcastToCampaign).toHaveBeenCalledWith('c1', 'player-moved', expect.objectContaining({
    playerId: 'p1',
    mapLevel: 'settlement',
    insideBurgId: 'burg-1',
    resolvedName: 'Harrowick',
  }));

  expect(result).toMatchObject({
    playerId: 'p1',
    mapLevel: 'settlement',
    insideBurgId: 'burg-1',
    resolvedName: 'Harrowick',
  });
});

test('works without a wsServer (broadcast is best-effort)', async () => {
  const client = { query: jest.fn() };
  const result = await applyNarrativeMove(client, {
    campaignId: 'c1', playerId: 'p1', requestorUserId: 'llm-system',
    destination: { kind: 'burg', ref: 'Harrowick' },
  });
  expect(result.playerId).toBe('p1');
});
