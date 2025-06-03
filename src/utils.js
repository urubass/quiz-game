// Utility helpers
const ADJACENCY = {
  "PHA": ["STC"],
  "STC": ["PHA", "JHC", "PLK", "KVK", "ULK", "LBK", "HKK", "PAK", "VYS"],
  "JHC": ["STC", "PLK", "VYS", "JHM"],
  "PLK": ["STC", "JHC", "KVK", "ULK"],
  "KVK": ["STC", "PLK", "ULK"],
  "ULK": ["STC", "PLK", "KVK", "LBK"],
  "LBK": ["STC", "ULK", "HKK"],
  "HKK": ["STC", "LBK", "PAK", "OLK"],
  "PAK": ["STC", "HKK", "OLK", "VYS", "JHM"],
  "VYS": ["STC", "JHC", "PAK", "JHM", "ZLK", "OLK"],
  "JHM": ["JHC", "PAK", "VYS", "ZLK"],
  "ZLK": ["VYS", "JHM", "OLK", "MSK"],
  "OLK": ["HKK", "PAK", "VYS", "ZLK", "MSK"],
  "MSK": ["OLK", "ZLK"]
};

function areAdjacent(r1, r2) {
  if (!r1 || !r2 || !ADJACENCY[r1] || !ADJACENCY[r2]) return false;
  return ADJACENCY[r1].includes(r2) || ADJACENCY[r2].includes(r1);
}

function serializeRoomState(room) {
  if (!room) return null;
  const players = Array.isArray(room.players) ? room.players : [];
  const territories = Array.isArray(room.territories) ? room.territories : [];
  const initialPlayerOrderSummary = Array.isArray(room.initialPlayerOrder)
    ? room.initialPlayerOrder.map(p => ({ id: p.id, name: p.name, initialOrder: p.initialOrder }))
    : [];
  return {
    roomId: room.id,
    phase: room.phase,
    turnCounter: room.turnCounter,
    activePlayerId: room.activePlayerId,
    turnIndex: room.turnIndex,
    lastResult: room.lastResult || null,
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
      territories: Array.isArray(p.territories) ? p.territories : []
    })),
    initialPlayerOrder: initialPlayerOrderSummary,
    territories: territories.map(t => ({ id: t.id, owner: t.owner })),
    turnData: room.turnData ? {
      type: room.turnData.type,
      targetTerritoryId: room.turnData.targetTerritoryId,
      attackerId: room.turnData.attackerId,
      defenderId: room.turnData.defenderId,
      playerId: room.turnData.playerId
    } : null
  };
}

module.exports = { ADJACENCY, areAdjacent, serializeRoomState };
