const socket = io();
const $ = (sel) => document.querySelector(sel);
const app = $("#app");

// --- Globální stav --------------------------------------------------------
let state = { screen: "home" }; // home | wizard | lobby | game | gameover
let mode = "create";            // create | join (používá wizard)
let roomId = "";
let myName = "";
let isAdmin = false;
let players = [];
let selected = null;
let roundActive = true;
let currentQ = null;
let timer = 20;

// --- Root renderer --------------------------------------------------------
function render() {
    app.innerHTML = "";
    const map = { home, wizard, lobby, game, gameover };
    map[state.screen]();
}

// -------------------------------------------------------------------------
// HOME
function home() {
    const card = html(`<div class="card">
    <h1>🧠 Online Kvíz</h1>
    <button id="btnCreate">Vytvořit hru</button>
    <button id="btnJoin">Připojit se</button>
    <p class="toggle-theme">🌗</p>
  </div>`);
    app.appendChild(card);
    $("#btnCreate").onclick = () => {
        mode = "create";
        state.screen = "wizard";
        render();
    };
    $("#btnJoin").onclick = () => {
        mode = "join";
        state.screen = "wizard";
        render();
    };
    $(".toggle-theme").onclick = () => document.body.classList.toggle("dark");
}

// -------------------------------------------------------------------------
// WIZARD (dvoukrokový pouze při joinu)
function wizard() {
    const card = html(`<div class="card" id="wz"></div>`);
    app.appendChild(card);
    if (mode === "create") stepNameAdmin();
    else stepRoomCode();

    function stepNameAdmin() {
        card.innerHTML = `<h2>Jméno admina</h2><input class="input" id="name"/><button id="next">Pokračovat</button>`;
        $("#next").onclick = () => {
            const name = $("#name").value.trim();
            if (!name) return;
            myName = name;
            socket.emit("createRoom", { name }, ({ roomId: id, players: list }) => {
                roomId = id;
                players = list;
                isAdmin = true;
                state.screen = "lobby";
                render();
            });
        };
    }

    function stepRoomCode() {
        card.innerHTML = `<h2>Kód místnosti</h2><input class="input" id="code" placeholder="ABC123"/><button id="next">Další</button>`;
        $("#next").onclick = () => {
            roomId = $("#code").value.trim().toUpperCase();
            if (!roomId) return;
            stepPlayerName();
        };
    }

    function stepPlayerName() {
        card.innerHTML = `<h2>Tvé jméno</h2><input class="input" id="name"/><button id="join">Připojit se</button>`;
        $("#join").onclick = () => {
            const name = $("#name").value.trim();
            if (!name) return;
            myName = name;
            socket.emit("joinRoom", { roomId, name }, (res) => {
                if (res.error) return alert(res.error);
                players = res.players;
                isAdmin = false;
                state.screen = "lobby";
                render();
            });
        };
    }
}

// -------------------------------------------------------------------------
// LOBBY
function lobby() {
    const card = html(`<div class="card">
    <h2>Místnost <code>${roomId}</code></h2>
    <ul class="list" id="playerList"></ul>
    <button id="action">${isAdmin ? "Spustit hru" : "Ready"}</button>
  </div>`);
    app.appendChild(card);
    updatePlayerList();
    $("#action").onclick = () => {
        if (isAdmin) socket.emit("startGame", { roomId });
        else socket.emit("playerReady", { roomId });
    };
}

function updatePlayerList() {
    const ul = $("#playerList");
    if (!ul) return;
    ul.innerHTML = "";
    players.forEach((p) => {
        const li = html(`<li>${p.name}${p.admin ? " 👑" : ""}${p.ready ? " ✔️" : ""}</li>`);
        ul.appendChild(li);
    });
}

// -------------------------------------------------------------------------
// GAME
function game() {
    const card = html(`<div class="card">
    <div id="scorebar" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem"></div>
    <h3 id="qText"></h3>
    <div id="choices" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem"></div>
    <div class="timer" id="timer">20</div>
    <h4 id="info"></h4>
  </div>`);
    app.appendChild(card);
    renderQuestion();
    renderScorebar();
}

function renderQuestion() {
    $("#qText").textContent = currentQ.text;
    const area = $("#choices");
    area.innerHTML = "";
    currentQ.choices.forEach((c, i) => {
        const btn = html(`<button class="secondary">${c}</button>`);
        if (selected === i) btn.style.background = "var(--accent)";
        btn.onclick = () => {
            if (!roundActive) return;
            selected = i;
            socket.emit("answer", { roomId, answer: i, timeLeft: timer });
            renderQuestion();
        };
        area.appendChild(btn);
    });
}

function renderScorebar() {
    const bar = $("#scorebar");
    if (!bar) return;
    bar.innerHTML = "";
    players
        .slice()
        .sort((a, b) => b.score - a.score)
        .forEach((p) => {
            const tag = html(`<span>${p.name}: ${p.score}</span>`);
            bar.appendChild(tag);
        });
}

// -------------------------------------------------------------------------
// GAME OVER
function gameover() { /* nikdy voláno přímo – alias níže */ }
function gameOver() {
    const card = html(`<div class="card">
    <h2>Konec hry</h2>
    <ul class="list" id="final"></ul>
    <button id="restart">Restart</button>
  </div>`);
    app.appendChild(card);
    const ul = $("#final");
    state.leaderboard.forEach((p, i) => {
        ul.appendChild(html(`<li>${i + 1}. ${p.name} – ${p.score}</li>`));
    });
    $("#restart").onclick = () => location.reload();
}

// -------------------------------------------------------------------------
// Helper pro snadnější DOM
function html(str) {
    const t = document.createElement("template");
    t.innerHTML = str.trim();
    return t.content.firstChild;
}

// -------------------------------------------------------------------------
// Socket.io listeners
socket.on("playerList", (list) => {
    players = list;
    updatePlayerList();
    renderScorebar();
});

socket.on("question", ({ q }) => {
    currentQ = q;
    timer = 20;
    selected = null;
    roundActive = true;
    state.screen = "game";
    render();
});

socket.on("timer", (t) => {
    timer = t;
    const el = $("#timer");
    if (el) el.textContent = t;
});

socket.on("scores", (list) => {
    roundActive = false;
    players = list;
    renderScorebar();
    const info = $("#info");
    const me = players.find((p) => p.name === myName);
    if (me)
        info.textContent = me.selected === currentQ.correct ? `✅ +${1000 + me.timeLeft * 50}` : "❌ -200";
});

socket.on("gameOver", (board) => {
    state.leaderboard = board;
    state.screen = "gameover";
    render();
});

// Init
render();