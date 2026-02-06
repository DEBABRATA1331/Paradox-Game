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
        state.connections.push(conn);
        conn.on('data', (data) => {
            // RELAY or PROCESS
            if (data.type === 'JOIN') {
                const newPlayer = {
                    id: conn.peer,
                    name: data.name,
                    role: null,
                    alive: true,
                    lat: 0, lng: 0
                };
                state.players.push(newPlayer);
                Net.broadcast({ type: 'PLAYER_LIST', players: state.players });
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
            // Update Lobby UI if open
        }
        else if (data.type === 'GAME_START') {
            // Find my role
            const me = state.players.find(p => p.id === state.myId);
            if (me) {
                state.role = me.role;
                triggerRoleReveal();
            }
        }
        else if (data.type === 'WIN') {
            triggerGameEnd(data.winner);
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

                ctx.fillStyle = p.role === 'SHADOW' && state.isHost ? 'var(--alert-red)' : 'var(--neon-green)';
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillText(p.name, x + 10, y);
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
        app.innerHTML = `
            <div class="view active fade-in">
                <div class="holo-panel" style="width: 800px; height: 600px; display: flex;">
                    <div style="flex: 1; border-right: 1px solid var(--neon-cyan); padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        <input type="text" id="host-ip" placeholder="YOUR LOCAL IP (e.g. 192.168.1.5)" style="background:transparent; border:1px solid #555; color:white; padding:5px; text-align:center; width:100%;">
                        <button class="btn-sm" onclick="generateQR('${id}')" style="margin-bottom:20px;">GENERATE QR</button>
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
                    `<li style="padding: 10px; border-bottom: 1px solid #333; color: var(--neon-green);"> > ${p.name.toUpperCase()} [ONLINE]</li>`
                ).join('');
            }
        }, 1000);
    });

    window.generateQR = (peerId) => {
        const ip = document.getElementById('host-ip').value || window.location.hostname;
        const url = `http://${ip}:8000/?host=${peerId}`;
        document.getElementById('qr-target').innerHTML = '';
        new QRCode(document.getElementById('qr-target'), {
            text: url,
            width: 200,
            height: 200
        });
    };

    window.startGame = () => {
        // Assign Roles
        state.players.forEach(p => p.role = 'CREW');
        if (state.players.length > 0) {
            state.players[Math.floor(Math.random() * state.players.length)].role = 'SHADOW';
        }
        Net.broadcast({ type: 'GAME_START' });

        // Host enters game
        renderHostGame();
    };
}

function renderPlayerJoin() {
    // Check for URL param
    const urlParams = new URLSearchParams(window.location.search);
    const hostParam = urlParams.get('host');

    app.innerHTML = `
        <div class="view active fade-in">
             <div class="holo-panel">
                <h2>IDENTIFICATION REQUIRED</h2>
                <input type="text" id="p-name" placeholder="ENTER CODENAME" style="width: 100%; padding: 15px; margin: 20px 0; background: transparent; border: 1px solid var(--neon-cyan); color: white; font-family: var(--font-mono); font-size: 1.2rem; text-align: center;">
                ${hostParam ? `<p style="color:var(--neon-green)">TARGET HOST DETECTED</p>` : `<input type="text" id="target-host" placeholder="HOST PEER ID" style="width: 100%; padding: 15px; margin-bottom: 20px; background: transparent; border: 1px solid #555; color: #888;">`}
                
                <button class="btn-main" onclick="joinLobby('${hostParam || ''}')">ESTABLISH LINK</button>
             </div>
        </div>
    `;

    window.joinLobby = (preHost) => {
        const name = document.getElementById('p-name').value;
        const hostId = preHost || document.getElementById('target-host').value;
        if (!name || !hostId) return alert("MISSING CREDENTIALS");

        state.playerName = name;
        Net.init(false, () => {
            Net.connectToHost(hostId);
        });
    };
}

function renderPlayerLobbyWait() {
    app.innerHTML = `
        <div class="view active">
            <h2 class="glitch" data-text="ACCESS GRANTED">ACCESS GRANTED</h2>
            <p>AWAITING HOST INITIATION...</p>
            <div class="loader-bar" style="width: 100px; margin: 20px auto;"><div class="fill" style="animation-duration: 2s; animation-iteration-count:infinite;"></div></div>
            <button class="btn-sm" style="margin-top:50px" onclick="Audio.init()">INITIALIZE AUDIO SYSTEMS</button>
            <p style="font-size:0.8rem; color:#666; margin-top:10px;">(REQUIRED FOR COMMS)</p>
        </div>
    `;
    Loc.start();
}



// --- GAME LOOP ---

function triggerRoleReveal() {
    // Random role
    const isShadow = Math.random() > 0.7;
    const role = isShadow ? 'SHADOW' : 'CREW';
    state.role = role;
    const color = isShadow ? 'var(--alert-red)' : 'var(--neon-green)';

    // Animation
    app.innerHTML = `<div class="view active bg-reveal" style="background-color: black; z-index: 2000; display: flex; align-items: center; justify-content: center;">
        <h1 style="font-size: 5rem; color: white;">ANALYZING DNA...</h1>
    </div>`;

    setTimeout(() => {
        app.innerHTML = `
            <div class="view active fade-in" style="${isShadow ? 'box-shadow: inset 0 0 100px rgba(255, 42, 42, 0.4);' : ''}">
                <h3 style="color: #666; margin-bottom: 20px;">YOUR IDENTITY</h3>
                <h1 class="glitch" data-text="${role}" style="font-size: 5rem; color: ${color};">${role}</h1>
                <div class="holo-panel" style="margin-top: 40px; border-color: ${color}; max-width: 500px;">
                    <p style="font-size: 1.2rem; line-height: 1.5;">
                        ${isShadow
                ? 'ELIMINATE THE CREW. DO NOT GET CAUGHT. SABOTAGE THE REACTOR.'
                : 'REPAIR THE STATION. IDENTIFY THE SHADOWS. SURVIVE.'}
                    </p>
                </div>
                <button class="btn-main" onclick="enterMainGame()">INITIALIZE PROTOCOL</button>
            </div>
        `;
    }, 3000);
}

window.enterMainGame = () => {
    if (state.isHost) {
        renderHostGame();
    } else {
        renderPlayerGame();
    }
};

// --- HOST GAME View ---
function renderHostGame() {
    state.view = 'game';
    // Simplified Ship Status
    app.innerHTML = `
        <div class="view active">
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; width: 90%; height: 80%;">
                
                <!-- MAP / STATUS -->
                <div class="holo-panel">
                    <h2>STATION STATUS (RADAR)</h2>
                    <div style="position:relative; width: 100%; height: 300px; margin-bottom: 20px; border: 1px solid var(--neon-cyan); box-shadow: 0 0 15px rgba(0, 243, 255, 0.2);">
                         <div class="concept-map" style="position:absolute; top:0; left:0; height:100%; width:100%; opacity:0.3; border:none; box-shadow:none;"></div>
                         <canvas id="radar-canvas" width="600" height="300" style="position:absolute; top:0; left:0; width:100%; height:100%;"></canvas>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="status-module">
                            <h3>O2 LEVELS</h3>
                            <div class="progress-bar"><div class="fill" style="width: 90%; background: var(--neon-cyan);"></div></div>
                        </div>
                        <div class="status-module">
                            <h3>REACTOR CORE</h3>
                            <div class="progress-bar"><div class="fill" style="width: 0%; background: var(--neon-green);" id="progress-fill"></div></div>
                        </div>
                        <div class="status-module">
                            <h3>COMMS</h3>
                            <div class="progress-bar"><div class="fill" style="width: 45%; background: var(--alert-red);"></div></div>
                        </div>
                    </div>
                </div>

                <!-- LOGS -->
                <div class="holo-panel">
                    <h2>COMM LOGS</h2>
                    <ul id="game-logs" style="list-style: none; margin-top: 20px; text-align: left; font-size: 0.9rem; color: #aaa;">
                        <li style="padding: 5px; border-bottom: 1px solid #222;">[SYSTEM] Protocol Initiated...</li>
                        <li style="padding: 5px; border-bottom: 1px solid #222;">[SYSTEM] 8 Lifeforms Detected...</li>
                    </ul>
                    <button class="btn-main" style="margin-top: auto; width: 100%; border-color: var(--alert-red); color: var(--alert-red);" onclick="triggerEmergency()">EMERGENCY MEETING</button>
                </div>
            </div>
        </div>
    `;
    updateHostProgress();
    setTimeout(() => Loc.renderRadar('radar-canvas'), 1000);
}

window.hostHandleTaskComplete = () => {
    state.tasksCompleted++;
    updateHostProgress();
    // 3 tasks per player to win (or just global 3 for prototype)
    if (state.tasksCompleted >= 3) {
        triggerGameEnd('CREW');
        Net.broadcast({ type: 'WIN', winner: 'CREW' });
    }
}

function updateHostProgress() {
    const total = 3;
    const current = state.tasksCompleted || 0;
    const pct = Math.min((current / total) * 100, 100);
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = pct + '%';
}

// --- PLAYER GAME View ---
function renderPlayerGame() {
    state.view = 'game';
    const isShadow = state.role === 'SHADOW';

    // Generate tasks
    const tasks = [
        { id: 1, name: 'ALIGN ENGINE OUTPUT', complete: false },
        { id: 2, name: 'CLEAR O2 FILTERS', complete: false },
        { id: 3, name: 'CALIBRATE SHIELDS', complete: false }
    ];

    const taskHTML = tasks.map(t => `
        <div class="task-item" id="task-${t.id}" onclick="openTask(${t.id}, '${t.name}')">
            <span>${t.name}</span>
            <span class="status">[PENDING]</span>
        </div>
    `).join('');

    app.innerHTML = `
        <div class="view active" style="justify-content: flex-start; padding-top: 40px;">
            <div style="width: 100%; padding: 0 20px; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="color: ${isShadow ? 'var(--alert-red)' : 'var(--neon-green)'};">${state.role}</h2>
                <button class="btn-sm" onclick="triggerEmergency()">REPORT BODY</button>
            </div>
            
            <div class="holo-panel" style="width: 90%; margin-top: 20px; flex: 1;">
                <h3>${isShadow ? 'SABOTAGE TARGETS' : 'MISSION TASKS'}</h3>
                <div class="task-list" style="margin-top: 20px;">
                    ${taskHTML}
                </div>
            </div>

            ${isShadow ? `
            <div style="width: 90%; margin: 20px 0;">
                <button class="btn-main" style="width: 100%; border-color: var(--alert-red); color: var(--alert-red);" onclick="triggerSabotage()">ELIMINATE</button>
            </div>` : ''}
        </div>
        
        <!-- TASK MODAL CONTAINER -->
        <div id="task-modal" class="modal-overlay"></div>
    `;

    window.openTask = (id, name) => {
        const modal = document.getElementById('task-modal');
        modal.style.display = 'flex';
        Audio.playBeep();

        let content = '';

        if (id === 1) { // ALIGN ENGINE
            content = `
                <div class="holo-panel" style="background: black; width: 90%; max-width: 400px; text-align: center;">
                    <h3>${name}</h3>
                    <div style="height: 200px; display: flex; align-items: center; justify-content: center; position: relative; margin: 20px 0; border: 1px dashed #333;">
                        <div id="target-zone" style="width: 50px; height: 100%; background: rgba(0, 243, 255, 0.2); border-left: 1px solid var(--neon-cyan); border-right: 1px solid var(--neon-cyan); position: absolute;"></div>
                        <input type="range" min="0" max="100" value="0" id="engine-slider" style="width: 80%; z-index: 10;">
                    </div>
                    <p>ALIGN SLIDER TO CENTER</p>
                    <button class="btn-sm" onclick="closeModal()">EXIT</button>
                </div>
            `;
        } else if (id === 2) { // CLEAR FILTERS
            content = `
                <div class="holo-panel" style="background: black; width: 90%; max-width: 400px; text-align: center;">
                    <h3>${name}</h3>
                    <div id="o2-game-area" style="height: 200px; position: relative; margin: 20px 0; border: 2px solid #333; overflow: hidden; background: #111;">
                        <!-- Debris injected here -->
                    </div>
                    <p>CLICK TO CLEAR DEBRIS (<span id="debris-count">5</span>)</p>
                    <button class="btn-sm" onclick="closeModal()">EXIT</button>
                </div>
            `;
            setTimeout(() => startO2Game(id), 100);
        } else {
            content = `<div class="holo-panel"><h3>Accessing...</h3></div>`;
            setTimeout(() => { completeTask(id); closeModal(); }, 1500);
        }

        modal.innerHTML = content;

        if (id === 1) initEngineSlider(id);
    };

    function startO2Game(id) {
        const area = document.getElementById('o2-game-area');
        if (!area) return;
        let count = 5;
        for (let i = 0; i < 5; i++) {
            const d = document.createElement('div');
            d.className = 'debris-item';
            d.style.left = Math.random() * 80 + '%';
            d.style.top = Math.random() * 80 + '%';
            d.innerText = 'X';
            d.onclick = (e) => {
                e.stopPropagation();
                d.remove();
                count--;
                const countEl = document.getElementById('debris-count');
                if (countEl) countEl.innerText = count;
                Audio.playTone(400 + Math.random() * 200, 'square', 0.05);
                if (count <= 0) {
                    completeTask(id);
                    closeModal();
                }
            };
            area.appendChild(d);
        }
    }

    function initEngineSlider(id) {
        const slider = document.getElementById('engine-slider');
        if (!slider) return;
        slider.oninput = () => {
            const val = parseInt(slider.value);
            Audio.playTone(200 + val * 5, 'sawtooth', 0.1);
            if (val > 45 && val < 55) {
                slider.style.accentColor = 'var(--neon-green)';
                if (!slider.dataset.locked) {
                    completeTask(id);
                    slider.dataset.locked = true;
                    setTimeout(closeModal, 500);
                }
            } else {
                slider.style.accentColor = 'var(--alert-red)';
            }
        };
    }

    window.closeModal = () => {
        document.getElementById('task-modal').style.display = 'none';
        Audio.playBeep();
    };

    window.completeTask = (id) => {
        const el = document.getElementById(`task-${id}`);
        if (el && !el.classList.contains('completed')) {
            el.style.opacity = '0.5';
            el.querySelector('.status').innerText = '[DONE]';
            el.classList.add('completed');
            el.onclick = null;
            Audio.playTone(800, 'sine', 0.1); // Success ding
            Audio.playTone(1200, 'sine', 0.4);

            // Win Logic
            state.tasksCompleted = (state.tasksCompleted || 0) + 1;
            checkWinCondition();
        }
    };
}

function checkWinCondition() {
    const totalTasks = 3; // Hardcoded for prototype
    if ((state.tasksCompleted || 0) >= totalTasks) {
        setTimeout(() => triggerGameEnd('CREW'), 1000);
    }
}

window.triggerGameEnd = (winner) => {
    state.view = 'end';
    const isCrew = winner === 'CREW';
    const color = isCrew ? 'var(--neon-green)' : 'var(--alert-red)';
    const text = isCrew ? 'MISSION ACCOMPLISHED' : 'CRITICAL FAILURE';
    const subtext = isCrew ? 'STATION STABILIZED' : 'SYSTEMS OFFLINE';

    app.innerHTML = `
        <div class="view active fade-in" style="background: ${isCrew ? '#051005' : '#100505'};">
            <h1 class="glitch" data-text="${text}" style="font-size: 4rem; color: ${color};">${text}</h1>
            <p style="margin-top: 20px; font-size: 1.5rem;">${subtext}</p>
            <button class="btn-main" onclick="location.reload()" style="margin-top: 50px; border-color: ${color}; color: ${color};">REBOOT SYSTEM</button>
        </div>
    `;
    if (!isCrew) Audio.playAlarm();
}


window.triggerEmergency = () => {
    Audio.playAlarm();
    app.innerHTML = `
        <div class="view active" style="background: var(--alert-red);">
            <h1 class="glitch" data-text="EMERGENCY MEETING" style="font-size: 4rem; color: black; text-shadow: none;">EMERGENCY MEETING</h1>
        </div>
    `;
    setTimeout(() => {
        state.view = 'vote';
        renderVotingScreen();
    }, 3000);
}

function renderVotingScreen() {
    const players = ['CMDR. SHEPARD', 'AGENT 47', 'EZIO', 'GORDON', 'CHELL'];
    const playerButtons = players.map(p => `
        <button class="vote-btn" onclick="castVote('${p}')">
            ${p}
        </button>
    `).join('');

    app.innerHTML = `
        <div class="view active">
            <h2>WHO IS THE SHADOW?</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 30px; width: 90%;">
                ${playerButtons}
                <button class="vote-btn" onclick="castVote('SKIP')" style="grid-column: span 2; border-color: #666; color: #aaa;">SKIP VOTE</button>
            </div>
        </div>
    `;
}

window.castVote = (target) => {
    app.innerHTML = `
        <div class="view active">
            <h2>VOTE RECORDED</h2>
            <h1 style="color: var(--neon-cyan);">${target}</h1>
            <p>WAITING FOR RESULTS...</p>
        </div>
    `;
}


window.triggerSabotage = () => {
    // Effect
    document.body.classList.add('red-alert');
    app.classList.add('shake');
    Audio.playAlarm();

    // Simulate O2 Depletion leading to loss
    setTimeout(() => {
        document.body.classList.remove('red-alert');
        app.classList.remove('shake');
        triggerGameEnd('SHADOW');
    }, 3000); // Shadow wins after 3 seconds for demo
}
