const { areAdjacent } = require('../src/utils');

describe('areAdjacent', () => {
  test('reports adjacency for neighboring regions', () => {
    expect(areAdjacent('PHA', 'STC')).toBe(true);
    expect(areAdjacent('STC', 'HKK')).toBe(true);
    expect(areAdjacent('OLK', 'MSK')).toBe(true);
  });

  test('rejects non-adjacent regions', () => {
    expect(areAdjacent('PHA', 'ULK')).toBe(false);
    expect(areAdjacent('JHC', 'MSK')).toBe(false);
    expect(areAdjacent('LBK', 'JHM')).toBe(false);
  });
});
