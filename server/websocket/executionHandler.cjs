const { TerminalManager, STATES, getDefaultShell, getDefaultShellArgs } = require('../services/terminal/terminalManager.cjs');

// Terminal states after which the session id is safely reusable (process gone
// or being torn down). STOPPING is included so Run->Stop->Run works immediately:
// the dying session is disposed, never blocking the next execution.
const STATES_TERMINAL = [STATES.EXITED, STATES.FAILED, STATES.DISPOSED, STATES.STOPPING];

/**
 * WebSocket transport layer for terminal sessions.
 *
 * The WebSocket is a pure TRANSPORT: it carries protocol frames for the
 * TerminalManager, which owns every process. No process lifecycle logic
 * lives in this file beyond routing + disconnect policy.
 *
 * Protocol (frontend -> backend):
 *   { type: "session.create", sessionId, kind, language?, code?, cwd?, cols, rows, stdinInput?, preStdin? }
 *   { type: "session.input",  sessionId, data }
 *   { type: "session.resize", sessionId, cols, rows }
 *   { type: "session.signal", sessionId, signal }
 *   { type: "session.kill",   sessionId }
 *   { type: "session.dispose", sessionId }
 *
 * Backend -> frontend:
 *   { type: "terminal.ready", sessionId, state }
 *   { type: "terminal.output", sessionId, data }
 *   { type: "terminal.error",  sessionId, message }
 *   { type: "terminal.exit",   sessionId, code, signal }
 *   { type: "terminal.state",  sessionId, state }
 *   { type: "terminal.stdin_required", sessionId }
 *
 * Legacy compatibility (kept): { action: "execute" | "input" | "kill" | "stdin-ready" }
 */
