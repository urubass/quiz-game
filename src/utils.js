// Utility helpers
const fs = require('fs');
const path = require('path');

const ADJACENCY = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../data/adjacency.json'),
    'utf8'
  )
);

function areAdjacent(r1, r2) {
  if (!r1 || !r2 || !ADJACENCY[r1] || !ADJACENCY[r2]) return false;
  return ADJACENCY[r1].includes(r2) || ADJACENCY[r2].includes(r1);
}

function serializeRoomState(room) {
  if (!room) return null;
  const players = Array.isArray(room.players) ? room.players : [];
  const territories = Array.isArray(room.territories) ? room.territories : [];
  const initialPlayerOrderSummary = Array.isArray(room.initialPlayerOrder)
    ? room.initialPlayerOrder.map(p => ({ id: p.id, name: p.name, initialOrder: p.initialOrder, team: p.team }))
    : [];
  return {
    roomId: room.id,
    phase: room.phase,
    turnCounter: room.turnCounter,
    activePlayerId: room.activePlayerId,
    activeTeam: room.activeTeam || null,
    turnIndex: room.turnIndex,
    lastResult: room.lastResult || null,
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
      team: p.team,
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
