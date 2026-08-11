/**
 * Runs once before `npm run dev`.
 * Only frees port 3001 if an old (non-modular) API is bound there.
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
    if (!result) return;

    const isNewApi = result.status === 200 && result.body.includes('ai-code-editor-api');
    if (!isNewApi) {
        console.log(`[dev] Replacing outdated API on port ${PORT}...`);
        killPort();
    }
})();
