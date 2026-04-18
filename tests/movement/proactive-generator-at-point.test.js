import { jest } from '@jest/globals';

const queryMock = jest.fn();
jest.unstable_mockModule('../../server/db/pool.js', () => ({
  query: queryMock,
  getClient: jest.fn(),
}));

const { evaluateEncounterAtPoint } = await import('../../server/services/encounters/proactive-generator.js');

beforeEach(() => queryMock.mockReset());

test('returns true when point is inside an encounter region and roll succeeds', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.01;

  queryMock
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    .mockResolvedValueOnce({ rows: [{ category: 'encounter' }] });

  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 100, y: 200,
  });
  expect(result).toBe(true);

  Math.random = originalRandom;
});

test('returns false when point is not in an encounter region and roll is too high', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.99;

  queryMock
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 100, y: 200,
  });
  expect(result).toBe(false);

  Math.random = originalRandom;
});

test('returns false on DB error', async () => {
  queryMock.mockRejectedValueOnce(new Error('db down'));
  const result = await evaluateEncounterAtPoint({
    campaignId: 'c1', sessionId: 's1', x: 0, y: 0,
  });
  expect(result).toBe(false);
});
