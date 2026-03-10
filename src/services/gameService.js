'use strict';

const { v4: uuidv4 } = require('uuid');
const gameEngine = require('./gameEngine');
const gameStateStore = require('../redis/gameStateStore');
const distributedLock = require('../redis/distributedLock');
const pubsub = require('../redis/pubsub');
const connectionManager = require('../websocket/connectionManager');
const gameRepository = require('../database/gameRepository');
const metricsCollector = require('../metrics/metricsCollector');

/**
 * Game Service — orchestrates game lifecycle with distributed locking
 * and cross-instance synchronization.
 */
const gameService = {
    /**
     * Create a new game between two players.
     * @param {string} player1Id
     * @param {string} player2Id
     * @returns {Object} Created game state
     */
    async createGame(player1Id, player2Id) {
        const gameId = uuidv4();
        const startedAt = Date.now();

        const gameState = {
            gameId,
            players: [player1Id, player2Id],
            board: gameEngine.createBoard(),
            currentTurn: player1Id, // Player 1 (X) goes first
            status: 'active',
            version: 1,
            moves: [],
            startedAt,
            playerSymbols: {
                [player1Id]: 'X',
                [player2Id]: 'O',
            },
            disconnectedPlayers: {},
        };

        await gameStateStore.setGameState(gameId, gameState);

        // Subscribe this server to game updates
        await this._subscribeToGame(gameId);

        // Track metric
        metricsCollector.activeGames.inc();

        // Record event
        try {
            await gameRepository.saveGameEvent(gameId, 'GAME_CREATED', null, {
                players: [player1Id, player2Id],
            }, 1);
        } catch (err) {
            console.error('[GameService] Failed to save game event:', err.message);
        }

        console.log(`[GameService] Game ${gameId} created: ${player1Id} (X) vs ${player2Id} (O)`);
        return gameState;
    },

    /**
     * Handle a player's move — THE CRITICAL SECTION.
     * Uses distributed locking to prevent race conditions.
     *
     * @param {string} gameId
     * @param {string} playerId
     * @param {{ row: number, col: number }} move
     * @param {number} clientVersion - For optimistic locking
     */
    async handleMove(gameId, playerId, move, clientVersion) {
        const moveStart = Date.now();

        // ─── 1. Acquire distributed lock ───
        const lockTimer = metricsCollector.lockWaitDuration.startTimer();
        const lock = await distributedLock.acquireLock(`game:${gameId}`, 5000, 3, 100);
        lockTimer();

        if (!lock.acquired) {
            connectionManager.sendToPlayer(playerId, {
                type: 'ERROR',
                error: 'Server busy. Please retry.',
                gameId,
            });
            return;
        }

        try {
            // ─── 2. Fetch game state ───
            const gameState = await gameStateStore.getGameState(gameId);
            if (!gameState) {
                connectionManager.sendToPlayer(playerId, {
                    type: 'ERROR',
                    error: 'Game not found',
                    gameId,
                });
                return;
            }

            // ─── 3. Optimistic locking — version check ───
            if (clientVersion !== undefined && clientVersion !== gameState.version) {
                connectionManager.sendToPlayer(playerId, {
                    type: 'VERSION_MISMATCH',
                    error: 'State has changed. Refresh and retry.',
                    gameId,
                    serverVersion: gameState.version,
                });
                return;
            }

            // ─── 4. Validate move ───
            const validationTimer = metricsCollector.moveValidationDuration.startTimer();
            const validation = gameEngine.validateMove(gameState, playerId, move);
            validationTimer();

            if (!validation.valid) {
                connectionManager.sendToPlayer(playerId, {
                    type: 'INVALID_MOVE',
                    error: validation.error,
                    gameId,
                });
                return;
            }

            // ─── 5. Apply move ───
            const symbol = gameState.playerSymbols[playerId];
            const newBoard = gameEngine.applyMove(gameState.board, move.row, move.col, symbol);

            // ─── 6. Check game result ───
            const winResult = gameEngine.checkWinner(newBoard);
            const isDraw = !winResult.winner && gameEngine.checkDraw(newBoard);

            let newStatus = 'active';
            let winnerId = null;
            let resultType = null;

            if (winResult.winner) {
                newStatus = 'completed';
                winnerId = playerId;
                resultType = 'win';
            } else if (isDraw) {
                newStatus = 'completed';
                resultType = 'draw';
            }

            // ─── 7. Update state ───
            const newVersion = gameState.version + 1;
            const moveRecord = {
                playerId,
                symbol,
                row: move.row,
                col: move.col,
                version: newVersion,
                timestamp: Date.now(),
            };

            const updatedState = {
                ...gameState,
                board: newBoard,
                currentTurn: newStatus === 'active'
                    ? gameEngine.getNextTurn(gameState.players, playerId)
                    : null,
                status: newStatus,
                version: newVersion,
                moves: [...gameState.moves, moveRecord],
                winnerId,
                resultType,
                winLine: winResult.line || null,
            };

            // ─── 8. Save back to Redis ───
            await gameStateStore.setGameState(gameId, updatedState);

            // ─── 9. Publish update via Pub/Sub ───
            const updateMessage = {
                type: 'MOVE_MADE',
                gameId,
                move: moveRecord,
                board: newBoard,
                currentTurn: updatedState.currentTurn,
                status: newStatus,
                version: newVersion,
                winnerId,
                resultType,
                winLine: winResult.line || null,
            };

            await pubsub.publish(gameId, updateMessage);

            // Track move propagation latency
            const propagationLatency = Date.now() - moveStart;
            metricsCollector.movePropagationLatency.observe(propagationLatency);

            // ─── 10. Handle game end ───
            if (newStatus === 'completed') {
                await this._handleGameEnd(updatedState);
            }

            // Record event (event sourcing)
            try {
                await gameRepository.saveGameEvent(gameId, 'MOVE', playerId, moveRecord, newVersion);
            } catch (err) {
                console.error('[GameService] Failed to save move event:', err.message);
            }

        } finally {
            // ─── 11. ALWAYS release lock ───
            await distributedLock.releaseLock(lock.lockKey, lock.token);
        }
    },

    /**
     * Send current game state to a player (used for reconnection and state requests).
     * @param {string} gameId
     * @param {string} playerId
     */
    async sendGameState(gameId, playerId) {
        const gameState = await gameStateStore.getGameState(gameId);
        if (!gameState) {
            connectionManager.sendToPlayer(playerId, {
                type: 'ERROR',
                error: 'Game not found',
                gameId,
            });
            return;
        }

        connectionManager.sendToPlayer(playerId, {
            type: 'GAME_STATE',
            ...gameState,
        });
    },

    /**
     * Handle player resignation.
     * @param {string} gameId
     * @param {string} playerId
     */
    async handleResign(gameId, playerId) {
        const lock = await distributedLock.acquireLock(`game:${gameId}`);
        if (!lock.acquired) return;

        try {
            const gameState = await gameStateStore.getGameState(gameId);
            if (!gameState || gameState.status !== 'active') return;

            const winnerId = gameState.players.find((p) => p !== playerId);

            const updatedState = {
                ...gameState,
                status: 'completed',
                winnerId,
                resultType: 'forfeit',
                version: gameState.version + 1,
            };

            await gameStateStore.setGameState(gameId, updatedState);

            await pubsub.publish(gameId, {
                type: 'GAME_OVER',
                gameId,
                winnerId,
                resultType: 'forfeit',
                resignedPlayer: playerId,
            });

            await this._handleGameEnd(updatedState);
        } finally {
            await distributedLock.releaseLock(lock.lockKey, lock.token);
        }
    },

    /**
     * Subscribe this server instance to a game's pub/sub channel.
     * Routes incoming messages to locally connected players.
     */
    async _subscribeToGame(gameId) {
        await pubsub.subscribe(gameId, (message) => {
            // Forward to all locally connected players in this game
            const gameState = message;
            // We need the player list to know who to forward to
            // The message itself might contain this, or we use the original game info
            if (message.type === 'MOVE_MADE' || message.type === 'GAME_OVER') {
                // Broadcast to all connected players who might be in this game
                const allConnected = connectionManager.getConnectedPlayerIds();
                for (const pid of allConnected) {
                    const playerGame = connectionManager.getPlayerGame(pid);
                    if (playerGame && playerGame.gameId === gameId) {
                        connectionManager.sendToPlayer(pid, message);
                    }
                }
            } else if (message.type === 'GAME_START') {
                // Notify players about game creation
                if (message.players) {
                    connectionManager.broadcastToPlayers(message.players, message);
                }
            }
        });
    },

    /**
     * Handle game completion — persist to DB, cleanup Redis, update metrics.
     */
    async _handleGameEnd(gameState) {
        metricsCollector.activeGames.dec();
        metricsCollector.matchCompletionTotal.inc();

        try {
            await gameRepository.saveGameResult({
                gameId: gameState.gameId,
                player1Id: gameState.players[0],
                player2Id: gameState.players[1],
                winnerId: gameState.winnerId,
                moves: gameState.moves,
                boardFinal: gameState.board,
                resultType: gameState.resultType,
                startedAt: gameState.startedAt,
                durationMs: Date.now() - gameState.startedAt,
                totalMoves: gameState.moves.length,
            });
        } catch (err) {
            console.error('[GameService] Failed to persist game result:', err.message);
        }

        // Cleanup: unsubscribe from pub/sub after a delay (let final messages through)
        setTimeout(async () => {
            await pubsub.unsubscribe(gameState.gameId, () => { });
            // Don't delete game state immediately — allow reconnection to see final state
            // Redis TTL will clean it up
        }, 60000);

        // Record final event
        try {
            await gameRepository.saveGameEvent(
                gameState.gameId,
                'GAME_ENDED',
                null,
                { winnerId: gameState.winnerId, resultType: gameState.resultType },
                gameState.version
            );
        } catch (err) {
            console.error('[GameService] Failed to save end event:', err.message);
        }
    },
};

module.exports = gameService;
