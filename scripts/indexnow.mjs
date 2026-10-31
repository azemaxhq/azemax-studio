/**
 * IndexNow submission for Azemax Studio.
 *
 * Submits changed public URLs to Bing's IndexNow API so content changes are
 * discovered promptly without waiting for the next crawl cycle.
 *
 * Security model:
 *  - The IndexNow API key is read exclusively from the INDEXNOW_API_KEY env
 *    variable. It is never embedded in client-side JavaScript or the Vite
 *    bundle.
 *  - A key file is written to the public root for Bing key-file verification
 *    (https://www.azemax.com/indexnow-key.txt).
 *  - Submitted URLs are deduplicated against a local state file so the same
 *    URL is not submitted more than once.
 *
 * Usage:
 *   # Generate the verification key file (build-time, server-side only):
 *   INDEXNOW_API_KEY=<your-key> vite-node scripts/indexnow.mjs --generate-keyfile
 *
 *   # Submit changed URLs after deployment:
 *   INDEXNOW_API_KEY=<your-key> vite-node scripts/indexnow.mjs \
 *     --urls https://www.azemax.com/ https://www.azemax.com/features
 *
 * Run the submission step after a successful deployment for any URLs whose
 * content changed. The build itself never submits URLs automatically.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../dist/', import.meta.url);
const STATE_FILE = new URL('../.indexnow-state.json', import.meta.url);
const KEY_FILE = new URL('../public/indexnow-key.txt', import.meta.url);

const ENDPOINT = 'https://www.bing.com/indexnow';

function nowIso() {
    return new Date().toISOString();
}

function log(level, message) {
    console.log(`[indexnow] [${level}] ${new Date().toISOString()} ${message}`);
}

async function readState() {
    try {
        const raw = await readFile(STATE_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { submitted: [] };
    }
}

async function writeState(state) {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function keyFileExists() {
    try {
        await stat(KEY_FILE);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write the Bing key-file to the public root so the domain can be verified.
 * The file contains only the API key. It is safe to serve publicly because
 * possession of the key is the authentication mechanism itself.
 *
 * Always overwrites any existing file so the deployed key matches the
 * current INDEXNOW_API_KEY. Never logs the key value.
 */
async function ensureKeyFile(apiKey) {
    await mkdir(new URL('./', KEY_FILE), { recursive: true });
    await writeFile(KEY_FILE, apiKey);
    log('info', 'IndexNow key file generated for domain verification.');
}

/**
 * Submit URLs to Bing IndexNow. Returns the number of URLs accepted.
 */
async function submitUrls(apiKey, urls) {
    const state = await readState();
    const already = new Set(state.submitted);

    const pending = urls.filter((u) => !already.has(u));
    if (pending.length === 0) {
        log('info', 'No new URLs to submit (all already submitted).');
        return 0;
    }

    const body = {
        host: 'www.azemax.com',
        key: apiKey,
        keyLocation: 'https://www.azemax.com/indexnow-key.txt',
        urlList: pending,
    };

    log('info', `Submitting ${pending.length} URL(s) to IndexNow.`);

    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
        });

        if (response.ok) {
            // Mark as submitted only after acceptance.
            pending.forEach((u) => already.add(u));
            state.submitted = Array.from(already);
            await writeState(state);
            log('success', `IndexNow accepted ${pending.length} URL(s).`);
            return pending.length;
        }

        const text = await response.text();
        log('error', `IndexNow submission failed: HTTP ${response.status} ${text}`);
        return 0;
    } catch (error) {
        log('error', `IndexNow submission error: ${error.message}`);
        return 0;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const urls = args.filter((a) => !a.startsWith('--'));
    const generateKeyFile = args.includes('--generate-keyfile');

    const apiKey = process.env.INDEXNOW_API_KEY;
    if (!apiKey) {
        log('error', 'INDEXNOW_API_KEY environment variable is not set.');
        log('info', 'Obtain a key from https://www.bing.com/webmasters and set it before running.');
        process.exitCode = 1;
        return;
    }

    if (generateKeyFile) {
        await ensureKeyFile(apiKey);
        log('info', 'Key file written to public/indexnow-key.txt (do not commit to version control).');
        return;
    }

    if (urls.length === 0) {
        log('info', 'No URLs provided. Use --generate-keyfile to write the verification file, or pass --urls to submit.');
        return;
    }

    // Normalize URLs to absolute https://www.azemax.com/ form.
    const normalized = urls.map((u) => {
        try {
            const url = new URL(u);
            return url.origin + url.pathname;
        } catch {
            return u;
        }
    });

    await submitUrls(apiKey, normalized);
}

main().catch((error) => {
    console.error('[indexnow] fatal:', error);
    process.exitCode = 1;
});
