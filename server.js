const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    // Increase ping timeout and interval for potentially less stable connections
    pingTimeout: 10000, // Default 5000
    pingInterval: 25000 // Default 25000
});
const PORT = process.env.PORT || 3000;

/* === CONSTANTS ========================================================= */
const PREP_TIME = 3; // Increased slightly
const ANSWER_TIME = 15; // Increased slightly
const REVEAL_TIME = 5; // Increased slightly
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const DRAFT_WINNER_PICKS = 2;
const DRAFT_OTHERS_PICKS = 1;
const MAX_TURNS = 50;
const FIRST_PICK_BONUS = 100; // Bonus score for first territory claimed in draft

// Region IDs
const REGIONS = ["PHA", "STC", "JHC", "PLK", "KVK", "ULK", "LBK", "HKK", "PAK", "OLK", "MSK", "JHM", "ZLK", "VYS"];
// Adjacency list for server-side validation
const ADJACENCY = { "PHA": ["STC"], "STC": ["PHA", "JHC", "PLK", "KVK", "ULK", "LBK", "HKK", "PAK", "VYS"], "JHC": ["STC", "PLK", "VYS", "JHM"], "PLK": ["STC", "JHC", "KVK", "ULK"], "KVK": ["STC", "PLK", "ULK"], "ULK": ["STC", "PLK", "KVK", "LBK"], "LBK": ["STC", "ULK", "HKK"], "HKK": ["STC", "LBK", "PAK", "OLK"], "PAK": ["STC", "HKK", "OLK", "VYS", "JHM"], "VYS": ["STC", "JHC", "PAK", "JHM", "ZLK", "OLK"], "JHM": ["JHC", "PAK", "VYS", "ZLK"], "ZLK": ["VYS", "JHM", "OLK", "MSK"], "OLK": ["HKK", "PAK", "VYS", "ZLK", "MSK"], "MSK": ["OLK", "ZLK"] };
function areAdjacent(r1, r2) {
    if (!r1 || !r2 || !ADJACENCY[r1] || !ADJACENCY[r2]) return false; // Basic validation
    return ADJACENCY[r1].includes(r2) || ADJACENCY[r2].includes(r1);
}

/* === DATA ============================================================== */
let questions = [];
try {
    const questionsPath = path.join(__dirname, "questions.json");
    if (fs.existsSync(questionsPath)) {
        questions = JSON.parse(fs.readFileSync(questionsPath, "utf8"));
        console.log(`Loaded ${questions.length} questions.`);
        if (questions.length === 0) { console.error("Warning: questions.json is empty."); }
    } else {
        console.error("Error: questions.json not found at", questionsPath);
        questions = []; // Ensure questions is an empty array if file missing
    }
}
catch (err) {
    console.error("Error loading or parsing questions.json:", err);
    questions = []; // Ensure questions is an empty array on error
}

const shuffle = (a) => { const n = [...a]; for (let i = n.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [n[i], n[j]] = [n[j], n[i]]; } return n; };
const rooms = {}; // In-memory store for rooms

// Function to generate a unique room ID
function generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Avoid confusing chars (I, O, 0, 1)
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure uniqueness
    return rooms[result] ? generateRoomId() : result;
}

// Helper function to get a player object from a room
function getPlayer(room, playerId) {
    if (!room || !Array.isArray(room.players)) return null;
    return room.players.find(p => p.id === playerId);
}

// Helper to remove the 'correct' answer before sending to clients
function sanitizeQuestion(q) {
    if (!q) return null;
    const { correct, ...rest } = q; // Use object destructuring to omit 'correct'
    return rest;
}
// Spectator version might be the same if we decide spectators see choices but not the answer hint
function sanitizeQuestionForSpectator(q) {
    return sanitizeQuestion(q); // Currently same as normal sanitize
}

/* === SOCKET LOGIC ====================================================== */
io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("create", ({ name }, callback) => {
        // Input validation
        if (typeof name !== 'string' || name.trim().length === 0 || name.length > 20) {
            return callback({ error: "Neplatné jméno (max 20 znaků)." });
        }

        try {
            const roomId = generateRoomId();
            const hostPlayer = {
                id: socket.id,
                name: name.trim() || `Hráč_${socket.id.substring(0, 4)}`,
                score: 0,
                ready: false, // Host isn't ready by default
                territories: [],
                initialOrder: 0 // Host is initially first in list
            };
            rooms[roomId] = {
                id: roomId,
                players: [hostPlayer],
                hostId: socket.id,
                phase: "lobby", // Initial phase
                turnCounter: 0,
                deck: [], // Will be filled on game start
                currentQuestion: null,
                answers: {}, // { playerId: { answer: index, timeReceived: timestamp } }
                territories: [], // Will be filled on game start
                draftData: null, // { index, picksMadeTotal, picksRemainingForPlayer, rankedPlayers[], firstPickTerritoryId }
                turnData: null, // { type, playerId?, attackerId?, defenderId?, fromTerritoryId?, targetTerritoryId }
                activePlayerId: null,
                turnIndex: 0, // Index into initialPlayerOrder
                lastResult: null, // String description of last event
                prepTimer: null, // Timeout IDs for clearing
                questionTimer: null,
                revealTimer: null,
                initialPlayerOrder: [] // Array of { id, name, initialOrder } - set on game start
            };
            socket.join(roomId);
            console.log(`[${roomId}] Room created by ${hostPlayer.name} (${socket.id})`);
            // Send back the necessary info
            callback({ roomId, players: rooms[roomId].players });
        } catch (error) {
            console.error("Error creating room:", error);
            callback({ error: "Nepodařilo se vytvořit místnost. Zkuste to prosím znovu." });
        }
    });

    socket.on("join", ({ roomId, name }, callback) => {
        // Input validation
        if (typeof roomId !== 'string' || roomId.length !== 6) {
            return callback({ error: "Neplatný kód místnosti." });
        }
        if (typeof name !== 'string' || name.trim().length === 0 || name.length > 20) {
            return callback({ error: "Neplatné jméno (max 20 znaků)." });
        }

        const room = rooms[roomId];
        const trimmedName = name.trim();

        if (!room) {
            return callback({ error: "Místnost nenalezena." });
        }

        // --- Reconnection Logic ---
        // Try to find if a player with the same name exists and might be reconnecting
        const potentialReconnectPlayer = room.players.find(p => p.name === trimmedName);
        // Check if this socket ID is already in the room (e.g., rapid refresh)
        const alreadyJoined = room.players.find(p => p.id === socket.id);

        if (alreadyJoined) {
            console.log(`[${roomId}] Player ${alreadyJoined.name} (${socket.id}) already in room.`);
            socket.join(roomId); // Ensure they are in the socket.io room
            // Send full state in case they missed updates
            socket.emit("state", serializeRoomState(room));
            return callback({ roomId, players: room.players });
        }

        if (potentialReconnectPlayer && room.phase !== 'lobby' && room.phase !== 'finished') {
            // Found a player with the same name, game in progress - likely a reconnect
            console.log(`[${roomId}] Player ${trimmedName} (${socket.id}) attempting to reconnect. Assigning old player data.`);
            const oldSocketId = potentialReconnectPlayer.id;
            potentialReconnectPlayer.id = socket.id; // Update the player's socket ID
            socket.join(roomId);

            // Notify others about the potential ID change (though name stays the same)
            io.to(roomId).emit("players", room.players); // Send updated player list (with new ID)
            // Send the full current game state to the reconnected player
            socket.emit("state", serializeRoomState(room));
            console.log(`[${roomId}] Reconnection successful for ${trimmedName}. Old ID: ${oldSocketId}, New ID: ${socket.id}`);
            return callback({ roomId, players: room.players }); // Confirm join/reconnect
        }
        // --- End Reconnection Logic ---


        // Standard join logic
        if (room.phase !== "lobby") {
            return callback({ error: "Hra již probíhá." });
        }
        if (room.players.length >= MAX_PLAYERS) {
            return callback({ error: "Místnost je plná." });
        }
        // Check if name is already taken by a *different* player ID in the lobby
        if (room.players.some(p => p.name === trimmedName)) {
            return callback({ error: "Hráč s tímto jménem již v lobby existuje." });
        }

        try {
            const newPlayer = {
                id: socket.id,
                name: trimmedName || `Hráč_${socket.id.substring(0, 4)}`,
                score: 0,
                ready: false,
                territories: [],
                initialOrder: room.players.length // Order based on join sequence initially
            };
            room.players.push(newPlayer);
            socket.join(roomId);
            console.log(`[${roomId}] ${newPlayer.name} (${socket.id}) joined room.`);
            // Emit updated player list to everyone in the room
            io.to(roomId).emit("players", room.players);
            callback({ roomId, players: room.players }); // Confirm join
        } catch (error) {
            console.error(`[${roomId}] Error adding player ${trimmedName}:`, error);
            callback({ error: "Nepodařilo se připojit k místnosti." });
        }
    });

    socket.on("ready", ({ roomId }) => {
        const room = rooms[roomId];
        const player = getPlayer(room, socket.id);

        if (player && room?.phase === 'lobby') {
            player.ready = !player.ready; // Toggle readiness
            console.log(`[${roomId}] Player ${player.name} (${socket.id}) readiness toggled to: ${player.ready}`);
            // Notify everyone in the room about the change in player readiness
            io.to(roomId).emit("players", room.players);
            console.log(`[${roomId}] Emitted updated players list after ready toggle.`);

            // Optional: Check if game can now start and notify host (client-side handles button enable)
            const canStart = room.players.length >= MIN_PLAYERS && room.players.every(p => p.ready);
            if (canStart && room.hostId) {
                // Maybe emit a specific event to the host? Or rely on client logic.
                // io.to(room.hostId).emit("canStart", true);
            }

        } else if (!player) {
            console.log(`[${roomId}] Invalid ready request: Player ${socket.id} not found.`);
            socket.emit("errorMsg", "Chyba: Hráč nenalezen.");
        } else if (room?.phase !== 'lobby') {
            console.log(`[${roomId}] Invalid ready request: Phase is not lobby (${room.phase})`);
            // Optionally inform the player, though UI should prevent this
            // socket.emit("errorMsg", "Nelze měnit připravenost mimo lobby.");
        }
    });

    socket.on("start", ({ roomId }) => {
        const room = rooms[roomId];
        // Validate request
        if (!room) return socket.emit("errorMsg", "Místnost nenalezena.");
        if (room.hostId !== socket.id) return socket.emit("errorMsg", "Hru může spustit pouze host.");
        if (room.phase !== 'lobby') return socket.emit("errorMsg", "Hru lze spustit pouze z lobby.");
        if (room.players.length < MIN_PLAYERS) return socket.emit("errorMsg", `Potřeba alespoň ${MIN_PLAYERS} hráči.`);
        if (!room.players.every(p => p.ready)) return socket.emit("errorMsg", "Všichni hráči musí být připraveni.");
        if (questions.length === 0) return socket.emit("errorMsg", "Chyba: Nebyly nalezeny žádné otázky pro hru.");

        console.log(`[${roomId}] Host ${socket.id} starting game...`);
        try {
            initializeGame(roomId); // Sets up deck, territories, player order, etc.
            sendDraftOrderQuestion(roomId); // Start the first step: draft question
        } catch (error) {
            console.error(`[${roomId}] Error starting game:`, error);
            io.to(roomId).emit("errorMsg", "Nastala chyba při startu hry.");
            // Reset room to lobby?
            room.phase = "lobby";
            room.players.forEach(p => p.ready = false);
            io.to(roomId).emit("players", room.players); // Send reset player list
        }
    });

    socket.on("draftPick", ({ roomId, territoryId }) => handleDraftPick(socket, roomId, territoryId));
    socket.on("selectAction", ({ roomId, fromTerritoryId, targetTerritoryId }) => handleSelectAction(socket, roomId, fromTerritoryId, targetTerritoryId));
    socket.on("submitAnswer", ({ roomId, answer }) => handleAnswer(socket, roomId, answer));
    socket.on("disconnect", (reason) => handleDisconnect(socket, reason));
    socket.on("error", (err) => {
        console.error(`Socket error for ${socket.id}:`, err.message);
        // Attempt to find which room the socket was in, if any
        let roomIdWithError = null;
        for (const rId in rooms) {
            if (getPlayer(rooms[rId], socket.id)) {
                roomIdWithError = rId;
                break;
            }
        }
        console.error(`   Error details:`, err);
        // Inform the client about the generic error
        socket.emit("errorMsg", `Nastala chyba spojení: ${err.message}`);
        // Optionally, inform the room if the error seems critical?
        // if (roomIdWithError) io.to(roomIdWithError).emit("errorMsg", `Hráč ${getPlayer(rooms[roomIdWithError], socket.id)?.name} narazil na chybu.`);
    });
});

