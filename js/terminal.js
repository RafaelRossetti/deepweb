/**
 * Thor Terminal Controller
 * Manages the CLI and log display.
 */

export class Terminal {
    constructor(containerId, inputId) {
        this.container = document.getElementById(containerId);
        this.input = document.getElementById(inputId);
        this.commandHistory = [];
        this.historyIndex = -1;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.input.value.trim();
                if (cmd) {
                    this.executeCommand(cmd);
                    this.input.value = '';
                }
            }
        });

        // Click on terminal to autofocus input
        this.container.addEventListener('click', () => {
            this.input.focus();
        });
    }

    log(message, type = 'default') {
        const line = document.createElement('div');
        line.className = `terminal-line mb-1 ${this.getTypeClass(type)}`;

        // Animated typing effect for important messages
        if (type === 'critical' || type === 'success') {
            line.innerHTML = `<span class="opacity-0 italic">[${new Date().toLocaleTimeString()}]</span> ${message}`;
            this.container.insertBefore(line, this.input.parentElement);
            this.animateText(line, `[${new Date().toLocaleTimeString()}] ${message}`);
        } else {
            line.innerHTML = `<span class="text-gray-600">[${new Date().toLocaleTimeString()}]</span> ${message}`;
            this.container.insertBefore(line, this.input.parentElement);
        }

        this.container.scrollTop = this.container.scrollHeight;
    }

    getTypeClass(type) {
        switch (type) {
            case 'success': return 'text-green-400 font-bold';
            case 'error': return 'text-red-500';
            case 'warning': return 'text-yellow-500 italic';
            case 'info': return 'text-blue-400';
            case 'critical': return 'text-blue-500 font-bold uppercase tracking-widest';
            default: return 'text-gray-400';
        }
    }

    animateText(element, text) {
        element.innerHTML = '';
        let i = 0;
        const interval = setInterval(() => {
            element.innerHTML += text.charAt(i);
            i++;
            if (i >= text.length) {
                clearInterval(interval);
            }
            this.container.scrollTop = this.container.scrollHeight;
        }, 30);
    }

    executeCommand(cmd) {
        this.log(`thor@root:~$ ${cmd}`, 'user');

        const args = cmd.toLowerCase().split(' ');
        const baseCmd = args[0];

        switch (baseCmd) {
            case 'help':
                this.log("AVAILABLE COMMANDS:", 'info');
                this.log(" - scan: Search for nearby network vulnerabilities", 'default');
                this.log(" - connect [ip]: Establish tunnel to target", 'default');
                this.log(" - status: Display system resource usage", 'default');
                this.log(" - cls: Clear HUD log buffer", 'default');
                break;
            case 'cls':
            case 'clear':
                const lines = this.container.querySelectorAll('.terminal-line');
                lines.forEach(l => l.remove());
                break;
            case 'scan':
                window.dispatchEvent(new CustomEvent('thor-scan'));
                break;
            case 'status':
                this.log("--- SYSTEM STATUS ---", 'info');
                this.log("CPU LOAD: 14%", 'default');
                this.log("RAM: 2.4GB / 16GB", 'default');
                this.log("VPN NODES: 4 Active", 'default');
                break;
            default:
                this.log(`Command not found: ${baseCmd}. Type 'help' for options.`, 'error');
        }
    }
}
