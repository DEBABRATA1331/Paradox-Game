// Basic State Management
// (Moved to below)

// Basic State Management
const state = {
    view: 'loading',
    role: null,
    playerName: '',
    isHost: false,
    audioContext: null,
    peer: null,        // My Peer Object
    conn: null,        // Active Connection (for Player)
    connections: [],   // List of Player Connections (for Host)
    hostId: null,      // Host Peer ID
    players: [],       // Player List [{id, name, role, lat, lng, alive}]
    tasksCompleted: 0
};

// --- NETWORK MANAGER ---
const Net = {
    init: (isHost, finishCallback) => {
        state.peer = new Peer(null, { debug: 2 });

        state.peer.on('open', (id) => {
            console.log('My Peer ID is: ' + id);
            state.myId = id;
            if (finishCallback) finishCallback(id);
        });

        // HOST: Listen for connections
        if (isHost) {
            state.peer.on('connection', (c) => {
                Net.handleIncomingConnection(c);
            });
        }
    },
    connectToHost: (hostId) => {
        state.hostId = hostId;
        const conn = state.peer.connect(hostId);
        state.conn = conn;

        conn.on('open', () => {
            console.log("Connected to Host");
            // Send Handshake
            conn.send({ type: 'JOIN', name: state.playerName });
            renderPlayerLobbyWait();
        });

        conn.on('data', (data) => Net.handleData(data));
        conn.on('error', (err) => alert("Connection Error: " + err));
    },
    handleIncomingConnection: (conn) => {
        // Enforce 8 Player Limit
        if (state.players.length >= 8) {
            conn.on('open', () => {
                conn.send({ type: 'ERROR', message: 'ROOM FULL' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        state.connections.push(conn);
        conn.on('data', (data) => {
            // RELAY or PROCESS
            if (data.type === 'JOIN') {
                // Auto-assign Color
                const colors = ['#FF0000', '#00FF00', '#0088FF', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#FFFFFF'];
                const color = colors[state.players.length % colors.length];

                const newPlayer = {
                    id: conn.peer,
                    name: data.name,
                    role: null,
                    alive: true,
                    lat: 0, lng: 0,
                    color: color
                };
                state.players.push(newPlayer);
                Net.broadcast({ type: 'PLAYER_LIST', players: state.players });

                // **AUTO-START LOGIC**
                if (state.players.length === 4) {
                    setTimeout(() => window.startGame(), 2000);
                }
            }
            else if (data.type === 'GPS') {
                // Update player location
                const p = state.players.find(x => x.id === conn.peer);
                if (p) { p.lat = data.lat; p.lng = data.lng; }
                // Re-broadcast radar data? Or just Host uses it locally.
                // For now, Host just renders it.
            }
            else if (data.type === 'TASK_COMPLETE') {
                window.hostHandleTaskComplete();
            }
        });
    },
    broadcast: (msg) => {
        state.connections.forEach(c => c.send(msg));
    },
    handleData: (data) => {
        // CLIENT Logic
        if (data.type === 'PLAYER_LIST') {
            state.players = data.players;
        }
        else if (data.type === 'GAME_START') {
            // NO-OP, handled by Scenario
        }
        else if (data.type === 'SCENARIO') {
            renderPlayerScenario(data.text);
        }
        else if (data.type === 'WIN') {
            triggerGameEnd(data.winner);
        }
        else if (data.type === 'ROUND_RESULT') {
            app.innerHTML = `
                <div class="view active fade-in">
                    <h1 style="color: var(--neon-cyan);">${data.text}</h1>
                    <p>NEXT ROUND STARTING...</p>
                </div>
            `;
        }
        else if (data.type === 'ERROR') {
            alert("CONNECTION DENIED: " + data.message);
            window.location.reload();
        }

        // HOST Logic (if receiving from client)
        if (state.isHost) {
            if (data.type === 'VOTE') {
                processVote(data.target);
            }
        }
    }
};

// --- LOCATION / RADAR ---
const Loc = {
    watchId: null,
    start: () => {
        if (!navigator.geolocation) return;
        Loc.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                // Send to host
                if (!state.isHost && state.conn) {
                    state.conn.send({ type: 'GPS', lat: latitude, lng: longitude });
                }
            },
            (err) => console.warn("GPS Error", err),
            { enableHighAccuracy: true }
        );
    },
    renderRadar: (canvasId) => {
        const c = document.getElementById(canvasId);
        if (!c) return;
        const ctx = c.getContext('2d');
        // Simple Radar Loop
        const draw = () => {
            console.log("Drawing Radar...");
            // Mock Radar Implementation
            // Center is Host
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.strokeStyle = 'var(--neon-cyan)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(c.width / 2, c.height / 2, 50, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(c.width / 2, c.height / 2, 100, 0, Math.PI * 2);
            ctx.stroke();

            // Draw Players (Relative to 0,0 for now, assumes mock Joystick or close range)
            state.players.forEach((p, i) => {
                // Mocking position for visual demo if 0,0
                let x = c.width / 2 + (p.lng || (Math.cos(i) * 50));
                let y = c.height / 2 + (p.lat || (Math.sin(i) * 50));

                ctx.fillStyle = p.color || '#fff';
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fill();

                // Host sees Shadows marked
                if (p.role === 'SHADOW' && state.isHost) {
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                ctx.fillStyle = '#fff';
                ctx.font = '10px monospace';
                ctx.fillText(p.name, x + 12, y);
            });
            requestAnimationFrame(draw);
        };
        draw();
    }
};


// --- AUDIO MANAGER ---
const Audio = {
    ctx: null,
    init: () => {
        if (!Audio.ctx) {
            Audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
            Audio.startAmbience();
            if (window.ParticleSystem) ParticleSystem.init();
        }
    },
    playTone: (freq, type, duration, vol = 0.1) => {
        if (!Audio.ctx) return;
        const osc = Audio.ctx.createOscillator();
        const gain = Audio.ctx.createGain();
        osc.type = type; // sine, square, sawtooth
        osc.frequency.setValueAtTime(freq, Audio.ctx.currentTime);
        gain.gain.setValueAtTime(vol, Audio.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, Audio.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(Audio.ctx.destination);
        osc.start();
        osc.stop(Audio.ctx.currentTime + duration);
    },
    playGlitch: () => {
        Audio.playTone(Math.random() * 1000 + 100, 'sawtooth', 0.1, 0.2);
        Audio.playTone(Math.random() * 500 + 50, 'square', 0.05, 0.2);
    },
    playBeep: () => Audio.playTone(1200, 'sine', 0.1, 0.1),
    playAlarm: () => {
        if (!Audio.ctx) return;
        const now = Audio.ctx.currentTime;
        const osc = Audio.ctx.createOscillator();
        const gain = Audio.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(400, now + 0.5);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.connect(gain);
        gain.connect(Audio.ctx.destination);
        osc.start();
        osc.stop(now + 0.5);
    },
    startAmbience: () => {
        // Low drone
        const osc = Audio.ctx.createOscillator();
        const gain = Audio.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50, Audio.ctx.currentTime);
        gain.gain.setValueAtTime(0.05, Audio.ctx.currentTime);
        osc.connect(gain);
        gain.connect(Audio.ctx.destination);
        osc.start();
    }
};

// --- PARTICLES ---
const ParticleSystem = {
    canvas: null,
    ctx: null,
    particles: [],
    init: () => {
        const c = document.getElementById('bg-particles');
        if (!c) return;
        ParticleSystem.canvas = c;
        ParticleSystem.ctx = c.getContext('2d');
        c.width = window.innerWidth;
        c.height = window.innerHeight;

        for (let i = 0; i < 50; i++) {
            ParticleSystem.particles.push({
                x: Math.random() * c.width,
                y: Math.random() * c.height,
                size: Math.random() * 2,
                speed: Math.random() * 0.5 + 0.1
            });
        }
        ParticleSystem.animate();
        window.addEventListener('resize', () => {
            c.width = window.innerWidth;
            c.height = window.innerHeight;
        });
    },
    animate: () => {
        const { ctx, canvas, particles } = ParticleSystem;
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';

        particles.forEach(p => {
            p.y -= p.speed;
            if (p.y < 0) p.y = canvas.height;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        requestAnimationFrame(ParticleSystem.animate);
    }
};

// DOM Elements
const app = document.getElementById('app');

function renderHomeButton() {
    // Check if button already exists
    if (document.getElementById('btn-home')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-home';
    btn.innerText = 'HOME';
    btn.style.position = 'fixed';
    btn.style.top = '10px';
    btn.style.left = '10px';
    btn.style.zIndex = '9999';
    btn.style.background = '#000';
    btn.style.border = '1px solid #333';
    btn.style.color = '#fff';
    btn.style.padding = '5px 10px';
    btn.style.cursor = 'pointer';
    btn.onclick = () => window.location.reload();
    document.body.appendChild(btn);
}

// init
window.addEventListener('click', () => {
    // Audio context must be resumed on user gesture
    Audio.init();
}, { once: true });

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // Simulate connection
        initializeGame();
        ParticleSystem.init();
    }, 2500);
});

function initializeGame() {
    // For prototype: We just ask if they are Host or Player
    renderRoleSelection();
    renderHomeButton();
}

function renderRoleSelection() {
    app.innerHTML = `
        <div class="view active fade-in bg-poster">
            <h1 class="glitch" data-text="SELECT TERMINAL">SELECT TERMINAL</h1>
            <div style="display: flex; gap: 20px; margin-top: 40px;">
                <button class="btn-main" onclick="setMode('HOST')">HOST CONSOLE</button>
                <button class="btn-main" onclick="setMode('PLAYER')">PERSONAL TERMINAL</button>
            </div>
        </div>
    `;
    window.setMode = (mode) => {
        if (mode === 'HOST') {
            state.isHost = true;
            renderHostLobby();
        } else {
            state.isHost = false;
            renderPlayerJoin();
        }
    };
}


function renderHostLobby() {
    Net.init(true, (id) => {
        // Detect Production vs Local
        const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        const inputStyle = isProd ? 'display:none;' : 'display:block;';
        const btnText = isProd ? 'SHOW JOIN QR' : 'GENERATE QR';

        app.innerHTML = `
            <div class="view active fade-in">
                <div class="holo-panel" style="width: 800px; height: 600px; display: flex;">
                    <div style="flex: 1; border-right: 1px solid var(--neon-cyan); padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        <input type="text" id="host-ip" placeholder="YOUR LOCAL IP (e.g. 192.168.1.5)" style="background:transparent; border:1px solid #555; color:white; padding:5px; text-align:center; width:100%; margin-bottom: 10px; ${inputStyle}">
                        <button class="btn-sm" onclick="generateQR('${id}')" style="margin-bottom:20px;">${btnText}</button>
                        <div id="qr-target" style="border: 2px solid var(--neon-cyan); padding: 10px; background:white;"></div>
                        <p style="margin-top: 20px; color: var(--neon-cyan); font-size:0.8rem;">SCAN THIS TO JOIN</p>
                    </div>
                    <div style="flex: 1; padding: 20px;">
                        <h2>CONNECTED AGENTS</h2>
                        <ul id="player-list" style="list-style: none; margin-top: 20px; text-align: left;">
                            <!-- Players injected here -->
                        </ul>
                        <button class="btn-main" style="width: 100%; margin-top: auto;" onclick="startGame()">INITIATE SEQUENCE</button>
                    </div>
                </div>
            </div>
        `;

        // Auto-update player list
        setInterval(() => {
            const list = document.getElementById('player-list');
            if (list) {
                list.innerHTML = state.players.map(p =>
                    `<li style="padding: 10px; border-bottom: 1px solid #333; color: ${p.color || 'var(--neon-green)'}; display:flex; align-items:center;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${p.color || '#fff'}; margin-right:10px;"></span> 
                        > ${p.name.toUpperCase()} [ONLINE]
                     </li>`
                ).join('');
            }
        }, 1000);
    });

    window.generateQR = (peerId) => {
        let base = window.location.origin; // Default to current URL (works for Render/Prod)

        // If Localhost and user typed an override IP
        const manualIp = document.getElementById('host-ip').value;
        if (manualIp && manualIp.trim() !== '') {
            base = `http://${manualIp}:8000`;
        }

        const url = `${base}/?host=${peerId}`;
        console.log("Generating QR for:", url); // Debug

        document.getElementById('qr-target').innerHTML = '';
        new QRCode(document.getElementById('qr-target'), {
            text: url,
            width: 200,
            height: 200
        });
    };

    // --- SCENARIO & ELIMINATION LOGIC ---
    const SCENARIOS = [
        "OXYGEN LEAK DETECTED. FILTERS SABOTAGED.",
        "NAVIGATION OFFLINE. WHO ALTERED THE COURSE?",
        "FOOD SUPPLIES CONTAMINATED. POISON FOUND.",
        "REACTOR UNSTABLE. COOLANT LINES CUT.",
        "COMMUNICATIONS JAMMED. UNAUTHORIZED SIGNAL SENT.",
        "ESCAPE POD LAUNCHED EMPTY. SOMEONE IS HIDING.",
        "MEDICAL BAY BREACHED. DATA STOLEN.",
        "SHIELDS LOWERED. WE ARE VULNERABLE."
    ];

    state.votes = {}; // { targetName: count }
    state.currentScenario = "";

    window.startGame = () => {
        // START GAME
        Net.broadcast({ type: 'GAME_START' });
        startScenarioPhase();
    };

    function startScenarioPhase() {
        state.view = 'scenario';
        state.votes = {};

        // Pick Random Scenario
        const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
        state.currentScenario = scenario;

        // Notify All
        Net.broadcast({ type: 'SCENARIO', text: scenario });

        // Render Host View
        renderHostScenario(scenario);
    }

    function renderHostScenario(text) {
        app.innerHTML = `
        <div class="view active fade-in" style="border: 4px solid var(--neon-cyan);">
            <h1 class="glitch" data-text="CRISIS ALERT">CRISIS ALERT</h1>
            <div class="holo-panel" style="margin: 40px auto; padding: 40px; border-color: var(--alert-red);">
                <h2 style="font-size: 2rem; color: var(--alert-red);">${text}</h2>
            </div>
            <p>WAITING FOR AGENT DELIBERATION...</p>
            <div id="vote-tally" style="margin-top: 30px;"></div>
        </div>
    `;
    }

    function renderPlayerScenario(text) {
        app.innerHTML = `
        <div class="view active fade-in">
            <h2 style="color: var(--alert-red);">SITUATION REPORT</h2>
            <div class="holo-panel" style="margin: 20px 0; border-color: var(--alert-red);">
                <p style="font-size: 1.5rem;">${text}</p>
            </div>
            <p>WHO IS RESPONSIBLE?</p>
            <button class="btn-main" onclick="renderVotingScreen()" style="margin-top: 30px;">CAST VOTE</button>
        </div>
    `;
        Audio.playAlarm();
    }

    window.renderVotingScreen = () => {
        const alivePlayers = state.players.filter(p => p.alive && p.id !== state.myId);

        // If I am dead, show dead screen
        // TODO: Need strict dead check logic later

        const btns = alivePlayers.map(p => `
        <button class="vote-btn" onclick="castVote('${p.name}')" style="border-color:${p.color}; color:${p.color};">
            ${p.name}
        </button>
    `).join('');

        app.innerHTML = `
        <div class="view active fade-in">
            <h2>SELECT TARGET</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 30px;">
                ${btns}
                <button class="vote-btn" onclick="castVote('SKIP')" style="grid-column: span 2; border-color: #666; color: #aaa;">SKIP VOTE</button>
            </div>
        </div>
    `;
    };

    window.castVote = (target) => {
        // Send Vote to Host
        if (state.conn) {
            state.conn.send({ type: 'VOTE', target: target });
        }

        app.innerHTML = `
        <div class="view active fade-in">
            <h2>VOTE TRANSMITTED</h2>
            <h1 style="color: var(--neon-cyan); margin: 40px 0;">${target}</h1>
            <p>AWAITING CONSENSUS...</p>
            <div class="loader-bar" style="width: 200px; margin: 20px auto;"><div class="fill" style="width: 100%; animation: none; background: #333;"></div></div>
        </div>
    `;
    };

    // --- ELIMINATION LOGIC (HOST) ---
    function processVote(target) {
        state.votes[target] = (state.votes[target] || 0) + 1;

        // Update Host UI Tally
        const tallyEl = document.getElementById('vote-tally');
        if (tallyEl) {
            tallyEl.innerHTML = Object.entries(state.votes).map(([k, v]) => `<div>${k}: ${v}</div>`).join('');
        }

        // Check if everyone voted
        const livingCount = state.players.filter(p => p.alive).length;
        const votesCast = Object.values(state.votes).reduce((a, b) => a + b, 0);

        if (votesCast >= livingCount) {
            resolveRound();
        }
    }

    function resolveRound() {
        // Find Max
        let maxVotes = 0;
        let eliminated = null;

        // Simple Majority
        for (const [name, count] of Object.entries(state.votes)) {
            if (count > maxVotes) {
                maxVotes = count;
                eliminated = name;
            } else if (count === maxVotes) {
                eliminated = 'TIE'; // No one dies on tie
            }
        }

        let resultMsg = "NO CONSENSUS REACHED.";

        if (eliminated && eliminated !== 'TIE' && eliminated !== 'SKIP') {
            const p = state.players.find(x => x.name === eliminated);
            if (p) {
                p.alive = false;
                resultMsg = `${p.name} WAS EJECTED.`;
                // Check Win (e.g. 1 Survivor)
                const survivors = state.players.filter(x => x.alive).length;
                if (survivors <= 1) {
                    Net.broadcast({ type: 'WIN', winner: state.players.find(x => x.alive).name + " WINS!" });
                    triggerGameEnd(state.players.find(x => x.alive).name);
                    return;
                }
            }
        }

        // Broadcast Result
        Net.broadcast({ type: 'ROUND_RESULT', text: resultMsg });

        // Show Result on Host
        app.innerHTML = `
        <div class="view active fade-in">
            <h1 style="font-size: 3rem; color: var(--neon-cyan);">${resultMsg}</h1>
            <p>NEXT CRISIS IMMINENT...</p>
        </div>
    `;

        setTimeout(() => startScenarioPhase(), 5000);
    }

    document.body.classList.remove('red-alert');
    app.classList.remove('shake');
    triggerGameEnd('SHADOW');
}, 3000); // Shadow wins after 3 seconds for demo
}