/* === GAME FLOW FUNCTIONS ============================================== */

function handleDisconnect(socket, reason) {
    console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
    let roomIdFound = null;
    const disconnectedPlayerId = socket.id;

    // Find the room the disconnected socket belonged to
    for (const rId in rooms) {
        const room = rooms[rId];
        const playerIndex = room.players.findIndex(p => p.id === disconnectedPlayerId);

        if (playerIndex !== -1) {
            roomIdFound = rId;
            const disconnectedPlayer = room.players[playerIndex];
            console.log(`[${rId}] Player ${disconnectedPlayer.name} (${disconnectedPlayerId}) disconnected/left.`);

            // --- Immediate Player Removal ---
            room.players.splice(playerIndex, 1);

            // --- Remove from Initial Order & Adjust Turn Index ---
            let turnIndexAdjusted = false;
            const initialOrderIndex = room.initialPlayerOrder.findIndex(p => p.id === disconnectedPlayerId);
            if (initialOrderIndex !== -1) {
                room.initialPlayerOrder.splice(initialOrderIndex, 1);
                console.log(`[${rId}] Removed ${disconnectedPlayer.name} from initialPlayerOrder.`);
                // If the disconnected player was *before* the current turn index in the original order,
                // we need to decrement the index to keep pointing at the same *next* player.
                if (initialOrderIndex < room.turnIndex) {
                    room.turnIndex--;
                    turnIndexAdjusted = true;
                    console.log(`[${rId}] Decremented turnIndex to ${room.turnIndex} due to disconnect before current index.`);
                }
                // Ensure turn index wraps around correctly after removal, only if not adjusted already
                if (room.initialPlayerOrder.length > 0 && !turnIndexAdjusted) {
                    room.turnIndex %= room.initialPlayerOrder.length;
                } else if (room.initialPlayerOrder.length === 0) {
                    room.turnIndex = 0; // Reset if no players left in order
                }
                console.log(`[${rId}] Final turnIndex after disconnect adjustment: ${room.turnIndex}`);
            }


            // --- Game State Handling (Post-Removal) ---
            if (room.phase !== 'lobby' && room.phase !== 'finished') {
                console.log(`[${rId}] Handling disconnect during game phase: ${room.phase}`);

                // Release Territories
                let releasedCount = 0;
                room.territories?.forEach(t => {
                    if (t.owner === disconnectedPlayerId) { t.owner = null; releasedCount++; }
                });
                if (releasedCount > 0) console.log(`[${rId}] Released ${releasedCount} territories owned by ${disconnectedPlayer.name}.`);

                // Check if Game Ends due to Insufficient Players
                if (room.players.length < MIN_PLAYERS) {
                    console.log(`[${rId}] Not enough players left (${room.players.length}), ending game.`);
                    endGame(rId, `Nedostatek hráčů (${disconnectedPlayer.name} opustil hru).`);
                    // endGame handles cleanup and state emission, so break early
                    break;
                }

                // Handle Active Player Disconnect
                let needsStateUpdate = true; // Assume state needs update unless handled by sub-function
                if (room.activePlayerId === disconnectedPlayerId) {
                    console.log(`[${rId}] Active player ${disconnectedPlayer.name} disconnected.`);
                    clearRoomTimers(room); // Stop any pending actions for this player

                    if (room.phase === 'draft' && room.draftData) {
                        console.log(`[${rId}] Active player disconnected during draft. Setting next picker.`);
                        needsStateUpdate = false; // setNextDraftPicker handles state update
                        setNextDraftPicker(rId); // Move to next picker or end draft
                    }
                    // Handle disconnect during question/prep phases
                    else if (room.phase.endsWith('-question') || room.phase.endsWith('-prep')) {
                        console.log(`[${rId}] Active player disconnected during question/prep. Advancing turn.`);
                        needsStateUpdate = false; // advanceTurn handles state update
                        // Treat it like the player failed the action or timed out
                        if (room.phase === 'claim-question' || room.phase === 'claim-prep') {
                            // Pretend the claim failed
                            room.lastResult = `${disconnectedPlayer.name} opustil hru během obsazování.`;
                            advanceTurn(rId, true); // Force advance, don't re-evaluate
                        } else if (room.phase === 'duel-question' || room.phase === 'duel-prep') {
                            // Pretend the duel was lost by the disconnected player
                            const wasAttacker = room.turnData?.attackerId === disconnectedPlayerId;
                            const remainingPlayerId = wasAttacker ? room.turnData?.defenderId : room.turnData?.attackerId;
                            const remainingPlayer = getPlayer(room, remainingPlayerId);
                            if (remainingPlayer) {
                                room.lastResult = `${disconnectedPlayer.name} opustil hru během duelu. ${remainingPlayer.name} ${wasAttacker ? 'ubránil území' : 'získal území'}.`;
                                if (!wasAttacker && room.turnData?.targetTerritoryId) { // Defender disconnected, attacker wins territory
                                    const terr = room.territories.find(t=> t.id === room.turnData.targetTerritoryId);
                                    if(terr && remainingPlayerId) terr.owner = remainingPlayerId;
                                    if(remainingPlayer) {
                                        if (!Array.isArray(remainingPlayer.territories)) remainingPlayer.territories = [];
                                        if(!remainingPlayer.territories.includes(terr.id)) remainingPlayer.territories.push(terr.id);
                                    }
                                }
                            } else {
                                room.lastResult = `${disconnectedPlayer.name} opustil hru během duelu.`;
                            }
                            advanceTurn(rId, true); // Force advance
                        } else {
                            // Generic case or draft order question
                            advanceTurn(rId, true);
                        }
                    }
                    else if (room.phase === 'turn-select-action') {
                        console.log(`[${rId}] Active player disconnected during action selection. Advancing turn.`);
                        needsStateUpdate = false; // advanceTurn handles state update
                        advanceTurn(rId, true); // Force advance turn
                    }
                    // Other phases where active player matters? Results? Should transition quickly anyway.
                }
                // Handle Non-Active Player Disconnect
                else {
                    if (room.phase === 'draft' && room.draftData?.rankedPlayers) {
                        // Remove player from the ranked list if they were still waiting
                        const rankIdx = room.draftData.rankedPlayers.indexOf(disconnectedPlayerId);
                        if (rankIdx > -1) {
                            room.draftData.rankedPlayers.splice(rankIdx, 1);
                            console.log(`[${rId}] Removed non-active ${disconnectedPlayer.name} from draft ranking.`);
                            // Adjust draft index if the removed player was before the current index
                            if (rankIdx < room.draftData.index) {
                                room.draftData.index--;
                                console.log(`[${rId}] Decremented draft index to ${room.draftData.index}.`);
                            }
                        }
                        needsStateUpdate = true; // Need to update state with new ranking potentially
                    } else if (room.phase === 'duel-question' && room.turnData && (room.turnData.attackerId === disconnectedPlayerId || room.turnData.defenderId === disconnectedPlayerId)) {
                        // A non-active player involved in a duel disconnected. The active player might still be evaluating.
                        // Let the duel evaluation handle the missing answer. The player is already removed from room.players.
                        console.log(`[${rId}] Non-active player ${disconnectedPlayer.name} involved in duel disconnected. Evaluation will proceed.`);
                        needsStateUpdate = true; // Ensure state update reflects removed player
                    }
                    // For most other phases, disconnect of non-active player just requires updating the player list.
                    else {
                        needsStateUpdate = true;
                    }
                }

                // Send State Update if Necessary
                if (needsStateUpdate && room.phase !== 'finished') { // Don't update if game just ended
                    console.log(`[${rId}] Sending state update after player disconnect (Phase: ${room.phase}).`);
                    io.to(rId).emit("state", serializeRoomState(room));
                }

            } else if (room.phase === 'lobby') {
                // If in lobby, just update the player list for everyone
                io.to(rId).emit("players", room.players);
            }

            // Assign New Host if Host Disconnected
            if (room.hostId === disconnectedPlayerId && room.players.length > 0) {
                room.hostId = room.players[0].id; // Assign to the next player in the list
                console.log(`[${rId}] Host disconnected. New host assigned: ${room.players[0].name} (${room.hostId})`);
                // Notify players about the new host (client updates based on first player in list)
                if (room.phase === 'lobby') { io.to(rId).emit("players", room.players); }
                else if (room.phase !== 'finished') { io.to(rId).emit("state", serializeRoomState(room)); }
            }

            // Clean Up Room if Empty
            if (room.players.length === 0) {
                console.log(`[${rId}] Room is now empty. Deleting room.`);
                clearRoomTimers(room); // Clear any remaining timers
                delete rooms[rId];
            }

            break; // Found the room and handled disconnect, exit loop
        }
    }

    if (!roomIdFound) {
        console.log(`Disconnected socket ${disconnectedPlayerId} not found in any active room.`);
    }
}


