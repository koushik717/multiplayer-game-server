'use strict';

const client = require('prom-client');

// Create a Registry
const register = new client.Registry();

// Add default metrics (event loop lag, heap size, etc.)
client.collectDefaultMetrics({ register });

/**
 * Prometheus Metrics Collector — tracks all game server metrics.
 */
const metricsCollector = {
    // ── Gauges ──
    activeGames: new client.Gauge({
        name: 'game_server_active_games',
        help: 'Number of currently active games',
        registers: [register],
    }),

    wsConnections: new client.Gauge({
        name: 'game_server_ws_connections',
        help: 'Number of active WebSocket connections on this instance',
        registers: [register],
    }),

    matchmakingQueueSize: new client.Gauge({
        name: 'game_server_matchmaking_queue_size',
        help: 'Number of players waiting in matchmaking queue',
        registers: [register],
    }),

    // ── Histograms ──
    moveValidationDuration: new client.Histogram({
        name: 'game_server_move_validation_duration_ms',
        help: 'Time to validate a move (ms)',
        buckets: [1, 5, 10, 25, 50, 100],
        registers: [register],
    }),

    movePropagationLatency: new client.Histogram({
        name: 'game_server_move_propagation_latency_ms',
        help: 'End-to-end time from move receipt to broadcast (ms)',
        buckets: [10, 25, 50, 100, 150, 250, 500],
        registers: [register],
    }),

    lockWaitDuration: new client.Histogram({
        name: 'game_server_lock_wait_duration_ms',
        help: 'Time spent waiting to acquire distributed lock (ms)',
        buckets: [1, 5, 10, 25, 50, 100, 250, 500],
        registers: [register],
    }),

    // ── Counters ──
    matchCompletionTotal: new client.Counter({
        name: 'game_server_match_completion_total',
        help: 'Total number of completed games',
        registers: [register],
    }),

    reconnectionRecoveryTotal: new client.Counter({
        name: 'game_server_reconnection_recovery_total',
        help: 'Total successful reconnections',
        registers: [register],
    }),

    movesProcessedTotal: new client.Counter({
        name: 'game_server_moves_processed_total',
        help: 'Total moves processed',
        registers: [register],
    }),

    rateLimitHitsTotal: new client.Counter({
        name: 'game_server_rate_limit_hits_total',
        help: 'Total rate limit rejections',
        registers: [register],
    }),

    // ── Registry access ──
    register,
};

module.exports = metricsCollector;
