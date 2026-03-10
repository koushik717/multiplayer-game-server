'use strict';

/**
 * Game Engine — pure functions for Tic-Tac-Toe game logic.
 * No side effects, no I/O. Server-authoritative validation.
 */

const BOARD_SIZE = 3;
const SYMBOLS = { X: 'X', O: 'O' };
const EMPTY = null;

const gameEngine = {
    /**
     * Create an empty board.
     * @returns {Array<Array<null>>} 3×3 board
     */
    createBoard() {
        return Array.from({ length: BOARD_SIZE }, () =>
            Array.from({ length: BOARD_SIZE }, () => EMPTY)
        );
    },

    /**
     * Validate a move.
     * @param {Object} gameState
     * @param {string} playerId
     * @param {{ row: number, col: number }} move
     * @returns {{ valid: boolean, error?: string }}
     */
    validateMove(gameState, playerId, move) {
        // Game must be active
        if (gameState.status !== 'active') {
            return { valid: false, error: 'Game is not active' };
        }

        // Must be this player's turn
        if (gameState.currentTurn !== playerId) {
            return { valid: false, error: 'Not your turn' };
        }

        // Player must be in the game
        if (!gameState.players.includes(playerId)) {
            return { valid: false, error: 'You are not a participant in this game' };
        }

        const { row, col } = move;

        // Validate coordinates
        if (
            row === undefined || col === undefined ||
            row < 0 || row >= BOARD_SIZE ||
            col < 0 || col >= BOARD_SIZE
        ) {
            return { valid: false, error: `Invalid coordinates. Must be 0-${BOARD_SIZE - 1}` };
        }

        // Validate integers
        if (!Number.isInteger(row) || !Number.isInteger(col)) {
            return { valid: false, error: 'Coordinates must be integers' };
        }

        // Cell must be empty
        if (gameState.board[row][col] !== EMPTY) {
            return { valid: false, error: 'Cell is already occupied' };
        }

        return { valid: true };
    },

    /**
     * Apply a move to the board (returns new board, does not mutate).
     * @param {Array} board
     * @param {number} row
     * @param {number} col
     * @param {string} symbol - 'X' or 'O'
     * @returns {Array} New board state
     */
    applyMove(board, row, col, symbol) {
        const newBoard = board.map((r) => [...r]);
        newBoard[row][col] = symbol;
        return newBoard;
    },

    /**
     * Check if there's a winner.
     * @param {Array} board
     * @returns {{ winner: boolean, symbol?: string, line?: Array }}
     */
    checkWinner(board) {
        const lines = [];

        // Rows
        for (let r = 0; r < BOARD_SIZE; r++) {
            lines.push(board[r].map((_, c) => ({ r, c })));
        }

        // Columns
        for (let c = 0; c < BOARD_SIZE; c++) {
            lines.push(board.map((_, r) => ({ r, c })));
        }

        // Diagonals
        lines.push(board.map((_, i) => ({ r: i, c: i })));
        lines.push(board.map((_, i) => ({ r: i, c: BOARD_SIZE - 1 - i })));

        for (const line of lines) {
            const cells = line.map(({ r, c }) => board[r][c]);
            if (cells[0] !== EMPTY && cells.every((cell) => cell === cells[0])) {
                return { winner: true, symbol: cells[0], line };
            }
        }

        return { winner: false };
    },

    /**
     * Check if the board is a draw (all cells filled, no winner).
     * @param {Array} board
     * @returns {boolean}
     */
    checkDraw(board) {
        return board.every((row) => row.every((cell) => cell !== EMPTY));
    },

    /**
     * Get the symbol for a player based on their position.
     * Player 1 (index 0) = X, Player 2 (index 1) = O
     * @param {string[]} players
     * @param {string} playerId
     * @returns {string}
     */
    getPlayerSymbol(players, playerId) {
        const index = players.indexOf(playerId);
        return index === 0 ? SYMBOLS.X : SYMBOLS.O;
    },

    /**
     * Get the next player's turn.
     * @param {string[]} players
     * @param {string} currentPlayerId
     * @returns {string}
     */
    getNextTurn(players, currentPlayerId) {
        const currentIndex = players.indexOf(currentPlayerId);
        return players[(currentIndex + 1) % players.length];
    },

    /**
     * Get available (empty) cells on the board.
     * @param {Array} board
     * @returns {Array<{ row: number, col: number }>}
     */
    getAvailableMoves(board) {
        const moves = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] === EMPTY) {
                    moves.push({ row: r, col: c });
                }
            }
        }
        return moves;
    },

    BOARD_SIZE,
    SYMBOLS,
    EMPTY,
};

module.exports = gameEngine;
