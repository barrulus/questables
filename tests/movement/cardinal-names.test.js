import { cardinalGateName } from '../../server/services/movement/cardinal-names.js';

describe('cardinalGateName', () => {
  test.each([
    [0, 'North Gate'],
    [22.4, 'North Gate'],
    [22.5, 'Northeast Gate'],
    [45, 'Northeast Gate'],
    [90, 'East Gate'],
    [135, 'Southeast Gate'],
    [180, 'South Gate'],
    [225, 'Southwest Gate'],
    [270, 'West Gate'],
    [315, 'Northwest Gate'],
    [337.5, 'North Gate'],
    [359.9, 'North Gate'],
    [360, 'North Gate'],
    [-45, 'Northwest Gate'],
  ])('bearing %p → %p', (bearing, expected) => {
    expect(cardinalGateName(bearing)).toBe(expected);
  });
});
