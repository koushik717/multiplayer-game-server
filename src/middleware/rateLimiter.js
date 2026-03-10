'use strict';

const { redisClient } = require('../redis/redisClient');
const metricsCollector = require('../metrics/metricsCollector');

const RATE_LIMIT_PREFIX = 'ratelimit:';
const MOVE_RATE_LIMIT = parseInt(process.env.MOVE_RATE_LIMIT, 10) || 10;

/**
 * Redis-based sliding window rate limiter.
 * Per-player limits on different action types.
 */

const LIMITS = {
    MOVE: { max: MOVE_RATE_LIMIT, windowSec: 10 },      // 10 moves per 10s
    FIND_MATCH: { max: 3, windowSec: 30 },                // 3 match requests per 30s
    CANCEL_MATCH: { max: 5, windowSec: 30 },              // 5 cancel requests per 30s
    GET_STATE: { max: 10, windowSec: 10 },                 // 10 state requests per 10s
    RESIGN: { max: 2, windowSec: 60 },                     // 2 resigns per 60s
    PING: { max: 30, windowSec: 10 },                      // 30 pings per 10s
};

/**
 * Sliding window rate limiter using Redis sorted sets.
 *
 * Lua script: atomically check + increment counter with sliding window.
 */
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])

  -- Remove entries outside the window
  redis.call("ZREMRANGEBYSCORE", key, 0, now - window * 1000)

  -- Count current entries in window
  local count = redis.call("ZCARD", key)

  if count < limit then
    -- Add new entry
    redis.call("ZADD", key, now, now .. "-" .. math.random(1000000))
    redis.call("EXPIRE", key, window + 1)
    return 1
  else
    return 0
  end
`;

const rateLimiter = {
    /**
     * Check if a player action is within rate limits.
     * @param {string} playerId
     * @param {string} actionType - Message type (MOVE, FIND_MATCH, etc.)
     * @returns {boolean} Whether the action is allowed
     */
    async checkLimit(playerId, actionType) {
        const config = LIMITS[actionType];
        if (!config) return true; // No limit for unknown actions

        const key = `${RATE_LIMIT_PREFIX}${playerId}:${actionType}`;
        const now = Date.now();

        const result = await redisClient.eval(
            RATE_LIMIT_SCRIPT,
            1,
            key,
            now,
            config.windowSec,
            config.max
        );

        if (result === 0) {
            metricsCollector.rateLimitHitsTotal.inc();
            console.log(`[RateLimiter] Rate limit hit: ${playerId} / ${actionType}`);
            return false;
        }

        return true;
    },
};

module.exports = rateLimiter;
