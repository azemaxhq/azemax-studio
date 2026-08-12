import { getWebSocketUrl } from '../utils/apiClient';

/**
 * Frontend TerminalSessionController
 *
 * One instance per terminal tab. It is the single owner of:
 *   - the session identity + deterministic state machine
 *   - the WebSocket transport for that session
 *   - input/resize/signal/kill protocol frames
 *
 * It does NOT own React state. It owns a transport and a state string.
 * xterm owns terminal input/output rendering. React owns metadata/visibility.
 *
 * State machine:
 *   DISCONNECTED -> CONNECTING -> CONNECTED -> STARTING -> RUNNING | WAITING_FOR_INPUT
 *   RUNNING -> STOPPING -> EXITED | FAILED
 *   (never leaves RUNNING silently; the backend process lifecycle is authoritative)
 */
export type TermState =
    | 'DISCONNECTED'
    | 'CONNECTING'
    | 'CONNECTED'
    | 'STARTING'
    | 'RUNNING'
    | 'WAITING_FOR_INPUT'
    | 'STOPPING'
    | 'EXITED'
    | 'FAILED'
    | 'DISPOSED';

interface SessionMessage {
    type: string;
    sessionId?: string;
    data?: string;
    message?: string;
    code?: number | null;
    signal?: string | null;
    state?: TermState;
    interactive?: boolean;
}

export interface SessionListeners {
    onOutput: (data: string) => void;
    onState: (state: TermState) => void;
    onExit: (code: number | null, signal: string | null) => void;
    onStdinRequired: (interactive: boolean) => void;
    onError: (message: string) => void;
}

const CONNECT_TIMEOUT_MS = 8000;
const EXEC_TIMEOUT_MS = 60000;

export class TerminalSessionController {
    readonly id: string;
    state: TermState = 'DISCONNECTED';

    private ws: WebSocket | null = null;
    private listeners: SessionListeners;
    private connectTimer: ReturnType<typeof setTimeout> | null = null;
    private execTimer: ReturnType<typeof setTimeout> | null = null;
    private settled = false;
    private generation = 0;

    /** Whether a live PTY exists on the backend (false for remote/Wandbox). */
    private localPty = true;
    /** Remote-stdin collection: buffer keystrokes until Enter, then send once. */
    private dexStdinBuffering = false;
    private dexStdinBuf = '';

    // Execution capture for the performance analysis panel.
    private execStart = 0;
    private execStdout = '';
    private execStderr = '';

    readonly createdAt = Date.now();

    constructor(id: string, listeners: SessionListeners) {
        this.id = id;
        this.listeners = listeners;
    }

    get isActive(): boolean {
        return this.state === 'CONNECTING'
            || this.state === 'STARTING'
            || this.state === 'RUNNING'
            || this.state === 'WAITING_FOR_INPUT';
    }

    setListeners(listeners: SessionListeners) {
        this.listeners = listeners;
    }

    private setState(state: TermState) {
        this.state = state;
        this.listeners.onState(state);
    }

    // --- Program execution ----------------------------------------------------

    startCode(code: string, language: string, preStdin: string, cols: number, rows: number, cwd?: string) {
        // Fully detach any previous transport/timers. `settled` refers to the
        // current execution only: a reused controller must start clean.
        this.teardown();
        this.settled = false;

        this.setState('CONNECTING');
        this.execStart = Date.now();
        this.execStdout = '';
        this.execStderr = '';
        this.localPty = true;
        this.dexStdinBuffering = false;
        this.dexStdinBuf = '';

        const generation = ++this.generation;
        let ws: WebSocket;
        try {
            ws = new WebSocket(getWebSocketUrl());
        } catch (err) {
            this.setState('FAILED');
            this.listeners.onError(`Failed to open WebSocket: ${(err as Error).message}`);
            this.finish();
            return;
        }
        this.ws = ws;
        const current = () => this.ws === ws && this.generation === generation;

        this.connectTimer = setTimeout(() => {
            if (current() && ws.readyState !== WebSocket.OPEN) {
                this.listeners.onError('[error] Could not connect to the execution server. Is the backend running on port 3001?');
                this.setState('FAILED');
                this.finish();
            }
        }, CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
            if (!current()) return;
            if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
            ws.send(JSON.stringify({
                type: 'session.create',
                sessionId: this.id,
                kind: 'code',
                language,
                code,
                cwd: cwd || undefined,
                preStdin: preStdin || undefined,
                stdinInput: preStdin || '',
                cols,
                rows,
            }));
            // Backstop: if no exit arrives, kill + report instead of hanging.
            this.execTimer = setTimeout(() => {
                if (!current()) return;
                this.listeners.onError(`[error] Execution timed out after ${Math.round(EXEC_TIMEOUT_MS / 1000)}s.`);
                this.send({ type: 'session.kill', sessionId: this.id });
            }, EXEC_TIMEOUT_MS);
        };

        ws.onmessage = (msg) => {
            if (!current()) return; // stale socket must never affect the newer run
            this.handleMessage(msg);
        };
        ws.onerror = () => {
            if (!current()) return;
            // onclose handles final teardown; just surface for diagnostics.
            this.listeners.onError('WebSocket connection error.');
        };
        ws.onclose = () => {
            if (!current()) return;
            this.handleClose();
        };
    }

