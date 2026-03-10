'use strict';

const { redisClient } = require('../redis/redisClient');

const IDEMPOTENCY_PREFIX = 'idempotency:';
const DEFAULT_TTL = 60; // 60 seconds

/**
 * Idempotency Key Manager — prevents duplicate message processing
 * from network retries or client bugs.
 */
const idempotency = {
    /**
     * Check if a request has already been processed.
     * If not, mark it as processed atomically.
     * @param {string} key - Unique idempotency key (e.g., "move:gameId:playerId:version")
     * @param {number} [ttl=DEFAULT_TTL] - TTL in seconds
     * @returns {boolean} true if this is a NEW request, false if duplicate
     */
    async checkAndMark(key, ttl = DEFAULT_TTL) {
        const fullKey = `${IDEMPOTENCY_PREFIX}${key}`;
        // SET NX returns 'OK' only if key didn't exist
        const result = await redisClient.set(fullKey, '1', 'NX', 'EX', ttl);
        return result === 'OK';
    },

    /**
     * Remove an idempotency key (e.g., if processing failed and should be retried).
     * @param {string} key
     */
    async remove(key) {
        await redisClient.del(`${IDEMPOTENCY_PREFIX}${key}`);
    },
};

module.exports = idempotency;
