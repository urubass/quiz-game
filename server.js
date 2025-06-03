const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const registerSocketHandlers = require('./src/socketHandlers');
const { areAdjacent } = require('./src/utils');

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' },
    pingTimeout: 10000,
    pingInterval: 25000
  });

  registerSocketHandlers(io);

  app.get('/scores', (req, res) => {
    const file = path.join(__dirname, 'scores.json');
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') return res.json([]);
        console.error('Error reading scores file:', err);
        return res.status(500).json({ error: 'Unable to read scores' });
      }
      try {
        const scores = JSON.parse(data || '[]');
        res.json(scores);
      } catch (e) {
        console.error('Error parsing scores file:', e);
        res.status(500).json({ error: 'Unable to read scores' });
      }
    });
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('*', (req, res) => {
    if (req.url.includes('.') && !req.url.endsWith('.html')) {
      res.status(404).end();
    } else {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  return { app, server, io };
}

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const { server, io } = createServer();
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

module.exports = { createServer, areAdjacent };
