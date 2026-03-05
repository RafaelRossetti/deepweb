/**
 * THOR CYBER-INTRUSION SIMULATOR — MAIN APP
 * Multiplayer: Attacker vs Defender via PeerJS (WebRTC)
 */

// ===== SHARED GAME STATE =====
const gameState = {
    exfiltration: 0,
    trace: 0,
    ports: {
        22: { name: 'SSH', status: 'closed' },
        80: { name: 'HTTP', status: 'open' },
        443: { name: 'HTTPS', status: 'open' },
        3306: { name: 'MySQL', status: 'open' },
        8080: { name: 'Proxy', status: 'open' }
    },
    connected: false,
    exploitReady: false,
    gameActive: false,
    gameTimer: 300, // 5 minutes in seconds
    attackerIp: '189.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255),
    targetIp: '10.0.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255)
};

// ===== TERMINAL HELPER =====
class Terminal {
    constructor(containerId, inputId) {
        this.container = document.getElementById(containerId);
        this.input = document.getElementById(inputId);
        if (!this.container || !this.input) return;

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.input.value.trim();
                if (cmd) { this.onCommand(cmd); this.input.value = ''; }
            }
        });
        this.container.addEventListener('click', () => this.input.focus());
        this.onCommand = () => { };
    }

    log(msg, type = 'default') {
        if (!this.container) return;
        const el = document.createElement('div');
        el.className = `log ${type}`;
        const t = new Date().toLocaleTimeString();
        el.innerHTML = `<span style="color:#333">[${t}]</span> ${msg}`;
        this.container.insertBefore(el, this.input.parentElement);
        this.container.scrollTop = this.container.scrollHeight;
    }
}

// ===== IDS LOG HELPER =====
class IDSLog {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
    }
    add(msg, type = '') {
        if (!this.container) return;
        const el = document.createElement('div');
        el.className = `ids-entry ${type}`;
        const t = new Date().toLocaleTimeString();
        el.textContent = `[${t}] ${msg}`;
        this.container.appendChild(el);
        this.container.scrollTop = this.container.scrollHeight;
    }
}

// ===== SCREEN MANAGER =====
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

// ===== UPDATE UI BARS =====
function updateBars() {
    // Attacker bars
    const atkExfilBar = document.getElementById('atk-exfil-bar');
    const atkExfilPct = document.getElementById('atk-exfil-pct');
    const atkTraceBar = document.getElementById('atk-trace-bar');
    const atkTracePct = document.getElementById('atk-trace-pct');
    if (atkExfilBar) { atkExfilBar.style.width = gameState.exfiltration + '%'; atkExfilPct.textContent = Math.round(gameState.exfiltration) + '%'; }
    if (atkTraceBar) { atkTraceBar.style.width = gameState.trace + '%'; atkTracePct.textContent = Math.round(gameState.trace) + '%'; }

    // Defender bars
    const defExfilBar = document.getElementById('def-exfil-bar');
    const defExfilPct = document.getElementById('def-exfil-pct');
    const defTraceBar = document.getElementById('def-trace-bar');
    const defTracePct = document.getElementById('def-trace-pct');
    if (defExfilBar) { defExfilBar.style.width = gameState.exfiltration + '%'; defExfilPct.textContent = Math.round(gameState.exfiltration) + '%'; }
    if (defTraceBar) { defTraceBar.style.width = gameState.trace + '%'; defTracePct.textContent = Math.round(gameState.trace) + '%'; }
}

