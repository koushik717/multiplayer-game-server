'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const gameEngine = require('../../services/gameEngine');

describe('Game Engine', () => {
    describe('createBoard', () => {
        it('should create a 3x3 empty board', () => {
            const board = gameEngine.createBoard();
            assert.equal(board.length, 3);
            assert.equal(board[0].length, 3);
            assert.equal(board[1][1], null);
        });
    });

    describe('validateMove', () => {
        it('should accept valid move', () => {
            const state = {
                status: 'active',
                currentTurn: 'p1',
                players: ['p1', 'p2'],
                board: gameEngine.createBoard(),
            };
            const result = gameEngine.validateMove(state, 'p1', { row: 0, col: 0 });
            assert.equal(result.valid, true);
        });

        it('should reject move on occupied cell', () => {
            const board = gameEngine.createBoard();
            board[0][0] = 'X';
            const state = { status: 'active', currentTurn: 'p1', players: ['p1', 'p2'], board };
            const result = gameEngine.validateMove(state, 'p1', { row: 0, col: 0 });
            assert.equal(result.valid, false);
            assert.match(result.error, /occupied/i);
        });

        it('should reject move when not your turn', () => {
            const state = {
                status: 'active',
                currentTurn: 'p1',
                players: ['p1', 'p2'],
                board: gameEngine.createBoard(),
            };
            const result = gameEngine.validateMove(state, 'p2', { row: 0, col: 0 });
            assert.equal(result.valid, false);
            assert.match(result.error, /not your turn/i);
        });

        it('should reject move when game is not active', () => {
            const state = {
                status: 'completed',
                currentTurn: 'p1',
                players: ['p1', 'p2'],
                board: gameEngine.createBoard(),
            };
            const result = gameEngine.validateMove(state, 'p1', { row: 0, col: 0 });
            assert.equal(result.valid, false);
        });

        it('should reject out-of-bounds coordinates', () => {
            const state = {
                status: 'active',
                currentTurn: 'p1',
                players: ['p1', 'p2'],
                board: gameEngine.createBoard(),
            };
            assert.equal(gameEngine.validateMove(state, 'p1', { row: -1, col: 0 }).valid, false);
            assert.equal(gameEngine.validateMove(state, 'p1', { row: 3, col: 0 }).valid, false);
            assert.equal(gameEngine.validateMove(state, 'p1', { row: 0, col: 3 }).valid, false);
        });

        it('should reject non-integer coordinates', () => {
            const state = {
                status: 'active',
                currentTurn: 'p1',
                players: ['p1', 'p2'],
                board: gameEngine.createBoard(),
            };
            assert.equal(gameEngine.validateMove(state, 'p1', { row: 1.5, col: 0 }).valid, false);
        });
    });

    describe('applyMove', () => {
        it('should place symbol without mutating original board', () => {
            const board = gameEngine.createBoard();
            const newBoard = gameEngine.applyMove(board, 1, 1, 'X');
            assert.equal(newBoard[1][1], 'X');
            assert.equal(board[1][1], null); // Original unchanged
        });
    });

    describe('checkWinner', () => {
        it('should detect row win', () => {
            const board = [
                ['X', 'X', 'X'],
                [null, null, null],
                [null, null, null],
            ];
            const result = gameEngine.checkWinner(board);
            assert.equal(result.winner, true);
            assert.equal(result.symbol, 'X');
        });

        it('should detect column win', () => {
            const board = [
                ['O', null, null],
                ['O', null, null],
                ['O', null, null],
            ];
            const result = gameEngine.checkWinner(board);
            assert.equal(result.winner, true);
            assert.equal(result.symbol, 'O');
        });

        it('should detect diagonal win', () => {
            const board = [
                ['X', null, null],
                [null, 'X', null],
                [null, null, 'X'],
            ];
            assert.equal(gameEngine.checkWinner(board).winner, true);
        });

        it('should detect anti-diagonal win', () => {
            const board = [
                [null, null, 'O'],
                [null, 'O', null],
                ['O', null, null],
            ];
            assert.equal(gameEngine.checkWinner(board).winner, true);
        });

        it('should return no winner for incomplete board', () => {
            const board = [
                ['X', 'O', null],
                [null, 'X', null],
                [null, null, null],
            ];
            assert.equal(gameEngine.checkWinner(board).winner, false);
        });
    });

    describe('checkDraw', () => {
        it('should detect draw (full board, no winner)', () => {
            const board = [
                ['X', 'O', 'X'],
                ['X', 'O', 'O'],
                ['O', 'X', 'X'],
            ];
            assert.equal(gameEngine.checkDraw(board), true);
            assert.equal(gameEngine.checkWinner(board).winner, false);
        });

        it('should not be draw when cells are empty', () => {
            const board = [
                ['X', null, null],
                [null, null, null],
                [null, null, null],
            ];
            assert.equal(gameEngine.checkDraw(board), false);
        });
    });

    describe('getPlayerSymbol', () => {
        it('should return X for first player, O for second', () => {
            assert.equal(gameEngine.getPlayerSymbol(['p1', 'p2'], 'p1'), 'X');
            assert.equal(gameEngine.getPlayerSymbol(['p1', 'p2'], 'p2'), 'O');
        });
    });

    describe('getNextTurn', () => {
        it('should alternate turns', () => {
            assert.equal(gameEngine.getNextTurn(['p1', 'p2'], 'p1'), 'p2');
            assert.equal(gameEngine.getNextTurn(['p1', 'p2'], 'p2'), 'p1');
        });
    });

    describe('getAvailableMoves', () => {
        it('should return all empty cells', () => {
            const board = [
                ['X', null, null],
                [null, 'O', null],
                [null, null, null],
            ];
            const moves = gameEngine.getAvailableMoves(board);
            assert.equal(moves.length, 7);
        });

        it('should return empty array for full board', () => {
            const board = [
                ['X', 'O', 'X'],
                ['X', 'O', 'O'],
                ['O', 'X', 'X'],
            ];
            assert.equal(gameEngine.getAvailableMoves(board).length, 0);
        });
    });
});
