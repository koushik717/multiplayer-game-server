import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Gauge } from 'k6/metrics';

// ── Custom Metrics ──
const gamesPlayed = new Counter('games_played');
const moveLatency = new Trend('move_latency_ms');
const connectionTime = new Trend('connection_time_ms');
const activeConnections = new Gauge('active_connections');

// ── Configuration ──
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080'; // NGINX load balancer
const WS_URL = BASE_URL.replace('http', 'ws');

export const options = {
    scenarios: {
        // Ramp up to 200 concurrent players
        concurrent_players: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },   // Ramp to 50
                { duration: '1m', target: 200 },   // Ramp to 200
                { duration: '2m', target: 200 },   // Hold at 200
                { duration: '30s', target: 0 },    // Ramp down
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: {
        'move_latency_ms': ['p(95)<200'],        // 95% of moves under 200ms
        'connection_time_ms': ['p(95)<1000'],     // 95% connections under 1s
        'ws_connecting': ['p(95)<1000'],
    },
};

export default function () {
    const playerName = `k6_player_${__VU}_${__ITER}`;

    // ── 1. Get auth token ──
    const authStart = Date.now();
    const authRes = http.post(`${BASE_URL}/api/auth/token`, JSON.stringify({
        playerName,
    }), {
        headers: { 'Content-Type': 'application/json' },
    });

    check(authRes, {
        'auth: status 200': (r) => r.status === 200,
        'auth: has token': (r) => JSON.parse(r.body).token !== undefined,
    });

    if (authRes.status !== 200) return;

    const { token, playerId } = JSON.parse(authRes.body);
    connectionTime.add(Date.now() - authStart);

    // ── 2. Connect WebSocket ──
    const wsUrl = `${WS_URL}/ws?token=${token}`;

    const res = ws.connect(wsUrl, {}, function (socket) {
        activeConnections.add(1);

        let gameId = null;
        let currentVersion = null;
        let myTurn = false;
        let gameActive = false;

        socket.on('open', () => {
            // Find a match (alternate between PvP and Solo)
            const mode = __ITER % 3 === 0 ? 'solo' : 'pvp';
            socket.send(JSON.stringify({ type: 'FIND_MATCH', mode }));
        });

        socket.on('message', (data) => {
            const msg = JSON.parse(data);

            switch (msg.type) {
                case 'GAME_START':
                    gameId = msg.gameId;
                    currentVersion = msg.version;
                    myTurn = msg.currentTurn === playerId;
                    gameActive = true;
                    if (myTurn) makeRandomMove(socket, msg.board, gameId, currentVersion);
                    break;

                case 'MOVE_MADE':
                    currentVersion = msg.version;
                    myTurn = msg.currentTurn === playerId;
                    if (msg.status === 'completed') {
                        gameActive = false;
                        gamesPlayed.add(1);
                    } else if (myTurn) {
                        const moveStart = Date.now();
                        makeRandomMove(socket, msg.board, gameId, currentVersion);
                        moveLatency.add(Date.now() - moveStart);
                    }
                    break;

                case 'GAME_OVER':
                    gameActive = false;
                    gamesPlayed.add(1);
                    break;
            }
        });

        socket.on('close', () => {
            activeConnections.add(-1);
        });

        // Wait for game to complete (max 30 seconds)
        socket.setTimeout(() => {
            socket.close();
        }, 30000);

        // Keep alive
        sleep(Math.random() * 2 + 1);
    });

    check(res, { 'ws: connected': (r) => r && r.status === 101 });
}

function makeRandomMove(socket, board, gameId, version) {
    // Find empty cells
    const available = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            if (board[r][c] === null) {
                available.push({ row: r, col: c });
            }
        }
    }

    if (available.length === 0) return;

    const move = available[Math.floor(Math.random() * available.length)];
    socket.send(JSON.stringify({
        type: 'MOVE',
        gameId,
        move,
        version,
    }));
}