    private handleMessage(msg: MessageEvent) {
        let res: SessionMessage;
        try {
            res = JSON.parse(String(msg.data));
        } catch {
            return;
        }
        // Ignore frames that belong to another session (belt-and-braces isolation).
        if (res.sessionId && res.sessionId !== this.id) return;

        switch (res.type) {
            case 'terminal.output':
                if (!res.data) return;
                this.execStdout += res.data;
                this.listeners.onOutput(res.data);
                break;
            case 'terminal.stdout':
                if (res.data) { this.execStdout += res.data; this.listeners.onOutput(res.data); }
                break;
            case 'terminal.stderr':
                if (res.data) { this.execStderr += res.data; this.listeners.onOutput(res.data); }
                break;
            case 'terminal.error':
                if (res.message) { this.execStderr += res.message; this.listeners.onError(res.message); }
                break;
            case 'terminal.state':
                if (res.state) this.setState(res.state);
                break;
            case 'terminal.stdin_required':
                if (res.interactive === true) {
                    // Local PTY wait: keystrokes stream straight to the PTY, which
                    // echoes them. No local echo/buffering.
                    this.localPty = true;
                    this.dexStdinBuffering = false;
                    this.setState('WAITING_FOR_INPUT');
                    this.listeners.onStdinRequired(true);
                } else {
                    // Remote (Wandbox) execution: buffer a single line locally, then
                    // send it on Enter. The backend feeds it to the remote stdin.
                    this.localPty = false;
                    this.dexStdinBuffering = true;
                    this.dexStdinBuf = '';
                    this.setState('WAITING_FOR_INPUT');
                    this.listeners.onStdinRequired(false);
                }
                break;
            case 'terminal.ready':
                this.setState('CONNECTED');
                this.listeners.onState('STARTING');
                break;
            case 'terminal.exit':
                this.listeners.onExit(res.code ?? null, res.signal ?? null);
                this.setState(res.code === 0 ? 'EXITED' : 'FAILED');
                this.finish();
                break;
            default:
                break;
        }
    }

    private handleClose() {
        if (this.settled) return;
        // Unexpected disconnect before an exit frame: surface a terminal state
        // so the UI un-sticks (button returns to Run) instead of hanging.
        this.setState('FAILED'); // setState fires onState('FAILED') -> isRunning cleared
        this.finish();
    }

    private finish() {
        if (this.settled) return;
        this.settled = true;
        this.teardown();
    }

    private send(payload: Record<string, unknown>) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    /** Keystrokes from xterm.onData — never routed through React state. */
    sendInput(data: string) {
        if (this.dexStdinBuffering) {
            const code = data.charCodeAt(0);
            if (code === 13) { // Enter submits the collected line
                const line = this.dexStdinBuf + '\n';
                this.dexStdinBuf = '';
                this.dexStdinBuffering = false;
                this.localPty = false;
                this.send({ type: 'session.input', sessionId: this.id, data: line });
                return;
            }
            if (code === 3) { // Ctrl+C cancels
                this.dexStdinBuf = '';
                this.dexStdinBuffering = false;
                this.listeners.onOutput('^C\r\n');
                this.send({ type: 'session.kill', sessionId: this.id });
                return;
            }
            if (code === 127 || data === '\b') {
                if (this.dexStdinBuf.length > 0) {
                    this.dexStdinBuf = this.dexStdinBuf.slice(0, -1);
                    this.listeners.onOutput('\b \b');
                }
                return;
            }
            if (code >= 32 && code <= 126) {
                this.dexStdinBuf += data;
                this.listeners.onOutput(data);
            }
            return;
        }
        if (this.localPty) {
            // PTY echoes: just forward raw keystrokes.
            this.send({ type: 'session.input', sessionId: this.id, data });
        }
    }

    resize(cols: number, rows: number) {
        this.send({ type: 'session.resize', sessionId: this.id, cols, rows });
    }

    signal(sig: string) {
        this.send({ type: 'session.signal', sessionId: this.id, signal: sig });
    }

    stop() {
        if (!this.isActive) return;
        this.setState('STOPPING');
        this.send({ type: 'session.kill', sessionId: this.id });
    }

    dispose() {
        this.send({ type: 'session.dispose', sessionId: this.id });
        this.teardown();
        this.settled = true;
        this.setState('DISPOSED');
    }

    clearCapture() {
        this.execStdout = '';
        this.execStderr = '';
    }

    getPerformanceData() {
        return {
            executionTime: Date.now() - this.execStart,
            stdout: this.execStdout,
            stderr: this.execStderr,
        };
    }

    /** Remove a stale superseded session transport without side effects. */
    teardown() {
        if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
        if (this.execTimer) { clearTimeout(this.execTimer); this.execTimer = null; }
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            try { ws.close(); } catch { /* ignore */ }
        }
        this.dexStdinBuffering = false;
        this.dexStdinBuf = '';
    }
}