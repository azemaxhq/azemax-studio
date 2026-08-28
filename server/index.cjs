const http = require('http');
const WebSocket = require('ws');
const { createApp } = require('./app.cjs');
const { PORT } = require('./config/index.cjs');
const { attachExecutionWebSocket } = require('./websocket/executionHandler.cjs');
const { listDetectedRuntimes } = require('./services/execution/runtimeDetection.cjs');
const { aiRequestManager } = require('./services/ai/aiRequestManager.cjs');
const lifecycle = require('./lifecycle.cjs');

// ---- Construction (no I/O yet) ----
const app = createApp();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// attachExecutionWebSocket owns the TerminalManager; it is returned so graceful
// shutdown can terminate every live terminal session/PTY before exiting.
const terminalManager = attachExecutionWebSocket(wss);

// Single-instance + shutdown lifecycle. Installed before the async bind so a
// signal received during startup is handled correctly.
const onComplete = () => lifecycle.releaseLock(PORT);
lifecycle.installGracefulShutdown({
    server,
    wss,
    terminalManager,
    onComplete,
    beforeClose: () => aiRequestManager.abortAll(),
});

// ---- Startup (entrypoint owns it; exactly one listen per process) ----
const { siblingPid } = lifecycle.acquireLock(PORT);

lifecycle.listenWithRetry(server, PORT)
    .then(() => {
        // The port is now ours; make sure the single-instance lock is too.
        lifecycle.reclaimLock(PORT);
        if (siblingPid) {
            console.log(`[server] Port ${PORT} was released by a previous instance (PID ${siblingPid}); this instance is now serving.`);
        }
        const runtimes = listDetectedRuntimes();
        console.log(`\n🚀 AI Code Editor API`);
        console.log(`   HTTP:      http://localhost:${PORT}/api`);
        console.log(`   Health:    http://localhost:${PORT}/api/health`);
        console.log(`   WebSocket: ws://localhost:${PORT}`);
        console.log(`   Runtimes:  ${runtimes.length} local language(s) detected\n`);
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