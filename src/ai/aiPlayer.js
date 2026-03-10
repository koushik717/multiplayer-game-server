'use strict';

const gameEngine = require('../services/gameEngine');
const gameStateStore = require('../redis/gameStateStore');
const gameService = require('../services/gameService');
const pubsub = require('../redis/pubsub');

/**
 * AI Player — Minimax with alpha-beta pruning for Tic-Tac-Toe.
 * Treated as a real player — all moves go through the same pipeline.
 * Never bypasses validation.
 */

// Active AI registrations: gameId → aiPlayerId
const activeGames = new Map();

const aiPlayer = {
    /**
     * Register the AI to listen for moves in a specific game.
     * @param {string} gameId
     * @param {string} aiPlayerId
     */
    async registerForGame(gameId, aiPlayerId) {
        activeGames.set(gameId, aiPlayerId);

        // Subscribe to game events
        await pubsub.subscribe(gameId, async (message) => {
            if (message.type === 'MOVE_MADE' || message.type === 'GAME_START') {
                await this._onGameUpdate(gameId, message);
            }

            if (message.type === 'GAME_OVER') {
                this.unregisterFromGame(gameId);
            }
        });

        // Check if AI goes first
        const gameState = await gameStateStore.getGameState(gameId);
        if (gameState && gameState.currentTurn === aiPlayerId) {
            await this._makeMove(gameId, aiPlayerId, gameState);
        }

        console.log(`[AI] Registered for game ${gameId} as ${aiPlayerId}`);
    },

    /**
     * Unregister AI from a game.
     * @param {string} gameId
     */
    unregisterFromGame(gameId) {
        activeGames.delete(gameId);
        console.log(`[AI] Unregistered from game ${gameId}`);
    },

    /**
     * Handle game update — check if it's AI's turn.
     */
    async _onGameUpdate(gameId, message) {
        const aiPlayerId = activeGames.get(gameId);
        if (!aiPlayerId) return;

        // If game just started or a move was made, check if it's AI's turn
        const gameState = await gameStateStore.getGameState(gameId);
        if (!gameState || gameState.status !== 'active') return;

        if (gameState.currentTurn === aiPlayerId) {
            // Small delay to feel more natural
            const thinkTime = 500 + Math.random() * 1000;
            setTimeout(async () => {
                await this._makeMove(gameId, aiPlayerId, gameState);
            }, thinkTime);
        }
    },

    /**
     * Calculate and submit the AI's move through the normal pipeline.
     */
    async _makeMove(gameId, aiPlayerId, gameState) {
        const aiSymbol = gameState.playerSymbols[aiPlayerId];
        const humanSymbol = aiSymbol === 'X' ? 'O' : 'X';

        // Calculate best move using minimax
        const bestMove = this._minimax(
            gameState.board,
            aiSymbol,
            humanSymbol,
            true, // AI is maximizing
            -Infinity,
            Infinity
        );

        if (!bestMove.move) {
            console.error(`[AI] No valid move found for game ${gameId}`);
            return;
        }

        console.log(`[AI] Playing move (${bestMove.move.row}, ${bestMove.move.col}) in game ${gameId}`);

        // Submit through the SAME move pipeline — no bypassing validation
        await gameService.handleMove(gameId, aiPlayerId, bestMove.move, gameState.version);
    },

    /**
     * Minimax algorithm with alpha-beta pruning.
     * @param {Array} board
     * @param {string} aiSymbol
     * @param {string} humanSymbol
     * @param {boolean} isMaximizing
     * @param {number} alpha
     * @param {number} beta
     * @returns {{ score: number, move?: { row: number, col: number } }}
     */
    _minimax(board, aiSymbol, humanSymbol, isMaximizing, alpha, beta) {
        // Check terminal states
        const winResult = gameEngine.checkWinner(board);
        if (winResult.winner) {
            if (winResult.symbol === aiSymbol) return { score: 10 };
            return { score: -10 };
        }
        if (gameEngine.checkDraw(board)) return { score: 0 };

        const availableMoves = gameEngine.getAvailableMoves(board);
        let bestResult = { score: isMaximizing ? -Infinity : Infinity, move: null };

        for (const move of availableMoves) {
            const symbol = isMaximizing ? aiSymbol : humanSymbol;
            const newBoard = gameEngine.applyMove(board, move.row, move.col, symbol);

            const result = this._minimax(newBoard, aiSymbol, humanSymbol, !isMaximizing, alpha, beta);

            if (isMaximizing) {
                if (result.score > bestResult.score) {
                    bestResult = { score: result.score, move };
                }
                alpha = Math.max(alpha, result.score);
            } else {
                if (result.score < bestResult.score) {
                    bestResult = { score: result.score, move };
                }
                beta = Math.min(beta, result.score);
            }

            // Alpha-beta pruning
            if (beta <= alpha) break;
        }

        return bestResult;
    },
};

module.exports = aiPlayer;