function initializeGame(roomId) {
    const room = rooms[roomId];
    if (!room) {
        console.error(`[${roomId}] Cannot initialize game: Room not found.`);
        return;
    }
    if (!questions || questions.length < room.players.length + MAX_TURNS) { // Basic check for sufficient questions
        console.error(`[${roomId}] Cannot initialize game: Insufficient questions loaded (${questions.length}).`);
        endGame(roomId, "Nedostatek otázek pro hru."); // End game immediately
        return;
    }

    console.log(`[${roomId}] Initializing game state...`);
    room.phase = "initializing";
    room.deck = shuffle([...questions]); // Create a shuffled deck for this game
    room.turnCounter = 0;
    room.currentQuestion = null;
    room.answers = {};
    room.turnData = null;
    room.activePlayerId = null;
    room.turnIndex = 0;
    room.lastResult = null;
    clearRoomTimers(room); // Clear any leftover timers

    // Initialize territories
    room.territories = REGIONS.map(id => ({ id, owner: null }));

    // Reset players and determine initial order *before* draft question
    room.players.forEach((p, index) => {
        p.score = 0;
        p.territories = [];
        p.ready = false; // Reset ready status
        p.initialOrder = index; // Store the order *as they are now* before draft sorting
    });
    // Create the definitive initialPlayerOrder list based on current player order
    room.initialPlayerOrder = room.players.map(p => ({ id: p.id, name: p.name, initialOrder: p.initialOrder }));
    console.log(`[${roomId}] Initial player order (for turns): ${room.initialPlayerOrder.map(p=>p.name).join(', ')}`);

    // Game is initialized, ready for the draft order question
    console.log(`[${roomId}] Game initialized. Deck size: ${room.deck.length}`);
}

function sendDraftOrderQuestion(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.deck || room.deck.length === 0) {
        console.error(`[${roomId}] Error: Cannot send draft question, deck is empty or missing.`);
        return endGame(roomId, "Chyba: Nedostatek otázek pro určení pořadí.");
    }

    console.log(`[${roomId}] Preparing draft order question.`);
    room.phase = "draft-order-question";
    const question = room.deck.pop();
    if (!question || typeof question.correct === 'undefined') {
        console.error(`[${roomId}] Error: Popped invalid question from deck:`, question);
        return endGame(roomId, "Chyba: Neplatná otázka pro určení pořadí.");
    }
    room.currentQuestion = { ...question, type: 'draft' }; // Add type marker
    room.answers = {}; // Reset answers for this question
    clearRoomTimers(room); // Clear any previous timers

    // Send state update *before* prep, so clients know the phase
    io.to(roomId).emit("state", serializeRoomState(room));

    // Emit prep signal to all players
    console.log(`[${roomId}] Emitting prep for draft question (Time: ${PREP_TIME}s)`);
    io.to(roomId).emit("prep", { time: PREP_TIME, type: 'draft' });

    // Set timer for the prep phase
    room.prepTimer = setTimeout(() => {
        // Double-check if room still exists and phase is correct
        if (!rooms[roomId] || rooms[roomId].phase !== 'draft-order-question') {
            console.log(`[${roomId}] Draft question cancelled or phase changed before prep time ended.`);
            return;
        }
        if (!rooms[roomId].currentQuestion) {
            console.error(`[${roomId}] Error: currentQuestion is null when trying to send draft question.`);
            return endGame(roomId, "Chyba: Nelze odeslat draftovací otázku.");
        }

        console.log(`[${roomId}] Sending draft question text to ALL (Limit: ${ANSWER_TIME}s)`);
        // Send the question itself (without the correct answer)
        io.to(roomId).emit("question", {
            q: sanitizeQuestion(room.currentQuestion),
            limit: ANSWER_TIME,
            type: 'draft'
        });

        // Set timer for the answer phase
        room.questionTimer = setTimeout(() => {
            // Double-check phase again
            if (rooms[roomId] && rooms[roomId].phase === 'draft-order-question') {
                console.log(`[${roomId}] Draft question time up. Evaluating answers...`);
                evaluateDraftOrder(roomId); // Evaluate answers after time limit
            }
        }, ANSWER_TIME * 1000);

    }, PREP_TIME * 1000);
}

