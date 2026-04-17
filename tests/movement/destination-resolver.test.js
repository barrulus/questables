import { jest } from '@jest/globals';
import { resolveDestination } from '../../server/services/movement/destination-resolver.js';

function makeClient(responses) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const match = responses.find((r) => r.match.test(sql));
      if (!match) throw new Error(`No mock for SQL:\n${sql}`);
      return { rows: typeof match.rows === 'function' ? match.rows(params) : match.rows };
    }),
  };
}

describe('resolveDestination — burg by name', () => {
  test('returns coordinates + burgId for exact burg match', async () => {
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{ id: 'burg-uuid', x: 1234.5, y: 678.9, name: 'Harrowick' }],
      },
    ]);

    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'burg', ref: 'Harrowick' },
    });

    expect(result).toEqual({
      x: 1234.5,
      y: 678.9,
      burgId: 'burg-uuid',
      mapLevel: 'settlement',
      resolvedName: 'Harrowick',
    });
  });

  test('resolves when ref is a uuid', async () => {
    const client = makeClient([
      {
        match: /FROM public\.maps_burgs/,
        rows: [{ id: '11111111-1111-1111-1111-111111111111', x: 10, y: 20, name: 'X' }],
      },
    ]);

    const result = await resolveDestination(client, {
      campaignId: 'camp-1',
      destination: { kind: 'burg', ref: '11111111-1111-1111-1111-111111111111' },
    });

    expect(result.burgId).toBe('11111111-1111-1111-1111-111111111111');
  });

  test('throws destination_not_found when burg is unknown', async () => {
    const client = makeClient([
      { match: /FROM public\.maps_burgs/, rows: [] },
    ]);

    await expect(
      resolveDestination(client, {
        campaignId: 'camp-1',
        destination: { kind: 'burg', ref: 'Nowhereville' },
      }),
    ).rejects.toMatchObject({ code: 'destination_not_found' });
  });
});
