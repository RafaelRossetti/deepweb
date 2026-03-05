import { gameState } from './gameState.js';
import { Terminal } from './terminal.js';

document.addEventListener('DOMContentLoaded', () => {
    const terminal = new Terminal('terminal', 'terminal-input');

    // UI Elements
    const detectionBar = document.getElementById('detection-bar');
    const systemTimeEl = document.getElementById('system-time');
    const btnScan = document.getElementById('btn-scan');
    const btnExploit = document.getElementById('btn-exploit');
    const btnDecrypt = document.getElementById('btn-decrypt');
    const btnExfiltrate = document.getElementById('btn-exfiltrate');
    const networkMap = document.getElementById('network-map');

    // State Vars
    let isScanning = false;

    // Initialize UI
    const updateUI = () => {
        detectionBar.style.width = `${gameState.data.detectionLevel}%`;

        // Update tool buttons based on unlock status
        if (gameState.data.tools.exploit.unlocked) {
            btnExploit.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    };

    // System Clock
    setInterval(() => {
        const now = new Date();
        systemTimeEl.textContent = now.toLocaleTimeString();
    }, 1000);

    // Event Handlers
    btnScan.addEventListener('click', () => {
        if (isScanning) return;

        isScanning = true;
        terminal.log("INITIALIZING NETWORK WIDE SCAN...", "info");
        btnScan.textContent = "SCANNING...";

        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            terminal.log(`Tracing packets... ${progress}%`, "default");

            if (progress >= 100) {
                clearInterval(interval);
                isScanning = false;
                btnScan.textContent = "NETWORK SCAN";
                terminal.log("SCAN COMPLETE. VULNERABILITIES DETECTED AT [10.0.4.15]", "success");
                createNetworkNode("10.0.4.15", "Corporate Mainframe");
            }
        }, 300);
    });

    window.addEventListener('thor-scan', () => {
        btnScan.click();
    });

    // Network Map Logic
    const createNetworkNode = (ip, label) => {
        const node = document.createElement('div');
        node.className = 'absolute w-16 h-16 border border-blue-500 rounded-full flex flex-col items-center justify-center cursor-pointer hover:bg-blue-900/40 transition-all animate-pulse';
        node.style.left = '50%';
        node.style.top = '50%';
        node.style.transform = 'translate(-50%, -50%)';

        node.innerHTML = `
            <span class="text-[8px] text-blue-300 font-bold">${ip}</span>
            <div class="w-2 h-2 bg-blue-500 rounded-full mb-1"></div>
        `;

        node.onclick = () => {
            terminal.log(`TARGET SELECTED: ${label} (${ip})`, "info");
            terminal.log("RUNNING PORT SCAN...", "default");
            setTimeout(() => {
                terminal.log("PORT 80: OPEN", "success");
                terminal.log("PORT 443: OPEN", "success");
                terminal.log("PORT 22: FILTERED", "warning");
                terminal.log("TARGET READY FOR EXPLOITATION.", "critical");

                // Unlock exploit tool for this session
                gameState.unlockTool('exploit');
                updateUI();
            }, 1000);
        };

        networkMap.appendChild(node);

        // Animate node to a random position
        setTimeout(() => {
            const x = Math.random() * 70 + 15;
            const y = Math.random() * 70 + 15;
            node.style.left = `${x}%`;
            node.style.top = `${y}%`;
        }, 100);
    };

    // Exploit Action
    btnExploit.addEventListener('click', () => {
        if (!gameState.data.tools.exploit.unlocked) return;

        terminal.log("INITIALIZING BUFFER OVERFLOW EXPLOIT...", "critical");
        let progress = 0;
        const interval = setInterval(() => {
            progress += 10;
            terminal.log(`Injecting NOP Sled... ${progress}%`, "default");

            // Detection increases during exploit
            gameState.updateDetection(5);
            updateUI();

            if (progress >= 100) {
                clearInterval(interval);
                terminal.log("EXPLOIT SUCCESSFUL. ROOT ACCESS GRANTED.", "success");
                terminal.log("NEW OBJECTIVE: EXFILTRATE SENSITIVE DATA.", "info");
                document.getElementById('mission-title').textContent = "DATA HEIST: CORPORATE ASSETS";
            }
        }, 500);
    });

    // Final Boot Log
    updateUI();
});
