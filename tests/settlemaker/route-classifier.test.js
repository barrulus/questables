import { classifyRouteKind } from '../../server/services/settlemaker/route-classifier.js';

describe('classifyRouteKind', () => {
  test.each([
    ['searoute', 'sea'],
    ['sea', 'sea'],
    ['ship', 'sea'],
    ['trail', 'foot'],
    ['footpath', 'foot'],
    ['road', 'road'],
    ['highway', 'road'],
    ['', 'road'],
    [null, 'road'],
    [undefined, 'road'],
  ])('classifies type %p as %p', (input, expected) => {
    expect(classifyRouteKind(input)).toBe(expected);
  });
});