// ===== MAIN INIT =====
document.addEventListener('DOMContentLoaded', () => {
    // ---- LOBBY ----
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    const roomCodeDisplay = document.getElementById('room-code-display');
    const roomCodeValue = document.getElementById('room-code-value');
    const btnCopy = document.getElementById('btn-copy-code');
    const inputRoomCode = document.getElementById('input-room-code');
    const joinStatus = document.getElementById('join-status');
    const btnPlayAgain = document.getElementById('btn-play-again');

    // Timer interval ref
    let timerInterval = null;

    // Format timer
    function formatTime(sec) {
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        return `⏱ ${m}:${s}`;
    }

    function startGameTimer() {
        gameState.gameTimer = 300;
        timerInterval = setInterval(() => {
            if (!gameState.gameActive) return;
            gameState.gameTimer--;
            const timerText = formatTime(gameState.gameTimer);
            const atkTimer = document.getElementById('atk-game-timer');
            const defTimer = document.getElementById('def-game-timer');
            if (atkTimer) atkTimer.textContent = timerText;
            if (defTimer) defTimer.textContent = timerText;

            if (gameState.gameTimer <= 0) {
                endGame('timeout');
            }
        }, 1000);
    }

    // Clock
    setInterval(() => {
        const t = new Date().toLocaleTimeString();
        const ac = document.getElementById('atk-clock');
        const dc = document.getElementById('def-clock');
        if (ac) ac.textContent = t;
        if (dc) dc.textContent = t;
    }, 1000);

    // Win/Lose
    function endGame(reason) {
        gameState.gameActive = false;
        if (timerInterval) clearInterval(timerInterval);
        const title = document.getElementById('go-title');
        const msg = document.getElementById('go-message');

        if (reason === 'attacker_wins') {
            title.textContent = 'DATA BREACH';
            title.style.color = 'var(--red)';
            msg.textContent = thorNet.role === 'attacker'
                ? 'EXFILTRAÇÃO CONCLUÍDA. Você extraiu todos os dados com sucesso.'
                : 'FALHA NA DEFESA. O invasor conseguiu exfiltrar os dados.';
        } else if (reason === 'defender_wins') {
            title.textContent = 'INTRUSO NEUTRALIZADO';
            title.style.color = 'var(--blue)';
            msg.textContent = thorNet.role === 'defender'
                ? 'TRACE COMPLETO. Você rastreou e neutralizou o invasor.'
                : 'VOCÊ FOI RASTREADO. Sua conexão foi cortada e sua identidade exposta.';
        } else {
            title.textContent = 'TEMPO ESGOTADO';
            title.style.color = 'var(--yellow)';
            msg.textContent = 'Nenhum dos lados completou o objetivo a tempo. Empate.';
        }

        thorNet.send({ type: 'game_over', reason });
        showScreen('game-over');
    }

    function checkWinCondition() {
        if (gameState.exfiltration >= 100) endGame('attacker_wins');
        if (gameState.trace >= 100) endGame('defender_wins');
    }

    // ========================
    //   ATTACKER LOGIC
    // ========================
    function initAttacker() {
        const term = new Terminal('atk-terminal', 'atk-input');
        const networkMap = document.getElementById('atk-network-map');
        const btnScan = document.getElementById('atk-btn-scan');
        const btnExploit = document.getElementById('atk-btn-exploit');
        const btnBrute = document.getElementById('atk-btn-bruteforce');
        const btnExfil = document.getElementById('atk-btn-exfiltrate');
        const objText = document.getElementById('atk-objective');
        const targetIpEl = document.getElementById('atk-target-ip');

        if (targetIpEl) targetIpEl.textContent = gameState.targetIp;
        let isScanning = false;
        let isExfiltrating = false;

        function unlockBtn(el) { if (el) el.classList.remove('locked'); }

        function addNode(ip) {
            const node = document.createElement('div');
            node.className = 'net-node';
            node.style.left = '50%'; node.style.top = '50%';
            node.innerHTML = `<div class="node-dot"></div><span>${ip}</span>`;
            node.onclick = () => {
                term.log(`Connecting to ${ip}...`, 'info');
                setTimeout(() => {
                    gameState.connected = true;
                    term.log(`TUNNEL ESTABLISHED TO ${ip}`, 'success');
                    thorNet.send({ type: 'alert', msg: `Connection attempt from ${gameState.attackerIp}`, level: 'alert' });
                    unlockBtn(btnExploit);
                    if (objText) objText.textContent = 'Exploit uma porta aberta no alvo.';
                }, 800);
            };
            if (networkMap) networkMap.appendChild(node);
            setTimeout(() => {
                node.style.left = (Math.random() * 60 + 20) + '%';
                node.style.top = (Math.random() * 60 + 20) + '%';
            }, 50);
        }

        // Scan
        btnScan.addEventListener('click', () => {
            if (isScanning) return;
            isScanning = true;
            term.log('SCANNING NETWORK...', 'info');
            btnScan.textContent = '...';
            thorNet.send({ type: 'alert', msg: `Port scan detected from ${gameState.attackerIp}`, level: 'warning' });

            let p = 0;
            const iv = setInterval(() => {
                p += 10;
                if (p % 30 === 0) term.log(`Probing subnets... ${p}%`, 'default');
                if (p >= 100) {
                    clearInterval(iv);
                    isScanning = false;
                    btnScan.textContent = 'SCAN';
                    term.log(`TARGET FOUND: ${gameState.targetIp}`, 'success');
                    addNode(gameState.targetIp);
                }
            }, 120);
        });

        // Exploit
        btnExploit.addEventListener('click', () => {
            if (btnExploit.classList.contains('locked') || !gameState.connected) {
                term.log('Connect to a target first.', 'error'); return;
            }
            // Find an open port to exploit
            const openPorts = Object.entries(gameState.ports).filter(([k, v]) => v.status === 'open');
            if (openPorts.length === 0) { term.log('All ports are patched! No entry point.', 'error'); return; }

            const [port, info] = openPorts[Math.floor(Math.random() * openPorts.length)];
            term.log(`EXPLOITING PORT ${port} (${info.name})...`, 'critical');
            thorNet.send({ type: 'alert', msg: `EXPLOIT ATTEMPT on port ${port} (${info.name}) from ${gameState.attackerIp}`, level: 'alert' });
            thorNet.send({ type: 'state', key: 'exploit_port', value: port });

            let p = 0;
            const iv = setInterval(() => {
                p += 10;
                if (p >= 100) {
                    clearInterval(iv);
                    if (gameState.ports[port].status === 'patched') {
                        term.log(`EXPLOIT FAILED: Port ${port} was patched by defender!`, 'error');
                        thorNet.send({ type: 'alert', msg: `Exploit on port ${port} BLOCKED (patched)`, level: 'blocked' });
                    } else {
                        gameState.exploitReady = true;
                        term.log(`ROOT SHELL OBTAINED via port ${port}!`, 'success');
                        thorNet.send({ type: 'alert', msg: `ROOT ACCESS GAINED via port ${port}!`, level: 'alert' });
                        unlockBtn(btnBrute);
                        unlockBtn(btnExfil);
                        if (objText) objText.textContent = 'Exfiltre os dados antes do trace completar!';
                    }
                }
            }, 200);
        });

        // Bruteforce
        btnBrute.addEventListener('click', () => {
            if (btnBrute.classList.contains('locked')) return;
            term.log('BRUTEFORCING CREDENTIALS...', 'critical');
            thorNet.send({ type: 'alert', msg: `Brute force attack detected! High packet volume from ${gameState.attackerIp}`, level: 'alert' });
            let tries = 0;
            const iv = setInterval(() => {
                tries++;
                const hash = Math.random().toString(36).substring(2, 10);
                term.log(`Attempt #${tries}: ${hash}... FAILED`, 'default');
                if (tries >= 8) {
                    clearInterval(iv);
                    term.log(`Attempt #${tries + 1}: a7f3c2e1... MATCH FOUND!`, 'success');
                    term.log('ADMIN PASSWORD CRACKED. Exfiltration speed doubled.', 'success');
                    gameState.exfilSpeed = 2;
                    thorNet.send({ type: 'alert', msg: 'Admin credentials compromised!', level: 'alert' });
                }
            }, 250);
        });

        // Exfiltrate
        btnExfil.addEventListener('click', () => {
            if (btnExfil.classList.contains('locked') || isExfiltrating) return;
            isExfiltrating = true;
            term.log('STARTING DATA EXFILTRATION...', 'critical');
            thorNet.send({ type: 'alert', msg: `DATA EXFILTRATION IN PROGRESS from ${gameState.attackerIp}!`, level: 'alert' });
            if (objText) objText.textContent = '▓ Exfiltrando dados... Não seja rastreado!';

            const speed = gameState.exfilSpeed || 1;
            const iv = setInterval(() => {
                if (!gameState.gameActive) { clearInterval(iv); return; }
                gameState.exfiltration = Math.min(100, gameState.exfiltration + (1.5 * speed));
                thorNet.send({ type: 'state', key: 'exfiltration', value: gameState.exfiltration });
                updateBars();
                if (gameState.exfiltration % 10 < 2) term.log(`Exfiltrating... ${Math.round(gameState.exfiltration)}%`, 'default');
                checkWinCondition();
                if (gameState.exfiltration >= 100) { clearInterval(iv); isExfiltrating = false; }
            }, 500);
        });

        // Terminal commands
        term.onCommand = (cmd) => {
            const args = cmd.toLowerCase().split(' ');
            switch (args[0]) {
                case 'help':
                    term.log('ATTACKER COMMANDS:', 'info');
                    term.log(' scan     - Discover targets on the network', 'default');
                    term.log(' exploit  - Exploit open port on connected target', 'default');
                    term.log(' bruteforce - Crack admin credentials', 'default');
                    term.log(' exfiltrate - Begin data extraction', 'default');
                    term.log(' whoami   - Show operator info', 'default');
                    term.log(' status   - Show game state', 'default');
                    term.log(' cls      - Clear terminal', 'default');
                    break;
                case 'scan': btnScan.click(); break;
                case 'exploit': btnExploit.click(); break;
                case 'bruteforce': btnBrute.click(); break;
                case 'exfiltrate': btnExfil.click(); break;
                case 'whoami':
                    term.log('--- OPERATOR ---', 'info');
                    term.log(`IP: ${gameState.attackerIp}`, 'default');
                    term.log('ROLE: ATTACKER', 'default');
                    term.log('RANK: GHOST', 'success');
                    break;
                case 'status':
                    term.log('--- STATUS ---', 'info');
                    term.log(`Exfiltration: ${Math.round(gameState.exfiltration)}%`, 'default');
                    term.log(`Enemy Trace: ${Math.round(gameState.trace)}%`, gameState.trace > 50 ? 'warning' : 'default');
                    break;
                case 'cls': case 'clear':
                    term.container.querySelectorAll('.log').forEach(l => l.remove());
                    break;
                default:
                    term.log(`Command not found: ${args[0]}`, 'error');
            }
        };

        // Receive data from defender
        thorNet.onData = (data) => {
            if (data.type === 'state') {
                if (data.key === 'trace') { gameState.trace = data.value; updateBars(); checkWinCondition(); }
                if (data.key === 'block') { term.log(`⚠ YOUR IP WAS BLOCKED! Re-routing through VPN...`, 'warning'); }
                if (data.key === 'patch_port') {
                    const p = data.value;
                    if (gameState.ports[p]) gameState.ports[p].status = 'patched';
                    term.log(`⚠ Port ${p} has been PATCHED by the defender!`, 'warning');
                }
                if (data.key === 'rotate_keys') {
                    gameState.exfiltration = Math.max(0, gameState.exfiltration - 15);
                    updateBars();
                    term.log('⚠ ENCRYPTION KEYS ROTATED! Exfiltration progress lost!', 'error');
                }
            }
            if (data.type === 'game_over') {
                gameState.gameActive = false;
                showScreen('game-over');
            }
        };
    }

    // ========================
    //   DEFENDER LOGIC
    // ========================
    function initDefender() {
        const term = new Terminal('def-terminal', 'def-input');
        const ids = new IDSLog('def-ids-log');
        const btnTrace = document.getElementById('def-btn-trace');
        const btnBlock = document.getElementById('def-btn-block');
        const btnPatch = document.getElementById('def-btn-patch');
        const btnRotate = document.getElementById('def-btn-rotate');
        const objText = document.getElementById('def-objective');
        const targetIpEl = document.getElementById('def-target-ip');

        if (targetIpEl) targetIpEl.textContent = gameState.targetIp;
        let isTracing = false;

        // Trace
        btnTrace.addEventListener('click', () => {
            if (isTracing) { term.log('Trace already running.', 'warning'); return; }
            isTracing = true;
            term.log('INITIATING TRACE ON INTRUDER...', 'critical');
            ids.add('TRACE PROTOCOL LAUNCHED', 'warning');

            const iv = setInterval(() => {
                if (!gameState.gameActive) { clearInterval(iv); return; }
                gameState.trace = Math.min(100, gameState.trace + 1.2);
                thorNet.send({ type: 'state', key: 'trace', value: gameState.trace });
                updateBars();
                if (gameState.trace % 10 < 1.5) term.log(`Tracing... ${Math.round(gameState.trace)}%`, 'default');
                checkWinCondition();
                if (gameState.trace >= 100) { clearInterval(iv); isTracing = false; }
            }, 600);
        });

        // Block IP
        btnBlock.addEventListener('click', () => {
            term.log(`BLOCKING IP: ${gameState.attackerIp}...`, 'info');
            ids.add(`FIREWALL RULE ADDED: BLOCK ${gameState.attackerIp}`, 'blocked');
            thorNet.send({ type: 'state', key: 'block', value: gameState.attackerIp });
            // Temporarily slow attacker exfiltration
            gameState.exfiltration = Math.max(0, gameState.exfiltration - 5);
            thorNet.send({ type: 'state', key: 'exfiltration', value: gameState.exfiltration });
            updateBars();
            term.log('IP blocked. Attacker forced to re-route (5% exfiltration lost).', 'success');
        });

        // Patch Port
        btnPatch.addEventListener('click', () => {
            const openPorts = Object.entries(gameState.ports).filter(([k, v]) => v.status === 'open');
            if (openPorts.length === 0) { term.log('All ports already patched!', 'warning'); return; }
            const [port, info] = openPorts[0];
            gameState.ports[port].status = 'patched';
            term.log(`PATCHING PORT ${port} (${info.name})...`, 'info');
            ids.add(`Port ${port} PATCHED successfully`, 'blocked');
            thorNet.send({ type: 'state', key: 'patch_port', value: port });
            term.log(`Port ${port} is now secure.`, 'success');
        });

        // Rotate Keys
        btnRotate.addEventListener('click', () => {
            term.log('ROTATING ENCRYPTION KEYS...', 'critical');
            ids.add('ENCRYPTION KEY ROTATION INITIATED', 'warning');
            thorNet.send({ type: 'state', key: 'rotate_keys', value: true });
            term.log('Keys rotated. Attacker exfiltration progress reduced by 15%.', 'success');
        });

        // Terminal commands
        term.onCommand = (cmd) => {
            const args = cmd.toLowerCase().split(' ');
            switch (args[0]) {
                case 'help':
                    term.log('DEFENDER COMMANDS:', 'info');
                    term.log(' trace     - Begin tracing the intruder', 'default');
                    term.log(' block     - Block attacker IP (costs exfil %)', 'default');
                    term.log(' patch     - Patch an open port', 'default');
                    term.log(' rotate    - Rotate encryption keys', 'default');
                    term.log(' ports     - Show port status', 'default');
                    term.log(' status    - Show game state', 'default');
                    term.log(' cls       - Clear terminal', 'default');
                    break;
                case 'trace': btnTrace.click(); break;
                case 'block': btnBlock.click(); break;
                case 'patch': btnPatch.click(); break;
                case 'rotate': btnRotate.click(); break;
                case 'ports':
                    term.log('--- PORT STATUS ---', 'info');
                    Object.entries(gameState.ports).forEach(([p, info]) => {
                        const color = info.status === 'open' ? 'warning' : 'success';
                        term.log(`PORT ${p} [${info.name}]: ${info.status.toUpperCase()}`, color);
                    });
                    break;
                case 'status':
                    term.log('--- DEFENSE STATUS ---', 'info');
                    term.log(`Data stolen: ${Math.round(gameState.exfiltration)}%`, gameState.exfiltration > 50 ? 'error' : 'default');
                    term.log(`Your trace: ${Math.round(gameState.trace)}%`, 'default');
                    break;
                case 'cls': case 'clear':
                    term.container.querySelectorAll('.log').forEach(l => l.remove());
                    break;
                default:
                    term.log(`Command not found: ${args[0]}`, 'error');
            }
        };

        // Receive data from attacker
        thorNet.onData = (data) => {
            if (data.type === 'alert') {
                ids.add(data.msg, data.level || 'alert');
            }
            if (data.type === 'state') {
                if (data.key === 'exfiltration') {
                    gameState.exfiltration = data.value;
                    updateBars();
                    checkWinCondition();
                }
                if (data.key === 'exploit_port') {
                    ids.add(`CRITICAL: Exploit attempt on port ${data.value}!`, 'alert');
                }
            }
            if (data.type === 'game_over') {
                gameState.gameActive = false;
                showScreen('game-over');
            }
        };
    }

    // ========================
    //   LOBBY HANDLERS
    // ========================
    function startGame() {
        gameState.gameActive = true;
        gameState.exfiltration = 0;
        gameState.trace = 0;
        gameState.exfilSpeed = 1;
        Object.keys(gameState.ports).forEach(p => {
            if (p !== '22') gameState.ports[p].status = 'open';
        });
        startGameTimer();
        updateBars();
    }

    btnCreate.addEventListener('click', () => {
        btnCreate.disabled = true;
        btnCreate.textContent = 'CRIANDO...';

        thorNet.createRoom({
            onConnected: () => {
                startGame();
                showScreen('game-attacker');
                initAttacker();
            },
            onData: null,
            onDisconnected: () => {
                if (gameState.gameActive) endGame('timeout');
            }
        }).then((code) => {
            roomCodeDisplay.classList.remove('hidden');
            roomCodeValue.textContent = code;
        }).catch((err) => {
            btnCreate.disabled = false;
            btnCreate.textContent = 'CRIAR SALA';
            alert('Erro ao criar sala: ' + err.message);
        });
    });

    btnCopy.addEventListener('click', () => {
        const code = roomCodeValue.textContent;
        navigator.clipboard.writeText(code).then(() => {
            btnCopy.textContent = '✅';
            setTimeout(() => btnCopy.textContent = '📋', 2000);
        });
    });

    btnJoin.addEventListener('click', () => {
        const code = inputRoomCode.value.trim();
        if (!code || code.length < 4) { joinStatus.textContent = 'Código inválido.'; return; }

        btnJoin.disabled = true;
        joinStatus.textContent = 'Conectando...';

        thorNet.joinRoom(code, {
            onConnected: () => {
                startGame();
                showScreen('game-defender');
                initDefender();
            },
            onData: null,
            onDisconnected: () => {
                if (gameState.gameActive) endGame('timeout');
            }
        }).then(() => {
            joinStatus.textContent = 'Conexão estabelecida!';
        }).catch((err) => {
            btnJoin.disabled = false;
            joinStatus.textContent = 'Falha: ' + err.message;
        });
    });

    btnPlayAgain.addEventListener('click', () => {
        thorNet.disconnect();
        location.reload();
    });
});
