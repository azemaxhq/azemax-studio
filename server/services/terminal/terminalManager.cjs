const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { getLanguageConfig, canRunLocally } = require('../execution/languageConfig.cjs');
const { resolveFileName, codeNeedsStdin } = require('../execution/fileNaming.cjs');
const { streamViaWandbox } = require('../execution/wandboxExecutor.cjs');
const { EXECUTION_TIMEOUT_MS, COMPILE_TIMEOUT_MS } = require('../execution/constants.cjs');
const { spawnSandboxed, minimalEnv } = require('../execution/sandbox.cjs');
const { LIMITS, ALLOW_LOCAL_EXECUTION, WORKSPACES_DIR } = require('../../config/index.cjs');

// --- Constants -------------------------------------------------------------

const PTY_RELAY = path.join(__dirname, 'ptyRelay.py');

/** Kill a detached process group (or fall back to the direct child). */
function killProcessTree(proc) {
    if (!proc) return;
    if (proc.pid && process.platform !== 'win32') {
        try {
            process.kill(-proc.pid, 'SIGKILL');
            return;
        } catch { /* fall through to direct kill */ }
    }
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
}
// VS Code: ITerminalProfileResolverService.getDefaultShell per OS — not hard-coded '/bin/zsh'.
// Mirrors `src/core/terminal/terminalProfiles.ts:getDefaultShell` for the backend (os-aware).
function getDefaultShell() {
  const env = process.env.SHELL || process.env.COMSPEC;
  if (env) return env;
  const plat = os.platform();
  if (plat === 'win32') return 'powershell.exe';
  if (plat === 'darwin') return '/bin/zsh';
  return '/bin/bash';
}
const DEFAULT_SHELL = getDefaultShell();

function getDefaultShellArgs(shellPath) {
  if (/powershell/i.test(shellPath)) return [];
  // login shell for POSIX (VS Code: '-l' for default profiles)
  return ['-l'];
}

// --- Session state machine -------------------------------------------------
// DISCONNECTED -> CONNECTING -> CONNECTED -> STARTING -> RUNNING/WAITING_FOR_INPUT
// RUNNING -> STOPPING -> EXITED/FAILED -> DISPOSED

const STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    WAITING_FOR_INPUT: 'WAITING_FOR_INPUT',
    STOPPING: 'STOPPING',
    EXITED: 'EXITED',
    FAILED: 'FAILED',
    DISPOSED: 'DISPOSED',
};

/**
 * TerminalManager owns every spawned process.
 *
 * sessionId -> { id, state, kind('shell'|'code'), proc, ctrlFd/child process
 *                transport (WebSocket or null), cols, rows, cwd, pid, createdAt }
 *
 * Rules:
 *  - Every child process belongs to exactly one session.
 *  - On process exit: session -> EXITED and process is unregistered.
 *  - On session dispose: kill process group, close pty, remove temp files.
 *  - Sessions with no live transport and no live process are garbage collected.
 */
class TerminalManager {
    constructor() {
        this.sessions = new Map();
        this._handlers = new Map(); // sessionId -> { stdout, stderr, control }
        this._gcTimer = setInterval(() => this._garbageCollect(), 30000);
        if (this._gcTimer.unref) this._gcTimer.unref();
    }

    static MAX_SESSIONS = LIMITS.WS_GLOBAL_MAX_SESSIONS;

