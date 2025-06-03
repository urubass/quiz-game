const socket = io();
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const app = $("#app");
const modal = $("#question-modal");

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

// --- MAP LOADING ---
// Declare the promise variable globally
let mapSvgPromise = null;
let mapSvgContent = null; // Optional: store the resolved content

// Immediately invoke an async function to start fetching the map
// and store the promise in mapSvgPromise.
mapSvgPromise = (async () => {
    try {
        // Assuming map.svg is in the same public directory as index.html
        const response = await fetch('map.svg');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const svgText = await response.text();
        console.log("Map SVG loaded successfully.");
        mapSvgContent = svgText; // Store the content once loaded
        return svgText; // Resolve the promise with the SVG text
    } catch (error) {
        console.error("Error loading map.svg:", error);
        // Resolve the promise with error HTML so await doesn't fail later
        const errorHtml = "<p style='color:red; font-weight:bold;'>Chyba: Nepodařilo se načíst mapu.</p>";
        mapSvgContent = errorHtml; // Store error state
        return errorHtml;
    }
})(); // Execute the async IIFE immediately
// --- END MAP LOADING ---


let state = {
    view: "home", roomId: "", myId: "", myName: "", reconnectToken: "", players: [], initialPlayerOrder: [],
    territories: [], phase: "lobby", turnIndex: 0, myTurn: false, activePlayerId: null,
    question: null, prepTime: 0, lastResult: null, turnCounter: 0, turnData: null,
    lastRevealedQuestion: null,
};

let questionTimerInterval = null;
let prepTimerInterval = null;
const MIN_PLAYERS_CLIENT = 2; // Sync with server MIN_PLAYERS if changed

// --- RENDER FUNCTIONS ---

function render() {
    console.log(`%c Render triggered: View=${state.view}, Phase=${state.phase}, MyTurn=${state.myTurn}, Active=${state.activePlayerId}`, 'color: blue; font-weight: bold;');
    app.innerHTML = ""; // Clear previous content

    switch (state.view) {
        case "home": renderHome(); hideModal(); break;
        case "lobby": renderLobby(); hideModal(); break;
        case "game": renderGame(); break; // renderGame handles modal via updateActionPanelOrModal
        default: app.innerHTML = "<h1>Chyba: Neznámý pohled</h1>"; hideModal();
    }
}

