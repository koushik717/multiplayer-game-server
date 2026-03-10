'use strict';

const { redisClient } = require('../redis/redisClient');
const gameService = require('./gameService');
const connectionManager = require('../websocket/connectionManager');
const pubsub = require('../redis/pubsub');
const metricsCollector = require('../metrics/metricsCollector');

const MATCHMAKING_QUEUE = 'matchmaking_queue';
const MATCHMAKING_SET = 'matchmaking_active'; // Track who's in queue

/**
 * Lua script: Atomically pop two players from the matchmaking queue.
 * Returns the two player IDs, or empty array if < 2 players.
 */
const POP_TWO_PLAYERS_SCRIPT = `
  local len = redis.call("LLEN", KEYS[1])
  if len >= 2 then
    local p1 = redis.call("RPOP", KEYS[1])
    local p2 = redis.call("RPOP", KEYS[1])
    redis.call("SREM", KEYS[2], p1, p2)
    return {p1, p2}
  end
  return {}
`;

/**
 * Matchmaking Service — Redis-based queue for player matching.
 */
const matchmakingService = {
    /**
     * Queue a player for matchmaking.
     * @param {string} playerId
     * @param {string} mode - 'pvp' or 'solo'
     */
    async findMatch(playerId, mode = 'pvp') {
        if (mode === 'solo') {
            return this._createSoloGame(playerId);
        }

        // Check if already in queue
        const alreadyQueued = await redisClient.sismember(MATCHMAKING_SET, playerId);
        if (alreadyQueued) {
            connectionManager.sendToPlayer(playerId, {
                type: 'MATCHMAKING_STATUS',
                status: 'already_queued',
                message: 'You are already in the matchmaking queue.',
            });
            return;
        }

        // Add to queue
        await redisClient.lpush(MATCHMAKING_QUEUE, playerId);
        await redisClient.sadd(MATCHMAKING_SET, playerId);

        connectionManager.sendToPlayer(playerId, {
            type: 'MATCHMAKING_STATUS',
            status: 'queued',
            message: 'Looking for an opponent...',
        });

        console.log(`[Matchmaking] Player ${playerId} queued for matchmaking`);

        // Try to match
        await this._attemptMatch();
    },

    /**
     * Cancel matchmaking for a player.
     * @param {string} playerId
     */
    async cancelMatch(playerId) {
        await redisClient.lrem(MATCHMAKING_QUEUE, 0, playerId);
        await redisClient.srem(MATCHMAKING_SET, playerId);

        connectionManager.sendToPlayer(playerId, {
            type: 'MATCHMAKING_STATUS',
            status: 'cancelled',
            message: 'Matchmaking cancelled.',
        });

        console.log(`[Matchmaking] Player ${playerId} cancelled matchmaking`);
    },

    /**
     * Attempt to match two players atomically.
     */
    async _attemptMatch() {
        // Atomically pop two players using Lua script
        const result = await redisClient.eval(
            POP_TWO_PLAYERS_SCRIPT,
            2,
            MATCHMAKING_QUEUE,
            MATCHMAKING_SET
        );

        if (!result || result.length < 2) return;

        const [player1Id, player2Id] = result;
        console.log(`[Matchmaking] Matched: ${player1Id} vs ${player2Id}`);

        // Create the game
        const gameState = await gameService.createGame(player1Id, player2Id);

        // Set player game contexts
        connectionManager.setPlayerGame(player1Id, gameState.gameId);
        connectionManager.setPlayerGame(player2Id, gameState.gameId);

        // Notify both players (via pub/sub for cross-instance support)
        const gameStartMessage = {
            type: 'GAME_START',
            gameId: gameState.gameId,
            players: gameState.players,
            board: gameState.board,
            currentTurn: gameState.currentTurn,
            playerSymbols: gameState.playerSymbols,
            version: gameState.version,
        };

        // Also publish to pub/sub so other instances can notify their local players
        await pubsub.publish(gameState.gameId, gameStartMessage);

        // Direct send to locally connected players
        connectionManager.sendToPlayer(player1Id, gameStartMessage);
        connectionManager.sendToPlayer(player2Id, gameStartMessage);
    },

    /**
     * Create a solo game against AI.
     * @param {string} playerId
     */
    async _createSoloGame(playerId) {
        const aiPlayerId = `ai-${Date.now()}`;

        const gameState = await gameService.createGame(playerId, aiPlayerId);

        connectionManager.setPlayerGame(playerId, gameState.gameId);

        const gameStartMessage = {
            type: 'GAME_START',
            gameId: gameState.gameId,
            players: gameState.players,
            board: gameState.board,
            currentTurn: gameState.currentTurn,
            playerSymbols: gameState.playerSymbols,
            version: gameState.version,
            mode: 'solo',
        };

        connectionManager.sendToPlayer(playerId, gameStartMessage);

        // Initialize AI for this game
        const aiPlayer = require('../ai/aiPlayer');
        aiPlayer.registerForGame(gameState.gameId, aiPlayerId);

        console.log(`[Matchmaking] Solo game created: ${playerId} vs AI (${aiPlayerId})`);
    },
};

module.exports = matchmakingService;