function evaluateDraftOrder(roomId) {
    const room = rooms[roomId];
    // Ensure we are in the correct state to evaluate
    if (!room || !room.currentQuestion || room.currentQuestion.type !== 'draft' || room.phase !== 'draft-order-question') {
        console.warn(`[${roomId}] Attempted to evaluate draft order in incorrect state. Phase: ${room?.phase}, QType: ${room?.currentQuestion?.type}`);
        return; // Avoid evaluating if state is wrong
    }

    clearRoomTimers(room); // Stop the question timer if still running
    console.log(`[${roomId}] Evaluating draft order...`);
    room.phase = "draft-order-evaluating"; // Update phase

    const correctIndex = room.currentQuestion.correct;
    // Estimate question start time (less critical for draft, more for duels)
    // Using Date.now() at the point of evaluation might be sufficient here.
    const evaluationTime = Date.now();

    // Score players based on correctness and time
    room.players.forEach(p => {
        const answerData = room.answers[p.id];
        p.draftCorrect = false; // Track correctness
        p.draftTime = Infinity; // Track time (lower is better)

        if (answerData && answerData.answer === correctIndex) {
            p.draftCorrect = true;
            // Use time received if available, otherwise penalize slightly? Or assume max time?
            // Let's use time received, default to infinity if no answer.
            p.draftTime = answerData.timeReceived || Infinity;
        }
    });

    // Sort players: Correct answers first, then by fastest time
    room.players.sort((a, b) => {
        // Prioritize correct answers (true > false)
        if (a.draftCorrect !== b.draftCorrect) {
            return b.draftCorrect - a.draftCorrect; // true (1) comes before false (0)
        }
        // If correctness is the same, sort by time (ascending)
        return a.draftTime - b.draftTime;
    });

    // Log the determined order
    console.log(`[${roomId}] Draft order determined: ${room.players.map((p, idx) => `${idx + 1}. ${p.name} (${p.draftCorrect ? 'OK' : 'X'}, ${isFinite(p.draftTime) ? (p.draftTime % 100000) + 'ms' : 'N/A'})`).join('; ')}`);

    // Clean up temporary properties
    room.players.forEach(p => { delete p.draftCorrect; delete p.draftTime; });

    // Prepare result text for reveal
    const rankedPlayerNames = room.players.map(p => p.name);
    const winnerPicks = DRAFT_WINNER_PICKS > 1 ? `${DRAFT_WINNER_PICKS}x` : `${DRAFT_WINNER_PICKS}x`;
    const otherPicks = DRAFT_OTHERS_PICKS > 1 ? `${DRAFT_OTHERS_PICKS}x` : `${DRAFT_OTHERS_PICKS}x`;
    const resultText = `Pořadí pro výběr: ${rankedPlayerNames.join(', ')}. ${rankedPlayerNames[0]} vybírá ${winnerPicks}, ostatní ${otherPicks}.`;
    room.lastResult = resultText; // Store result

    // Prepare reveal data package
    const revealData = {
        correctIndex: correctIndex,
        playerAnswers: room.answers, // Send all answers for clients to display
        resultText: resultText
    };

    // Send state update first (phase change, potential player reorder if state includes it)
    io.to(roomId).emit("state", serializeRoomState(room));
    // Then send the reveal data
    io.to(roomId).emit("reveal", revealData);

    // Set timer for reveal duration before starting draft picks
    room.revealTimer = setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].phase === 'draft-order-evaluating') {
            startDraftPhase(roomId); // Proceed to draft picking phase
        }
    }, REVEAL_TIME * 1000);
}


function startDraftPhase(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players.length === 0) {
        console.error(`[${roomId}] Cannot start draft phase: No players in room.`);
        return endGame(roomId, "Chyba draftu: V místnosti nejsou žádní hráči.");
    }

    console.log(`[${roomId}] Starting draft phase.`);
    room.phase = "draft";
    // Players should already be sorted correctly from evaluateDraftOrder

    // Initialize draft state data
    room.draftData = {
        index: 0, // Start with the first player in the sorted list (rank 0)
        picksMadeTotal: 0,
        // Determine picks for the first player (winner of draft question)
        picksRemainingForPlayer: (room.players.length > 0 && DRAFT_WINNER_PICKS > 0) ? DRAFT_WINNER_PICKS : DRAFT_OTHERS_PICKS,
        rankedPlayers: room.players.map(p => p.id), // Store the IDs in the determined rank order
        firstPickTerritoryId: null // Track first pick for adjacency rule if needed
    };

    // Set the first active player
    room.activePlayerId = room.draftData.rankedPlayers[0];
    const activePlayerName = getPlayer(room, room.activePlayerId)?.name || 'Neznámý hráč';

    // Reset question/answer state
    room.currentQuestion = null;
    room.answers = {};
    clearRoomTimers(room); // Clear reveal timer

    // Update last result message
    room.lastResult = `Začíná draft. ${activePlayerName} vybírá (${room.draftData.picksRemainingForPlayer}x).`;
    console.log(`[${roomId}] Draft started. Active: ${activePlayerName}, Picks left: ${room.draftData.picksRemainingForPlayer}`);

    // Send the new state to all clients
    io.to(roomId).emit("state", serializeRoomState(room));
}

function handleDraftPick(socket, roomId, territoryId) {
    const room = rooms[roomId];
    const player = getPlayer(room, socket.id);

    // --- Validations ---
    if (!room || !player) return; // Should not happen if socket is connected
    if (room.phase !== 'draft') return socket.emit("errorMsg", "Nyní neprobíhá draft.");
    if (!room.draftData) { console.error(`[${roomId}] Draft pick attempted but draftData is null!`); return socket.emit("errorMsg", "Chyba stavu draftu."); }
    if (player.id !== room.activePlayerId) return socket.emit("errorMsg", "Nejsi na řadě s výběrem.");
    if (room.draftData.picksRemainingForPlayer <= 0) return socket.emit("errorMsg", "Již jsi vybral svá území v tomto kole draftu.");

    const territory = room.territories.find(t => t.id === territoryId);
    if (!territory) return socket.emit("errorMsg", "Neplatné území.");
    if (territory.owner) return socket.emit("errorMsg", "Toto území je již obsazené.");

    // Adjacency check for the winner's second pick (if applicable)
    const isWinner = room.draftData.index === 0;
    const isSecondPick = isWinner && room.draftData.picksRemainingForPlayer === (DRAFT_WINNER_PICKS - DRAFT_OTHERS_PICKS); // Assumes winner gets more

    if (isSecondPick && DRAFT_WINNER_PICKS > DRAFT_OTHERS_PICKS && room.draftData.firstPickTerritoryId) {
        const firstPickId = room.draftData.firstPickTerritoryId;
        // Check if *any* territory adjacent to the first pick is currently free
        const hasAdjacentFree = room.territories.some(t => !t.owner && areAdjacent(firstPickId, t.id));
        // If there are free adjacent spots, the second pick MUST be one of them
        if (hasAdjacentFree && !areAdjacent(firstPickId, territoryId)) {
            return socket.emit("errorMsg", `Druhý výběr (${territoryId}) musí sousedit s prvním (${firstPickId}), pokud je volné sousední území.`);
        }
    }
    // --- End Validations ---

    console.log(`[${roomId}] ${player.name} picks ${territoryId}. (Picks left: ${room.draftData.picksRemainingForPlayer - 1})`);

    // --- Apply Pick ---
    territory.owner = player.id;
    if (!Array.isArray(player.territories)) { player.territories = []; }
    player.territories.push(territory.id);
    room.draftData.picksMadeTotal++;

    // Store the first pick ID if this is the winner's first pick
    if (isWinner && room.draftData.picksRemainingForPlayer === DRAFT_WINNER_PICKS) {
        room.draftData.firstPickTerritoryId = territoryId;
    }

    // Apply first pick bonus if this is the player's absolute first territory
    let bonusMsg = "";
    if (player.territories.length === 1 && FIRST_PICK_BONUS > 0) {
        player.score = (player.score || 0) + FIRST_PICK_BONUS;
        bonusMsg = ` (+${FIRST_PICK_BONUS}b bonus za první zábor)`;
        console.log(`[${roomId}] ${player.name} received first pick bonus.`);
    }
    room.lastResult = `${player.name} vybral ${territoryId}${bonusMsg}.`;

    // Decrement remaining picks for the current player
    room.draftData.picksRemainingForPlayer--;

    // --- Determine Next Step ---
    if (room.draftData.picksRemainingForPlayer > 0) {
        // Same player picks again (only happens for the winner if picks > 1)
        console.log(`[${roomId}] ${player.name} has ${room.draftData.picksRemainingForPlayer} more picks.`);
        room.lastResult += ` ${player.name} vybírá znovu.`;
        // Send state update to reflect the pick and remaining picks
        io.to(roomId).emit("state", serializeRoomState(room));
    } else {
        // Move to the next player in the draft order
        setNextDraftPicker(roomId); // This function will handle state update and potentially end draft
    }
}

