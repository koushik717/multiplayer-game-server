'use strict';

const Redis = require('ioredis');

/**
 * Creates a Redis client with standard configuration.
 * We need separate clients for pub/sub (subscriber can't run other commands).
 */
function createRedisClient(label = 'main') {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      console.log(`[Redis:${label}] Reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('connect', () => console.log(`[Redis:${label}] Connected`));
  client.on('error', (err) => console.error(`[Redis:${label}] Error:`, err.message));
  client.on('close', () => console.log(`[Redis:${label}] Connection closed`));

  return client;
}

// Main client — for commands (GET, SET, etc.)
const redisClient = createRedisClient('main');

// Subscriber client — dedicated to pub/sub
const redisSubscriber = createRedisClient('subscriber');

// Publisher client — dedicated to publishing (separate from main for clarity)
const redisPublisher = createRedisClient('publisher');

module.exports = {
  redisClient,
  redisSubscriber,
  redisPublisher,
  createRedisClient,
};
