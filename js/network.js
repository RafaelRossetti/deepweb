/**
 * THOR NETWORK — PeerJS WebRTC Connection Manager
 * Handles lobby creation, joining, and real-time data exchange.
 */

class ThorNetwork {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.roomCode = null;
        this.role = null; // 'attacker' or 'defender'
        this.onConnected = null;
        this.onData = null;
        this.onDisconnected = null;
        this.PREFIX = 'THOR-';
    }

    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    createRoom(callbacks) {
        this.role = 'attacker';
        this.roomCode = this.generateCode();
        const peerId = this.PREFIX + this.roomCode;

        this.onConnected = callbacks.onConnected;
        this.onData = callbacks.onData;
        this.onDisconnected = callbacks.onDisconnected;

        this.peer = new Peer(peerId, {
            debug: 0
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                console.log('[THOR NET] Room created:', this.roomCode);
                resolve(this.roomCode);
            });

            this.peer.on('connection', (conn) => {
                console.log('[THOR NET] Defender connected!');
                this.conn = conn;
                this._setupConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('[THOR NET] Error:', err);
                reject(err);
            });
        });
    }

    joinRoom(code, callbacks) {
        this.role = 'defender';
        this.roomCode = code.toUpperCase();
        const peerId = this.PREFIX + this.roomCode;

        this.onConnected = callbacks.onConnected;
        this.onData = callbacks.onData;
        this.onDisconnected = callbacks.onDisconnected;

        this.peer = new Peer(undefined, {
            debug: 0
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', () => {
                console.log('[THOR NET] Connecting to room:', this.roomCode);
                const conn = this.peer.connect(peerId, { reliable: true });

                conn.on('open', () => {
                    console.log('[THOR NET] Connected to attacker!');
                    this.conn = conn;
                    this._setupConnection(conn);
                    resolve();
                });

                conn.on('error', (err) => {
                    console.error('[THOR NET] Connection error:', err);
                    reject(err);
                });

                // Timeout
                setTimeout(() => {
                    if (!this.conn) reject(new Error('Connection timed out.'));
                }, 10000);
            });

            this.peer.on('error', (err) => {
                console.error('[THOR NET] Peer error:', err);
                reject(err);
            });
        });
    }

    _setupConnection(conn) {
        conn.on('data', (data) => {
            if (this.onData) this.onData(data);
        });

        conn.on('close', () => {
            console.log('[THOR NET] Connection closed.');
            if (this.onDisconnected) this.onDisconnected();
        });

        if (this.onConnected) this.onConnected();
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    disconnect() {
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
    }
}

// Global instance
const thorNet = new ThorNetwork();
