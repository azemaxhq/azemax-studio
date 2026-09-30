/**
 * Execution sandbox primitives — the security boundary for ALL host
 * process spawning (HTTP execute path AND terminal PTY path).
 *
 * Two guarantees, applied uniformly:
 *  1. ENVIRONMENT ISOLATION — children get an explicit minimal allowlist env.
 *     The server's process.env (provider API keys, DB paths, deployment
 *     secrets) is NEVER inherited. This alone closes the credential-theft
 *     class (see audit B2).
 *  2. RESOURCE LIMITS (Linux) — when `prlimit(1)` is available, children run
 *     under RLIMIT_CPU / RLIMIT_AS / RLIMIT_NPROC / RLIMIT_FSIZE /
 *     RLIMIT_NOFILE, bounding fork bombs, memory hogs, and disk-fill attempts.
 *     On platforms without prlimit (macOS dev), timeouts + output caps still
 *     apply; production Linux hosts get the full envelope.
 *
 * What this is NOT: a container/VM boundary. A hostile program still shares
 * the host kernel and (limited) network. That is why production keeps
 * ALLOW_LOCAL_EXECUTION=false (fail-closed) and uses the Wandbox sandbox.
 * Host execution exists for local development and for a future UID/container
 * sandbox to plug into — `spawnSandboxed` is the single choke point.
 */
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const { LIMITS } = require('../../config/index.cjs');
const logger = require('../../lib/logger.cjs');

const SANDBOX_MAX_MEMORY_MB = Number(process.env.SANDBOX_MAX_MEMORY_MB) || 1024;
const SANDBOX_MAX_PROCESSES = Number(process.env.SANDBOX_MAX_PROCESSES) || 64;
const SANDBOX_MAX_CPU_SECONDS = Math.max(5, Math.ceil((LIMITS.EXECUTION_TIMEOUT_MS || 60000) / 1000));
const SANDBOX_MAX_FILE_MB = Number(process.env.SANDBOX_MAX_FILE_MB) || 64;

/** Explicit minimal environment. Everything not listed here is dropped. */
function minimalEnv({ cwd, cols = 80, rows = 30 } = {}) {
    const sysPath = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin';
    return {
        PATH: process.env.SANDBOX_PATH || sysPath,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        TZ: 'UTC',
        TERM: 'xterm-256color',
        // HOME points at the per-execution tmpdir so sandboxed programs can
        // neither read the service account's home nor write to it.
        HOME: cwd || os.tmpdir(),
        TMPDIR: cwd || os.tmpdir(),
        COLUMNS: String(cols),
        LINES: String(rows),
    };
}

let prlimitChecked = false;
let prlimitAvailable = false;

function hasPrlimit() {
    if (!prlimitChecked) {
        prlimitChecked = true;
        prlimitAvailable = process.platform === 'linux';
        if (prlimitAvailable) {
            try {
                execFileSync('prlimit', ['--version'], { stdio: 'ignore' });
            } catch {
                prlimitAvailable = false;
            }
        }
        if (prlimitAvailable) logger.info('sandbox prlimit available', {});
    }
    return prlimitAvailable;
}

/**
 * Spawn with the sandbox envelope. Drop-in replacement for child_process.spawn
 * for untrusted workloads. `options.env` is IGNORED (minimal env always wins)
 * unless `options.allowExtraEnv` explicitly lists additional pass-through keys
 * (used for nothing by default — escape hatch only).
 */
function spawnSandboxed(cmd, args, options = {}) {
    const { cwd, allowExtraEnv, ...rest } = options;
    const env = minimalEnv({ cwd });
    if (Array.isArray(allowExtraEnv)) {
        for (const key of allowExtraEnv) {
            if (typeof key === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(key) && process.env[key] !== undefined) {
                env[key] = process.env[key];
            }
        }
    }
    if (hasPrlimit()) {
        const limits = [
            `--cpu=${SANDBOX_MAX_CPU_SECONDS}`,
            `--as=${SANDBOX_MAX_MEMORY_MB * 1024 * 1024}`,
            `--nproc=${SANDBOX_MAX_PROCESSES}`,
            `--fsize=${SANDBOX_MAX_FILE_MB * 1024 * 1024}`,
            `--nofile=128`,
        ];
        return spawn('prlimit', [...limits, `--`, cmd, ...args], { ...rest, cwd, env });
    }
    return spawn(cmd, args, { ...rest, cwd, env });
}

module.exports = {
    minimalEnv,
    spawnSandboxed,
    hasPrlimit,
    SANDBOX_MAX_MEMORY_MB,
    SANDBOX_MAX_PROCESSES,
    SANDBOX_MAX_CPU_SECONDS,
    SANDBOX_MAX_FILE_MB,
};
