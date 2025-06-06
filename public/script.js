const socket = io();

const { useState, useEffect } = React;

function Home({ onCreate, onJoin, myName, setMyName }) {
  const [code, setCode] = useState("");
  const [bots, setBots] = useState(0);
  const [error, setError] = useState("");
  return (
    React.createElement('div', { id: 'home-card', className: 'card' },
      React.createElement('h1', null, 'Dobyvatel \u010CR'),
      React.createElement('input', {
        id: 'name',
        className: 'input',
        placeholder: 'Tv\u00e9 jm\u00e9no',
        value: myName,
        onChange: e => { setMyName(e.target.value); localStorage.setItem('dobyvatel_playerName', e.target.value); }
      }),
      React.createElement('input', {
        id: 'bots',
        className: 'input',
        type: 'number',
        min: 0,
        max: 5,
        value: bots,
        onChange: e => setBots(e.target.value)
      }),
      React.createElement('button', {
        id: 'create',
        onClick: () => {
          if (!myName.trim()) { setError('Zadejte pros\u00edm jm\u00e9no.'); return; }
          setError('');
          onCreate(myName.trim(), parseInt(bots,10)||0, []);
        }
      }, 'Vytvo\u0159it hru'),
      React.createElement('input', {
        id: 'code',
        className: 'input',
        placeholder: 'K\u00f3d m\u00edstnosti (6 znak\u016f)',
        value: code,
        onChange: e => setCode(e.target.value.toUpperCase())
      }),
      React.createElement('button', {
        id: 'join',
        className: 'secondary',
        onClick: () => {
          if (!myName.trim() || code.length !== 6) { setError('Zadejte jm\u00e9no a platn\u00fd k\u00f3d.'); return; }
          setError('');
          onJoin(code, myName.trim());
        }
      }, 'P\u0159ipojit se ke h\u0159e'),
      React.createElement('p', { id: 'home-error', style: { color: 'red', marginTop: '1rem', minHeight: '1.2em' } }, error)
    )
  );
}

function Lobby({ roomId, players, onReady, onStart, myId }) {
  const allReady = players.length > 0 && players.every(p => p.ready);
  const isHost = players.length > 0 && players[0].id === myId;
  return (
    React.createElement('div', { id: 'lobby-card', className: 'card' },
      React.createElement('h2', null, 'M\u00edstnost: ', roomId),
      React.createElement('p', null, 'Sd\u00edlej k\u00f3d s p\u0159\u00e1teli.'),
      React.createElement('h3', null, 'Hr\u00e1\u010di:'),
      React.createElement('ul', { id: 'player-list' },
        players.map(p => React.createElement('li', { key: p.id },
          React.createElement('span', null, p.name, p.id === myId ? ' (Ty)' : ''),
          React.createElement('span', { className: 'ready-status' }, p.ready ? '\u2714' : '')
        ))
      ),
      React.createElement('button', { id: 'ready', onClick: onReady }, 'Jsem p\u0159ipraven'),
      React.createElement('button', { id: 'start', className: 'secondary', onClick: onStart, disabled: !(isHost && allReady) }, 'Start hry')
    )
  );
}

function GameBoard({ players, territories }) {
  return (
    React.createElement('div', { id: 'game-board' },
      React.createElement('div', { id: 'map-wrapper' },
        React.createElement('object', { id: 'map', type: 'image/svg+xml', data: 'map.svg' })
      ),
      React.createElement('div', { id: 'score-panel' },
        React.createElement('h3', null, 'Sk\u00f3re'),
        React.createElement('ul', null,
          players.map(p => {
            const cap = territories.find(t => t.id === p.capitalId);
            const lives = cap ? cap.lives : 0;
            return React.createElement('li', { key: p.id }, `${p.name}: ${p.score} ${p.capitalId ? '(' + p.capitalId + ' ' + lives + ')' : ''}`);
          })
        )
      )
    )
  );
}