function renderHome() {
    app.innerHTML = `
        <div id="home-card" class="card">
            <h1>Dobyvatel ČR</h1>
            <input id="name" class="input" placeholder="Tvé jméno" value="${state.myName || ''}" />
            <button id="create">Vytvořit hru</button>
            <input id="code" class="input" placeholder="Kód místnosti (6 znaků)" />
            <button id="join" class="secondary">Připojit se ke hře</button>
            <p id="home-error" style="color: red; margin-top: 1rem; min-height: 1.2em;"></p>
        </div>`;
    $("#create").onclick = () => {
        const name = $("#name").value.trim(); if (!name) { $("#home-error").textContent = "Zadejte prosím jméno."; return; }
        $("#home-error").textContent = ""; state.myName = name; socket.emit("create", { name }, handleRoomResponse);
    };
    $("#join").onclick = () => {
        const name = $("#name").value.trim(); const code = $("#code").value.trim().toUpperCase(); if (!name || !code || code.length !== 6) { $("#home-error").textContent = "Zadejte jméno a platný 6místný kód."; return; }
        socket.emit("join", { roomId: state.roomId, name: state.myName, token: state.reconnectToken }, (res) => {
    };
}

function handleRoomResponse(res) {
    if (res.error) {
        console.error("Create/Join room failed:", res.error);
        const errorEl = $("#home-error"); if(errorEl) errorEl.textContent = "Chyba: " + res.error;
    } else {
        console.log("Room created/joined successfully:", res);
        state.roomId = res.roomId; state.myId = socket.id; state.players = res.players; state.reconnectToken = res.token || ""; localStorage.setItem("dobyvatel_token", state.reconnectToken); state.view = "lobby";
        render();
    }
}

function renderLobby() {
    const minPlayers = MIN_PLAYERS_CLIENT || 2;
    app.innerHTML = `
        <div id="lobby-card" class="card">
            <h2>Místnost: ${state.roomId}</h2>
            <p>Sdílej kód s přáteli. Hra je pro ${minPlayers}-6 hráčů.</p>
            <h3>Hráči:</h3>
            <ul id="player-list"></ul>
            <button id="ready">Jsem připraven</button>
            <button id="start" class="secondary" disabled>Start hry</button>
            <p id="lobby-info" style="margin-top: 1rem; min-height: 1.2em;"></p>
        </div>`;
    updatePlayerList();
    setupLobbyButtons();
}

function updatePlayerList() {
    const ul = $("#player-list"); if (!ul) return;
    ul.innerHTML = ""; let allReady = true;
    const players = Array.isArray(state.players) ? state.players : [];
    const isHost = players.length > 0 && players[0].id === state.myId;
    const minPlayers = MIN_PLAYERS_CLIENT || 2;

    players.forEach((p, index) => {
        const li = document.createElement("li"); const isMe = p.id === state.myId;
        // Use initialPlayerOrder for consistent color if available, fallback to current index
        const initialPlayerData = state.initialPlayerOrder?.find(ip => ip.id === p.id);
        const colorIndex = initialPlayerData?.initialOrder !== undefined ? initialPlayerData.initialOrder : index;
        const playerColor = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] || '#888'; // Ensure fallback color

        li.innerHTML = `
            <span><span class="player-color-dot" style="background-color: ${playerColor};"></span> ${p.name} ${isMe ? '(Ty)' : ''} ${index === 0 ? '👑' : ''}</span>
            ${p.ready ? '<span class="ready-status">✔ Připraven</span>' : '<span>⏳ Čeká...</span>'}
        `;
        ul.appendChild(li); if (!p.ready) allReady = false;
        if (isMe && $("#ready")) { $("#ready").textContent = p.ready ? "Zrušit připravenost" : "Jsem připraven"; }
    });

    const startButton = $("#start"); const lobbyInfo = $("#lobby-info");
    if (startButton && lobbyInfo) {
        const enoughPlayers = players.length >= minPlayers;
        startButton.disabled = !(isHost && enoughPlayers && allReady);
        if (!isHost) { lobbyInfo.textContent = "Čeká se, až host 👑 spustí hru."; }
        else if (!enoughPlayers) { lobbyInfo.textContent = `Čeká se na další hráče (${players.length}/${minPlayers}).`; }
        else if (!allReady) { lobbyInfo.textContent = "Čeká se, až budou všichni připraveni..."; }
        else { lobbyInfo.textContent = "Všichni připraveni. Můžeš spustit hru!"; }
    }
}

function setupLobbyButtons() {
    const readyButton = $("#ready");
    if (readyButton) {
        // Remove previous listener to avoid duplicates if re-rendered
        readyButton.onclick = null;
        readyButton.onclick = () => {
            console.log("Ready button clicked. Emitting ready event.");
            socket.emit("ready", { roomId: state.roomId });
        };
    } else {
        console.error("Ready button not found during setup.");
    }

    const startButton = $("#start");
    if (startButton) {
        startButton.onclick = null; // Remove previous listener
        startButton.onclick = () => { if (!startButton.disabled) socket.emit("start", { roomId: state.roomId }); };
    }
}

async function renderGame() {
    console.log("renderGame - Start");
    let currentMapHtml = "<p>Načítám mapu...</p>"; // Default loading text

    // Check if mapSvgPromise exists and await it if needed
    if (mapSvgPromise) {
        try {
            // Await the promise. If already resolved, this returns the value immediately.
            const svgContent = await mapSvgPromise;
            currentMapHtml = svgContent; // Use the loaded SVG or error HTML
        } catch (error) {
            // This catch might be redundant if the promise itself handles errors, but good safety.
            console.error("Error awaiting mapSvgPromise in renderGame:", error);
            currentMapHtml = "<p style='color:red;'>Chyba při zpracování mapy.</p>";
        }
    } else {
        console.error("mapSvgPromise was not initialized!");
        currentMapHtml = "<p style='color:red;'>Chyba inicializace mapy!</p>";
    }

    // Added wrapper div #game-layout for better structure
    app.innerHTML = `
        <div id="game-layout">
            <div id="map-wrapper" class="card">
                 <div id="map-container"> ${currentMapHtml} </div>
            </div>
            <div id="sidebar">
                <div class="card" id="info-panel"></div>
                <div class="card" id="action-panel">
                     <h3>Akce</h3>
                     <p id="sidebar-action-info">Načítání...</p>
                </div>
                <div class="card" id="score-panel"></div>
            </div>
        </div>
        <div id="turn-order-display"></div>
        `;

    // Use requestAnimationFrame to ensure the DOM is updated before trying to manipulate it
    requestAnimationFrame(() => {
        console.log("renderGame - requestAnimationFrame callback");
        try {
            // Update functions now operate on the newly rendered DOM
            updateMap();
            updateSidebar();
            updateTurnOrderDisplay();
            updateActionPanelOrModal();
            setupMapInteraction();
            if (state.phase === 'finished') {
                displayGameOverOverlay();
            }
        } catch(err) {
            console.error("Error during game rendering updates:", err);
            // Optionally display an error to the user in the UI
            const errorDiv = document.createElement('div');
            errorDiv.textContent = `Chyba při vykreslování: ${err.message}`;
            errorDiv.style.color = 'red';
            errorDiv.style.padding = '10px';
            if ($("#sidebar")) $("#sidebar").prepend(errorDiv);
        }
        console.log("renderGame - requestAnimationFrame callback finished");
    });
    console.log("renderGame - End");
}

function displayGameOverOverlay() {
    console.log("displayGameOverOverlay called");
    if ($('#game-over-overlay')) return; // Prevent multiple overlays

    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.width = '100%'; overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.color = 'white';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10'; // Ensure it's above the map
    overlay.style.textAlign = 'center';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';

    const reasonText = state.lastResult || "Hra skončila.";
    const sortedPlayers = [...(state.players || [])].sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const terrA = Array.isArray(a.territories) ? a.territories.length : 0;
        const terrB = Array.isArray(b.territories) ? b.territories.length : 0;
        return terrB - terrA; // Higher territory count is better
    });
    const winner = sortedPlayers.length > 0 ? sortedPlayers[0] : null;
    const winnerText = winner ? `Vítěz: ${winner.name}` : "Žádný vítěz.";

    overlay.innerHTML = `
        <h2>Hra Skončila!</h2>
        <p style="margin-bottom: 0.5rem;">${reasonText}</p>
        <p style="font-size: 1.1em; font-weight: bold; margin-bottom: 1.5rem;">${winnerText}</p>
        <h3>Konečné pořadí:</h3>
        <ol style="list-style: decimal; padding-left: 2rem; margin: 0.5rem 0 2rem 0; text-align: left; max-width: 300px;">
            ${sortedPlayers.map(p => `<li>${p.name} (${p.score || 0}b, ${Array.isArray(p.territories) ? p.territories.length : 0} krajů)</li>`).join('')}
        </ol>
        <button onclick="window.location.reload()" style="padding: 0.8rem 1.5rem; font-size: 1rem; cursor: pointer;">Nová hra</button>
    `;

    // Append to map-wrapper to contain it visually
    const mapWrapper = $("#map-wrapper");
    if (mapWrapper) {
        mapWrapper.style.position = 'relative'; // Needed for absolute positioning of overlay
        mapWrapper.appendChild(overlay);
    } else {
        console.error("Cannot display game over overlay: #map-wrapper not found.");
        // Fallback: append to body or app if map-wrapper fails
        document.body.appendChild(overlay);
    }
}


