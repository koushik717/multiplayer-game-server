-- ═══════════════════════════════════════════════════
-- Multiplayer Game Server — Database Schema
-- ═══════════════════════════════════════════════════

-- ── Players ──
CREATE TABLE IF NOT EXISTS players (
    id              VARCHAR(64) PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    games_played    INTEGER DEFAULT 0,
    wins            INTEGER DEFAULT 0,
    losses          INTEGER DEFAULT 0,
    draws           INTEGER DEFAULT 0,
    elo_rating      INTEGER DEFAULT 1000
);

CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo_rating DESC);

-- ── Game History ──
CREATE TABLE IF NOT EXISTS game_history (
    id              VARCHAR(64) PRIMARY KEY,
    player1_id      VARCHAR(64) REFERENCES players(id),
    player2_id      VARCHAR(64) REFERENCES players(id),
    winner_id       VARCHAR(64) REFERENCES players(id),
    moves           JSONB NOT NULL DEFAULT '[]',
    board_final     JSONB,
    result_type     VARCHAR(20) NOT NULL CHECK (result_type IN ('win', 'draw', 'forfeit', 'timeout')),
    started_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    duration_ms     INTEGER,
    total_moves     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_game_history_player1 ON game_history(player1_id);
CREATE INDEX IF NOT EXISTS idx_game_history_player2 ON game_history(player2_id);
CREATE INDEX IF NOT EXISTS idx_game_history_ended ON game_history(ended_at DESC);

-- ── Game Events (Event Sourcing) ──
CREATE TABLE IF NOT EXISTS game_events (
    id              SERIAL PRIMARY KEY,
    game_id         VARCHAR(64) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    player_id       VARCHAR(64),
    payload         JSONB NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id, version);
CREATE INDEX IF NOT EXISTS idx_game_events_type ON game_events(event_type);
