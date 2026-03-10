'use strict';

const { redisClient } = require('./redisClient');
const { v4: uuidv4 } = require('uuid');

/**
 * Distributed Lock using Redis SET NX EX pattern.
 * Safe release via Lua script to prevent releasing another process's lock.
 */

// Lua script: only release if the lock value matches our token
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

const LOCK_PREFIX = 'lock:';

const distributedLock = {
    /**
     * Acquire a distributed lock.
     * @param {string} resource - Resource name (e.g., "game:123")
     * @param {number} [ttlMs=5000] - Lock TTL in milliseconds
     * @param {number} [retries=3] - Number of retry attempts
     * @param {number} [retryDelayMs=100] - Base delay between retries
     * @returns {{ acquired: boolean, token: string|null, lockKey: string }}
     */
    async acquireLock(resource, ttlMs = 5000, retries = 3, retryDelayMs = 100) {
        const lockKey = `${LOCK_PREFIX}${resource}`;
        const token = uuidv4(); // Unique token to safely release

        for (let attempt = 0; attempt <= retries; attempt++) {
            // SET key token NX PX ttlMs
            const result = await redisClient.set(lockKey, token, 'NX', 'PX', ttlMs);

            if (result === 'OK') {
                return { acquired: true, token, lockKey };
            }

            if (attempt < retries) {
                // Exponential backoff with jitter
                const delay = retryDelayMs * Math.pow(2, attempt) + Math.random() * 50;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        return { acquired: false, token: null, lockKey };
    },

    /**
     * Release a distributed lock safely.
     * Only releases if the token matches (prevents releasing another process's lock).
     * @param {string} lockKey
     * @param {string} token
     * @returns {boolean} Whether the lock was released
     */
    async releaseLock(lockKey, token) {
        const result = await redisClient.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
        return result === 1;
    },
};

module.exports = distributedLock;