function updateMap() {
    const svg = $("#map-container svg");
    if (!svg) {
        console.warn("updateMap: SVG element not found.");
        return; // Cannot update if SVG isn't there
    }
    const territories = Array.isArray(state.territories) ? state.territories : [];
    const players = Array.isArray(state.players) ? state.players : [];
    const initialOrderMap = new Map(state.initialPlayerOrder?.map(p => [p.id, p.initialOrder]));

    // Reset styles and attributes for all regions first
    $$(".region").forEach(el => {
        el.removeAttribute("data-owner-id");
        el.classList.remove('region--owned', 'region--selectable', 'region--targetable', 'disabled');
        el.style.fill = ''; // Reset fill, will be overridden or default CSS takes over
        el.style.cursor = 'default'; // Reset cursor
        el.classList.add('disabled'); // Assume disabled initially
    });

    // Apply state to regions
    territories.forEach(territory => {
        const el = $(`#${territory.id}`);
        if (!el) {
            console.warn(`Territory element #${territory.id} not found in SVG.`);
            return;
        }

        let isDisabled = true; // Assume territory is not interactive
        const ownerId = territory.owner;

        if (ownerId) {
            // Territory is owned
            const owner = players.find(p => p.id === ownerId);
            const initialOrderIndex = initialOrderMap.get(ownerId); // Get initial order for color

            if (owner && initialOrderIndex !== undefined) {
                const colorIndex = initialOrderIndex % PLAYER_COLORS.length;
                el.setAttribute("data-owner-id", ownerId);
                el.classList.add('region--owned');
                el.style.fill = `var(--player-${colorIndex})`; // Use CSS variable for color
            } else {
                // Owner not found or missing initial order - treat as free (or handle error)
                console.warn(`Owner ${ownerId} for territory ${territory.id} not found or missing initial order. Treating as free.`);
                territory.owner = null; // Correct state if inconsistent
                el.style.fill = 'var(--region-free)';
            }
        } else {
            // Territory is free
            el.style.fill = 'var(--region-free)';
        }

        // Determine interactivity based on phase and ownership
        if (state.phase === 'draft' && state.myTurn && !ownerId) {
            el.classList.add('region--selectable');
            isDisabled = false;
        } else if (state.phase === 'turn-select-action' && state.myTurn) {
            // Can target adjacent non-owned territories
            if (ownerId !== state.myId) { // Can't target self
                const myTerritories = territories.filter(t => t.owner === state.myId).map(t => t.id);
                const isAdjacentToMine = (ADJACENCY_CLIENT[territory.id] || []).some(neighborId => myTerritories.includes(neighborId));
                if (isAdjacentToMine) {
                    el.classList.add('region--targetable');
                    isDisabled = false;
                }
            }
        }

        // Final check for enabling/disabling
        if (isDisabled) {
            el.classList.add('disabled');
            el.style.cursor = 'not-allowed';
        } else {
            el.classList.remove('disabled');
            el.style.cursor = 'pointer';
        }
    });
}

function updateSidebar() {
    updateInfoPanel();
    updateScorePanel();
}

