const http = require('http');
const WebSocket = require('ws');
const { createApp } = require('./app.cjs');
const { PORT, LIMITS } = require('./config/index.cjs');
const { attachExecutionWebSocket } = require('./websocket/executionHandler.cjs');
const { listDetectedRuntimes } = require('./services/execution/runtimeDetection.cjs');
const { aiRequestManager } = require('./services/ai/aiRequestManager.cjs');
const { openDatabase, closeDatabase } = require('./db/index.cjs');
const logger = require('./lib/logger.cjs');
const lifecycle = require('./lifecycle.cjs');

// ---- Fail-closed authentication guard (production) ----
// Firebase Authentication is the sole identity provider. A production process
// that cannot verify identities must never boot: every product route would be
// exposed. Missing configuration is a deployment error, never a reason to
// allow unauthenticated access.
const { isFirebaseConfigured } = require('./services/auth/firebaseAdmin.cjs');
if (process.env.NODE_ENV === 'production' && !isFirebaseConfigured()) {
    require('./config/index.cjs').fail(
        'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY ' +
        '(or provide application default credentials) before running in production. Authentication must never be disabled.',
    );
}

// ---- Construction (no I/O yet) ----
openDatabase(); // migrations run here; fatal on failure
const app = createApp();
const server = http.createServer(app);
// maxPayload caps a single WS message (default 100MB is a memory-exhaustion vector).
const wss = new WebSocket.Server({ server, maxPayload: LIMITS.WS_MAX_PAYLOAD });

// attachExecutionWebSocket owns the TerminalManager; it is returned so graceful
// shutdown can terminate every live terminal session/PTY before exiting.
const terminalManager = attachExecutionWebSocket(wss);

// Single-instance + shutdown lifecycle. Installed before the async bind so a
// signal received during startup is handled correctly.
const onComplete = () => { try { closeDatabase(); } catch { /* ignore */ } lifecycle.releaseLock(PORT); };
lifecycle.installGracefulShutdown({
    server,
    wss,
    terminalManager,
    onComplete,
    beforeClose: () => aiRequestManager.abortAll(),
});

// ---- Startup (entrypoint owns it; exactly one listen per process) ----
const { siblingPid } = lifecycle.acquireLock(PORT);

const HOST = process.env.HOST || '0.0.0.0';

// In production the platform assigns PORT; bind to 0.0.0.0 so external traffic reaches us.
const listenOpts = process.env.NODE_ENV === 'production' ? { port: PORT, host: HOST } : PORT;

lifecycle.listenWithRetry(server, listenOpts)
    .then(() => {
        // The port is now ours; make sure the single-instance lock is too.
        lifecycle.reclaimLock(PORT);
        if (siblingPid) {
            console.log(`[server] Port ${PORT} was released by a previous instance (PID ${siblingPid}); this instance is now serving.`);
        }
        const runtimes = listDetectedRuntimes();
        const displayHost = process.env.NODE_ENV === 'production' ? HOST : 'localhost';
        const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const wsProto = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';
        // Structured startup line (no secrets — counts and flags only).
        const { publicSummary } = require('./config/index.cjs');
        logger.info('server listening', {
            http: `${proto}://${displayHost}:${PORT}/api`,
            websocket: `${wsProto}://${displayHost}:${PORT}`,
            localRuntimes: runtimes.length,
            ...publicSummary(),
        });
    })
    .catch(async (err) => {
        if (err && err.code === 'EADDRINUSE') {
            const ours = await lifecycle.reportPortInUse(PORT, siblingPid);
            lifecycle.releaseLock(PORT);
            // Exit cleanly (code 0) when a healthy sibling is already serving, so
            // the concurrently/dev layer does not restart into a competing listener.
            process.exit(ours ? 0 : 1);
        }
        console.error('[server] Failed to start:', err);
        lifecycle.releaseLock(PORT);
        process.exit(1);
    });