function setNextDraftPicker(roomId) {
    const room = rooms[roomId];
    if (!room || !room.draftData) {
        console.error(`[${roomId}] Error: setNextDraftPicker called but room or draftData is missing.`);
        return;
    }

    // Move to the next player index in the ranked list
    room.draftData.index++;

    // Check if we have processed all ranked players
    if (room.draftData.index >= room.draftData.rankedPlayers.length) {
        console.log(`[${roomId}] All players have finished their draft picks. Total picks: ${room.draftData.picksMadeTotal}`);
        // Verify if all territories that should be picked are picked (optional sanity check)
        const expectedPicks = (DRAFT_WINNER_PICKS - DRAFT_OTHERS_PICKS) + (room.draftData.rankedPlayers.length * DRAFT_OTHERS_PICKS);
        if (room.draftData.picksMadeTotal !== expectedPicks) {
            console.warn(`[${roomId}] Mismatch in expected draft picks (${expectedPicks}) vs actual (${room.draftData.picksMadeTotal}).`);
        }
        startFirstTurn(roomId); // Draft finished, start the actual game turns
    } else {
        // Get the ID of the next player
        const nextPlayerId = room.draftData.rankedPlayers[room.draftData.index];
        const nextPlayer = getPlayer(room, nextPlayerId); // Find the player object

        // Handle case where the next player might have disconnected during the draft
        if (!nextPlayer) {
            console.warn(`[${roomId}] Player ranked ${room.draftData.index + 1} (ID: ${nextPlayerId}) not found (disconnected?). Skipping.`);
            // Recursively call to move to the *next* available player
            setNextDraftPicker(roomId);
            return; // Stop execution for this recursion level
        }

        // Set the new active player
        room.activePlayerId = nextPlayerId;
        // Determine picks for this player (usually 1, unless it's the winner on their first turn)
        // This logic assumes the winner (index 0) is handled separately on their first pick turn.
        room.draftData.picksRemainingForPlayer = DRAFT_OTHERS_PICKS; // All others get the standard number
        // Reset first pick ID tracker (only relevant for winner's 2nd pick)
        room.draftData.firstPickTerritoryId = null;

        // Update status message
        room.lastResult = (room.lastResult || "") + ` Nyní vybírá ${nextPlayer.name}.`;
        console.log(`[${roomId}] Next draft picker (Rank ${room.draftData.index + 1}): ${nextPlayer.name}`);

        // Send updated state to clients
        io.to(roomId).emit("state", serializeRoomState(room));
    }
}


function startFirstTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.phase === 'finished') {
        console.warn(`[${roomId}] Attempted to start first turn but room doesn't exist or game finished.`);
        return;
    }
    if (!room.initialPlayerOrder || room.initialPlayerOrder.length === 0) {
        // This should ideally not happen if initialization worked
        console.error(`[${roomId}] FATAL: Cannot start first turn, initialPlayerOrder is empty!`);
        // Attempt recovery? Or end game?
        if (room.players.length >= MIN_PLAYERS) {
            console.warn(`[${roomId}] Rebuilding initialPlayerOrder from current players.`);
            room.initialPlayerOrder = room.players.map((p, idx)=>({id: p.id, name: p.name, initialOrder: idx}));
        } else {
            return endGame(roomId, "Chyba startu hry: Nelze určit pořadí hráčů.");
        }
    }

    console.log(`[${roomId}] Starting first turn (Turn 1).`);
    room.phase = "turn-select-action"; // First phase of a turn

    // Use the initialPlayerOrder determined *before* the draft question
    room.turnIndex = 0; // Start with the first player in that order
    room.activePlayerId = room.initialPlayerOrder[room.turnIndex]?.id;

    // Handle case where the first player in initial order might have disconnected
    let safety = 0;
    while (!getPlayer(room, room.activePlayerId) && safety < room.initialPlayerOrder.length) {
        console.warn(`[${roomId}] Player ${room.activePlayerId} at turn index ${room.turnIndex} not found. Finding next.`);
        room.turnIndex = (room.turnIndex + 1) % room.initialPlayerOrder.length;
        room.activePlayerId = room.initialPlayerOrder[room.turnIndex]?.id;
        safety++;
    }

    if (!getPlayer(room, room.activePlayerId)) {
        console.error(`[${roomId}] FATAL: Could not find any valid starting player in initialPlayerOrder.`);
        return endGame(roomId, "Chyba startu hry: Nelze určit prvního hráče na tahu.");
    }

    // Reset draft data and other temporary states
    room.draftData = null;
    room.currentQuestion = null;
    room.answers = {};
    room.turnData = null; // Clear any previous turn data
    room.turnCounter = 1; // It's officially turn 1
    room.lastResult = "Draft skončil, hra začíná!";
    clearRoomTimers(room); // Clear draft timers

    const activePlayerName = getPlayer(room, room.activePlayerId)?.name;
    console.log(`[${roomId}] Turn 1 begins. Active player: ${activePlayerName} (Initial Order Index: ${room.turnIndex})`);

    // Send the initial turn state
    io.to(roomId).emit("state", serializeRoomState(room));
}

function handleSelectAction(socket, roomId, fromTerritoryId, targetTerritoryId) {
    const room = rooms[roomId];
    const player = getPlayer(room, socket.id);

    // --- Validations ---
    if (!room || !player) return;
    if (room.phase !== 'turn-select-action') return socket.emit("errorMsg", "Nyní nelze vybírat akci.");
    if (player.id !== room.activePlayerId) return socket.emit("errorMsg", "Nejsi na tahu.");

    const fromTerritory = room.territories.find(t => t.id === fromTerritoryId);
    const targetTerritory = room.territories.find(t => t.id === targetTerritoryId);

    if (!fromTerritory || !targetTerritory) return socket.emit("errorMsg", "Neplatné ID území.");
    if (fromTerritory.owner !== player.id) return socket.emit("errorMsg", "Nelze provést akci z území, které nevlastníš.");
    if (targetTerritory.owner === player.id) return socket.emit("errorMsg", "Nelze útočit na vlastní území nebo ho znovu obsazovat.");
    if (!areAdjacent(fromTerritoryId, targetTerritoryId)) return socket.emit("errorMsg", "Území spolu nesousedí.");
    // --- End Validations ---

    clearRoomTimers(room); // Clear any lingering timers

    // Determine action type: 'claim' (target is free) or 'duel' (target is owned by opponent)
    const actionType = targetTerritory.owner === null ? 'claim' : 'duel';

    // Store turn data
    room.turnData = {
        type: actionType,
        playerId: player.id, // Player initiating the action (always the active player here)
        fromTerritoryId: fromTerritoryId, // For reference, maybe future use
        targetTerritoryId: targetTerritoryId
    };

    if (actionType === 'claim') {
        console.log(`[${roomId}] Action Selected: ${player.name} attempts to CLAIM ${targetTerritoryId}.`);
        room.phase = "claim-prep"; // Move to prep phase for claim question
        // Send state update FIRST, then trigger question process
        io.to(roomId).emit("state", serializeRoomState(room));
        sendSinglePlayerQuestion(roomId, player.id, 'claim');
    } else { // actionType === 'duel'
        const defender = getPlayer(room, targetTerritory.owner);
        if (!defender) {
            // Defender might have disconnected just now? Or state inconsistency.
            console.warn(`[${roomId}] Defender ${targetTerritory.owner} for duel on ${targetTerritoryId} not found! Treating as CLAIM.`);
            targetTerritory.owner = null; // Make territory free
            room.turnData.type = 'claim'; // Change action type
            room.phase = "claim-prep";
            io.to(roomId).emit("state", serializeRoomState(room));
            sendSinglePlayerQuestion(roomId, player.id, 'claim'); // Send claim question instead
            return;
        }
        console.log(`[${roomId}] Action Selected: ${player.name} initiates DUEL vs ${defender.name} on ${targetTerritoryId}.`);
        room.phase = "duel-prep"; // Move to prep phase for duel question
        // Add attacker/defender IDs specifically for duel context
        room.turnData.attackerId = player.id;
        room.turnData.defenderId = defender.id;
        // Send state update FIRST, then trigger question process
        io.to(roomId).emit("state", serializeRoomState(room));
        sendDuelQuestion(roomId, player.id, defender.id);
    }
}


function sendSinglePlayerQuestion(roomId, playerId, type) {
    const room = rooms[roomId];
    if (!room || !playerId) return;
    const player = getPlayer(room, playerId);
    if (!player) { console.warn(`[${roomId}] Player ${playerId} not found for single player question.`); return advanceTurn(roomId, true); }
    if (!room.deck || room.deck.length === 0) { return endGame(roomId, "Nedostatek otázek."); }

    const question = room.deck.pop();
    if (!question || typeof question.correct === 'undefined') { return endGame(roomId, "Chyba: Neplatná otázka z balíčku."); }

    room.currentQuestion = { ...question, type }; // type should be 'claim' here
    room.answers = {}; // Reset answers
    clearRoomTimers(room);
    room.phase = `${type}-question`; // e.g., 'claim-question'

    console.log(`[${roomId}] Phase: ${room.phase}. Preparing ${type} question for ${player.name}.`);
    // Send state update first (phase change)
    io.to(roomId).emit("state", serializeRoomState(room));
    // Emit prep signal
    io.to(roomId).emit("prep", { time: PREP_TIME, type });

    room.prepTimer = setTimeout(() => {
        if (!rooms[roomId] || rooms[roomId].phase !== `${type}-question` || !rooms[roomId].currentQuestion) {
            console.log(`[${roomId}] ${type} question cancelled or phase changed before prep end.`); return;
        }
        console.log(`[${roomId}] Sending ${type} question text to ALL (Limit: ${ANSWER_TIME}s)`);
        // Send sanitized question to everyone
        io.to(roomId).emit("question", {
            q: sanitizeQuestionForSpectator(room.currentQuestion), // Spectators see question too
            limit: ANSWER_TIME,
            type: type
        });

        // Set timer for the answer
        room.questionTimer = setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].phase === `${type}-question`) {
                console.log(`[${roomId}] ${type} time up for ${player.name}. Evaluating...`);
                evaluateSingleAnswer(roomId); // Evaluate after time limit
            }
        }, ANSWER_TIME * 1000);
    }, PREP_TIME * 1000);
}