function updateInfoPanel() {
    const infoPanel = $("#info-panel"); if (!infoPanel) return;
    const players = Array.isArray(state.players) ? state.players : [];
    const initialOrder = Array.isArray(state.initialPlayerOrder) ? state.initialPlayerOrder : [];
    let turnInfo = "Čekání na začátek hry...";
    const activePlayer = players.find(p => p.id === state.activePlayerId);
    const initialOrderMap = new Map(initialOrder.map(p => [p.id, p.initialOrder]));

    if (activePlayer) {
        const isMyTurnClass = activePlayer.id === state.myId ? 'my-turn-indicator' : '';
        const colorIndex = initialOrderMap.get(activePlayer.id);
        const playerColor = (colorIndex !== undefined) ? PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] : '#888';
        turnInfo = `<span class="${isMyTurnClass}" style="font-weight: bold;">Tah: <span class="player-color-dot" style="background-color: ${playerColor};"></span> ${activePlayer.name} ${activePlayer.id === state.myId ? '(Ty)' : ''}</span>`;
    } else if (state.phase === 'finished') { turnInfo = "Hra skončila."; }
    else if (state.phase !== 'lobby' && state.phase !== 'initializing') { turnInfo = "Probíhá akce..."; }

    let phaseDescription = "";
    switch (state.phase) {
        case "lobby": phaseDescription = "Čekání v lobby..."; break;
        case "initializing": phaseDescription = "Inicializace hry..."; break;
        case "draft-order-question": phaseDescription = "Otázka pro určení pořadí..."; break;
        case "draft-order-evaluating": phaseDescription = "Vyhodnocuji pořadí..."; break;
        case "draft": phaseDescription = activePlayer?.id === state.myId ? "Vyber své území (Draft)." : `Čeká se na ${activePlayer?.name || '?'} (Draft)...`; break;
        case "turn-select-action": phaseDescription = activePlayer?.id === state.myId ? "Vyber CÍLOVÉ území pro akci." : `Čeká se na ${activePlayer?.name || '?'}...`; break;
        case "claim-prep": phaseDescription = "Příprava (Obsazení)..."; break;
        case "duel-prep": phaseDescription = "Příprava (Duel)..."; break;
        case "prep": phaseDescription = "Příprava na otázku..."; break; // Generic prep phase?
        case "claim-question": phaseDescription = (state.activePlayerId === state.myId) ? "Odpověz na otázku!" : `Čeká se na odpověď (${getPlayer(state.activePlayerId)?.name || '?'})...`; break;
        case "duel-question":
            const attackerName = getPlayer(state.turnData?.attackerId)?.name || '?';
            const defenderName = getPlayer(state.turnData?.defenderId)?.name || '?';
            const involved = state.turnData && [state.turnData.attackerId, state.turnData.defenderId].includes(state.myId);
            phaseDescription = involved ? "Odpověz na otázku!" : `Probíhá duel (${attackerName} vs ${defenderName})...`; break;
        case "results": phaseDescription = "Zobrazuji výsledky..."; break;
        case "finished": phaseDescription = "Hra skončila!"; break;
        default: phaseDescription = `Neznámá fáze: ${state.phase}`;
    }

    let turnDataInfo = "";
    if (state.turnData && (state.phase.includes('prep') || state.phase.includes('question') || state.phase === 'results')) {
        const actor = getPlayer(state.turnData.playerId || state.turnData.attackerId)?.name || '?';
        const target = state.turnData.targetTerritoryId || '?';
        const targetRegionName = REGION_NAMES_CLIENT[target] || target; // Use display name
        const defender = getPlayer(state.turnData.defenderId)?.name;
        if (state.turnData.type === 'claim') { turnDataInfo = `Akce: ${actor} obsazuje ${targetRegionName}`; }
        else if (state.turnData.type === 'duel' && defender) { turnDataInfo = `Akce: ${actor} útočí na ${targetRegionName} (${defender})`; }
    }

    infoPanel.innerHTML = `
        <h3>Stav Hry (Kolo ${state.turnCounter || 0})</h3> <div>${turnInfo}</div>
        <div style="font-size: 0.9em; color: var(--text-muted);">Fáze: ${phaseDescription}</div>
        ${turnDataInfo ? `<div style="font-size: 0.9em; color: var(--text-muted); margin-top: 0.2em;">${turnDataInfo}</div>` : ''}
        ${state.lastResult ? `<div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color); font-style: italic;">Poslední výsledek: ${state.lastResult}</div>` : ''}
    `;
}

function updateTurnOrderDisplay() {
    const displayEl = $("#turn-order-display"); if (!displayEl) return;
    const initialOrder = state.initialPlayerOrder || [];
    const currentPlayersMap = new Map((state.players || []).map(p => [p.id, p])); // Map for quick lookup
    const activePlayerId = state.activePlayerId;

    displayEl.innerHTML = "Pořadí: "; // Reset

    initialOrder.forEach((playerInfo) => {
        // Only display players currently in the game
        if (!currentPlayersMap.has(playerInfo.id)) return;

        const span = document.createElement("span");
        span.classList.add("turn-order-dot");
        const colorIndex = playerInfo.initialOrder; // Use the stored initial order for color index
        span.style.backgroundColor = colorIndex !== undefined ? PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] : '#888';
        span.title = playerInfo.name; // Tooltip with name

        if (playerInfo.id === activePlayerId) {
            span.classList.add("active-turn");
            span.title += " (na tahu)"; // Add to tooltip
        }

        displayEl.appendChild(span);
    });
}


function updateActionPanelOrModal() {
    const sidebarActionInfo = $("#sidebar-action-info");
    // Determine if the modal should be shown based on the current game phase
    const shouldShowModal = state.phase.endsWith('-prep') || state.phase.endsWith('-question') || state.phase === 'prep' || state.phase === 'results';

    if (shouldShowModal) {
        if(sidebarActionInfo) sidebarActionInfo.textContent = "Odpověz na otázku / Sleduj výsledky v okně.";
        renderQuestionModal(); // Prepare/update modal content
        showModal();          // Ensure modal is visible
    } else {
        hideModal(); // Hide modal if not needed for the current phase
        if(sidebarActionInfo) {
            // Update sidebar text based on the phase when the modal is hidden
            const activePlayer = state.players.find(p => p.id === state.activePlayerId);
            if (state.phase === 'turn-select-action' && state.myTurn) {
                sidebarActionInfo.textContent = "KLIKNI NA MAPĚ na sousední volné nebo nepřátelské území pro akci.";
            } else if (state.phase === 'draft' && state.myTurn) {
                sidebarActionInfo.textContent = "KLIKNI NA MAPĚ na volné území pro draft.";
            } else if (state.phase === 'finished') { sidebarActionInfo.textContent = "Hra skončila."; }
            // else if (state.phase === 'results') { sidebarActionInfo.textContent = "Zobrazuji výsledky..."; } // Covered by modal now
            else if (state.phase === 'draft-order-evaluating') { sidebarActionInfo.textContent = "Vyhodnocuji pořadí..."; }
            else if (activePlayer && state.phase !== 'lobby') { sidebarActionInfo.textContent = `Čeká se na ${activePlayer.name}...`; }
            else { sidebarActionInfo.textContent = "Čekání..."; }
        }
    }
}

function showModal() {
    if (!modal) return;
    if (modal.style.display !== 'flex') {
        console.log("%c Showing modal", "color: green;");
        modal.style.display = 'flex';
        // Clear timers just in case they were left running from a previous state
        clearTimeout(prepTimerInterval); prepTimerInterval = null;
        clearTimeout(questionTimerInterval); questionTimerInterval = null;
    }
}

function hideModal() {
    if (!modal) return;
    if (modal.style.display !== 'none') {
        console.log("%c Hiding modal", "color: orange;");
        modal.style.display = 'none';
        // Clear timers when hiding the modal
        clearTimeout(prepTimerInterval); prepTimerInterval = null;
        clearTimeout(questionTimerInterval); questionTimerInterval = null;
        // Optionally clear modal content immediately
        const timerEl = $("#modal-question-timer"); const textEl = $("#modal-question-text");
        const optionsEl = $("#modal-answer-options"); const feedbackEl = $("#modal-question-feedback");
        if (timerEl) timerEl.textContent = ""; if (textEl) textEl.textContent = "";
        if (optionsEl) optionsEl.innerHTML = ""; if (feedbackEl) feedbackEl.textContent = "";
    }
}

function renderQuestionModal() {
    console.log("renderQuestionModal - Start");
    const timerEl = $("#modal-question-timer");
    const textEl = $("#modal-question-text");
    const optionsEl = $("#modal-answer-options");
    const feedbackEl = $("#modal-question-feedback");
    if (!timerEl || !textEl || !optionsEl || !feedbackEl) {
        console.error("Modal elements not found!"); return;
    }

    // Clear previous content & timers
    timerEl.textContent = ""; textEl.textContent = ""; optionsEl.innerHTML = "";
    feedbackEl.textContent = ""; feedbackEl.style.color = 'inherit'; // Reset feedback color
    clearTimeout(prepTimerInterval); prepTimerInterval = null;
    clearTimeout(questionTimerInterval); questionTimerInterval = null;
    optionsEl.classList.remove('showing-results'); // Remove results class

    console.log(`renderQuestionModal: Rendering for Phase=${state.phase}, PrepTime=${state.prepTime}, Question=${!!state.question}, Results=${!!state.lastRevealedQuestion}`);

    // --- PREP PHASE ---
    if (state.phase.endsWith('-prep') || state.phase === 'prep') {
        textEl.textContent = "Připrav se na otázku...";
        let prepCounter = state.prepTime;
        if (prepCounter > 0) {
            timerEl.textContent = `Začíná za: ${prepCounter} s`;
            prepTimerInterval = setInterval(() => {
                // Check if modal is still visible and phase is still prep
                if (!modal || modal.style.display === 'none' || (!state.phase.endsWith('-prep') && state.phase !== 'prep')) {
                    clearInterval(prepTimerInterval); prepTimerInterval = null;
                    console.log("Prep timer cleared due to phase change or modal hide.");
                    return;
                }
                prepCounter--;
                if (timerEl) timerEl.textContent = `Začíná za: ${prepCounter} s`;
                if (prepCounter <= 0) {
                    clearInterval(prepTimerInterval); prepTimerInterval = null;
                    if (timerEl) timerEl.textContent = "Načítání otázky...";
                    // Server should send 'question' event shortly after prep ends
                }
            }, 1000);
        } else {
            timerEl.textContent = "Načítání otázky...";
        }
    }
    // --- QUESTION PHASE ---
    else if (state.phase.endsWith('-question') && state.question) {
        const q = state.question;
        textEl.textContent = q.text; // Always show question text
        let questionCounter = q.limit;

        // Determine eligibility to answer
        const myPlayerId = state.myId;
        let amIEligible = false;
        if (state.phase === 'draft-order-question') amIEligible = true; // Everyone answers draft question
        else if (state.phase === 'claim-question' && state.activePlayerId === myPlayerId) amIEligible = true; // Only active player answers claim
        else if (state.phase === 'duel-question' && state.turnData && (state.turnData.attackerId === myPlayerId || state.turnData.defenderId === myPlayerId)) amIEligible = true; // Only attacker/defender answer duel

        console.log(`renderQuestionModal: Am I eligible to answer? ${amIEligible}`);

        if (amIEligible) {
            // Interactive display for the player(s) answering
            timerEl.textContent = `Zbývá: ${questionCounter} s`;
            optionsEl.innerHTML = (q.choices || []).map((choice, index) =>
                `<button class="answer-btn" data-index="${index}">${String.fromCharCode(65 + index)}. ${choice}</button>`
            ).join('');

            // Start countdown timer
            questionTimerInterval = setInterval(() => {
                // Check if modal is still visible and phase is still question
                if (!modal || modal.style.display === 'none' || !state.phase.endsWith('-question')) {
                    clearInterval(questionTimerInterval); questionTimerInterval = null;
                    console.log("Question timer cleared due to phase change or modal hide.");
                    return;
                }
                questionCounter--;
                if (timerEl) timerEl.textContent = `Zbývá: ${questionCounter} s`;
                if (questionCounter <= 0) {
                    clearInterval(questionTimerInterval); questionTimerInterval = null;
                    if (timerEl) timerEl.textContent = "Čas vypršel!";
                    if (feedbackEl) feedbackEl.textContent = "Čas vypršel.";
                    $$('#modal-answer-options .answer-btn').forEach(b => b.disabled = true); // Disable buttons
                    // Server will handle timeout and proceed
                }
            }, 1000);

            // Attach click listeners to answer buttons
            $$('#modal-answer-options .answer-btn').forEach(btn => {
                btn.onclick = () => {
                    if (!btn.disabled) {
                        const answerIndex = parseInt(btn.dataset.index);
                        console.log(`Submitting answer: ${answerIndex}`);
                        socket.emit('submitAnswer', { roomId: state.roomId, answer: answerIndex });
                        // Disable all buttons immediately after clicking
                        $$('#modal-answer-options .answer-btn').forEach(b => b.disabled = true);
                        if(feedbackEl) feedbackEl.textContent = "Odpověď odeslána...";
                        // Clear the timer as soon as an answer is submitted
                        if (questionTimerInterval) {
                            clearInterval(questionTimerInterval);
                            questionTimerInterval = null;
                            if(timerEl) timerEl.textContent = "Odpovězeno"; // Update timer display
                        }
                    }
                };
            });
        } else {
            // Read-only display for spectators
            timerEl.textContent = "Čekání na odpověď...";
            // Display choices as non-interactive text
            optionsEl.innerHTML = (q.choices || []).map((choice, index) =>
                `<div class="readonly-choice">${String.fromCharCode(65 + index)}. ${choice}</div>`
            ).join('');
            feedbackEl.textContent = "Ostatní hráči odpovídají...";
        }
    }
    // --- RESULTS PHASE ---
    else if (state.phase === 'results' && state.lastRevealedQuestion) {
        optionsEl.classList.add('showing-results'); // Add class for styling results
        timerEl.textContent = "Výsledky";
        const questionToShow = state.lastRevealedQuestion;
        textEl.textContent = questionToShow.text;

        // Re-render options as disabled buttons to show correct/incorrect
        optionsEl.innerHTML = (questionToShow.choices || []).map((choice, index) =>
            `<button class="answer-btn" data-index="${index}" disabled>${String.fromCharCode(65 + index)}. ${choice}</button>`
        ).join('');

        // Feedback text is set by the 'reveal' event handler below
        // The reveal handler will also style the buttons
        feedbackEl.textContent = state.lastResult || "Zpracovávám výsledky..."; // Use lastResult from state

    } else {
        // Fallback for unexpected states or phases where modal might still be shown
        textEl.textContent = 'Čekání na další akci...';
        timerEl.textContent = "";
        optionsEl.innerHTML = "";
        feedbackEl.textContent = "";
    }
    console.log("renderQuestionModal - End");
}

function updateScorePanel() {
    const scorePanel = $("#score-panel"); if (!scorePanel) return;
    const players = Array.isArray(state.players) ? state.players : [];
    const initialOrderMap = new Map(state.initialPlayerOrder?.map(p => [p.id, p.initialOrder]));

    // Sort players primarily by score (desc), secondarily by territory count (desc)
    const sortedPlayers = [...players].sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const terrA = Array.isArray(a.territories) ? a.territories.length : 0;
        const terrB = Array.isArray(b.territories) ? b.territories.length : 0;
        return terrB - terrA;
    });

    let rows = `<table class='table'><thead><tr><th>#</th><th>Hráč</th><th>Kraje</th><th>Body</th></tr></thead><tbody>`;
    sortedPlayers.forEach((p, index) => {
        const colorIndex = initialOrderMap.get(p.id);
        const playerColor = (colorIndex !== undefined) ? PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] : '#888';
        // Indicate active player with a class for potential styling
        const isActiveClass = p.id === state.activePlayerId ? 'active-player-row' : '';
        const territoryCount = Array.isArray(p.territories) ? p.territories.length : 0;

        rows += `<tr class="${isActiveClass}">
                    <td>${index + 1}.</td>
                    <td class="player-name">
                        <span class="player-color-dot" style="background-color: ${playerColor};"></span> ${p.name} ${p.id === state.myId ? '(Ty)' : ''}
                    </td>
                    <td>${territoryCount}</td>
                    <td>${p.score || 0}</td>
                 </tr>`;
    });
    rows += "</tbody></table>";
    scorePanel.innerHTML = `<h3>Pořadí</h3>${rows}`;
}

