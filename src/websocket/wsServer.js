'use strict';

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const connectionManager = require('./connectionManager');
const { handleMessage } = require('./messageRouter');
const metricsCollector = require('../metrics/metricsCollector');

const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 10000;

/**
 * WebSocket Server — handles connections, authentication, heartbeat, and message routing.
 */
function createWebSocketServer(httpServer) {
    const wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws',
        // Verify client during upgrade
        verifyClient: (info, done) => {
            try {
                const url = new URL(info.req.url, `http://${info.req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token) {
                    done(false, 401, 'Authentication required');
                    return;
                }

                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                info.req.playerId = decoded.playerId;
                info.req.playerName = decoded.playerName || decoded.playerId;
                done(true);
            } catch (err) {
                console.error('[WebSocket] Auth failed:', err.message);
                done(false, 401, 'Invalid token');
            }
        },
    });

    // ── Heartbeat mechanism ──
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log(`[WebSocket] Terminating inactive connection: ${ws.playerId}`);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, HEARTBEAT_INTERVAL);

    wss.on('close', () => clearInterval(heartbeatInterval));

    // ── Connection handler ──
    wss.on('connection', (ws, req) => {
        const playerId = req.playerId;
        const playerName = req.playerName;

        ws.isAlive = true;
        ws.playerId = playerId;
        ws.playerName = playerName;

        // Register in connection manager
        connectionManager.register(playerId, ws);
        metricsCollector.wsConnections.inc();

        // Send welcome message
        ws.send(JSON.stringify({
            type: 'CONNECTED',
            playerId,
            playerName,
            serverId: process.env.SERVER_ID || 'unknown',
            timestamp: Date.now(),
        }));

        console.log(`[WebSocket] Player ${playerId} (${playerName}) connected to ${process.env.SERVER_ID}`);

        // ── Heartbeat pong ──
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // ── Message handler ──
        ws.on('message', async (data) => {
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (err) {
                ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid JSON' }));
                return;
            }

            try {
                await handleMessage(playerId, message, ws);
            } catch (err) {
                console.error(`[WebSocket] Error handling message from ${playerId}:`, err);
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    error: 'Internal server error',
                    requestId: message.requestId,
                }));
            }
        });

        // ── Disconnect handler ──
        ws.on('close', (code, reason) => {
            console.log(`[WebSocket] Player ${playerId} disconnected (code: ${code})`);
            connectionManager.unregister(playerId);
            metricsCollector.wsConnections.dec();

            // Trigger reconnection logic
            const reconnectionService = require('../services/reconnectionService');
            reconnectionService.handleDisconnect(playerId);
        });

        ws.on('error', (err) => {
            console.error(`[WebSocket] Error for ${playerId}:`, err.message);
        });
    });

    console.log(`[WebSocket] Server initialized on path /ws`);
    return wss;
}

module.exports = { createWebSocketServer };
