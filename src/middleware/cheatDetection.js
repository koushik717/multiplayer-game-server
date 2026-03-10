'use strict';

/**
 * Cheat Detection — validates move timing and impossible actions.
 */

// Track last move time per player
const lastMoveTime = new Map();

const MIN_MOVE_INTERVAL_MS = 200; // Minimum time between moves (200ms)

const cheatDetection = {
    /**
     * Check if a move is suspicious.
     * @param {string} playerId
     * @param {Object} gameState
     * @param {{ row: number, col: number }} move
     * @returns {{ suspicious: boolean, reason?: string }}
     */
    checkMove(playerId, gameState, move) {
        // ─── Time-based validation ───
        const now = Date.now();
        const lastTime = lastMoveTime.get(playerId);

        if (lastTime && (now - lastTime) < MIN_MOVE_INTERVAL_MS) {
            return {
                suspicious: true,
                reason: `Move too fast (${now - lastTime}ms). Minimum: ${MIN_MOVE_INTERVAL_MS}ms`,
            };
        }

        lastMoveTime.set(playerId, now);

        // ─── Impossible action detection ───
        // Playing out of turn
        if (gameState.currentTurn !== playerId) {
            return {
                suspicious: true,
                reason: 'Attempted to play out of turn',
            };
        }

        // Invalid coordinates (trying to exploit)
        const { row, col } = move;
        if (
            typeof row !== 'number' || typeof col !== 'number' ||
            row < 0 || row > 2 || col < 0 || col > 2 ||
            !Number.isInteger(row) || !Number.isInteger(col)
        ) {
            return {
                suspicious: true,
                reason: 'Invalid move coordinates (possible exploit attempt)',
            };
        }

        return { suspicious: false };
    },

    /**
     * Clear tracking data for a player.
     * @param {string} playerId
     */
    clearPlayer(playerId) {
        lastMoveTime.delete(playerId);
    },
};

module.exports = cheatDetection;
