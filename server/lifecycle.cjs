/**
 * Development/runtime lifecycle for the backend.
 *
 * Responsibilities (see server/index.cjs for wiring):
 *  1. Single-instance guard via a PID lockfile, so a second `npm run dev` /
 *     `npm run server` never creates a competing listener on the same port.
 *  2. Bounded EADDRINUSE retry when binding, so a watcher restart that overlaps
 *     a dying predecessor (which is still releasing :3001) does not crash.
 *  3. Graceful, idempotent shutdown: stop accepting work, terminate terminal
 *     sessions/PTYs through the existing TerminalManager, close WebSocket
 *     clients + WebSocketServer + HTTP server, then exit — bounded by a force
 *     exit so shutdown can never hang.
 *
 * Nothing here ever kills an unrelated process. Port/owner discovery is
 * read-only (probe + lsof/ps for identification in error messages only).
 */
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const SHUTDOWN_FORCE_MS = 2000;
const BIND_RETRY_MS = 4000;      // how long to wait for a dying predecessor to free the port
const BIND_RETRY_INTERVAL = 100; // poll interval while waiting
const LOCK_PREFIX = 'ai-code-editor-server';
const API_MARKER = 'ai-code-editor-api';
const SERVER_MARKER = 'server/index.cjs';

function lockFileFor(port) {
    return path.join(os.tmpdir(), `${LOCK_PREFIX}-${port}.lock`);
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** True if `pid` is a live sibling instance of this dev server (not just any process). */
function isOurServerProcess(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    if (!isAlive(pid)) return false;
    try {
        const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
        return cmd.includes(SERVER_MARKER);
    } catch {
        return false;
    }
}

function readLock(port) {
    try {
        return JSON.parse(fs.readFileSync(lockFileFor(port), 'utf8'));
    } catch {
        return null;
    }
}

function writeLock(port) {
    try {
        fs.writeFileSync(lockFileFor(port), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    } catch {
        /* lockfile is best-effort */
    }
}

/** Remove the lock only if it still belongs to this process. */
function releaseLock(port) {
    try {
        const lock = readLock(port);
        if (lock && lock.pid === process.pid) fs.unlinkSync(lockFileFor(port));
    } catch {
        /* ignore */
    }
}

/**
 * Claim the single-instance lock. If a LIVE sibling already owns it, do NOT
 * overwrite or exit — the sibling may be a dying predecessor mid-shutdown. We
 * report it and let the bind retry decide the outcome.
 */
function acquireLock(port) {
    const lock = readLock(port);
    if (lock && isOurServerProcess(lock.pid)) {
        return { siblingPid: lock.pid };
    }
    writeLock(port);
    return { siblingPid: null };
}

/** After a successful bind, make sure the lock belongs to this process. */
function reclaimLock(port) {
    const lock = readLock(port);
    if (!lock || lock.pid !== process.pid) writeLock(port);
}

/** Read-only probe of the existing /api/health (identify, never kill). */
function probeHealth(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1200 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/** Read-only: find the PID listening on `port` (for error messages). */
function pidListeningOn(port) {
    try {
        const out = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
        return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number)[0] || null;
    } catch {
        return null;
    }
}

/**
 * Bind `server` to `port`, retrying on EADDRINUSE for a bounded window.
 * A watcher restart can overlap a predecessor that is still releasing the port;
 * retrying instead of crashing heals that race. Resolves on success, rejects
 * with the error if the port is still occupied after the window.
 */
function listenWithRetry(server, portOrOpts, { retryMs = BIND_RETRY_MS, interval = BIND_RETRY_INTERVAL } = {}) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const attempt = () => {
            const onListening = () => {
                server.removeListener('error', onError);
                resolve();
            };
            const onError = (err) => {
                server.removeListener('listening', onListening);
                if (err && err.code === 'EADDRINUSE' && Date.now() - started < retryMs) {
                    setTimeout(attempt, interval);
                    return;
                }
                server.removeListener('error', onError);
                reject(err);
            };
            server.once('listening', onListening);
            server.once('error', onError);
            // Support both `port` (number) and `{ port, host }` for production
            if (portOrOpts && typeof portOrOpts === 'object') {
                server.listen(portOrOpts);
            } else {
                server.listen(portOrOpts);
            }
        };
        attempt();
    });
}