function setupMapInteraction() {
    const mapContainer = $("#map-container svg");
    if (!mapContainer) {
        console.warn("setupMapInteraction: SVG element not found for interaction setup.");
        return;
    }
    // Remove previous listener to prevent duplicates
    mapContainer.onclick = null;

    mapContainer.onclick = (event) => {
        const targetElement = event.target.closest('.region'); // Get the region path/group
        if (!targetElement) return; // Clicked outside a region
        if (targetElement.classList.contains('disabled')) return; // Clicked on a non-interactive region

        const territoryId = targetElement.id;

        // --- DRAFT PHASE ACTION ---
        if (state.phase === 'draft' && state.myTurn) {
            if (targetElement.classList.contains('region--selectable')) {
                console.log(`Draft pick: ${territoryId}`);
                socket.emit('draftPick', { roomId: state.roomId, territoryId });
                disableMapTemporarily(); // Prevent rapid clicks
            }
        }
        // --- ACTION SELECTION PHASE ---
        else if (state.phase === 'turn-select-action' && state.myTurn) {
            if (targetElement.classList.contains('region--targetable')) {
                const targetTerritoryId = territoryId;
                console.log(`Action selected: Target ${targetTerritoryId}`);

                // Find an adjacent territory owned by me to use as the 'from' territory
                // In this simplified model, any adjacent owned territory is sufficient.
                const myTerritories = (state.territories || []).filter(t => t.owner === state.myId).map(t => t.id);
                const possibleOrigins = (ADJACENCY_CLIENT[targetTerritoryId] || []).filter(neighborId => myTerritories.includes(neighborId));

                if (possibleOrigins.length > 0) {
                    const fromTerritoryId = possibleOrigins[0]; // Just pick the first one found
                    console.log(`   Using origin: ${fromTerritoryId}`);
                    socket.emit('selectAction', { roomId: state.roomId, fromTerritoryId, targetTerritoryId });
                    disableMapTemporarily(); // Prevent rapid clicks
                } else {
                    // Should not happen if 'region--targetable' is set correctly based on adjacency
                    console.error(`No adjacent owned origin found for target ${targetTerritoryId}, although it was marked targetable.`);
                    alert("Chyba: Nelze najít sousední vlastní území pro tuto akci. Zkuste obnovit stránku.");
                }
            }
        }
    };
}

