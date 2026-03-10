'use strict';

const gameService = require('../services/gameService');
const matchmakingService = require('../services/matchmakingService');
const rateLimiter = require('../middleware/rateLimiter');

/**
 * Message Router — routes incoming WebSocket messages to appropriate handlers.
 */
async function handleMessage(playerId, message, ws) {
    const { type, requestId } = message;

    if (!type) {
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Missing message type', requestId }));
        return;
    }

    // Rate limiting check
    const allowed = await rateLimiter.checkLimit(playerId, type);
    if (!allowed) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            error: 'Rate limit exceeded. Please slow down.',
            requestId,
        }));
        return;
    }

    switch (type) {
        case 'FIND_MATCH':
            await matchmakingService.findMatch(playerId, message.mode || 'pvp');
            break;

        case 'CANCEL_MATCH':
            await matchmakingService.cancelMatch(playerId);
            break;

        case 'MOVE':
            await gameService.handleMove(
                message.gameId,
                playerId,
                message.move,
                message.version
            );
            break;

        case 'GET_STATE':
            await gameService.sendGameState(message.gameId, playerId);
            break;

        case 'RESIGN':
            await gameService.handleResign(message.gameId, playerId);
            break;

        case 'PING':
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now(), requestId }));
            break;

        default:
            ws.send(JSON.stringify({
                type: 'ERROR',
                error: `Unknown message type: ${type}`,
                requestId,
            }));
    }
}

module.exports = { handleMessage };
