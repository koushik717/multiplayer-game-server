'use strict';

const { redisClient } = require('./redisClient');

const GAME_KEY_PREFIX = 'game:';
const DEFAULT_TTL = 3600; // 1 hour TTL for stale games

/**
 * Game State Store — CRUD operations for game state in Redis.
 * Each game stored as: game:{gameId} → JSON string
 */
const gameStateStore = {
    /**
     * Get game state by ID.
     * @param {string} gameId
     * @returns {Object|null} Parsed game state or null
     */
    async getGameState(gameId) {
        const data = await redisClient.get(`${GAME_KEY_PREFIX}${gameId}`);
        if (!data) return null;
        return JSON.parse(data);
    },

    /**
     * Set game state with TTL.
     * @param {string} gameId
     * @param {Object} state
     * @param {number} [ttl=DEFAULT_TTL] TTL in seconds
     */
    async setGameState(gameId, state, ttl = DEFAULT_TTL) {
        const key = `${GAME_KEY_PREFIX}${gameId}`;
        await redisClient.set(key, JSON.stringify(state), 'EX', ttl);
    },

    /**
     * Delete game state (cleanup after persistence to DB).
     * @param {string} gameId
     */
    async deleteGameState(gameId) {
        await redisClient.del(`${GAME_KEY_PREFIX}${gameId}`);
    },

    /**
     * Extend the TTL of a game (e.g., on activity).
     * @param {string} gameId
     * @param {number} [ttl=DEFAULT_TTL]
     */
    async refreshTTL(gameId, ttl = DEFAULT_TTL) {
        await redisClient.expire(`${GAME_KEY_PREFIX}${gameId}`, ttl);
    },
};

module.exports = gameStateStore;