function disableMapTemporarily(duration = 500) {
    const svg = $("#map-container svg");
    if (svg) {
        svg.style.pointerEvents = 'none'; // Disable clicks on the SVG
        setTimeout(() => {
            if (svg) { // Check if SVG still exists
                svg.style.pointerEvents = 'auto'; // Re-enable clicks
            }
        }, duration);
    }
}
function getPlayer(playerId) {
    if (!playerId || !Array.isArray(state.players)) return null;
    return state.players.find(p => p.id === playerId);
}

// --- SOCKET EVENT HANDLERS ---

socket.on("connect", () => {
    console.log("%c Connected! ID: " + socket.id, "color: green");
    const oldId = state.myId;
    state.myId = socket.id; // Update own ID

    // Attempt to rejoin if we were already in a room (e.g., after a disconnect)
    if (state.roomId && state.view !== 'home') {
        console.log(`Attempting to rejoin room ${state.roomId} as ${state.myName} (Previous ID: ${oldId}, New ID: ${state.myId})`);
        // Use the new socket.id for rejoining
        socket.emit("join", { roomId: state.roomId, name: state.myName, token: state.reconnectToken }, (res) => {
            if (res.error) {
                console.error("Rejoin failed:", res.error);
                alert("Připojení k místnosti selhalo: " + res.error + "\nBudete vráceni na hlavní obrazovku.");
                // Reset state completely and go home
                state = { view: "home", myId: socket.id, myName: state.myName, roomId: "", players: [], territories: [], phase: 'lobby', turnIndex: 0, myTurn: false, activePlayerId: null, question: null, prepTime: 0, lastResult: null, turnCounter: 0, turnData: null, initialPlayerOrder: [], lastRevealedQuestion: null, reconnectToken: "" };
                render();
            } else {
                console.log("Rejoined successfully. Waiting for state update.");
                // Server should send a full 'state' update shortly after successful rejoin
                state.roomId = res.roomId; // Ensure roomId is correct from response
                state.players = res.players; // Update player list immediately
                state.reconnectToken = res.token || "";
                localStorage.setItem("dobyvatel_token", state.reconnectToken);
                // Don't set view yet, wait for 'state' event
            }
        });
    } else if (state.view === 'home') {
        // If we were on the home screen, just render it again
        render();
    }
});
socket.on("disconnect", (reason) => {
    console.error("Disconnected:", reason);
    hideModal(); // Hide modal on disconnect
    // Display a message indicating disconnection
    app.innerHTML = `
        <div class="card">
            <h1>Spojení přerušeno</h1>
            <p>Důvod: ${reason}</p>
            <p>Probíhá pokus o znovupřipojení...</p>
            <button onclick="window.location.reload()">Obnovit stránku</button>
        </div>`;
    // Clear potentially problematic state
    state.activePlayerId = null;
    state.myTurn = false;
    state.question = null;
    state.prepTime = 0;
    // Don't reset roomId or myName to allow rejoin attempt
});
socket.on("errorMsg", (message) => {
    console.error("Server error message:", message);
    // Try to display the error in a relevant place, fallback to alert
    const errEl = $("#sidebar-action-info") || $("#lobby-info") || $("#home-error");
    if (errEl) {
        const originalText = errEl.textContent;
        errEl.textContent = `Chyba: ${message}`;
        errEl.style.color = 'red';
        setTimeout(() => {
            // Restore original text only if it hasn't changed in the meantime
            if (errEl.textContent === `Chyba: ${message}`) {
                errEl.textContent = originalText;
                errEl.style.color = ''; // Reset color
            }
        }, 5000); // Show error for 5 seconds
    } else {
        alert("Chyba: " + message);
    }
});
socket.on("players", (players) => {
    console.log("Received players update (lobby/ready):", players);
    state.players = Array.isArray(players) ? players : [];
    // Update UI based on current view
    if (state.view === "lobby") {
        updatePlayerList();
    } else if (state.view === "game") {
        // In game, player list changes affect score panel and potentially info panel
        updateScorePanel();
        updateInfoPanel();
        updateTurnOrderDisplay(); // Also update turn order display if players change
    }
});
socket.on("state", (newState) => {
    console.log(`%c STATE UPDATE | Phase: ${newState.phase}, Active: ${newState.activePlayerId}, Turn: ${newState.turnCounter}`, 'color: purple; font-weight: bold;');
    // Preserve essential client-side info across state updates
    const myId = state.myId;
    const myName = state.myName;
    const previousPhase = state.phase;
    const lastQuestion = state.lastRevealedQuestion; // Preserve the last question for results display

    // Replace the entire state, except for preserved fields
    state = { ...newState }; // Copy received state
    state.myId = myId;       // Restore my ID
    state.myName = myName;   // Restore my name
    state.reconnectToken = localStorage.getItem("dobyvatel_token") || state.reconnectToken;

    // Ensure crucial arrays are arrays, provide defaults if missing
    state.players = Array.isArray(newState.players) ? newState.players : [];
    state.initialPlayerOrder = Array.isArray(newState.initialPlayerOrder) ? newState.initialPlayerOrder : [];
    state.territories = Array.isArray(newState.territories) ? newState.territories : [];

    // Recalculate client-specific derived state
    state.myTurn = newState.activePlayerId === state.myId;

    // Reset transient state parts not included in the main state update
    state.question = null; // Question is sent separately
    state.prepTime = 0;    // Prep time is sent separately
    state.lastRevealedQuestion = lastQuestion; // Keep the last *revealed* question until next prep

    // Update view based on phase
    if (state.phase === 'finished') state.view = 'game'; // Stay in game view to show overlay
    else if (state.phase === 'lobby') state.view = 'lobby';
    else state.view = 'game'; // Default to game view if not lobby/finished

    console.log("New client state:", JSON.parse(JSON.stringify(state))); // Deep copy for logging

    render(); // Re-render the UI based on the new state

    // Hide modal logic refinement: Hide modal if the new phase is NOT a modal phase,
    // unless the previous phase was also not a modal phase (avoids hiding unnecessarily).
    const wasInModalPhase = previousPhase.endsWith('-prep') || previousPhase.endsWith('-question') || previousPhase === 'prep' || previousPhase === 'results';
    const isInModalPhase = state.phase.endsWith('-prep') || state.phase.endsWith('-question') || state.phase === 'prep' || state.phase === 'results';

    if (wasInModalPhase && !isInModalPhase) {
        console.log("Hiding modal because phase changed from modal phase to non-modal phase.");
        hideModal();
    } else if (!isInModalPhase) {
        // Ensure modal is hidden if current phase doesn't require it (e.g., after reconnect)
        hideModal();
    }
    // updateActionPanelOrModal() called within render() -> requestAnimationFrame will handle showing/updating modal if needed
});
socket.on("prep", ({ time, type }) => {
    console.log(`%c PREP | T=${time}, Type=${type}. CurrentPhase=${state.phase}`, 'color: #0088cc');
    state.prepTime = time;
    state.question = null; // Clear any old question
    state.lastRevealedQuestion = null; // Clear revealed question to signify new question cycle

    // Determine the expected phase based on the prep type
    let expectedPhase = 'prep'; // Generic fallback
    if (type === 'claim') expectedPhase = 'claim-prep';
    else if (type === 'duel') expectedPhase = 'duel-prep';
    else if (type === 'draft') expectedPhase = 'draft-order-question'; // Draft prep leads to draft question phase

    state.phase = expectedPhase; // Update phase based on prep signal

    if (state.view === 'game') {
        updateActionPanelOrModal(); // Update UI immediately to show prep in modal
    }
});
socket.on("question", ({ q, limit, type }) => {
    console.log(`%c QUESTION | Type=${type}, L=${limit}, Txt=${q?.text?.substring(0, 30)}... CurrentPhase=${state.phase}`, 'color: #00aa00');
    state.question = { ...q, limit, type }; // Store the new question details
    state.prepTime = 0; // Prep time is over

    // Determine the expected phase based on the question type
    let expectedPhase = 'unknown-question';
    if (type === 'claim') expectedPhase = 'claim-question';
    else if (type === 'duel') expectedPhase = 'duel-question';
    else if (type === 'draft') expectedPhase = 'draft-order-question';

    state.phase = expectedPhase; // Update phase based on question signal

    if (state.view === 'game') {
        updateActionPanelOrModal(); // Update UI immediately to show question in modal
    }
});

