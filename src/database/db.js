'use strict';

const { Pool } = require('pg');

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
        database: process.env.POSTGRES_DB || 'game_server',
        user: process.env.POSTGRES_USER || 'gameadmin',
        password: process.env.POSTGRES_PASSWORD || 'gamepass123',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected pool error:', err.message);
});

pool.on('connect', () => {
    console.log('[PostgreSQL] New client connected');
});

module.exports = pool;
