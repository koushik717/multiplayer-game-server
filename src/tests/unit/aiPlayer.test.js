'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Test the AI minimax logic by importing it and running against known boards
const gameEngine = require('../../services/gameEngine');
const aiPlayer = require('../../ai/aiPlayer');

describe('AI Player — Minimax', () => {
    it('should block an obvious winning move by opponent', () => {
        // O can win next move on row 0 — AI (O) should NOT let X win
        // Board: X is about to win on row 0 (X X _)
        const board = [
            ['X', 'X', null],
            ['O', null, null],
            [null, null, 'O'],
        ];

        const result = aiPlayer._minimax(board, 'O', 'X', true, -Infinity, Infinity);
        // AI should block at (0,2)
        assert.deepStrictEqual(result.move, { row: 0, col: 2 });
    });

    it('should take a winning move when available', () => {
        const board = [
            ['O', 'O', null],
            ['X', 'X', null],
            [null, null, null],
        ];

        const result = aiPlayer._minimax(board, 'O', 'X', true, -Infinity, Infinity);
        // AI (O) should win at (0,2)
        assert.deepStrictEqual(result.move, { row: 0, col: 2 });
    });

    it('should return a valid move for empty board', () => {
        const board = gameEngine.createBoard();
        const result = aiPlayer._minimax(board, 'X', 'O', true, -Infinity, Infinity);
        assert.ok(result.move);
        assert.ok(result.move.row >= 0 && result.move.row < 3);
        assert.ok(result.move.col >= 0 && result.move.col < 3);
    });

    it('should handle near-full board', () => {
        const board = [
            ['X', 'O', 'X'],
            ['X', 'O', 'O'],
            ['O', 'X', null],
        ];

        const result = aiPlayer._minimax(board, 'X', 'O', true, -Infinity, Infinity);
        assert.deepStrictEqual(result.move, { row: 2, col: 2 });
    });
});