function Overlay({ question, revealData, players, onAnswer }) {
  if (!question && !revealData) return null;
  const results = revealData;
  let fastestId = null;
  if (results && results.playerAnswers && results.correctIndex !== undefined) {
    const correctTimes = Object.entries(results.playerAnswers)
      .filter(([id, a]) => a.answer === results.correctIndex && typeof a.timeReceived === 'number')
      .map(([id, a]) => ({ id, time: a.timeReceived }));
    if (correctTimes.length) {
      correctTimes.sort((a, b) => a.time - b.time);
      fastestId = correctTimes[0].id;
    }
  }

  return (
    React.createElement('div', { className: 'modal', style: { display: 'flex' } },
      React.createElement('div', { className: 'modal-content' },
        question ? (
          React.createElement('div', { id: 'modal-question-area' },
            React.createElement('h2', null, 'Ot\u00e1zka'),
            React.createElement('div', { id: 'modal-question-text' }, question.text),
            React.createElement('div', { id: 'modal-answer-options' },
              question.choices.map((c, idx) =>
                React.createElement('button', {
                  key: idx,
                  className: 'answer-btn',
                  onClick: () => onAnswer(idx)
                }, c)
              )
            )
          )
        ) : (
          React.createElement('div', { id: 'reveal-results' },
            React.createElement('div', { className: 'result-text' }, results.resultText),
            React.createElement('ul', { className: 'player-result-list' },
              players.map(p => {
                const ans = results.playerAnswers ? results.playerAnswers[p.id] : null;
                const correct = ans && ans.answer === results.correctIndex;
                const time = ans && ans.timeReceived;
                const fastest = fastestId && fastestId === p.id && correct;
                const icon = ans ? (correct ? '\u2714' : '\u2716') : '\u23F3';
                const diff = fastestId && time && results.playerAnswers[fastestId]
                  ? time - results.playerAnswers[fastestId].timeReceived
                  : 0;
                return React.createElement('li', { key: p.id, className: 'player-result-item' + (fastest ? ' fastest' : '') },
                  React.createElement('span', { className: 'player-name' }, p.name),
                  React.createElement('span', {
                    className: 'result-icon ' + (correct ? 'correct' : (ans ? 'incorrect' : 'timeout'))
                  }, icon),
                  time ? React.createElement('span', { className: 'answer-time' },
                    fastest ? '\u272A ' : '',
                    diff ? `+${diff}ms` : (fastest ? '0ms' : '')
                  ) : null
                );
              })
            )
          )
        )
      )
    )
  );
}

function App() {
  const [state, setState] = useState({
    view: 'home',
    roomId: '',
    myId: '',
    myName: localStorage.getItem('dobyvatel_playerName') || '',
    players: [],
    territories: [],
    question: null,
    revealData: null,
    phase: 'lobby'
  });

  useEffect(() => {
    socket.on('connect', () => {
      setState(s => ({ ...s, myId: socket.id }));
    });
    socket.on('players', players => {
      setState(s => ({ ...s, players }));
    });
    socket.on('state', newState => {
      setState(s => ({
        ...s,
        ...newState,
        view: newState.phase === 'lobby' ? 'lobby' : 'game'
      }));
    });
    socket.on('question', ({ q }) => {
      setState(s => ({ ...s, question: q, revealData: null }));
    });
    socket.on('reveal', data => {
      setState(s => ({ ...s, question: null, revealData: data }));
    });
    socket.on('gameOver', ({ reason, players }) => {
      setState(s => ({ ...s, phase: 'finished', revealData: { resultText: reason }, players }));
    });
  }, []);

  const onCreate = (name, bots, categories) => {
    socket.emit('create', { name, bots, categories }, handleRoomResponse);
  };
  const onJoin = (code, name) => {
    socket.emit('join', { roomId: code, name }, handleRoomResponse);
  };
  const handleRoomResponse = res => {
    if (res.error) {
      alert(res.error);
    } else {
      setState(s => ({ ...s, roomId: res.roomId, players: res.players, view: 'lobby' }));
    }
  };
  const onReady = () => socket.emit('ready', { roomId: state.roomId });
  const onStart = () => socket.emit('start', { roomId: state.roomId });
  const onAnswer = idx => socket.emit('submitAnswer', { roomId: state.roomId, answer: idx });

  let content;
  if (state.view === 'home') {
    content = React.createElement(Home, {
      onCreate,
      onJoin,
      myName: state.myName,
      setMyName: name => setState(s => ({ ...s, myName: name }))
    });
  } else if (state.view === 'lobby') {
    content = React.createElement(Lobby, {
      roomId: state.roomId,
      players: state.players,
      onReady,
      onStart,
      myId: state.myId
    });
  } else {
    content = React.createElement(GameBoard, { players: state.players, territories: state.territories || [] });
  }

  return React.createElement(React.Fragment, null,
    content,
    React.createElement(Overlay, { question: state.question, revealData: state.revealData, players: state.players, onAnswer })
  );
}

ReactDOM.render(React.createElement(App), document.getElementById('root'));

