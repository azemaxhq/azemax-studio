const { TerminalManager, STATES, getDefaultShell, getDefaultShellArgs } = require('../services/terminal/terminalManager.cjs');
const { findUserByFirebaseUid, syncFirebaseUser, recordUsage } = require('../services/auth/authService.cjs');
const { verifyIdToken, isFirebaseConfigured } = require('../services/auth/firebaseAdmin.cjs');
const { CORS_LIST, LIMITS, ALLOW_SHELL } = require('../config/index.cjs');
const logger = require('../lib/logger.cjs');

// Terminal states after which the session id is safely reusable (process gone
// or being torn down). STOPPING is included so Run->Stop->Run works immediately:
// the dying session is disposed, never blocking the next execution.
const STATES_TERMINAL = [STATES.EXITED, STATES.FAILED, STATES.DISPOSED, STATES.STOPPING];

/**
 * Extract a Firebase ID token from the WS upgrade request.
 *
 * Browsers cannot set an Authorization header on `new WebSocket()`, so the
 * client passes its current Firebase ID token as `?token=`. The token is
 * verified with Firebase Admin below before any session is created.
 */
function tokenFromUpgrade(req) {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const q = url.searchParams.get('token');
        if (q) return q;
    } catch { /* ignore */ }
    return null;
}

function originAllowed(req) {
    const origin = req.headers && req.headers.origin;
    if (!origin) return true; // non-browser clients send no Origin; auth still required
    try {
        return CORS_LIST.includes(origin.trim());
    } catch {
        return false;
    }
}