socket.on("reveal", ({ correctIndex, playerAnswers, resultText }) => {
    console.log(`%c REVEAL | CorrectIdx=${correctIndex}, Result=${resultText}`, 'color: #cc00cc');
    state.phase = 'results'; // Set phase to results
    state.lastResult = resultText || state.lastResult; // Update last result text
    // Store the question that was just answered for display during results
    state.lastRevealedQuestion = state.question || state.lastRevealedQuestion;
    state.question = null; // Clear the active question
    state.prepTime = 0;

    if (state.view === 'game') {
        updateInfoPanel(); // Update sidebar info to show 'results' phase and last result

        // Ensure modal is visible and render its content for the results
        if (modal) {
            showModal(); // Make sure it's visible
            renderQuestionModal(); // Re-render modal content for results phase

            // Now style the buttons and update feedback based on results
            const feedbackEl = $("#modal-question-feedback");
            const optionsEl = $("#modal-answer-options");
            const questionForReveal = state.lastRevealedQuestion;

            if (optionsEl && questionForReveal?.choices && correctIndex !== null && correctIndex !== undefined) {
                optionsEl.querySelectorAll('.answer-btn').forEach((btn, index) => {
                    const myAnswerData = playerAnswers ? playerAnswers[state.myId] : null;
                    const myAnswerIndex = myAnswerData?.answer;

                    btn.classList.remove('correct', 'incorrect', 'my-answer'); // Reset previous styles
                    btn.style.opacity = '0.6'; // Dim initially

                    if (index === correctIndex) {
                        btn.classList.add('correct');
                        if (myAnswerIndex === index) {
                            btn.classList.add('my-answer');
                        }
                        btn.style.opacity = '1'; // Highlight correct
                    } else if (myAnswerIndex === index) {
                        // My answer was incorrect
                        btn.classList.add('incorrect', 'my-answer');
                        btn.style.opacity = '1';
                    }
                });
            } else {
                console.warn("Cannot style reveal options: missing elements, choices, or correctIndex.");
            }

            // Update feedback text based on personal result
            if (feedbackEl && questionForReveal) {
                const myAnswerData = playerAnswers ? playerAnswers[state.myId] : null;
                const myAnswerIndex = myAnswerData?.answer;
                let feedbackMsg = resultText || "Výsledky zpracovány."; // Default message
                let wasEligible = false; // Determine if I was supposed to answer

                const qType = questionForReveal?.type;
                if (qType === 'draft') wasEligible = true;
                else if (qType === 'claim' && state.turnData?.playerId === state.myId) wasEligible = true;
                else if (qType === 'duel' && state.turnData && (state.turnData.attackerId === state.myId || state.turnData.defenderId === state.myId)) wasEligible = true;

                if (wasEligible && myAnswerIndex !== undefined && myAnswerIndex !== null && correctIndex !== undefined && correctIndex !== null) {
                    // I answered and was eligible
                    if (myAnswerIndex === correctIndex) {
                        feedbackMsg = `✔ Správná odpověď! ${resultText || ""}`;
                        feedbackEl.style.color = 'var(--success-color)'; // Use CSS variable
                    } else {
                        const correctChoiceText = questionForReveal.choices[correctIndex] ?? '?';
                        feedbackMsg = `❌ Špatná odpověď. ${resultText || ""} Správně: ${String.fromCharCode(65 + correctIndex)}. ${correctChoiceText}`;
                        feedbackEl.style.color = 'var(--error-color)'; // Use CSS variable
                    }
                } else if (wasEligible) {
                    // I was eligible but didn't answer (or answer was invalid)
                    const correctChoiceText = questionForReveal.choices[correctIndex] ?? '?';
                    feedbackMsg = `⏱️ Čas/Bez odpovědi. Správně: ${String.fromCharCode(65 + correctIndex)}. ${correctChoiceText}. ${resultText || ""}`;
                    feedbackEl.style.color = 'var(--text-muted)';
                } else {
                    // I was not eligible to answer (spectator)
                    feedbackMsg = resultText || "Výsledky zpracovány."; // Just show the general result
                    feedbackEl.style.color = 'inherit'; // Default color
                }
                feedbackEl.textContent = feedbackMsg.trim();
            } else if (feedbackEl) {
                // Fallback if data is missing
                feedbackEl.textContent = resultText || "Výsledky zpracovány.";
                feedbackEl.style.color = 'inherit';
            }

        } else {
            console.warn("Reveal received, but modal element not found.");
        }
    } else {
        console.log("Reveal received, but not in game view.");
    }
});


