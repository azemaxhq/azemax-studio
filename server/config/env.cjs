/**
 * Azemax strict environment validation — fail CLOSED, never fail open.
 *
 * This module is the single place server configuration is derived. It:
 *  - loads `.env` (dev convenience only; production uses real env vars)
 *  - validates every security-relevant variable
 *  - REFUSES to boot when production configuration is unsafe
 *  - never prints secret VALUES (only variable names)
 *
 * Fail-closed rules (production):
 *  - NODE_ENV=production requires AUTH_SECRET (>= 32 chars).
 *  - NODE_ENV=production requires an explicit CORS_ORIGIN (no localhost,
 *    no wildcard with credentials).
 *  - ALLOW_LOCAL_EXECUTION=true in production is a FATAL startup error.
 *    Host execution of untrusted code can never be made safe without UID
 *    separation, so there is no override flag. Use the Wandbox sandbox path.
 *  - ALLOW_SHELL=true in production is a FATAL startup error (same reason).
 *  - VITE_ provider keys are ignored server-side and warn loudly: provider
 *    secrets must be server-only. (The Vite build also blanks them.)
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function fail(message) {
    // Intentionally loud + non-zero exit. Never include values.
    console.error(`\n[FATAL] Refusing to start: ${message}\n`);
    process.exit(1);
}

function warn(message) {
    console.warn(`[config] ${message}`);
}

// ---- Port / paths ----------------------------------------------------------
const PORT = Number(process.env.PORT) || 3001;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    fail('PORT must be an integer between 1 and 65535.');
}
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const DATABASE_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(DATA_DIR, 'azemax.db');

// ---- Auth bypass (reversible, login gate removal) ----------------------------
// DISABLE_AUTH=true skips the login gate by injecting a fixed local user
// (local-dev@azemax.local). Auth code, tables, and hashes are left intact —
// unset the flag to restore login with zero migrations.
//
// Fail-closed: in production DISABLE_AUTH=true additionally requires the
// explicit acknowledgement ALLOW_PUBLIC_BYPASS=true, otherwise the server
// refuses to boot. The acknowledgement exists because a public bypass means
// EVERY visitor shares ONE identity: all projects, AI quota, and execution
// are shared, and anyone can read/overwrite/delete anything. Acceptable for
// a throwaway public beta; never for real user data.
const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true';
const ALLOW_PUBLIC_BYPASS = process.env.ALLOW_PUBLIC_BYPASS === 'true';
if (isProd && DISABLE_AUTH && !ALLOW_PUBLIC_BYPASS) {
    fail('DISABLE_AUTH=true in production requires explicit acknowledgement: set ALLOW_PUBLIC_BYPASS=true. Without it the server refuses to boot, because every visitor would share one identity (all projects/AI quota/execution shared, anyone can read or delete anything). Only acknowledge for a throwaway public beta.');
}
if (DISABLE_AUTH && isProd) {
    warn('PUBLIC AUTH BYPASS ACTIVE — every visitor shares the local-dev identity. Shared projects, shared AI/execution quotas, no privacy. Unset DISABLE_AUTH (or ALLOW_PUBLIC_BYPASS) and redeploy to restore login.');
} else if (DISABLE_AUTH) {
    warn('DISABLE_AUTH=true — login is bypassed with a fixed local user. Auth code is intact; unset to restore login. Never expose this process to untrusted users without ALSO understanding the shared-identity consequences.');
}

// ---- Public beta (anonymous workspace) --------------------------------------
// PUBLIC_BETA=true lets unauthenticated visitors use the editor immediately:
// workspace files persist in the browser (localStorage), while server AI and
// code-execution endpoints accept anonymous requests attributed to the client
// IP (never a client-supplied user id) under strict validation + rate limits.
// Server projects (/api/projects) and admin endpoints STAY login-required, so
// anonymous users can never read other users' private data.
// Default ON (unset or anything but "false" enables it); set PUBLIC_BETA=false
// to restore a hard login wall. Unlike DISABLE_AUTH this creates NO shared
// server identity and refuses nothing at boot.
const PUBLIC_BETA = process.env.PUBLIC_BETA !== 'false';
if (PUBLIC_BETA) {
    warn('PUBLIC_BETA enabled — anonymous visitors can use AI/execution under IP-based quotas; /api/projects stays login-required and anonymous workspaces persist locally in the browser. Set PUBLIC_BETA=false to restore a hard login wall.');
}

// ---- Auth secret -----------------------------------------------------------
const AUTH_SECRET = process.env.AUTH_SECRET || '';
if (isProd && AUTH_SECRET.length < 32) {
    fail('AUTH_SECRET must be set to a random string of at least 32 characters in production. Generate with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
}
if (!isProd && !isTest && AUTH_SECRET && AUTH_SECRET.length < 32) {
    warn('AUTH_SECRET is shorter than 32 characters — sessions are weak. Use a longer secret.');
}

// ---- CORS ------------------------------------------------------------------
const rawCORS = process.env.CORS_ORIGIN || (isProd ? '' : 'http://localhost:5173');
if (isProd && !rawCORS) {
    fail('CORS_ORIGIN must be set in production to your exact frontend origin(s), comma-separated. Example: CORS_ORIGIN=https://your-frontend.vercel.app');
}
const CORS_LIST = rawCORS.split(',').map((s) => s.trim()).filter(Boolean);
if (CORS_LIST.includes('*')) {
    fail('CORS_ORIGIN must not be "*" — credentials are enabled and a wildcard would expose the API to any website.');
}
if (isProd) {
    for (const origin of CORS_LIST) {
        if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(origin)) {
            fail('CORS_ORIGIN must not contain localhost in production. Set it to your public frontend origin.');
        }
        if (!/^https:\/\//i.test(origin)) {
            warn(`CORS origin "${origin}" is not https — production origins should be https.`);
        }
    }
}
const CORS_ORIGIN = CORS_LIST.length === 1 ? CORS_LIST[0] : CORS_LIST;

// ---- Execution gates (fail closed) ------------------------------------------
function execFlag(name) {
    const v = process.env[name];
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null; // unset
}

const localFlag = execFlag('ALLOW_LOCAL_EXECUTION');
const shellFlag = execFlag('ALLOW_SHELL');

if (isProd && localFlag === true) {
    fail('ALLOW_LOCAL_EXECUTION=true is forbidden in production: host execution of untrusted code has no UID/sandbox isolation. Keep it unset or "false" (Wandbox sandbox is used instead).');
}
if (isProd && shellFlag === true) {
    fail('ALLOW_SHELL=true is forbidden in production: interactive host shells cannot be isolated. Keep it unset or "false".');
}

// Default: allow on local dev/test machines, deny in production.
const ALLOW_LOCAL_EXECUTION = localFlag === true || (!isProd && localFlag !== false);
const ALLOW_SHELL = shellFlag === true || (!isProd && shellFlag !== false);

if (!isProd && (ALLOW_LOCAL_EXECUTION || ALLOW_SHELL)) {
    warn('Local code execution / interactive shell is ENABLED (development default). Never expose this process to untrusted users.');
}

// ---- VITE_ key hygiene -------------------------------------------------------
// Provider secrets must be server-only. VITE_ keys in the server environment
// are ignored (defense in depth alongside the Vite build-time blanking).
for (const k of ['VITE_GROQ_API_KEY', 'VITE_OPENROUTER_API_KEY', 'VITE_HF_TOKEN', 'VITE_KILO_API_KEY']) {
    if (process.env[k]) {
        warn(`${k} is set in the server environment — ignoring. Provider keys must be server-only (GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN, KILO_API_KEY). Do not bake provider secrets into frontend builds.`);
    }
}

// ---- AI provider keys (server-only) ------------------------------------------
const AI_MODELS = {
    nvidia: {
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        default: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
        apiKey: process.env.NVIDIA_API_KEY || '',
    },
    groq: {
        default: 'qwen/qwen3.8-27b',
        apiKey: process.env.GROQ_API_KEY || '',
    },
    openRouter: {
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        fallbacks: [
            'nvidia/nemotron-3-super-120b-a12b:free',
            'nvidia/nemotron-3.5-lightning:free',
            'nvidia/nemotron-3-ultra-550b-a55b:free',
        ],
    },
    huggingFace: {
        baseUrl: 'https://router.huggingface.co/v1/chat/completions',
        apiKey: process.env.HF_TOKEN || '',
        defaultModel: 'deepseek-ai/DeepSeek-R1:novita',
    },
    kiloCode: {
        baseUrl: process.env.KILO_BASE_URL || 'https://api.kilocode.ai/v1',
        apiKey: process.env.KILO_API_KEY || '',
    },
};

const configuredProviders = Object.entries(AI_MODELS)
    .filter(([, v]) => Boolean(v.apiKey))
    .map(([k]) => k);
if (configuredProviders.length === 0) {
    warn('No AI provider API keys configured — AI features will return a configuration error until a key is set.');
}

// ---- Quotas / limits (sane production defaults, all overridable) --------------
function num(name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
        fail(`${name} must be a number between ${min} and ${max}.`);
    }
    return n;
}

const LIMITS = {
    // AI policy (server-enforced, client input is untrusted)
    AI_MAX_MESSAGES: num('AI_MAX_MESSAGES', 50, { min: 1, max: 200 }),
    AI_MAX_MESSAGE_CHARS: num('AI_MAX_MESSAGE_CHARS', 20000, { min: 100, max: 100000 }),
    AI_MAX_TOTAL_CHARS: num('AI_MAX_TOTAL_CHARS', 100000, { min: 1000, max: 500000 }),
    AI_MAX_TOKENS_ABSOLUTE: num('AI_MAX_TOKENS_ABSOLUTE', 8192, { min: 256, max: 32768 }),
    AI_REQUESTS_PER_MINUTE: num('AI_REQUESTS_PER_MINUTE', 20, { min: 1, max: 1000 }),
    AI_REQUESTS_PER_DAY: num('AI_REQUESTS_PER_DAY', 200, { min: 1, max: 100000 }),
    // Anonymous (public-beta, IP-attributed) daily quotas are deliberately
    // tighter than authenticated quotas — denial-of-wallet backstop for the
    // unauthenticated AI/execution surface. Per-minute limits are shared.
    AI_ANON_REQUESTS_PER_DAY: num('AI_ANON_REQUESTS_PER_DAY', 50, { min: 1, max: 100000 }),
    EXEC_ANON_REQUESTS_PER_DAY: num('EXEC_ANON_REQUESTS_PER_DAY', 60, { min: 1, max: 100000 }),
    EXEC_REQUESTS_PER_MINUTE: num('EXEC_REQUESTS_PER_MINUTE', 30, { min: 1, max: 1000 }),
    EXEC_REQUESTS_PER_DAY: num('EXEC_REQUESTS_PER_DAY', 300, { min: 1, max: 100000 }),
    // Projects / storage quotas (per user)
    MAX_WORKSPACES_PER_USER: num('MAX_WORKSPACES_PER_USER', 50, { min: 1, max: 10000 }),
    MAX_WORKSPACE_BYTES: num('MAX_WORKSPACE_BYTES', 2 * 1024 * 1024, { min: 1024, max: 50 * 1024 * 1024 }),
    MAX_FILE_BYTES: num('MAX_FILE_BYTES', 512 * 1024, { min: 1024, max: 10 * 1024 * 1024 }),
    MAX_FILES_PER_WORKSPACE: num('MAX_FILES_PER_WORKSPACE', 2000, { min: 10, max: 50000 }),
    MAX_USER_STORAGE_BYTES: num('MAX_USER_STORAGE_BYTES', 50 * 1024 * 1024, { min: 1024 * 1024, max: 1024 * 1024 * 1024 }),
    // Execution sandbox caps
    MAX_CODE_BYTES: num('MAX_CODE_BYTES', 200 * 1024, { min: 1024, max: 2 * 1024 * 1024 }),
    MAX_STDIN_BYTES: num('MAX_STDIN_BYTES', 32 * 1024, { min: 0, max: 512 * 1024 }),
    MAX_OUTPUT_BYTES: num('MAX_OUTPUT_BYTES', 512 * 1024, { min: 4096, max: 4 * 1024 * 1024 }),
    EXECUTION_TIMEOUT_MS: num('EXECUTION_TIMEOUT_MS', 60000, { min: 5000, max: 300000 }),
    COMPILE_TIMEOUT_MS: num('COMPILE_TIMEOUT_MS', 30000, { min: 5000, max: 120000 }),
    WANDBOX_TIMEOUT_MS: num('WANDBOX_TIMEOUT_MS', 55000, { min: 5000, max: 120000 }),
    // WebSocket guards
    WS_MAX_PAYLOAD: num('WS_MAX_PAYLOAD', 1024 * 1024, { min: 4096, max: 16 * 1024 * 1024 }),
    WS_GLOBAL_MAX_SESSIONS: num('WS_GLOBAL_MAX_SESSIONS', 500, { min: 10, max: 10000 }),
    WS_USER_MAX_SESSIONS: num('WS_USER_MAX_SESSIONS', 5, { min: 1, max: 50 }),
    WS_IP_MAX_SESSIONS: num('WS_IP_MAX_SESSIONS', 20, { min: 1, max: 200 }),
    WS_HEARTBEAT_MS: num('WS_HEARTBEAT_MS', 30000, { min: 5000, max: 120000 }),
    WS_IDLE_TIMEOUT_MS: num('WS_IDLE_TIMEOUT_MS', 10 * 60 * 1000, { min: 60000, max: 3600000 }),
    // Auth hardening
    AUTH_RATE_PER_MINUTE: num('AUTH_RATE_PER_MINUTE', 10, { min: 1, max: 100 }),
    SESSION_TTL_MS: num('SESSION_TTL_MS', 30 * 24 * 3600 * 1000, { min: 3600000, max: 90 * 24 * 3600 * 1000 }),
};

// Public / non-secret summary for startup logging (names + counts only).
function publicSummary() {
    return {
        env: process.env.NODE_ENV || 'development',
        port: PORT,
        providersConfigured: configuredProviders,
        allowLocalExecution: ALLOW_LOCAL_EXECUTION,
        allowShell: ALLOW_SHELL,
        authDisabled: DISABLE_AUTH,
        publicBeta: PUBLIC_BETA,
        // Truthful signal: reflects whether the Admin SDK actually initialized,
        // not merely whether FIREBASE_PROJECT_ID is present in the environment.
        firebaseConfigured: (() => {
            try {
                return require('../services/auth/firebaseAdmin.cjs').isFirebaseConfigured();
            } catch {
                return false;
            }
        })(),
        corsOrigins: CORS_LIST.map(() => '[set]'),
    };
}

module.exports = {
    isProd,
    isTest,
    DISABLE_AUTH,
    ALLOW_PUBLIC_BYPASS,
    PUBLIC_BETA,
    PORT,
    DATA_DIR,
    WORKSPACES_DIR,
    DATABASE_PATH,
    AUTH_SECRET,
    CORS_ORIGIN,
    CORS_LIST,
    ALLOW_LOCAL_EXECUTION,
    ALLOW_SHELL,
    AI_MODELS,
    LIMITS,
    publicSummary,
    fail,
};
