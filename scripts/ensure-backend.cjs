/**
 * Runs once before `npm run dev`.
 * Ensures port 3001 is free for the dev server. If the port is already
 * listening (stale nohup, previous dev server not cleaned up), it is freed
 * so `node --watch server/index.cjs` can bind without hitting
 * "Port already in use ... Completed running ... Waiting for file changes".
 */
const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3001;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

function probe() {
    return new Promise((resolve) => {
        const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

function killPort() {
    try {
        const pids = execSync(`lsof -ti :${PORT}`, { encoding: 'utf8' }).trim();
        if (!pids) return;
        execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: 'ignore' });
        console.log(`[dev] Freed port ${PORT} (stale backend)`);
    } catch {
        /* port already free */
    }
}

(async () => {
    const result = await probe();
    if (!result) return; // port free — nothing to do

    // For `npm run dev` we always want the concurrently-managed server to own
    // the port. If the port is already listening (whether outdated or even
    // healthy new API), it is almost certainly a stale detached `nohup` or a
    // previous dev server that wasn't cleaned up. `node --watch` would see
    // EADDRINUSE, exit with "Completed running ... Waiting for file changes"
    // and never actually serve — leaving the dev client hanging on wait-on.
    // Free the port so the new dev server can bind cleanly.
    const isNewApi = result.status === 200 && result.body.includes('ai-code-editor-api');
    if (isNewApi) {
        console.log(`[dev] Port ${PORT} already in use by a previous server — freeing for new dev server...`);
    } else {
        console.log(`[dev] Replacing outdated API on port ${PORT}...`);
    }
    killPort();
    // Give the OS a moment to release the port before `node --watch` binds
    await new Promise(r => setTimeout(r, 800));
    // Verify it's free; if not, probe again and warn
    const after = await probe();
    if (after) {
        console.warn(`[dev] Port ${PORT} still in use after kill — you may need to run: kill $(lsof -ti :${PORT})`);
    }
})();