socket.on("gameOver", ({ reason, players }) => {
    console.log("%c GAME OVER | Reason: " + reason, "color: red; font-weight: bold;");
    state.phase = 'finished';
    state.players = players; // Update with final player data (scores, territories)
    state.lastResult = reason;
    state.view = 'game'; // Stay in game view to show the overlay
    state.activePlayerId = null;
    state.myTurn = false;
    state.question = null; state.prepTime = 0; state.lastRevealedQuestion = null;
    hideModal(); // Ensure modal is hidden
    render(); // Re-render to potentially update panels and trigger overlay display

const ADJACENCY_CLIENT = {
    "PHA": ["STC"], "STC": ["PHA", "JHC", "PLK", "KVK", "ULK", "LBK", "HKK", "PAK", "VYS"], "JHC": ["STC", "PLK", "VYS", "JHM"], "PLK": ["STC", "JHC", "KVK", "ULK"], "KVK": ["STC", "PLK", "ULK"], "ULK": ["STC", "PLK", "KVK", "LBK"], "LBK": ["STC", "ULK", "HKK"], "HKK": ["STC", "LBK", "PAK", "OLK"], "PAK": ["STC", "HKK", "OLK", "VYS", "JHM"], "VYS": ["STC", "JHC", "PAK", "JHM", "ZLK", "OLK"], "JHM": ["JHC", "PAK", "VYS", "ZLK"], "ZLK": ["VYS", "JHM", "OLK", "MSK"], "OLK": ["HKK", "PAK", "VYS", "ZLK", "MSK"], "MSK": ["OLK", "ZLK"]
};

// Add region names for display purposes
const REGION_NAMES_CLIENT = {
    "PHA": "Praha", "STC": "Středočeský", "JHC": "Jihočeský", "PLK": "Plzeňský",
    "KVK": "Karlovarský", "ULK": "Ústecký", "LBK": "Liberecký", "HKK": "Královéhradecký",
    "PAK": "Pardubický", "VYS": "Vysočina", "JHM": "Jihomoravský", "ZLK": "Zlínský",
    "OLK": "Olomoucký", "MSK": "Moravskoslezský"
};


function areAdjacentClient(r1, r2) {
    if (!r1 || !r2) return false;
    return ADJACENCY_CLIENT[r1]?.includes(r2) || ADJACENCY_CLIENT[r2]?.includes(r1);
}

// Load player name from localStorage
state.myName = localStorage.getItem("dobyvatel_playerName") || "";
state.reconnectToken = localStorage.getItem("dobyvatel_token") || "";

// Save player name to localStorage on input change
document.addEventListener('input', (e) => {
    if (e.target.id === 'name') {
        state.myName = e.target.value;
        localStorage.setItem("dobyvatel_playerName", state.myName);
    }
});

// Initial render call when script loads
console.log("Client script loaded. Initializing...");
render(); // Start the application rendering process