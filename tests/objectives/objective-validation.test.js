import { describe, expect, it } from '@jest/globals';

import {
  sanitizeObjectivePayload,
  ObjectiveValidationError,
  validateLocationPayload,
} from '../../server/objectives/objective-validation.js';

describe('objective validation helpers', () => {
  it('sanitises title, markdown and pin location payloads', () => {
    const sanitized = sanitizeObjectivePayload(
      {
        title: '  Rescue the villagers  ',
        descriptionMd: '  **Plan:** sneak in.  ',
        locationType: 'pin',
        locationPin: { x: 123.45, y: 678.9 },
      },
      { campaignId: '11111111-1111-1111-1111-111111111111' },
    );

    expect(sanitized.title).toBe('Rescue the villagers');
    expect(sanitized.markdown).toEqual({ description_md: '**Plan:** sneak in.' });
    expect(sanitized.location).toEqual({
      type: 'pin',
      pin: { x: 123.45, y: 678.9 },
      burgId: null,
      markerId: null,
    });
  });

  it('normalises optional fields (slug, orderIndex, isMajor)', () => {
    const payload = sanitizeObjectivePayload(
      {
        title: 'Gather Intel',
        slug: '  Gather-Intel  ',
        orderIndex: '42',
        isMajor: 'true',
      },
      { campaignId: '22222222-2222-2222-2222-222222222222' },
    );

    expect(payload.slug).toBe('gather-intel');
    expect(payload.orderIndex).toBe(42);
    expect(payload.isMajor).toBe(true);
  });

  it('accepts burg location and rejects mixed-location payloads', () => {
    const burgId = '33333333-3333-4333-8333-333333333333';
    const burgLocation = validateLocationPayload({
      locationType: 'burg',
      locationBurgId: burgId,
    });

    expect(burgLocation).toEqual({ type: 'burg', pin: null, burgId, markerId: null });

    expect(() =>
      validateLocationPayload({
        locationType: 'burg',
        locationBurgId: burgId,
        locationMarkerId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toThrow(ObjectiveValidationError);
  });

  it('enforces parent/ancestor integrity', () => {
    const campaignId = '55555555-5555-4555-8555-555555555555';
    const parentId = '66666666-6666-4666-8666-666666666666';

    expect(() =>
      sanitizeObjectivePayload(
        {
          title: 'Broken hierarchy',
          parentId,
        },
        {
          campaignId,
          parentObjective: { id: parentId, campaign_id: '77777777-7777-4777-8777-777777777777' },
        },
      ),
    ).toThrow(ObjectiveValidationError);

    expect(() =>
      sanitizeObjectivePayload(
        {
          title: 'Cycle',
          parentId,
        },
        {
        campaignId,
        parentObjective: { id: parentId, campaign_id: campaignId },
          ancestorIds: [parentId],
        },
      ),
    ).toThrow(ObjectiveValidationError);
  });

  it('allows partial payloads when requireTitle is false', () => {
    const result = sanitizeObjectivePayload(
      {
        locationType: 'marker',
        locationMarkerId: '88888888-8888-4888-8888-888888888888',
      },
      {
        requireTitle: false,
        campaignId: '99999999-9999-4999-8999-999999999999',
      },
    );

    expect(result.title).toBeUndefined();
    expect(result.location).toEqual({
      type: 'marker',
      pin: null,
      burgId: null,
      markerId: '88888888-8888-4888-8888-888888888888',
    });
  });
});
