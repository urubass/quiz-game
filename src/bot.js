const { io } = require('socket.io-client');
const { areAdjacent } = require('../server');

class Bot {
  constructor(name, serverUrl) {
    this.name = name || `Bot_${Math.floor(Math.random()*1000)}`;
    this.serverUrl = serverUrl || `http://localhost:${process.env.PORT || 3000}`;
    this.socket = io(this.serverUrl, { autoConnect: false });
    this.roomId = null;
    this.ready = false;

    this.socket.on('connect', () => {
      if (this.roomId) this._join();
    });

    this.socket.on('state', (state) => this.handleState(state));
    this.socket.on('question', (data) => this.answerQuestion(data));
  }

  joinRoom(roomId) {
    this.roomId = roomId;
    if (!this.socket.connected) this.socket.connect();
    else this._join();
  }

  _join() {
    this.socket.emit('join', { roomId: this.roomId, name: this.name }, () => {});
  }

  handleState(state) {
    const me = state.players.find(p => p.id === this.socket.id);
    if (state.phase === 'lobby' && me && !me.ready) {
      this.socket.emit('ready', { roomId: this.roomId });
    }

    if (state.phase === 'draft' && state.activePlayerId === this.socket.id) {
      this.makeDraftPick(state);
    }

    if (state.phase === 'turn-select-action' && state.activePlayerId === this.socket.id) {
      this.makeAction(state);
    }
  }

  answerQuestion(data) {
    if (!data || !data.q || !Array.isArray(data.q.choices)) return;
    const answer = Math.floor(Math.random() * data.q.choices.length);
    setTimeout(() => {
      this.socket.emit('submitAnswer', { roomId: this.roomId, answer });
    }, 300);
  }

  makeDraftPick(state) {
    const free = state.territories.filter(t => !t.owner);
    if (free.length > 0) {
      this.socket.emit('draftPick', { roomId: this.roomId, territoryId: free[0].id });
    }
  }

  makeAction(state) {
    const myId = this.socket.id;
    const myTerritories = state.territories.filter(t => t.owner === myId);
    if (myTerritories.length === 0) return;
    const from = myTerritories[0];

    const targets = state.territories.filter(t => t.id !== from.id && areAdjacent(from.id, t.id));
    const freeTarget = targets.find(t => !t.owner);
    const enemyTarget = targets.find(t => t.owner && t.owner !== myId);
    const target = freeTarget || enemyTarget;
    if (target) {
      this.socket.emit('selectAction', {
        roomId: this.roomId,
        fromTerritoryId: from.id,
        targetTerritoryId: target.id
      });
    }
  }
}

module.exports = Bot;