function clientIp(req) {
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Verify the socket's Firebase ID token and resolve the application user. */
async function authenticateSocket(req) {
    const token = tokenFromUpgrade(req);
    if (!token || token.length > 8192 || !isFirebaseConfigured()) return null;
    let decoded;
    try {
        decoded = await verifyIdToken(token);
    } catch {
        return null;
    }
    if (!decoded || !decoded.uid) return null;

    let user = findUserByFirebaseUid(decoded.uid);
    const verificationChanged = Boolean(user) && Boolean(user.emailVerified) !== Boolean(decoded.email_verified);
    if ((!user || verificationChanged) && typeof decoded.email === 'string' && decoded.email) {
        try {
            user = syncFirebaseUser({
                uid: decoded.uid,
                email: decoded.email,
                displayName: decoded.name,
                photoUrl: decoded.picture,
                emailVerified: Boolean(decoded.email_verified),
                providerId: (decoded.firebase && decoded.firebase.sign_in_provider) || 'password',
            });
        } catch {
            user = null;
        }
    }
    return user;
}

/**
 * WebSocket transport layer for terminal sessions.
 *
 * Security model:
 *  - Authentication is MANDATORY: the handshake presents a Firebase ID token
 *    which is verified with Firebase Admin before any session exists.
 *  - A provider-verified email address is required.
 *  - When an Origin header is present it must be allowlisted (4403).
 *  - Every session records its owner's user id; ALL session operations verify
 *    ownership before touching the session (cross-user access impossible).
 *  - Session limits are three-tier: per-user, per-IP, global (all configurable).
 *  - Heartbeat (ping/pong) reaps dead sockets; idle sockets are closed.
 *  - maxPayload is set at server construction (see server/index.cjs).
 */
function attachExecutionWebSocket(wss) {
    const manager = new TerminalManager();
    // Keep a global reference so test harnesses can introspect sessions.
    if (global.__terminalManagerRefs) global.__terminalManagerRefs.push(manager);
    else global.__terminalManagerRefs = [manager];

    // ws re-emits the underlying http server's 'error' events on the
    // WebSocketServer. A listener must exist or that re-emit throws.
    wss.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') return;
        logger.error('ws server error', { message: err && err.message ? err.message : String(err) });
    });

    // Heartbeat + idle reaper (single interval for the whole server).
    const heartbeat = setInterval(() => {
        const now = Date.now();
        for (const ws of Array.from(wss.clients)) {
            if (ws.isAlive === false) {
                try { ws.terminate(); } catch { /* ignore */ }
                continue;
            }
            if (now - (ws.lastActivity || now) > LIMITS.WS_IDLE_TIMEOUT_MS) {
                try { ws.close(4408, 'Idle timeout'); } catch { /* ignore */ }
                continue;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch { /* ignore */ }
        }
    }, LIMITS.WS_HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();

    const countSessions = (predicate) => {
        let n = 0;
        for (const s of manager.sessions.values()) if (predicate(s)) n++;
        return n;
    };

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.lastActivity = Date.now();
        ws.on('pong', () => { ws.isAlive = true; ws.lastActivity = Date.now(); });

        if (!originAllowed(req)) {
            try { ws.close(4403, 'Forbidden origin'); } catch { /* ignore */ }
            return;
        }

        // Frames that arrive before async auth settles are buffered and replayed
        // once the socket is authenticated (avoids a handshake race that would
        // silently drop an early client message).
        const queuedFrames = [];
        const queueFrame = (message) => { queuedFrames.push(message); };
        ws.on('message', queueFrame);

        void (async () => {
            let user = null;
            try {
                user = await authenticateSocket(req);
            } catch {
                user = null;
            }
            if (!user) {
                try { ws.close(4401, 'Authentication required'); } catch { /* ignore */ }
                return;
            }
            if (!user.emailVerified) {
                try { ws.close(4403, 'Email verification required'); } catch { /* ignore */ }
                return;
            }

            ws.off('message', queueFrame);
            ws.user = user;
            runSessionProtocol(ws, req, user, queuedFrames);
        })().catch(() => {
            try { ws.close(1011, 'Authentication error'); } catch { /* ignore */ }
        });
    });

    /** Attach the full terminal-session protocol to an authenticated socket. */
    function runSessionProtocol(ws, req, user, queuedFrames) {
        const ip = clientIp(req);
        let legacySessionId = null;

        const sendRaw = (payload) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ sessionId: legacySessionId || payload.sessionId || null, ...payload }));
            }
        };

        /** Ownership check: session must exist AND belong to this socket's user. */
        const owns = (sessionId) => {
            const s = manager.getSession(sessionId);
            return Boolean(s && s.ownerId === user.id);
        };

        const handleMessage = async (message) => {
            ws.lastActivity = Date.now();
            if (message && message.length > LIMITS.WS_MAX_PAYLOAD) {
                sendRaw({ type: 'terminal.error', message: 'Message too large' });
                return;
            }
            let data;
            try {
                data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
            } catch {
                sendRaw({ type: 'terminal.error', message: 'Malformed message' });
                return;
            }

            try {
                // ---- Terminal session protocol ----
                if (data.type === 'session.create') {
                    // Three-tier caps: per-user, per-IP, global.
                    if (countSessions((s) => s.ownerId === user.id) >= LIMITS.WS_USER_MAX_SESSIONS) {
                        sendRaw({ type: 'terminal.error', message: `Session limit reached (${LIMITS.WS_USER_MAX_SESSIONS} per user). Close a terminal first.` });
                        return;
                    }
                    if (countSessions((s) => s.ownerIp === ip) >= LIMITS.WS_IP_MAX_SESSIONS) {
                        sendRaw({ type: 'terminal.error', message: 'Too many sessions from your network. Try again later.' });
                        return;
                    }
                    if (manager.sessions.size >= LIMITS.WS_GLOBAL_MAX_SESSIONS) {
                        sendRaw({ type: 'terminal.error', message: 'Server is busy. Try again shortly.' });
                        return;
                    }
                    const id = typeof data.sessionId === 'string' && data.sessionId.length <= 64
                        ? data.sessionId
                        : null;
                    const existing = id ? manager.getSession(id) : null;
                    if (existing) {
                        if (existing.ownerId !== user.id) {
                            sendRaw({ type: 'terminal.error', message: 'Session not found' });
                            return;
                        }
                        if (!STATES_TERMINAL.includes(existing.state)) {
                            sendRaw({ type: 'terminal.error', message: `Session ${id} still running` });
                            return;
                        }
                        // Same terminal re-running: dispose the finished session so
                        // the id can be reused without leaking its process/resources.
                        manager.dispose(existing.id);
                    }
                    const cols = Math.max(10, Math.min(500, Math.floor(Number(data.cols) || 80)));
                    const rows = Math.max(5, Math.min(200, Math.floor(Number(data.rows) || 30)));
                    const kind = data.kind === 'shell' ? 'shell' : 'code';
                    const session = manager.createSession(id, {
                        kind,
                        title: typeof data.title === 'string' ? data.title.slice(0, 120) : undefined,
                        language: typeof data.language === 'string' ? data.language.slice(0, 50) : undefined,
                        code: typeof data.code === 'string' ? data.code.slice(0, LIMITS.MAX_CODE_BYTES) : undefined,
                        cwd: typeof data.cwd === 'string' ? data.cwd.slice(0, 500) : undefined,
                        cols,
                        rows,
                        stdinInput: typeof data.stdinInput === 'string' ? data.stdinInput.slice(0, LIMITS.MAX_STDIN_BYTES) : '',
                        preStdin: typeof data.preStdin === 'string' ? data.preStdin.slice(0, LIMITS.MAX_STDIN_BYTES) : null,
                        ownerId: user.id,
                        ownerIp: ip,
                    });
                    legacySessionId = session.id;
                    manager.attachTransport(session.id, ws);
                    sendRaw({ sessionId: session.id, type: 'terminal.ready', state: session.state });

                    if (kind === 'shell') {
                        // Interactive shells are disabled in production by default
                        // (fail-closed): host shells cannot be safely isolated.
                        if (!ALLOW_SHELL) {
                            sendRaw({ sessionId: session.id, type: 'terminal.error', message: 'Interactive shell is unavailable in this environment. Code execution (Run) still works via sandboxed execution.\r\n' });
                            sendRaw({ sessionId: session.id, type: 'terminal.exit', code: 1, signal: null });
                            manager.dispose(session.id);
                            return;
                        }
                        manager.setState(session.id, STATES.STARTING);
                        const shell = getDefaultShell();
                        const shellArgs = getDefaultShellArgs(shell);
                        manager.spawnPty(session, shell, shellArgs);
                    } else if (kind === 'code') {
                        if (!session.language || !session.code) {
                            manager.setState(session.id, STATES.FAILED);
                            sendRaw({ sessionId: session.id, type: 'terminal.error', message: 'Language and code required\r\n' });
                            sendRaw({ sessionId: session.id, type: 'terminal.exit', code: 1, signal: null });
                            return;
                        }
                        recordUsage(user.id, { executions: 1 });
                        const stdinValue = data.stdinInput || data.preStdin || '';
                        await manager.executeCode(session, {
                            language: session.language,
                            code: session.code,
                            stdinInput: typeof stdinValue === 'string' ? stdinValue.slice(0, LIMITS.MAX_STDIN_BYTES) : '',
                            preStdin: null,
                            filename: typeof data.filename === 'string' ? data.filename.slice(0, 120) : null,
                        });
                    }
                    return;
                }

                if (data.type === 'session.input') {
                    const target = data.sessionId || legacySessionId;
                    if (target && owns(target)) manager.sendInput(target, typeof data.data === 'string' ? data.data.slice(0, 65536) : '');
                    return;
                }

                if (data.type === 'session.resize') {
                    const target = data.sessionId || legacySessionId;
                    if (target && owns(target)) manager.resize(target, data.cols, data.rows);
                    return;
                }

                if (data.type === 'session.signal') {
                    const target = data.sessionId || legacySessionId;
                    if (target && owns(target)) manager.signal(target, data.signal || 'SIGINT');
                    return;
                }

                if (data.type === 'session.kill') {
                    const target = data.sessionId || legacySessionId;
                    if (target && owns(target)) manager.kill(target);
                    return;
                }

                if (data.type === 'session.dispose') {
                    const target = data.sessionId || legacySessionId;
                    if (target && owns(target)) manager.dispose(target);
                    return;
                }

                // ---- Legacy protocol (backward compatible) ----
                if (data.action === 'kill') {
                    if (legacySessionId && owns(legacySessionId)) manager.kill(legacySessionId);
                    return;
                }

                if (data.action === 'input' || data.action === 'terminal:data') {
                    if (legacySessionId && owns(legacySessionId)) manager.sendInput(legacySessionId, typeof data.data === 'string' ? data.data.slice(0, 65536) : '');
                    return;
                }

                if (data.action === 'stdin-ready') {
                    if (legacySessionId && owns(legacySessionId)) manager.sendInput(legacySessionId, String(data.data || '').replace(/\r/g, '\n').slice(0, 65536));
                    return;
                }

                if (data.action === 'execute') {
                    if (countSessions((s) => s.ownerId === user.id) >= LIMITS.WS_USER_MAX_SESSIONS) {
                        sendRaw({ type: 'terminal.error', message: `Session limit reached (${LIMITS.WS_USER_MAX_SESSIONS} per user). Close a terminal first.` });
                        return;
                    }
                    // Legacy run path: auto-create a code session scoped to this socket.
                    const { language, files, stdinInput } = data;
                    if (typeof language !== 'string' || !files?.length) {
                        sendRaw({ type: 'terminal.error', message: 'Language and files required\r\n' });
                        sendRaw({ type: 'terminal.exit', code: 1, signal: null });
                        return;
                    }
                    const code = String(files[0].content || '').slice(0, LIMITS.MAX_CODE_BYTES);
                    const legacyFilename = typeof files[0].name === 'string' ? files[0].name.slice(0, 120) : (typeof data.filename === 'string' ? data.filename.slice(0, 120) : null);
                    const id = Math.random().toString(36).substring(2, 10);
                    const session = manager.createSession(id, {
                        kind: 'code',
                        language: language.slice(0, 50),
                        code,
                        stdinInput: typeof stdinInput === 'string' ? stdinInput.slice(0, LIMITS.MAX_STDIN_BYTES) : '',
                        preStdin: typeof stdinInput === 'string' ? stdinInput.slice(0, LIMITS.MAX_STDIN_BYTES) : null,
                        ownerId: user.id,
                        ownerIp: ip,
                    });
                    legacySessionId = id;
                    manager.attachTransport(id, ws);
                    recordUsage(user.id, { executions: 1 });
                    sendRaw({ sessionId: id, type: 'terminal.ready', state: session.state });
                    await manager.executeCode(session, {
                        language: session.language,
                        code,
                        stdinInput: session.code ? (typeof stdinInput === 'string' ? stdinInput.slice(0, LIMITS.MAX_STDIN_BYTES) : '') : '',
                        preStdin: typeof stdinInput === 'string' ? stdinInput.slice(0, LIMITS.MAX_STDIN_BYTES) : null,
                        filename: legacyFilename,
                    });
                    return;
                }
            } catch (err) {
                logger.error('ws message error', { userId: user.id, message: err && err.message });
                sendRaw({ type: 'terminal.error', message: 'Request failed' });
            }
        };

        ws.on('message', (message) => { void handleMessage(message); });

        const terminateAllForSocket = () => {
            // Disconnect policy: terminate every session attached to this socket so
            // processes are never orphaned. Sessions are single-transport.
            // Only our own sessions are touched (ownership was set at creation).
            for (const session of Array.from(manager.sessions.values())) {
                if (session.transport === ws && session.ownerId === user.id) {
                    manager.kill(session.id);
                    manager.dispose(session.id);
                }
            }
        };

        ws.on('close', () => {
            terminateAllForSocket();
        });

        ws.on('error', (err) => {
            logger.error('ws connection error', { userId: user.id, message: err && err.message });
            // Socket may not emit 'close' after an error; terminate its sessions
            // so child processes are never orphaned.
            terminateAllForSocket();
        });

        // Replay any frames that raced ahead of authentication.
        for (const queued of queuedFrames) void handleMessage(queued);
        queuedFrames.length = 0;
    }

    return manager;
}

module.exports = { attachExecutionWebSocket };
