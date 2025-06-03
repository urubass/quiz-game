const { areAdjacent } = require('../src/utils');

function makeId() {
  return 'bot-' + Math.random().toString(36).slice(2, 9);
}

function createBot(name = 'Bot') {
  return {
    id: makeId(),
    name,
    score: 0,
    ready: true,
    territories: [],
    isBot: true,
    initialOrder: 0,
    spectator: false
  };
}

function chooseRandomAnswer(question) {
  const len = question?.choices?.length || 0;
  return Math.floor(Math.random() * len);
}

function chooseDraftPick(room, bot) {
  if (!room || !bot) return null;
  const free = room.territories.filter(t => !t.owner);
  if (free.length === 0) return null;

  if (
    room.draftData &&
    room.draftData.firstPickTerritoryId &&
    room.draftData.index === 0 &&
    room.draftData.picksRemainingForPlayer === 1
  ) {
    const adjFree = free.filter(t =>
      areAdjacent(room.draftData.firstPickTerritoryId, t.id)
    );
    if (adjFree.length > 0) {
      return adjFree[Math.floor(Math.random() * adjFree.length)].id;
    }
  }

  return free[Math.floor(Math.random() * free.length)].id;
}

function chooseAction(room, bot) {
  if (!room || !bot) return null;
  const options = [];
  for (const tid of bot.territories || []) {
    const neighbors = room.territories.filter(
      t => areAdjacent(tid, t.id) && t.owner !== bot.id
    );
    neighbors.forEach(n => options.push({ from: tid, target: n.id }));
  }
  if (options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { createBot, chooseRandomAnswer, chooseDraftPick, chooseAction };