function sendDuelQuestion(roomId, attackerId, defenderId) {
    const room = rooms[roomId];
    if (!room || !attackerId || !defenderId) return;
    const attacker = getPlayer(room, attackerId);
    const defender = getPlayer(room, defenderId);
    if (!attacker || !defender) { console.warn(`[${roomId}] Attacker or Defender not found for duel.`); return advanceTurn(roomId, true); }
    if (!room.deck || room.deck.length === 0) { return endGame(roomId, "Nedostatek otázek."); }

    const question = room.deck.pop();
    if (!question || typeof question.correct === 'undefined') { return endGame(roomId, "Chyba: Neplatná otázka z balíčku."); }

    room.currentQuestion = { ...question, type: 'duel' };
    room.answers = {}; // Reset answers
    clearRoomTimers(room);
    room.phase = "duel-question";

    console.log(`[${roomId}] Phase: ${room.phase}. Preparing duel question: ${attacker.name} vs ${defender.name}.`);
    // Send state update first (phase change)
    io.to(roomId).emit("state", serializeRoomState(room));
    // Emit prep signal
    io.to(roomId).emit("prep", { time: PREP_TIME, type: 'duel' });

    room.prepTimer = setTimeout(() => {
        if (!rooms[roomId] || rooms[roomId].phase !== 'duel-question' || !rooms[roomId].currentQuestion) {
            console.log(`[${roomId}] Duel question cancelled or phase changed before prep end.`); return;
        }
        console.log(`[${roomId}] Sending duel question text to ALL (Limit: ${ANSWER_TIME}s)`);
        // Send sanitized question to everyone
        io.to(roomId).emit("question", {
            q: sanitizeQuestionForSpectator(room.currentQuestion),
            limit: ANSWER_TIME,
            type: 'duel'
        });

        // Set timer for the answer
        room.questionTimer = setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].phase === 'duel-question') {
                console.log(`[${roomId}] Duel time up. Evaluating...`);
                evaluateDuel(roomId); // Evaluate after time limit
            }
        }, ANSWER_TIME * 1000);
    }, PREP_TIME * 1000);
}


function handleAnswer(socket, roomId, answer) {
    const room = rooms[roomId];
    const player = getPlayer(room, socket.id);

    // Basic validations
    if (!room || !player) return;
    if (!room.currentQuestion) { console.warn(`[${roomId}] Answer received from ${player.name} but no current question.`); return; }
    if (room.answers[player.id]) { console.log(`[${roomId}] Player ${player.name} already answered.`); return; } // Ignore duplicate answers

    // Validate answer format (should be an index number)
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= (room.currentQuestion.choices?.length || 0)) {
        console.warn(`[${roomId}] Invalid answer format received from ${player.name}:`, answer);
        // Optionally record it as invalid? Or just ignore? For now, ignore.
        return;
    }

    const currentPhase = room.phase;
    const qType = room.currentQuestion.type;
    const turnData = room.turnData;
    let isEligible = false;

    // Determine eligibility based on question type and phase
    if (qType === 'draft' && currentPhase === 'draft-order-question') {
        isEligible = true; // Everyone answers draft question
    } else if (qType === 'claim' && currentPhase === 'claim-question' && room.activePlayerId === player.id) {
        isEligible = true; // Only active player answers claim
    } else if (qType === 'duel' && currentPhase === 'duel-question' && turnData && (turnData.attackerId === player.id || turnData.defenderId === player.id)) {
        isEligible = true; // Attacker and defender answer duel
    }

    if (!isEligible) {
        console.log(`[${roomId}] Player ${player.name} answered but was not eligible. Phase: ${currentPhase}, QType: ${qType}, Active: ${room.activePlayerId}, TurnData:`, turnData);
        return; // Ignore answer from non-eligible player
    }

    // Record the valid answer
    room.answers[player.id] = { answer: answer, timeReceived: Date.now() };
    console.log(`[${roomId}] Received answer ${answer} from ${player.name} for ${qType}.`);

    // --- Check if evaluation can happen early ---
    let evaluateNow = false;
    if (qType === 'draft') {
        // Evaluate draft if all *currently connected* players have answered
        const connectedPlayerIds = room.players.map(p => p.id);
        if (connectedPlayerIds.every(id => room.answers[id])) {
            evaluateNow = true;
            console.log(`[${roomId}] All connected players answered draft question.`);
        }
    } else if (qType === 'claim') {
        // Claim involves only one player, so receiving their answer means we can evaluate
        evaluateNow = true;
        console.log(`[${roomId}] Claim answer received.`);
    } else if (qType === 'duel') {
        // Evaluate duel if both attacker and defender have answered
        if (turnData && room.answers[turnData.attackerId] && room.answers[turnData.defenderId]) {
            evaluateNow = true;
            console.log(`[${roomId}] Both duel participants answered.`);
        }
    }

    // If all necessary answers are in, evaluate immediately
    if (evaluateNow) {
        clearTimeout(room.questionTimer); // Stop the timer
        room.questionTimer = null;
        console.log(`[${roomId}] Evaluating ${qType} early.`);
        // Call the appropriate evaluation function
        if (qType === 'draft') evaluateDraftOrder(roomId);
        else if (qType === 'claim') evaluateSingleAnswer(roomId);
        else if (qType === 'duel') evaluateDuel(roomId);
    }
}


function evaluateSingleAnswer(roomId) {
    const room = rooms[roomId];
    // Ensure we are in the correct state
    if (!room || !room.currentQuestion || room.currentQuestion.type !== 'claim' || room.phase !== 'claim-question') {
        console.warn(`[${roomId}] Attempted to evaluate single answer in incorrect state. Phase: ${room?.phase}, QType: ${room?.currentQuestion?.type}`);
        return advanceTurn(roomId, true); // Skip evaluation if state is wrong
    }

    clearRoomTimers(room); // Clear prep/question timers
    room.phase = "results"; // Move to results phase
    console.log(`[${roomId}] Evaluating claim result... Phase: ${room.phase}`);

    const td = room.turnData;
    // Active player is the one who answered
    const pId = room.activePlayerId;
    const player = getPlayer(room, pId);
    const answerData = room.answers[pId]; // Get the player's answer
    const correctIdx = room.currentQuestion.correct;
    const territory = room.territories.find(t => t.id === td?.targetTerritoryId);

    if (!player || !territory || !td) {
        console.error(`[${roomId}] Missing data for claim evaluation. Player: ${!!player}, Territory: ${!!territory}, TurnData: ${!!td}`);
        return advanceTurn(roomId, true); // Cannot evaluate, force next turn
    }

    player.score = player.score || 0; // Ensure score is initialized
    let resultText = "";
    let successfulClaim = false;

    if (answerData && answerData.answer === correctIdx) {
        // Correct answer
        territory.owner = pId; // Assign territory owner
        if (!Array.isArray(player.territories)) player.territories = [];
        if (!player.territories.includes(territory.id)) {
            player.territories.push(territory.id); // Add to player's list
        }
        player.score += 50; // Award points
        resultText = `${player.name} úspěšně obsadil ${territory.id}! (+50 bodů)`;
        successfulClaim = true;
        console.log(`[${roomId}] Claim successful by ${player.name} on ${territory.id}.`);
    } else {
        // Incorrect answer or timeout
        const reason = answerData ? "špatně odpověděl" : "neodpověděl včas";
        resultText = `${player.name} ${reason} a neuspěl při obsazování ${territory.id}.`;
        // NO penalty for failed claim
        console.log(`[${roomId}] Claim failed by ${player.name} on ${territory.id} (${reason}).`);
    }
    room.lastResult = resultText; // Store the result message

    // Prepare data for reveal event
    const revealData = {
        correctIndex: correctIdx,
        playerAnswers: room.answers, // Include the answer (or lack thereof)
        resultText: resultText
    };

    // Send state update (phase, score, territory owner)
    io.to(roomId).emit("state", serializeRoomState(room));
    // Send reveal information
    io.to(roomId).emit("reveal", revealData);

    // Set timer for reveal duration
    room.revealTimer = setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].phase === 'results') {
            advanceTurn(roomId); // Proceed to next turn after reveal
        }
    }, REVEAL_TIME * 1000);
}


