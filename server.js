// server.js – Node + Express + Socket.io backend (v2)
const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const MAX_TIME = 20; // sekund

// --- Data -----------------------------------------------------------------
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
const rooms = {};

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// --- Socket events --------------------------------------------------------
io.on("connection", (socket) => {
    socket.on("createRoom", ({ name }, cb) => {
        const roomId = generateRoomCode();
        rooms[roomId] = { players: [], current: 0, started: false, timer: null };
        const admin = { id: socket.id, name, score: 0, ready: false, admin: true };
        rooms[roomId].players.push(admin);
        socket.join(roomId);
        cb({ roomId, players: rooms[roomId].players });
    });

    socket.on("joinRoom", ({ roomId, name }, cb) => {
        const room = rooms[roomId];
        if (!room) return cb({ error: "Místnost neexistuje" });
        if (room.players.length >= 6) return cb({ error: "Místnost je plná" });
        const player = { id: socket.id, name, score: 0, ready: false, admin: false };
        room.players.push(player);
        socket.join(roomId);
        io.to(roomId).emit("playerList", room.players);
        cb({ roomId, players: room.players });
    });

    socket.on("playerReady", ({ roomId }) => {
        const player = rooms[roomId]?.players.find((p) => p.id === socket.id);
        if (player) player.ready = !player.ready;
        io.to(roomId).emit("playerList", rooms[roomId].players);
    });

    socket.on("startGame", ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.started) return;
        if (!room.players.every((p) => p.ready || p.admin)) return;
        room.started = true;
        sendQuestion(roomId);
    });

    socket.on("answer", ({ roomId, answer, timeLeft }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;
        player.selected = answer;          // umožní změnu odpovědi
        player.timeLeft = timeLeft;        // pro skóre
        if (!player.answered) player.answered = true;

        if (room.players.every((p) => p.answered)) {
            endRound(roomId);
        }
    });

    socket.on("disconnect", () => {
        for (const [rid, room] of Object.entries(rooms)) {
            room.players = room.players.filter((p) => p.id !== socket.id);
            if (room.players.length === 0) delete rooms[rid];
            else io.to(rid).emit("playerList", room.players);
        }
    });
});

// --- Herní logika ----------------------------------------------------------
function sendQuestion(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.current >= questions.length) return finishGame(roomId);

    const q = questions[room.current];
    room.players.forEach((p) => {
        p.answered = false;
        p.selected = null;
        p.timeLeft = 0;
    });

    io.to(roomId).emit("question", { index: room.current + 1, total: questions.length, q });

    let remaining = MAX_TIME;
    io.to(roomId).emit("timer", remaining);
    room.timer = setInterval(() => {
        remaining -= 1;
        io.to(roomId).emit("timer", remaining);
        if (remaining <= 0) endRound(roomId);
    }, 1000);
}

function endRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearInterval(room.timer);
    const q = questions[room.current];

    room.players.forEach((p) => {
        if (p.selected === q.correct) {
            p.score += 1000 + (p.timeLeft ?? 0) * 50;
        } else {
            p.score -= 200;
        }
    });

    io.to(roomId).emit("scores", room.players);
    room.current += 1;
    setTimeout(() => sendQuestion(roomId), 3000);
}

function finishGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    io.to(roomId).emit("gameOver", leaderboard);
}

// --- Statické soubory ------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
server.listen(PORT, () => console.log(`✅ Server běží na portu ${PORT}`));