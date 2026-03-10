'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const path = require('path');
const { createWebSocketServer } = require('./websocket/wsServer');
const metricsCollector = require('./metrics/metricsCollector');
const reconnectionService = require('./services/reconnectionService');
const pubsub = require('./redis/pubsub');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT, 10) || 3001;
const SERVER_ID = process.env.SERVER_ID || `server-${PORT}`;

// ── Middleware ──
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health Check ──
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        serverId: SERVER_ID,
        uptime: process.uptime(),
        timestamp: Date.now(),
        connections: require('./websocket/connectionManager').getConnectionCount(),
    });
});

// ── Generate a test JWT token (DEV ONLY) ──
app.post('/api/auth/token', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({ error: 'playerName is required' });
    }

    const playerId = uuidv4();
    const token = jwt.sign(
        { playerId, playerName },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );

    // Ensure player exists in DB (best-effort)
    const gameRepository = require('./database/gameRepository');
    gameRepository.ensurePlayer(playerId, playerName).catch(() => { });

    res.json({ playerId, playerName, token });
});

// ── Player Stats ──
app.get('/api/players/:playerId/stats', async (req, res) => {
    try {
        const gameRepository = require('./database/gameRepository');
        const stats = await gameRepository.getPlayerStats(req.params.playerId);
        if (!stats) return res.status(404).json({ error: 'Player not found' });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── Game History ──
app.get('/api/players/:playerId/history', async (req, res) => {
    try {
        const gameRepository = require('./database/gameRepository');
        const history = await gameRepository.getGameHistory(req.params.playerId);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// ── Prometheus Metrics ──
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', metricsCollector.register.contentType);
        res.end(await metricsCollector.register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// ── Initialize WebSocket Server ──
const wss = createWebSocketServer(server);

// ── Graceful Shutdown ──
async function shutdown(signal) {
    console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

    // Stop accepting new connections
    wss.close(() => {
        console.log('[Server] WebSocket server closed');
    });

    // Cleanup
    reconnectionService.clearAll();
    await pubsub.unsubscribeAll();

    // Close Redis connections
    const { redisClient, redisSubscriber, redisPublisher } = require('./redis/redisClient');
    await redisClient.quit();
    await redisSubscriber.quit();
    await redisPublisher.quit();
    console.log('[Server] Redis connections closed');

    // Close PostgreSQL pool
    const pool = require('./database/db');
    await pool.end();
    console.log('[Server] PostgreSQL pool closed');

    server.close(() => {
        console.log('[Server] HTTP server closed');
        process.exit(0);
    });

    // Force kill after 10 seconds
    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start Server ──
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║  🎮  Multiplayer Game Server                          ║
║  ─────────────────────────────────────────────────── ║
║  Server ID:    ${SERVER_ID.padEnd(40)}║
║  Port:         ${String(PORT).padEnd(40)}║
║  Environment:  ${(process.env.NODE_ENV || 'development').padEnd(40)}║
║  WebSocket:    ws://localhost:${PORT}/ws${' '.repeat(24)}║
║  Health:       http://localhost:${PORT}/health${' '.repeat(19)}║
║  Metrics:      http://localhost:${PORT}/metrics${' '.repeat(18)}║
╚═══════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
