'use strict';

const { redisSubscriber, redisPublisher } = require('./redisClient');

const CHANNEL_PREFIX = 'channel:game:';

// In-memory handlers map: channel → Set<callback>
const handlers = new Map();

/**
 * Redis Pub/Sub manager for cross-instance game event synchronization.
 */
const pubsub = {
    /**
     * Subscribe to a game channel.
     * @param {string} gameId
     * @param {Function} handler - Called with (message: Object)
     */
    async subscribe(gameId, handler) {
        const channel = `${CHANNEL_PREFIX}${gameId}`;

        if (!handlers.has(channel)) {
            handlers.set(channel, new Set());
            await redisSubscriber.subscribe(channel);
        }

        handlers.get(channel).add(handler);
    },

    /**
     * Unsubscribe a handler from a game channel.
     * If no handlers remain, unsubscribe from Redis.
     * @param {string} gameId
     * @param {Function} handler
     */
    async unsubscribe(gameId, handler) {
        const channel = `${CHANNEL_PREFIX}${gameId}`;
        const channelHandlers = handlers.get(channel);

        if (channelHandlers) {
            channelHandlers.delete(handler);
            if (channelHandlers.size === 0) {
                handlers.delete(channel);
                await redisSubscriber.unsubscribe(channel);
            }
        }
    },

    /**
     * Publish a game event to all subscribers across all server instances.
     * @param {string} gameId
     * @param {Object} message
     */
    async publish(gameId, message) {
        const channel = `${CHANNEL_PREFIX}${gameId}`;
        await redisPublisher.publish(channel, JSON.stringify(message));
    },

    /**
     * Unsubscribe from all channels (cleanup on shutdown).
     */
    async unsubscribeAll() {
        for (const channel of handlers.keys()) {
            await redisSubscriber.unsubscribe(channel);
        }
        handlers.clear();
    },
};

// ── Global message dispatcher ──
// Routes incoming pub/sub messages to registered handlers
redisSubscriber.on('message', (channel, rawMessage) => {
    const channelHandlers = handlers.get(channel);
    if (!channelHandlers) return;

    let message;
    try {
        message = JSON.parse(rawMessage);
    } catch (err) {
        console.error('[PubSub] Failed to parse message:', err.message);
        return;
    }

    for (const handler of channelHandlers) {
        try {
            handler(message);
        } catch (err) {
            console.error('[PubSub] Handler error:', err.message);
        }
    }
});

module.exports = pubsub;
