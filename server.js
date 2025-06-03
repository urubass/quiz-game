const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const registerSocketHandlers = require('./src/socketHandlers');
const { areAdjacent } = require('./src/utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 25000
});

registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.url.includes('.') && !req.url.endsWith('.html')) {
    res.status(404).end();
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

if (require.main === module) {
  server.listen(PORT, () =>
    console.log(`Dobyvatel server running on http://localhost:${PORT}`)
  );

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    io.close(() => {
      console.log('Socket.IO server closed');
    });
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

module.exports = {
    areAdjacent,
    evaluateDraftOrder,
    advanceTurn,
    checkForVictory,
    rooms
};