    createSession(id = null, { kind = 'code', title, language, code, cwd, cols = 80, rows = 30, stdinInput: _stdinInput = '', preStdin: _preStdin = null, ownerId = null, ownerIp = null }) {
        if (this.sessions.size >= TerminalManager.MAX_SESSIONS) {
            throw new Error(`Session limit reached (${TerminalManager.MAX_SESSIONS}). Close a terminal first.`);
        }
        // cwd containment: only directories under the OS temp root or the
        // server's workspace root are accepted. An arbitrary client path (e.g.
        // `/` or the repo root) would otherwise expose host files to the shell.
        let safeCwd = os.tmpdir();
        if (cwd) {
            try {
                // Resolve symlinks before the containment check: a symlink under
                // the temp root pointing at `/` must not become the shell cwd.
                const resolved = fs.realpathSync(path.resolve(String(cwd)));
                const roots = [os.tmpdir(), WORKSPACES_DIR].map((root) => {
                    try { return fs.realpathSync(path.resolve(root)); } catch { return path.resolve(root); }
                });
                const contained = roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
                if (contained && fs.statSync(resolved).isDirectory()) {
                    safeCwd = resolved;
                }
            } catch { /* fall back to tmpdir */ }
        }
        id = id || crypto.randomBytes(8).toString('hex');
        const session = {
            id,
            kind,
            title: title || (kind === 'shell' ? 'Shell' : (language || 'code')),
            state: STATES.CONNECTED,
            language: language || null,
            code: code || null,
            cwd: safeCwd,
            cols,
            rows,
            pid: null,
            transport: null,
            proc: null,
            controlProc: null,
            tmpDir: null,
            wandbox: null,
            abortController: null,
            // Per-session output budget. Code runs get the configured cap;
            // interactive shells get a larger (still bounded) budget because
            // they legitimately stream more over their lifetime.
            outputBytes: 0,
            outputLimit: kind === 'shell'
                ? Math.min(LIMITS.MAX_OUTPUT_BYTES * 4, 4 * 1024 * 1024)
                : LIMITS.MAX_OUTPUT_BYTES,
            outputTruncated: false,
            exitCode: null,
            createdAt: Date.now(),
            exitedAt: null,
            ownerId: ownerId || null,
            ownerIp: ownerIp || null,
            policy: { reconnect: false }, // WS disconnect -> terminate process (safe default)
        };
        this.sessions.set(id, session);
        return session;
    }

    attachTransport(id, ws) {
        const session = this.sessions.get(id);
        if (!session) return null;
        session.transport = ws;
        session.state = STATES.CONNECTED;
        return session;
    }

    detachTransport(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        session.transport = null;
        // Policy: WS disconnect terminates the process (no orphan processes).
        // Socket closures are handled by the closing connection's handler too;
        // this is the defensive backstop and applies re-attach timing grace.
    }

    getSession(id) {
        return this.sessions.get(id) || null;
    }

    /** Broadcast a protocol message to the session's transport. */
    send(id, payload) {
        const session = this.sessions.get(id);
        if (!session || !session.transport) return false;
        const ws = session.transport;
        if (ws.readyState !== ws.OPEN) return false;

        if (payload && payload.type === 'terminal.output') {
            if (session.outputTruncated) return false;
            const bytes = Buffer.byteLength(String(payload.data || ''), 'utf8');
            if (session.outputBytes + bytes > session.outputLimit) {
                if (!session.outputTruncated) {
                    session.outputTruncated = true;
                    try {
                        ws.send(JSON.stringify({
                            sessionId: id,
                            type: 'terminal.error',
                            message: `Output limit exceeded (${session.outputLimit} bytes); stopping session.`,
                        }));
                    } catch { /* ignore */ }
                    this.kill(id);
                }
                return false;
            }
            session.outputBytes += bytes;
            // A peer that stops reading must not make the server buffer output
            // without bound. Stop the run instead of queueing forever.
            if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > LIMITS.WS_MAX_BUFFERED_BYTES) {
                this.kill(id);
                return false;
            }
        }