/**
 * Explain why :port could not be bound. Returns true if the port is owned by a
 * live instance of THIS dev server (so the caller can exit cleanly instead of
 * crash-looping).
 */
async function reportPortInUse(port, siblingPid) {
    const probe = await probeHealth(port);
    const pid = siblingPid || pidListeningOn(port);
    const owner = pid ? ` (PID ${pid})` : '';

    if (probe && probe.status === 200 && probe.body.includes(API_MARKER)) {
        console.error(`\n[server] Port ${port} is already in use by another instance of this dev server${owner}.`);
        console.error(`[server] It is already healthy at http://localhost:${port}/api/health — not starting a second listener.`);
        console.error(`[server] To stop it: press Ctrl+C in its terminal, or run:  kill ${pid}\n`);
        return true;
    }

    console.error(`\n[server] Port ${port} is already in use by a different process${owner}.`);
    console.error(`[server] Identify it with:  lsof -iTCP:${port} -sTCP:LISTEN`);
    console.error(`[server] Free the port, then start the dev server again.\n`);
    return false;
}

/**
 * Install idempotent shutdown for SIGINT / SIGTERM / uncaughtException /
 * unhandledRejection. Sequence:
 *   1. stop accepting new work (server.close)
 *   2. terminate terminal sessions/PTYs via the existing TerminalManager
 *   3. close WebSocket clients
 *   4. close WebSocketServer
 *   5. close HTTP server (force-close remaining connections)
 *   6. bounded force-exit so shutdown never hangs
 */
function installGracefulShutdown({ server, wss, terminalManager, onComplete, beforeClose }) {
    let shuttingDown = false;

    const shutdown = (code, signal, err) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (err) console.error('[server] Fatal error:', err);

        const force = setTimeout(() => {
            console.log(`[server] Shutdown timed out — forcing exit (${signal || code})`);
            try { if (onComplete) onComplete(); } catch { /* ignore */ }
            process.exit(code);
        }, SHUTDOWN_FORCE_MS);
        if (force && force.unref) force.unref();

        // Abort any in-flight AI streams so no orphan upstream requests remain.
        try {
            if (typeof beforeClose === 'function') beforeClose();
        } catch (e) {
            console.error('[server] AI stream cleanup error:', e);
        }

        // Terminate every live terminal session/PTY (no orphan processes).
        try {
            if (terminalManager && typeof terminalManager.destroy === 'function') terminalManager.destroy();
        } catch (e) {
            console.error('[server] terminal cleanup error:', e);
        }

        // Close WebSocket clients, then the WebSocketServer.
        try {
            if (wss && wss.clients) {
                for (const client of Array.from(wss.clients)) {
                    try { client.terminate(); } catch { /* ignore */ }
                }
            }
        } catch { /* ignore */ }
        try {
            if (wss && typeof wss.close === 'function') wss.close();
        } catch { /* ignore */ }

        // Close the HTTP server; finish once drained (bounded by `force`).
        const finish = () => {
            clearTimeout(force);
            console.log(`[server] Shutdown complete (${signal || code})`);
            try { if (onComplete) onComplete(); } catch { /* ignore */ }
            process.exit(code);
        };
        try {
            server.close(() => finish());
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            else if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
        } catch {
            finish();
        }
    };

    process.on('SIGINT', () => shutdown(0, 'SIGINT'));
    process.on('SIGTERM', () => shutdown(0, 'SIGTERM'));
    process.on('uncaughtException', (err) => shutdown(1, 'uncaughtException', err));
    process.on('unhandledRejection', (reason) =>
        shutdown(1, 'unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
    );

    return { shutdown, isShuttingDown: () => shuttingDown };
}

/** True when nothing is currently accepting TCP on `port` (used by tests). */
function isPortFree(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(150);
        socket.once('connect', () => finish(false));
        socket.once('timeout', () => finish(true));
        socket.once('error', () => finish(true));
        socket.connect(port, '127.0.0.1');
    });
}

module.exports = {
    acquireLock,
    reclaimLock,
    releaseLock,
    listenWithRetry,
    reportPortInUse,
    installGracefulShutdown,
    isPortFree,
};