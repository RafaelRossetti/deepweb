/**
 * Thor GState Management
 * Handles persistence and core simulation variables.
 */

export const INITIAL_STATE = {
    credits: 0,
    detectionLevel: 0,
    experience: 0,
    level: 1,
    tools: {
        scanner: { level: 1, unlocked: true },
        exploit: { level: 1, unlocked: false },
        decrypt: { level: 1, unlocked: false },
        exfiltrate: { level: 1, unlocked: false }
    },
    currentMission: null,
    history: []
};

class GameState {
    constructor() {
        this.data = this.load();
        this.SAVE_KEY = 'thor_sim_data';
    }

    load() {
        const saved = localStorage.getItem('thor_sim_data');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse game state, resetting...", e);
                return { ...INITIAL_STATE };
            }
        }
        return { ...INITIAL_STATE };
    }

    save() {
        localStorage.setItem(this.SAVE_KEY, JSON.stringify(this.data));
    }

    reset() {
        this.data = { ...INITIAL_STATE };
        this.save();
        location.reload();
    }

    addCredits(amount) {
        this.data.credits += amount;
        this.save();
    }

    updateDetection(amount) {
        this.data.detectionLevel = Math.max(0, Math.min(100, this.data.detectionLevel + amount));
        this.save();
        if (this.data.detectionLevel >= 100) {
            this.handleSystemReset();
        }
    }

    handleSystemReset() {
        alert("SECURITY BREACH DETECTED: TRACE COMPLETED. SYSTEM REBOOTING...");
        this.data.detectionLevel = 0;
        this.data.currentMission = null;
        this.save();
        location.reload();
    }

    unlockTool(toolName) {
        if (this.data.tools[toolName]) {
            this.data.tools[toolName].unlocked = true;
            this.save();
        }
    }
}

export const gameState = new GameState();