        try {
            ws.send(JSON.stringify({ sessionId: id, ...payload }));
            return true;
        } catch {
            return false;
        }
    }

    setState(id, state) {
        const session = this.sessions.get(id);
        if (!session) return;
        session.state = state;
        this.send(id, { type: 'terminal.state', state });
    }

    // --- PTY spawn -----------------------------------------------------------

    /**
     * Spawn a process under a real PTY (via the Python relay).
     * The relay process is the child_process; the actual command runs inside
     * the pty. We also open a control fd via an extra 'pipe' stdio slot.
     */
    spawnPty(session, runCmd, runArgs) {
        session.outputBytes = 0;
        session.outputTruncated = false;
        const args = [PTY_RELAY, String(session.cols), String(session.rows), '--', runCmd, ...runArgs];
        // Sandboxed: minimal env + OS resource limits where available.
        const proc = spawnSandboxed('python3', args, {
            cwd: session.cwd && fs.existsSync(session.cwd) ? session.cwd : os.tmpdir(),
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });

        session.proc = proc;
        session.checkPty = true;

        // Ownership guard: this process may only emit frames while it is still
        // the CURRENT owner of this session id. Once the session is disposed or
        // replaced by a new run, all its handlers become no-ops. This is what
        // prevents a stale process/relay from writing into a newer session.
        const owner = () => this.sessions.get(session.id) === session;

        const ctrl = proc.stdio[3]; // 'pipe' index 3
        const ctrlOpen = ctrl && ctrl.writable;

        proc.stdout.on('data', (d) => {
            if (!owner()) return;
            this.send(session.id, { type: 'terminal.output', data: d.toString() });
        });
        proc.stderr.on('data', (d) => {
            if (!owner()) return;
            // Relay stderr is diagnostics only (the pty stream is on stdout).
            this.send(session.id, { type: 'terminal.output', data: `\u001b[2m[pty]${d.toString()}\u001b[0m`, diagnostic: true });
        });
        proc.on('error', (err) => {
            if (!owner()) return;
            this.send(session.id, { type: 'terminal.error', message: `Failed to start process: ${err.message}` });
            this._finishSession(session, -1, null);
        });
        // Use 'close' (not 'exit'): it fires only after stdio is fully drained,
        // so the final output chunk is never lost to a premature exit frame.
        // The owner guard prevents a stale process from finishing a newer session.
        proc.on('close', (code, sig) => {
            if (!owner()) return;
            if (session.state !== STATES.EXITED && session.state !== STATES.FAILED && session.state !== STATES.DISPOSED) {
                this._finishSession(session, code, sig);
            }
        });

        return { ctrl, ctrlOpen };
    }

    /** Spawn a plain child_process (no PTY) — used for wires/compile and non-interactive remote-style exec. */
    spawnPlain(session, runCmd, runArgs, { preStdin = '', cwd } = {}) {
        // Sandboxed: minimal env + OS resource limits where available.
        const proc = spawnSandboxed(runCmd, runArgs, {
            cwd: cwd || session.cwd,
        });
        session.proc = proc;
        session.checkPty = false;
        const owner = () => this.sessions.get(session.id) === session;

        proc.stdout.on('data', (d) => { if (owner()) this.send(session.id, { type: 'terminal.output', data: d.toString() }); });
        proc.stderr.on('data', (d) => { if (owner()) this.send(session.id, { type: 'terminal.output', data: d.toString() }); });
        proc.on('error', (err) => {
            if (!owner()) return;
            this.send(session.id, { type: 'terminal.error', message: `Failed to start process: ${err.message}` });
            this._finishSession(session, -1, null);
        });
        proc.on('close', (code, sig) => {
            if (owner() && session.state !== STATES.EXITED && session.state !== STATES.FAILED && session.state !== STATES.DISPOSED) {
                this._finishSession(session, code, sig);
            }
        });

        if (preStdin && proc.stdin) {
            const input = preStdin.endsWith('\n') ? preStdin : `${preStdin}\n`;
            proc.stdin.write(input);
            proc.stdin.end();
        }
        return proc;
    }

    _finishSession(session, code, signal) {
        if (session.state === STATES.EXITED || session.state === STATES.FAILED || session.state === STATES.DISPOSED) return;
        session.exitCode = code;
        session.exitedAt = Date.now();
        const wasSignal = typeof signal === 'string' && signal;
        session.state = wasSignal ? STATES.FAILED : (code === 0 ? STATES.EXITED : STATES.FAILED);
        this.send(session.id, {
            type: 'terminal.exit',
            code: wasSignal ? null : code,
            signal: wasSignal ? signal : null,
        });
        this._cleanupSession(session);
    }

    _buildEnv(session) {
        // Single choke point: the sandbox allowlist. Server env is never
        // inherited. SHELL/PWD are session-scoped additions on top.
        return {
            ...minimalEnv({ cwd: session.tmpDir || session.cwd, cols: session.cols, rows: session.rows }),
            SHELL: DEFAULT_SHELL,
            PWD: session.cwd,
        };
    }

    // --- Input / signal / resize / kill -------------------------------------

    sendInput(id, data) {
        const session = this.sessions.get(id);
        if (!session) return false;

        // Remote (Wandbox) run that is waiting for its stdin line: resume now.
        if (session.pendingWandboxStdin) {
            const resume = session.pendingWandboxStdin;
            session.pendingWandboxStdin = null;
            resume(String(data));
            return true;
        }

        if (!session.proc || !session.proc.stdin) return false;
        // Plain (non-PTY) procs: write to process stdin directly.
        // PTY procs: write to the relay's stdin (fd0), which forwards to the master.
        if (session.proc.stdin.writable) {
            try {
                session.proc.stdin.write(String(data));
            } catch { return false; }
            return true;
        }
        return false;
    }

    resize(id, cols, rows) {
        const session = this.sessions.get(id);
        if (!session) return;
        cols = Math.max(10, Math.floor(Number(cols) || session.cols));
        rows = Math.max(5, Math.floor(Number(rows) || session.rows));
        if (session.cols === cols && session.rows === rows) return;
        session.cols = cols;
        session.rows = rows;
        if (session.checkPty && session.proc && session.proc.stdin && session.proc.stdio && session.proc.stdio[3]) {
            const ctrl = session.proc.stdio[3];
            if (ctrl && ctrl.writable) {
                ctrl.write(`${JSON.stringify({ op: 'resize', cols, rows })}\n`);
            }
        }
    }

    signal(id, sig) {
        const session = this.sessions.get(id);
        if (!session || !session.proc) return false;
        if (session.checkPty && session.proc.stdio && session.proc.stdio[3] && session.proc.stdio[3].writable) {
            session.proc.stdio[3].write(`${JSON.stringify({ op: 'signal', sig })}\n`);
            return true;
        }
        if (session.proc.pid) {
            try { process.kill(session.proc.pid, sig); } catch { /* ignore */ }
        }
        return true;
    }

    kill(id) {
        const session = this.sessions.get(id);
        if (!session) return false;
        if (session.state === STATES.EXITED || session.state === STATES.FAILED || session.state === STATES.DISPOSED) return false;
        this.setState(id, STATES.STOPPING);
        if (session.wandbox) {
            session.wandbox.aborted = true;
        }
        // Abort the upstream Wandbox request (if any). Without this the HTTP
        // request keeps running after Stop/dispose and consumes a concurrency
        // slot until the provider timeout.
        if (session.abortController) {
            try { session.abortController.abort(); } catch { /* ignore */ }
        }
        if (session.pendingWandboxStdin) {
            session.pendingWandboxStdin = null;
        }
        // A compile subprocess must never outlive its session (killing the main
        // proc does NOT touch the compiler, so it would otherwise be orphaned).
        if (session.compileProc) {
            killProcessTree(session.compileProc);
            session.compileProc = null;
        }
        if (session.checkPty && session.proc && session.proc.stdio && session.proc.stdio[3] && session.proc.stdio[3].writable) {
            // Ask the relay to SIGKILL the full descendant tree (background
            // jobs live in their own process groups, so a plain group kill
            // would orphan them).
            try {
                session.proc.stdio[3].write(`${JSON.stringify({ op: 'kill' })}\n`);
            } catch { /* ignore */ }
        } else if (session.proc && session.proc.pid) {
            killProcessTree(session.proc);
        }
        return true;
    }

    dispose(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        // Stop first (kills the process tree and aborts any Wandbox request),
        // then detach the transport so a disposed session can never emit.
        this.kill(id);
        session.transport = null;
        if (session.abortController) {
            try { session.abortController.abort(); } catch { /* ignore */ }
        }
        if (session.pendingWandboxStdin) {
            session.pendingWandboxStdin = null;
        }
        session.proc = null;
        this._cleanupSession(session);
        session.state = STATES.DISPOSED;
        this.sessions.delete(id);
    }

    /** Full code-execution path: compile (if needed), then run in PTY. */
    async executeCode(session, { language, code, stdinInput = '', preStdin = null, filename = null }) {
        const lang = String(language).toLowerCase();
        session.outputBytes = 0;
        session.outputTruncated = false;

        // Wandbox fallback for unsupported/remote (also forced in production when local execution is disabled)
        const runViaWandbox = (stdinData = '', _wasInteractive = false) => {
            session.state = STATES.RUNNING;
            const controller = new AbortController();
            const wb = {
                stdinData: stdinData || '',
                aborted: false,
                controller,
            };
            session.wandbox = wb;
            session.abortController = controller;
            const owner = () => this.sessions.get(session.id) === session;
            const emitOutput = () => owner() && !wb.aborted;
            streamViaWandbox({
                language: lang,
                code,
                stdin: wb.stdinData,
                filename: filename || null,
                signal: controller.signal,
                onEvent: (event) => {
                    if (!owner()) return;
                    if (event.type === 'stdout') {
                        if (emitOutput()) this.send(session.id, { type: 'terminal.output', data: event.data });
                    } else if (event.type === 'stderr') {
                        if (emitOutput()) this.send(session.id, { type: 'terminal.output', data: event.data });
                    } else if (event.type === 'error') {
                        this.send(session.id, { type: 'terminal.error', message: event.data });
                    } else if (event.type === 'exit') {
                        session.exitCode = event.code;
                        session.state = event.code === 0 ? STATES.EXITED : STATES.FAILED;
                        this.send(session.id, { type: 'terminal.exit', code: event.code, signal: null });
                    }
                },
            }).catch(() => {
                if (!owner()) return;
                session.state = STATES.FAILED;
                this.send(session.id, { type: 'terminal.error', message: 'Wandbox execution failed' });
                this.send(session.id, { type: 'terminal.exit', code: 1, signal: null });
            }).finally(() => {
                if (session.abortController === controller) session.abortController = null;
                session.wandbox = null;
            });
        };

        const initialConfig = getLanguageConfig(lang, path.join(os.tmpdir(), 'main'), os.tmpdir());
        if (!ALLOW_LOCAL_EXECUTION || !canRunLocally(initialConfig)) {
            this.setState(session.id, STATES.STARTING);
            if (stdinInput || preStdin) {
                runViaWandbox(stdinInput || preStdin);
            } else if (this.detectNeedsStdin(lang, code)) {
                this.setState(session.id, STATES.WAITING_FOR_INPUT);
                this.send(session.id, { type: 'terminal.stdin_required' });
                // Wandbox is single-shot: hold the run until the first input line
                // arrives (sendInput), then start it with that stdin.
                session.pendingWandboxStdin = (line) => {
                    session.pendingWandboxStdin = null;
                    runViaWandbox(line);
                };
            } else {
                runViaWandbox();
            }
            return;
        }

        // Local execution with a real PTY.
        this.setState(session.id, STATES.STARTING);
        session.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderun-ses-'));

        const fileName = resolveFileName(lang, code, initialConfig.ext, filename);
        // Path-traversal guard: fileName must be a plain filename, no dirs
        if (!/^[a-zA-Z0-9_.-]+$/.test(fileName) || fileName.includes('..')) {
            throw Object.assign(new Error('Invalid filename'), { failCompile: true });
        }
        const filePath = path.join(session.tmpDir, fileName);
        const resolved = path.resolve(filePath);
        const tmpResolved = path.resolve(session.tmpDir);
        if (!resolved.startsWith(tmpResolved + path.sep) && resolved !== tmpResolved) {
            throw Object.assign(new Error('Path traversal detected'), { failCompile: true });
        }
        fs.writeFileSync(filePath, code);
        const config = getLanguageConfig(lang, filePath, session.tmpDir);

        try {
            if (config.compile) {
                if (!config.compile.cmd) {
                    runViaWandbox(stdinInput || preStdin || '');
                    return;
                }
                await this._compile(config, filePath, session);
                if (session.state === STATES.DISPOSED || session.state === STATES.EXITED || session.state === STATES.FAILED) return;
            }

            const runCmd = config.compile ? (config.cmd || config.args()[0]) : config.cmd;
            const runArgs = config.compile && !config.cmd
                ? config.args().slice(1)
                : (config.compile ? config.args() : config.args(filePath));

            if (!runCmd) {
                runViaWandbox(stdinInput || preStdin || '');
                return;
            }

            let args = [...runArgs];
            if (lang === 'python' && runCmd.includes('python')) {
                args = ['-u', ...args];
            }

            this.setState(session.id, STATES.RUNNING);

            if (preStdin || stdinInput) {
                // Pre-provided stdin: run in PTY but auto-feed. Also auto-provide the
                // first line after the prompt for a natural feel.
                const ctrl = this.spawnPty(session, runCmd, args);
                // Feed pre-stdin after a brief delay so interactive prompts appear first.
                setTimeout(() => {
                    const input = (preStdin || stdinInput).replace(/\r/g, '');
                    if (session.proc && session.proc.stdin && !session.proc.stdin.destroyed) {
                        session.proc.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
                    }
                }, 350);
                void ctrl;
            } else if (codeNeedsStdin(lang, code)) {
                this.setState(session.id, STATES.WAITING_FOR_INPUT);
                this.send(session.id, { type: 'terminal.stdin_required', interactive: true });
                this.spawnPty(session, runCmd, args);
            } else {
                this.spawnPty(session, runCmd, args);
            }

            // Global execution timeout (PTY gets SIGKILL; exit frame flows to frontend)
            session.execTimer = setTimeout(() => {
                if (session.proc && session.state !== STATES.EXITED && session.state !== STATES.FAILED) {
                    this.send(session.id, { type: 'terminal.output', data: '\r\n\x1b[1;31mExecution timed out\r\n\x1b[0m' });
                    this.kill(idFor(session));
                }
            }, EXECUTION_TIMEOUT_MS);
            if (session.execTimer && session.execTimer.unref) session.execTimer.unref();
        } catch (err) {
            const failCompile = err && err.failCompile === true;
            if (failCompile) {
                // Compilation failed: stderr already streamed. Terminate cleanly —
                // never fall back to Wandbox for broken code.
                console.error('[EXEC] Compilation failed:', err.message);
                session.state = STATES.FAILED;
                this.send(session.id, { type: 'terminal.exit', code: 1, signal: null });
                this._cleanupSession(session);
                return;
            }
            // A session stopped by the output cap / timeout / client must not
            // silently restart on the Wandbox path.
            if (session.state === STATES.STOPPING || session.state === STATES.EXITED
                || session.state === STATES.FAILED || session.state === STATES.DISPOSED) {
                return;
            }
            console.error('[EXEC] Local execution failed, using Wandbox:', err.message);
            this._cleanupSession(session);
            runViaWandbox(stdinInput || preStdin || '');
        }
    }

    async _compile(config, filePath, session) {
        return new Promise((resolve, reject) => {
            // Sandboxed compiler invocation (minimal env, no secret inheritance).
            const compProc = spawnSandboxed(config.compile.cmd, config.compile.args(filePath), {
                cwd: session.tmpDir,
                detached: process.platform !== 'win32',
            });
            // Track the compiler on the session so kill()/dispose() terminate it
            // too — an untracked compiler would be orphaned on stop/dispose.
            session.compileProc = compProc;
            const owner = () => this.sessions.get(session.id) === session;
            const timer = setTimeout(() => {
                killProcessTree(compProc);
                if (session.compileProc === compProc) session.compileProc = null;
                const e = new Error('Compilation timed out');
                e.failCompile = true;
                reject(e);
            }, COMPILE_TIMEOUT_MS);
            const finishCompile = (exitCode, sig) => {
                clearTimeout(timer);
                if (session.compileProc === compProc) session.compileProc = null;
                // Safety: if the proc ended via 'error' or is still alive, never
                // leave it running after the promise settles.
                if (!compProc.killed && compProc.exitCode === null && compProc.signalCode === null) {
                    killProcessTree(compProc);
                }
                if (exitCode === 0 && !sig) resolve();
                else {
                    const e = new Error(`Compilation failed (${sig || exitCode})`);
                    e.failCompile = true;
                    reject(e);
                }
            };
            compProc.stdout.on('data', (d) => { if (owner()) this.send(session.id, { type: 'terminal.output', data: d.toString() }); });
            compProc.stderr.on('data', (d) => { if (owner()) this.send(session.id, { type: 'terminal.output', data: d.toString() }); });
            compProc.on('error', (err) => {
                clearTimeout(timer);
                if (session.compileProc === compProc) session.compileProc = null;
                err.failCompile = true;
                reject(err);
            });
            compProc.on('close', (exitCode, sig) => finishCompile(exitCode, sig));
        });
    }

    detectNeedsStdin(lang, code) {
        return codeNeedsStdin(lang, code);
    }

    _cleanupSession(session) {
        if (session.execTimer) { clearTimeout(session.execTimer); session.execTimer = null; }
        if (session.pendingWandboxStdin) { session.pendingWandboxStdin = null; }
        if (session.compileProc) {
            killProcessTree(session.compileProc);
            session.compileProc = null;
        }
        if (session.tmpDir) {
            try { fs.rmSync(session.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
            session.tmpDir = null;
        }
        if (session.proc) {
            // Detach listeners; the process has already emitted exit by now.
            session.proc = null;
        }
    }

    _unregister(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        if (!session.proc) {
            // Only fully remove when no process remains (already exited).
            this._cleanupSession(session);
            if (session.state === STATES.DISPOSED) this.sessions.delete(id);
        }
    }

    _garbageCollect() {
        for (const [id, session] of this.sessions) {
            const procAlive = session.proc && (session.proc.exitCode === null) && (session.proc.signalCode === null);
            // VS Code: remoteAuthority transport alive check uses WebSocket.OPEN (1). `ws` lib keeps OPEN on constructor, not instance.
            // Use numeric 1 and fallback to instance.OPEN for mocks (tests use MockWS with static OPEN=1).
            const OPEN = 1;
            const transportAlive = session.transport
                && (session.transport.readyState === OPEN || session.transport.readyState === session.transport.OPEN);
            // Sessions that are EXITED/FAILED/DISPOSED with no process and no transport are stale.
            if (!procAlive && !transportAlive && (session.state === STATES.EXITED || session.state === STATES.FAILED || session.state === STATES.DISPOSED)) {
                this.sessions.delete(id);
            }
            // Sessions whose process disappeared but never sent an exit frame.
            if (session.proc && (session.proc.exitCode !== null || session.proc.signalCode !== null) &&
                session.state !== STATES.EXITED && session.state !== STATES.FAILED) {
                this._finishSession(session, session.proc.exitCode, session.proc.signalCode);
            }
        }
    }

    destroy() {
        clearInterval(this._gcTimer);
        for (const id of Array.from(this.sessions.keys())) {
            this.dispose(id);
        }
        this.sessions.clear();
    }

    activeCount() {
        return this.sessions.size;
    }
}

function idFor(session) {
    return session.id;
}

module.exports = { TerminalManager, STATES, getDefaultShell, getDefaultShellArgs, DEFAULT_SHELL };