function evaluateDuel(roomId) {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion || room.currentQuestion.type !== 'duel' || room.phase !== 'duel-question') {
        console.warn(`[${roomId}] Attempted to evaluate duel in incorrect state. Phase: ${room?.phase}, QType: ${room?.currentQuestion?.type}`);
        return advanceTurn(roomId, true);
    }

    clearRoomTimers(room);
    room.phase = "results";
    console.log(`[${roomId}] Evaluating duel result... Phase: ${room.phase}`);
    const td = room.turnData;
    if (!td || !td.attackerId || !td.defenderId || !td.targetTerritoryId) {
        console.error(`[${roomId}] Missing turn data for duel evaluation:`, td);
        return advanceTurn(roomId, true);
    }

    const attacker = getPlayer(room, td.attackerId);
    const defender = getPlayer(room, td.defenderId);
    const territory = room.territories.find(t => t.id === td.targetTerritoryId);

    // Check if participants or territory still exist
    if (!attacker) { console.warn(`[${roomId}] Attacker ${td.attackerId} not found for duel eval.`); /* Defender wins by default? */ }
    if (!defender) { console.warn(`[${roomId}] Defender ${td.defenderId} not found for duel eval.`); /* Attacker wins by default? */ }
    if (!territory) { console.error(`[${roomId}] Target territory ${td.targetTerritoryId} not found for duel eval.`); return advanceTurn(roomId, true); }

    // Even if a player disconnected, we might have their answer recorded before disconnect.
    const correctIdx = room.currentQuestion.correct;
    const attAnsData = room.answers[td.attackerId];
    const defAnsData = room.answers[td.defenderId];

    // Determine correctness (null/undefined answer is treated as incorrect)
    const attCorr = attAnsData?.answer === correctIdx;
    const defCorr = defAnsData?.answer === correctIdx;

    // Determine winner based on correctness, then time
    let winnerId = null;
    let resultReason = "";
    let timeInfo = "";

    if (attCorr && !defCorr) {
        winnerId = td.attackerId; // Attacker correct, Defender incorrect
        resultReason = `${attacker?.name || 'Útočník'} odpověděl správně, ${defender?.name || 'Obránce'} špatně.`;
    } else if (!attCorr && defCorr) {
        winnerId = td.defenderId; // Attacker incorrect, Defender correct
        resultReason = `${attacker?.name || 'Útočník'} odpověděl špatně, ${defender?.name || 'Obránce'} správně.`;
    } else if (attCorr && defCorr) {
        // Both correct, compare time (lower time is better)
        const attTime = attAnsData?.timeReceived || Infinity;
        const defTime = defAnsData?.timeReceived || Infinity;
        // Simple time comparison, can be refined with start time if needed
        if (attTime <= defTime) {
            winnerId = td.attackerId;
            resultReason = `Oba odpověděli správně, ${attacker?.name || 'Útočník'} byl rychlejší.`;
            timeInfo = ` (${(attTime % 100000)}ms vs ${(defTime % 100000)}ms)`; // Show relative ms for context
        } else {
            winnerId = td.defenderId;
            resultReason = `Oba odpověděli správně, ${defender?.name || 'Obránce'} byl rychlejší.`;
            timeInfo = ` (${(defTime % 100000)}ms vs ${(attTime % 100000)}ms)`;
        }
        resultReason += timeInfo;
    } else {
        // Both incorrect or timed out
        winnerId = td.defenderId; // Defender wins by default if both fail
        resultReason = `Oba odpověděli špatně nebo neodpověděli.`;
    }

    // Apply results (only if players still exist)
    attacker.score = attacker?.score || 0; // Ensure score initialized
    defender.score = defender?.score || 0;
    let resultText = "";

    const winnerPlayer = getPlayer(room, winnerId);
    const loserId = (winnerId === td.attackerId) ? td.defenderId : td.attackerId;
    const loserPlayer = getPlayer(room, loserId);

    if (winnerId === td.attackerId && attacker && territory) { // Attacker wins
        console.log(`[${roomId}] Duel Winner: Attacker ${attacker.name} (${resultReason})`);
        const oldOwnerId = territory.owner;
        territory.owner = attacker.id; // Change territory owner

        // Update attacker's territory list
        if (!Array.isArray(attacker.territories)) attacker.territories = [];
        if (!attacker.territories.includes(territory.id)) attacker.territories.push(territory.id);

        // Remove from defender's list (if they still exist)
        if (defender && Array.isArray(defender.territories)) {
            const terrIndex = defender.territories.indexOf(territory.id);
            if (terrIndex > -1) defender.territories.splice(terrIndex, 1);
        } else if (oldOwnerId && !defender) {
            console.log(`[${roomId}] Defender ${oldOwnerId} left, territory ${territory.id} already released.`);
        }

        attacker.score += 100; // Points for winning attack
        resultText = `${attacker.name} vyhrál duel o ${territory.id}! ${resultReason} (+100b)`;

    } else if (winnerId === td.defenderId && defender && territory) { // Defender wins
        console.log(`[${roomId}] Duel Winner: Defender ${defender.name} (${resultReason})`);
        // Territory owner doesn't change
        defender.score += 50; // Points for successful defense
        resultText = `${defender.name} ubránil ${territory.id}! ${resultReason} (+50b)`;
    } else {
        // Handle cases where winner/loser/territory might be missing after disconnect
        console.warn(`[${roomId}] Duel outcome unclear due to missing participants/territory. Winner ID: ${winnerId}`);
        resultText = `Duel o ${td.targetTerritoryId} skončil. ${resultReason}`;
        if (winnerPlayer) {
            resultText = `${winnerPlayer.name} vyhrál duel o ${td.targetTerritoryId}. ${resultReason}`;
        } else if (loserPlayer) {
            resultText = `${loserPlayer.name} prohrál duel o ${td.targetTerritoryId}. ${resultReason}`;
        }
    }

    room.lastResult = resultText; // Store result message

    // Prepare reveal data
    const revealData = {
        correctIndex: correctIdx,
        playerAnswers: room.answers,
        resultText: resultText
    };

    // Send state update (phase, scores, territory owner)
    io.to(roomId).emit("state", serializeRoomState(room));
    // Send reveal information
    io.to(roomId).emit("reveal", revealData);

    // Set timer for reveal duration
    room.revealTimer = setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].phase === 'results') {
            advanceTurn(roomId); // Proceed to next turn
        }
    }, REVEAL_TIME * 1000);
}


function advanceTurn(roomId, forced = false) {
    const room = rooms[roomId];
    if (!room || (room.phase === 'finished' && !forced)) {
        // Don't advance turn if game is already finished unless forced by disconnect logic
        return;
    }

    const previousPhase = room.phase;
    console.log(`[${roomId}] Advancing turn. Current Turn: ${room.turnCounter}, Index: ${room.turnIndex}, Phase: ${previousPhase}, Forced: ${forced}.`);
    clearRoomTimers(room); // Clear any timers from the previous step

    // Check for victory conditions *before* advancing turn index/counter
    // unless forced (e.g. disconnect might trigger advance before win check)
    if (!forced && checkForVictory(roomId)) {
        console.log(`[${roomId}] Victory condition met. Halting turn advancement.`);
        return; // endGame was called by checkForVictory
    }

    // Increment turn counter only if the turn naturally completed or was forced past action select
    // Don't increment if forced from prep/question/results as the turn didn't really finish.
    const naturalProgression = ['results', 'turn-select-action']; // Phases where turn counter increments after
    if (naturalProgression.includes(previousPhase) || forced) { // Increment on natural end or any forced advance
        room.turnCounter++;
        console.log(`[${roomId}] Turn counter incremented to ${room.turnCounter}.`);
    } else {
        console.log(`[${roomId}] Turn counter (${room.turnCounter}) not incremented (forced from phase ${previousPhase}).`);
    }


    // Check for MAX_TURNS limit
    if (room.turnCounter > MAX_TURNS) {
        console.log(`[${roomId}] Maximum turn limit (${MAX_TURNS}) reached.`);
        return endGame(roomId, `Dosaženo maximálního počtu kol (${MAX_TURNS}).`);
    }

    // Ensure initialPlayerOrder exists and is populated
    if (!room.initialPlayerOrder || room.initialPlayerOrder.length === 0) {
        if (room.players.length >= MIN_PLAYERS) {
            console.warn(`[${roomId}] initialPlayerOrder missing. Rebuilding from current players.`);
            room.initialPlayerOrder = room.players.map((p, idx)=>({id: p.id, name: p.name, initialOrder: idx}));
            room.turnIndex = 0; // Reset index
        } else {
            console.error(`[${roomId}] Cannot advance turn: initialPlayerOrder is empty and not enough players.`);
            return endGame(roomId, "Chyba: Nelze určit dalšího hráče na tahu.");
        }
    }

    const numPlayersInOrder = room.initialPlayerOrder.length;
    if (numPlayersInOrder === 0) {
        console.log(`[${roomId}] No players left in initial order. Ending game.`);
        return endGame(roomId, "Všichni hráči opustili hru.");
    }


    // Find the *next* player in the initial order who is still *currently* in the game
    let nextPlayerFound = false;
    let safetyCounter = 0; // Prevent infinite loop
    let nextTurnIndex = room.turnIndex; // Start searching from the current index

    do {
        nextTurnIndex = (nextTurnIndex + 1) % numPlayersInOrder; // Move to next index (wraps around)
        const nextPlayerInfo = room.initialPlayerOrder[nextTurnIndex];

        if (nextPlayerInfo && getPlayer(room, nextPlayerInfo.id)) {
            // Found the next player who is still in the room.players list
            room.activePlayerId = nextPlayerInfo.id;
            room.turnIndex = nextTurnIndex; // Update the room's turn index
            nextPlayerFound = true;
            console.log(`[${roomId}] Next active player found: ${nextPlayerInfo.name} (Initial Index: ${room.turnIndex})`);
        } else if (nextPlayerInfo) {
            // Player in initial order is no longer in the game, skip
            console.log(`[${roomId}] Skipping player ${nextPlayerInfo.name} (ID: ${nextPlayerInfo.id}) at index ${nextTurnIndex} (disconnected).`);
        }
        safetyCounter++;
    } while (!nextPlayerFound && safetyCounter <= numPlayersInOrder); // Loop until found or checked all

    if (!nextPlayerFound) {
        // This should only happen if all players in initialPlayerOrder are no longer in room.players
        console.error(`[${roomId}] FATAL: Could not find any valid next active player among remaining players.`);
        if (room.players.length > 0) {
            // Fallback: just pick the first player from the current list? Unreliable order.
            room.activePlayerId = room.players[0].id;
            room.turnIndex = room.initialPlayerOrder.findIndex(p=>p?.id === room.activePlayerId) ?? 0; // Try to find index, fallback 0
            console.warn(`[${roomId}] Fallback: Setting active player to ${room.players[0].name}`);
        } else {
            return endGame(roomId, "Chyba: Nelze najít dalšího hráče na tahu (žádní hráči nezbyli?).");
        }
    }

    // Set up state for the new turn
    room.phase = "turn-select-action"; // Start of the next player's turn
    room.currentQuestion = null;
    room.answers = {};
    room.turnData = null; // Clear data from the previous turn/action
    // Keep lastResult until the next action replaces it

    console.log(`[${roomId}] Advanced to Turn ${room.turnCounter}. Phase: ${room.phase}. Active: ${getPlayer(room, room.activePlayerId)?.name}`);
    // Send the updated state to all clients
    io.to(roomId).emit("state", serializeRoomState(room));
}