function attachExecutionWebSocket(wss) {
    const manager = new TerminalManager();
    // Keep a global reference so test harnesses can introspect sessions.
    if (global.__terminalManagerRefs) global.__terminalManagerRefs.push(manager);
    else global.__terminalManagerRefs = [manager];

    // ws re-emits the underlying http server's 'error' events on the
    // WebSocketServer (see websocket-server.js addListeners). A listener must
    // exist or that re-emit throws, which would skip later error listeners on
    // the http server (e.g. listenWithRetry's EADDRINUSE handling) and surface
    // as an uncaughtException.
    wss.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') return;
        console.error('[ws] WebSocket server error:', err && err.message ? err.message : err);
    });

    wss.on('connection', (ws, _req) => {
        // Session ID bound to this socket for legacy execute actions.
        let legacySessionId = null;

        const sendRaw = (payload) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ sessionId: legacySessionId || payload.sessionId || null, ...payload }));
            }
        };

        ws.on('message', async (message) => {
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
                    const id = data.sessionId;
                    const existing = manager.getSession(id);
                    if (existing && !STATES_TERMINAL.includes(existing.state)) {
                        sendRaw({ type: 'terminal.error', message: `Session ${id} still running` });
                        return;
                    }
                    if (existing) {
                        // Same terminal re-running: dispose the finished session so
                        // the id can be reused without leaking its process/resources.
                        manager.dispose(existing.id);
                    }
                    const session = manager.createSession(id, {
                        kind: data.kind || 'code',
                        title: data.title,
                        language: data.language,
                        code: data.code,
                        cwd: data.cwd,
                        cols: data.cols || 80,
                        rows: data.rows || 30,
                        stdinInput: data.stdinInput || '',
                        preStdin: data.preStdin || null,
                    });
                    legacySessionId = id;
                    manager.attachTransport(id, ws);
                    sendRaw({ sessionId: id, type: 'terminal.ready', state: session.state });

                    if (data.kind === 'shell') {
                        // Interactive shell is disabled in production by default (ephemeral free host).
                        // Set ALLOW_SHELL=true to re-enable if your host supports persistent PTY.
                        const isProdShell = process.env.NODE_ENV === 'production';
                        const allowShell = process.env.ALLOW_SHELL === 'true' || (process.env.ALLOW_SHELL !== 'false' && !isProdShell);
                        if (!allowShell) {
                            sendRaw({ sessionId: id, type: 'terminal.error', message: 'Interactive shell is unavailable in this beta environment. Code execution (Run) still works via sandboxed execution.\r\n' });
                            sendRaw({ sessionId: id, type: 'terminal.exit', code: 1, signal: null });
                            manager.dispose(id);
                            return;
                        }
                        manager.setState(id, STATES.STARTING);
                        // VS Code: ITerminalProfileService.getDefaultProfile per OS, not hard-coded '/bin/zsh'
                        const shell = getDefaultShell();
                        const shellArgs = getDefaultShellArgs(shell);
                        manager.spawnPty(session, shell, shellArgs);
                    } else if (data.kind === 'code') {
                        if (!data.language || !data.code) {
                            manager.setState(id, STATES.FAILED);
                            sendRaw({ sessionId: id, type: 'terminal.error', message: 'Language and code required\r\n' });
                            sendRaw({ sessionId: id, type: 'terminal.exit', code: 1, signal: null });
                            return;
                        }
                        const stdinValue = data.stdinInput || data.preStdin || '';
                        await manager.executeCode(session, {
                            language: data.language,
                            code: data.code,
                            stdinInput: stdinValue,
                            preStdin: data.preStdin || null,
                            filename: data.filename || null,
                        });
                    }
                    return;
                }

                if (data.type === 'session.input') {
                    if (data.sessionId) manager.sendInput(data.sessionId, data.data);
                    else if (legacySessionId) manager.sendInput(legacySessionId, data.data);
                    return;
                }

                if (data.type === 'session.resize') {
                    if (data.sessionId) manager.resize(data.sessionId, data.cols, data.rows);
                    else if (legacySessionId) manager.resize(legacySessionId, data.cols, data.rows);
                    return;
                }

                if (data.type === 'session.signal') {
                    const target = data.sessionId || legacySessionId;
                    if (target) manager.signal(target, data.signal || 'SIGINT');
                    return;
                }

                if (data.type === 'session.kill') {
                    const target = data.sessionId || legacySessionId;
                    if (target) manager.kill(target);
                    return;
                }

                if (data.type === 'session.dispose') {
                    const target = data.sessionId || legacySessionId;
                    if (target) manager.dispose(target);
                    return;
                }

                // ---- Legacy protocol (backward compatible) ----
                if (data.action === 'kill') {
                    if (legacySessionId) manager.kill(legacySessionId);
                    return;
                }

                if (data.action === 'input' || data.action === 'terminal:data') {
                    if (legacySessionId) manager.sendInput(legacySessionId, data.data);
                    return;
                }

                if (data.action === 'stdin-ready') {
                    // Legacy: provide stdin to the running session.
                    if (legacySessionId) manager.sendInput(legacySessionId, (data.data || '').replace(/\r/g, '\n'));
                    return;
                }

                if (data.action === 'execute') {
                    // Legacy run path: auto-create a code session scoped to this socket.
                    const { language, files, stdinInput } = data;
                    if (!language || !files?.length) {
                        sendRaw({ type: 'terminal.error', message: 'Language and files required\r\n' });
                        sendRaw({ type: 'terminal.exit', code: 1, signal: null });
                        return;
                    }
                    const code = files[0].content || '';
                    const legacyFilename = files[0].name || data.filename || null;
                    const id = Math.random().toString(36).substring(2, 10);
                    const session = manager.createSession(id, {
                        kind: 'code',
                        language: data.language,
                        code,
                        stdinInput: stdinInput || '',
                        preStdin: stdinInput || null,
                    });
                    legacySessionId = id;
                    manager.attachTransport(id, ws);
                    sendRaw({ sessionId: id, type: 'terminal.ready', state: session.state });
                    await manager.executeCode(session, {
                        language: data.language,
                        code,
                        stdinInput: stdinInput || '',
                        preStdin: stdinInput || null,
                        filename: legacyFilename,
                    });
                    return;
                }
            } catch (err) {
                console.error('[WS] message error:', err);
                sendRaw({ type: 'terminal.error', message: err.message });
            }
        });

        const terminateAllForSocket = () => {
            // Disconnect policy: terminate every session attached to this socket so
            // processes are never orphanged. Sessions are single-transport.
            for (const session of Array.from(manager.sessions.values())) {
                if (session.transport === ws) {
                    manager.kill(session.id);
                    manager.dispose(session.id);
                }
            }
        };

        ws.on('close', () => {
            terminateAllForSocket();
        });

        ws.on('error', (err) => {
            console.error('WebSocket connection error:', err);
            // Socket may not emit 'close' after an error; terminate its sessions
            // so child processes are never orphaned.
            terminateAllForSocket();
        });
    });

    // Return the manager so the entrypoint can terminate live terminal
    // sessions/PTYs during graceful shutdown. The manager remains per-WebSocket-
    // server; this is an additive return, not a behavioral change.
    return manager;
}

module.exports = { attachExecutionWebSocket };