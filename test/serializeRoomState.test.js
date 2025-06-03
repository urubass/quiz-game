const { serializeRoomState } = require('../src/utils');

describe('serializeRoomState', () => {
  test('serializes a full room object and strips extra fields', () => {
    const room = {
      id: 'XYZ789',
      phase: 'attack',
      turnCounter: 2,
      activePlayerId: 'a1',
      turnIndex: 0,
      lastResult: 'some result',
      players: [
        { id: 'a1', name: 'Alice', score: 3, territories: ['PHA'], extra: 'x' },
        { id: 'b2', name: 'Bob', score: 0, territories: [] }
      ],
      initialPlayerOrder: [
        { id: 'a1', name: 'Alice', initialOrder: 0, ignore: true },
        { id: 'b2', name: 'Bob', initialOrder: 1 }
      ],
      territories: [
        { id: 'PHA', owner: 'a1', foo: 'bar' },
        { id: 'STC', owner: null }
      ],
      turnData: {
        type: 'attack',
        targetTerritoryId: 'STC',
        attackerId: 'a1',
        defenderId: 'b2',
        playerId: 'a1',
        extra: 'y'
      },
      questionTimer: 123
    };

    const state = serializeRoomState(room);
    expect(state).toEqual({
      roomId: 'XYZ789',
      phase: 'attack',
      turnCounter: 2,
      activePlayerId: 'a1',
      activeTeam: null,
      turnIndex: 0,
      lastResult: 'some result',
      players: [
        { id: 'a1', name: 'Alice', score: 3, team: undefined, territories: ['PHA'] },
        { id: 'b2', name: 'Bob', score: 0, team: undefined, territories: [] }
      ],
      initialPlayerOrder: [
        { id: 'a1', name: 'Alice', initialOrder: 0, team: undefined },
        { id: 'b2', name: 'Bob', initialOrder: 1, team: undefined }
      ],
      territories: [
        { id: 'PHA', owner: 'a1' },
        { id: 'STC', owner: null }
      ],
      turnData: {
        type: 'attack',
        targetTerritoryId: 'STC',
        attackerId: 'a1',
        defenderId: 'b2',
        playerId: 'a1'
      }
    });
  });

  test('handles missing arrays and null room', () => {
    expect(serializeRoomState(null)).toBeNull();

    const minimal = {
      id: 'NO1',
      phase: 'prep',
      turnCounter: 0,
      activePlayerId: null,
      turnIndex: 0,
      lastResult: null,
      players: null,
      initialPlayerOrder: null,
      territories: null,
      turnData: null
    };

    expect(serializeRoomState(minimal)).toEqual({
      roomId: 'NO1',
      phase: 'prep',
      turnCounter: 0,
      activePlayerId: null,
      activeTeam: null,
      turnIndex: 0,
      lastResult: null,
      players: [],
      initialPlayerOrder: [],
      territories: [],
      turnData: null
    });
  });
});