function checkForVictory(roomId) {
    const room = rooms[roomId];
    // Don't check for victory during initial phases or if game ended
    if (!room || !room.territories || room.players.length < 1 || ['lobby', 'initializing', 'draft-order-question', 'draft-order-evaluating', 'draft', 'finished'].includes(room.phase)) {
        return false; // Not applicable state
    }

    const totalTerritories = room.territories.length;
    if (totalTerritories === 0) return false; // No territories to win yet

    let conqueror = null;
    let playersWithTerritories = 0;
    let lastPlayerWithTerritory = null;

    for (const player of room.players) {
        const pTerritoryCount = Array.isArray(player.territories) ? player.territories.length : 0;

        // Check for total conquest
        if (pTerritoryCount === totalTerritories) {
            conqueror = player;
            break; // Found a conqueror
        }

        // Track players who still own land
        if (pTerritoryCount > 0) {
            playersWithTerritories++;
            lastPlayerWithTerritory = player;
        }
    }

    // Condition 1: Total Conquest
    if (conqueror) {
        console.log(`[${roomId}] Victory Condition Met: ${conqueror.name} conquered all territories.`);
        endGame(roomId, `${conqueror.name} dobyl celé Česko!`);
        return true;
    }

    // Condition 2: Last Player Standing (with territories) - requires MIN_PLAYERS > 1
    // Only trigger if more than one player started (implied by MIN_PLAYERS)
    // And only if the game has progressed beyond the initial turns (e.g., turnCounter > 0 or phase isn't draft)
    if (MIN_PLAYERS > 1 && room.players.length >= 1 && playersWithTerritories === 1 && room.turnCounter > 0) {
        console.log(`[${roomId}] Victory Condition Met: ${lastPlayerWithTerritory.name} is the last player with territories.`);
        endGame(roomId, `${lastPlayerWithTerritory.name} zůstal jako poslední vládce území!`);
        return true;
    }

    // Condition 3: Only one player left in the game (others disconnected) - requires MIN_PLAYERS > 1
    if (MIN_PLAYERS > 1 && room.players.length === 1 && room.turnCounter > 0) { // Ensure game actually started
        const solePlayer = room.players[0];
        console.log(`[${roomId}] Victory Condition Met: ${solePlayer.name} is the only player left.`);
        endGame(roomId, `${solePlayer.name} vyhrál, protože ostatní hráči opustili hru.`);
        return true;
    }


    return false; // No victory condition met
}

function endGame(roomId, reason) {
    const room = rooms[roomId];
    if (!room) { console.error(`[${roomId}] Cannot end game: Room not found.`); return; }
    if (room.phase === 'finished') { console.log(`[${roomId}] Game already finished.`); return; } // Prevent double end game

    console.log(`[${roomId}] Ending game. Reason: ${reason}`);
    clearRoomTimers(room); // Clear all active timers

    room.phase = "finished"; // Set final phase
    room.activePlayerId = null; // No active player
    room.currentQuestion = null; // No active question
    room.lastResult = reason; // Store the reason for game end

    // Sort players for final ranking based on score, then territory count
    room.players.sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const territoriesA = Array.isArray(a.territories) ? a.territories.length : 0;
        const territoriesB = Array.isArray(b.territories) ? b.territories.length : 0;
        return territoriesB - territoriesA; // More territories is better if scores are tied
    });

    // Log final ranking
    console.log(`[${roomId}] Final ranking: ${room.players.map((p, i) => `${i + 1}. ${p.name} (${p.score || 0}b, ${p.territories?.length || 0}T)`).join('; ')}`);

    // Prepare final state and game over payload
    const finalState = serializeRoomState(room); // Get the final state object
    const gameOverPayload = {
        reason: reason,
        players: finalState.players // Send the sorted final player list
    };

    // Emit final state and game over event
    io.to(roomId).emit("state", finalState);
    io.to(roomId).emit("gameOver", gameOverPayload);

    // Optional: Clean up room after a delay? Or keep it for viewing results?
    // setTimeout(() => {
    //     if (rooms[roomId] && rooms[roomId].phase === 'finished') {
    //         console.log(`[${roomId}] Deleting finished room.`);
    //         delete rooms[roomId];
    //     }
    // }, 60000 * 5); // Delete after 5 minutes
}

function clearRoomTimers(room) {
    if (!room) return;
    let clearedCount = 0;
    if (room.prepTimer) { clearTimeout(room.prepTimer); room.prepTimer = null; clearedCount++; }
    if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; clearedCount++; }
    if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; clearedCount++; }
    // if (clearedCount > 0) console.log(`[${room.id}] Cleared ${clearedCount} timers.`);
}

// Serializes the room state to be sent to clients, omitting sensitive or unnecessary data
function serializeRoomState(room) {
    if (!room) return null;

    // Ensure players and territories are arrays
    const players = Array.isArray(room.players) ? room.players : [];
    const territories = Array.isArray(room.territories) ? room.territories : [];
    // Ensure initialPlayerOrder contains necessary info for client (ID, name, initial index for color)
    const initialPlayerOrderSummary = Array.isArray(room.initialPlayerOrder)
        ? room.initialPlayerOrder.map(p => ({ id: p.id, name: p.name, initialOrder: p.initialOrder }))
        : [];

    return {
        // Core State
        roomId: room.id,
        phase: room.phase,
        turnCounter: room.turnCounter,
        activePlayerId: room.activePlayerId,
        turnIndex: room.turnIndex, // Client uses this for turn order display logic maybe
        lastResult: room.lastResult || null,

        // Player Data (Public Info)
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score || 0,
            // Send territory IDs owned by the player
            territories: Array.isArray(p.territories) ? p.territories : [],
            // Client doesn't strictly need 'ready' or 'initialOrder' here,
            // but 'ready' might be useful if sent during lobby phase via state.
            // initialOrder is handled separately below.
        })),

        // Initial Order (for consistent colors and turn display)
        initialPlayerOrder: initialPlayerOrderSummary,

        // Territory Data
        territories: territories.map(t => ({
            id: t.id,
            owner: t.owner // Just send the owner ID
        })),

        // Turn-Specific Data (Limited Info)
        // Only send data relevant for current client display needs
        turnData: room.turnData ? {
            type: room.turnData.type,
            targetTerritoryId: room.turnData.targetTerritoryId,
            // Include involved player IDs for context (e.g., duel display)
            attackerId: room.turnData.attackerId, // Might be null if not duel
            defenderId: room.turnData.defenderId, // Might be null if not duel
            playerId: room.turnData.playerId     // Player who initiated claim/action
        } : null,

        // Client doesn't need: deck, currentQuestion (sent separately), answers, timers, hostId (derived)
    };
}

/* === SERVER SETUP ====================================================== */
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for the root and any non-file routes (for SPA routing)
app.get('*', (req, res) => {
    // Simple check if the request looks like a file path vs a route
    if (req.url.includes('.') && !req.url.endsWith('.html')) {
        res.status(404).end(); // Don't serve index.html for likely asset requests gone wrong
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Start the server
if (require.main === module) {
    server.listen(PORT, () => console.log(`Dobyvatel server running on http://localhost:${PORT}`));

    // Optional: Graceful shutdown
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

module.exports.areAdjacent = areAdjacent;
