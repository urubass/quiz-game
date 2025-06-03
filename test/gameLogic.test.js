jest.mock('socket.io', () => {
  return {
    Server: jest.fn().mockImplementation(() => ({
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    }))
  };
});

const {
  evaluateDraftOrder,
  advanceTurn,
  checkForVictory,
  rooms
} = require('../server');

beforeEach(() => {
  jest.useFakeTimers();
  for (const key of Object.keys(rooms)) {
    delete rooms[key];
  }
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  for (const key of Object.keys(rooms)) {
    delete rooms[key];
  }
});

describe('evaluateDraftOrder', () => {
  test('orders players by correct answer then response time', () => {
    const roomId = 'room1';
    rooms[roomId] = {
      id: roomId,
      phase: 'draft-order-question',
      deck: [],
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' }
      ],
      answers: {
        p1: { answer: 0, timeReceived: 100 },
        p2: { answer: 1, timeReceived: 50 },
        p3: { answer: 0, timeReceived: 150 }
      },
      currentQuestion: { type: 'draft', correct: 0 }
    };

    evaluateDraftOrder(roomId);

    const order = rooms[roomId].players.map(p => p.id);
    expect(order).toEqual(['p1', 'p3', 'p2']);
    expect(rooms[roomId].phase).toBe('draft-order-evaluating');
  });
});

describe('advanceTurn', () => {
  test('skips disconnected players when advancing', () => {
    const roomId = 'room2';
    rooms[roomId] = {
      id: roomId,
      phase: 'turn-select-action',
      turnCounter: 0,
      turnIndex: 0,
      activePlayerId: 'a',
      players: [
        { id: 'a', name: 'A', territories: [] },
        { id: 'c', name: 'C', territories: [] }
      ],
      initialPlayerOrder: [
        { id: 'a', name: 'A', initialOrder: 0 },
        { id: 'b', name: 'B', initialOrder: 1 },
        { id: 'c', name: 'C', initialOrder: 2 }
      ],
      deck: []
    };

    advanceTurn(roomId);

    expect(rooms[roomId].activePlayerId).toBe('c');
    expect(rooms[roomId].turnIndex).toBe(2);
    expect(rooms[roomId].turnCounter).toBe(1);
  });
});

describe('checkForVictory', () => {
  test('detects total conquest', () => {
    const roomId = 'victory1';
    rooms[roomId] = {
      id: roomId,
      phase: 'turn-select-action',
      turnCounter: 2,
      territories: [
        { id: 'A', owner: 'p1' },
        { id: 'B', owner: 'p1' }
      ],
      players: [
        { id: 'p1', name: 'Player1', territories: ['A', 'B'] }
      ]
    };

    const result = checkForVictory(roomId);
    expect(result).toBe(true);
    expect(rooms[roomId].phase).toBe('finished');
  });

  test('returns false when no victory conditions met', () => {
    const roomId = 'novictory';
    rooms[roomId] = {
      id: roomId,
      phase: 'turn-select-action',
      turnCounter: 1,
      territories: [
        { id: 'A', owner: 'p1' },
        { id: 'B', owner: 'p2' }
      ],
      players: [
        { id: 'p1', name: 'P1', territories: ['A'] },
        { id: 'p2', name: 'P2', territories: ['B'] }
      ]
    };

    const result = checkForVictory(roomId);
    expect(result).toBe(false);
    expect(rooms[roomId].phase).not.toBe('finished');
  });
});
