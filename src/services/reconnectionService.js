'use strict';

const gameStateStore = require('../redis/gameStateStore');
const connectionManager = require('../websocket/connectionManager');
const pubsub = require('../redis/pubsub');
const gameService = require('./gameService');
const metricsCollector = require('../metrics/metricsCollector');

const RECONNECT_TIMEOUT = parseInt(process.env.RECONNECT_TIMEOUT_MS, 10) || 30000;

// Active disconnect timers: playerId → timeoutId
const disconnectTimers = new Map();

/**
 * Reconnection Service — handles player disconnects with grace period,
 * state snapshot restoration, and forfeit on timeout.
 */
const reconnectionService = {
    /**
     * Handle a player disconnecting (socket closed).
     * Start a grace period timer — if they don't reconnect, they forfeit.
     * @param {string} playerId
     */
    async handleDisconnect(playerId) {
        // Find the player's active game
        const playerGame = connectionManager.getPlayerGame(playerId);
        if (!playerGame) return; // Not in a game, nothing to do

        const { gameId } = playerGame;
        const gameState = await gameStateStore.getGameState(gameId);
        if (!gameState || gameState.status !== 'active') return;

        console.log(`[Reconnection] Player ${playerId} disconnected from game ${gameId}. Grace period: ${RECONNECT_TIMEOUT}ms`);

        // Mark player as disconnected in game state
        const updatedState = {
            ...gameState,
            disconnectedPlayers: {
                ...gameState.disconnectedPlayers,
                [playerId]: {
                    disconnectedAt: Date.now(),
                    status: 'disconnected',
                },
            },
        };
        await gameStateStore.setGameState(gameId, updatedState);

        // Notify opponent
        await pubsub.publish(gameId, {
            type: 'PLAYER_DISCONNECTED',
            gameId,
            playerId,
            reconnectTimeoutMs: RECONNECT_TIMEOUT,
        });

        // Start forfeit timer
        const timerId = setTimeout(async () => {
            disconnectTimers.delete(playerId);
            await this._handleForfeit(gameId, playerId);
        }, RECONNECT_TIMEOUT);

        disconnectTimers.set(playerId, { timerId, gameId });
    },

    /**
     * Handle a player reconnecting.
     * Cancel forfeit timer, restore game state, reattach to game.
     * @param {string} playerId
     */
    async handleReconnect(playerId) {
        const timerInfo = disconnectTimers.get(playerId);
        if (!timerInfo) return; // No pending disconnect

        const { timerId, gameId } = timerInfo;

        // Cancel the forfeit timer
        clearTimeout(timerId);
        disconnectTimers.delete(playerId);

        console.log(`[Reconnection] Player ${playerId} reconnected to game ${gameId}`);

        // Fetch current game state
        const gameState = await gameStateStore.getGameState(gameId);
        if (!gameState) return;

        // Remove from disconnected players
        const updatedDisconnected = { ...gameState.disconnectedPlayers };
        delete updatedDisconnected[playerId];

        const updatedState = {
            ...gameState,
            disconnectedPlayers: updatedDisconnected,
        };
        await gameStateStore.setGameState(gameId, updatedState);

        // Set player game context
        connectionManager.setPlayerGame(playerId, gameId);

        // Subscribe this server to the game channel
        await pubsub.subscribe(gameId, (message) => {
            const allConnected = connectionManager.getConnectedPlayerIds();
            for (const pid of allConnected) {
                const playerGame = connectionManager.getPlayerGame(pid);
                if (playerGame && playerGame.gameId === gameId) {
                    connectionManager.sendToPlayer(pid, message);
                }
            }
        });

        // Send full state snapshot to reconnected player
        connectionManager.sendToPlayer(playerId, {
            type: 'RECONNECTED',
            gameId,
            ...updatedState,
        });

        // Notify opponent
        await pubsub.publish(gameId, {
            type: 'PLAYER_RECONNECTED',
            gameId,
            playerId,
        });

        metricsCollector.reconnectionRecoveryTotal.inc();
    },

    /**
     * Handle forfeit after reconnection timeout.
     * @param {string} gameId
     * @param {string} forfeitPlayerId
     */
    async _handleForfeit(gameId, forfeitPlayerId) {
        const gameState = await gameStateStore.getGameState(gameId);
        if (!gameState || gameState.status !== 'active') return;

        console.log(`[Reconnection] Player ${forfeitPlayerId} forfeited game ${gameId} (timeout)`);

        const winnerId = gameState.players.find((p) => p !== forfeitPlayerId);

        const updatedState = {
            ...gameState,
            status: 'completed',
            winnerId,
            resultType: 'timeout',
            version: gameState.version + 1,
        };

        await gameStateStore.setGameState(gameId, updatedState);

        // Notify all players
        await pubsub.publish(gameId, {
            type: 'GAME_OVER',
            gameId,
            winnerId,
            resultType: 'timeout',
            forfeitedPlayer: forfeitPlayerId,
        });

        // Persist result
        await gameService._handleGameEnd(updatedState);
    },

    /**
     * Check if a player has a pending reconnection.
     * @param {string} playerId
     * @returns {boolean}
     */
    hasPendingReconnect(playerId) {
        return disconnectTimers.has(playerId);
    },

    /**
     * Clear all disconnect timers (cleanup on shutdown).
     */
    clearAll() {
        for (const { timerId } of disconnectTimers.values()) {
            clearTimeout(timerId);
        }
        disconnectTimers.clear();
    },
};

module.exports = reconnectionService;
