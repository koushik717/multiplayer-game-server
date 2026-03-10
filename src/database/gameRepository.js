'use strict';

const pool = require('./db');

/**
 * Game Repository — persists completed games and player stats to PostgreSQL.
 */
const gameRepository = {
    /**
     * Ensure a player exists in the database (upsert).
     * @param {string} playerId
     * @param {string} username
     */
    async ensurePlayer(playerId, username) {
        await pool.query(
            `INSERT INTO players (id, username)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
            [playerId, username]
        );
    },

    /**
     * Save a completed game to persistent storage.
     * @param {Object} gameData
     */
    async saveGameResult(gameData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert game history
            await client.query(
                `INSERT INTO game_history (id, player1_id, player2_id, winner_id, moves, board_final, result_type, started_at, ended_at, duration_ms, total_moves)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    gameData.gameId,
                    gameData.player1Id,
                    gameData.player2Id,
                    gameData.winnerId,
                    JSON.stringify(gameData.moves),
                    JSON.stringify(gameData.boardFinal),
                    gameData.resultType,
                    new Date(gameData.startedAt),
                    new Date(),
                    gameData.durationMs,
                    gameData.totalMoves,
                ]
            );

            // Update player stats
            const players = [gameData.player1Id, gameData.player2Id].filter(Boolean);
            for (const pid of players) {
                if (pid.startsWith('ai-')) continue; // Skip AI player stats

                const isWinner = pid === gameData.winnerId;
                const isDraw = gameData.resultType === 'draw';

                await client.query(
                    `UPDATE players SET
            games_played = games_played + 1,
            wins = wins + $2,
            losses = losses + $3,
            draws = draws + $4
          WHERE id = $1`,
                    [
                        pid,
                        isWinner ? 1 : 0,
                        !isWinner && !isDraw ? 1 : 0,
                        isDraw ? 1 : 0,
                    ]
                );
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('[GameRepository] Failed to save game result:', err.message);
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Save a game event (event sourcing).
     * @param {string} gameId
     * @param {string} eventType
     * @param {string} playerId
     * @param {Object} payload
     * @param {number} version
     */
    async saveGameEvent(gameId, eventType, playerId, payload, version) {
        await pool.query(
            `INSERT INTO game_events (game_id, event_type, player_id, payload, version)
       VALUES ($1, $2, $3, $4, $5)`,
            [gameId, eventType, playerId, JSON.stringify(payload), version]
        );
    },

    /**
     * Get player statistics.
     * @param {string} playerId
     * @returns {Object|null}
     */
    async getPlayerStats(playerId) {
        const result = await pool.query(
            `SELECT id, username, games_played, wins, losses, draws, elo_rating, created_at
       FROM players WHERE id = $1`,
            [playerId]
        );
        return result.rows[0] || null;
    },

    /**
     * Get game history for a player.
     * @param {string} playerId
     * @param {number} [limit=20]
     * @returns {Object[]}
     */
    async getGameHistory(playerId, limit = 20) {
        const result = await pool.query(
            `SELECT * FROM game_history
       WHERE player1_id = $1 OR player2_id = $1
       ORDER BY ended_at DESC
       LIMIT $2`,
            [playerId, limit]
        );
        return result.rows;
    },

    /**
     * Get all events for a game (event sourcing replay).
     * @param {string} gameId
     * @returns {Object[]}
     */
    async getGameEvents(gameId) {
        const result = await pool.query(
            `SELECT * FROM game_events
       WHERE game_id = $1
       ORDER BY version ASC`,
            [gameId]
        );
        return result.rows;
    },
};

module.exports = gameRepository;
