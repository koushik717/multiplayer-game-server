'use strict';

/**
 * Connection Manager — tracks which players are connected to THIS server instance.
 * Each server instance maintains its own in-memory map.
 * Cross-instance communication happens via Redis Pub/Sub.
 */
class ConnectionManager {
    constructor() {
        // playerId → WebSocket
        this.connections = new Map();
        // playerId → { gameId, status }
        this.playerState = new Map();
    }

    /**
     * Register a new player connection.
     * @param {string} playerId
     * @param {WebSocket} socket
     */
    register(playerId, socket) {
        // Close existing connection if player reconnects to same server
        const existing = this.connections.get(playerId);
        if (existing && existing.readyState === 1) {
            existing.close(4001, 'Superseded by new connection');
        }

        this.connections.set(playerId, socket);
        console.log(`[ConnectionManager] Player ${playerId} connected (total: ${this.connections.size})`);
    }

    /**
     * Unregister a player connection.
     * @param {string} playerId
     */
    unregister(playerId) {
        this.connections.delete(playerId);
        this.playerState.delete(playerId);
        console.log(`[ConnectionManager] Player ${playerId} disconnected (total: ${this.connections.size})`);
    }

    /**
     * Get a player's WebSocket (only if connected to THIS instance).
     * @param {string} playerId
     * @returns {WebSocket|null}
     */
    getSocket(playerId) {
        const socket = this.connections.get(playerId);
        if (socket && socket.readyState === 1) return socket;
        return null;
    }

    /**
     * Send a message to a locally connected player.
     * @param {string} playerId
     * @param {Object} message
     * @returns {boolean} Whether the message was sent
     */
    sendToPlayer(playerId, message) {
        const socket = this.getSocket(playerId);
        if (!socket) return false;

        try {
            socket.send(JSON.stringify(message));
            return true;
        } catch (err) {
            console.error(`[ConnectionManager] Failed to send to ${playerId}:`, err.message);
            return false;
        }
    }

    /**
     * Send a message to multiple players (local only).
     * @param {string[]} playerIds
     * @param {Object} message
     */
    broadcastToPlayers(playerIds, message) {
        for (const playerId of playerIds) {
            this.sendToPlayer(playerId, message);
        }
    }

    /**
     * Set player's current game context.
     * @param {string} playerId
     * @param {string} gameId
     */
    setPlayerGame(playerId, gameId) {
        this.playerState.set(playerId, { gameId, status: 'active' });
    }

    /**
     * Get player's current game context.
     * @param {string} playerId
     * @returns {{ gameId: string, status: string }|null}
     */
    getPlayerGame(playerId) {
        return this.playerState.get(playerId) || null;
    }

    /**
     * Check if a player is connected to this instance.
     * @param {string} playerId
     * @returns {boolean}
     */
    isConnected(playerId) {
        const socket = this.connections.get(playerId);
        return socket && socket.readyState === 1;
    }

    /**
     * Get total connected players on this instance.
     * @returns {number}
     */
    getConnectionCount() {
        return this.connections.size;
    }

    /**
     * Get all connected player IDs.
     * @returns {string[]}
     */
    getConnectedPlayerIds() {
        return Array.from(this.connections.keys());
    }
}

// Singleton — one per server instance
module.exports = new ConnectionManager();
