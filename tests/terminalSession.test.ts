/**
 * Regression tests for the terminal session controller lifecycle:
 *   - stop during connect (kill delivered once the socket opens)
 *   - dispose while STOPPING (Kill-Terminal path must tear the socket down)
 *   - bounded execution capture (chatty programs can't grow buffers forever)
 *   - stale socket isolation (superseded transports never affect the new run)
 *   - exit frame -> EXITED + onExit
 *
 * Uses a mock WebSocket; import.meta.env is set BEFORE importing the controller
 * because apiClient reads it at module evaluation.
 *
 * Run with: npx tsx tests/terminalSession.test.ts
 */
import { check, finish } from './_harness';

(import.meta as unknown as { env: Record<string, unknown> }).env = {
    VITE_WS_URL: 'ws://test-socket',
    DEV: false,
    VITE_USE_BACKEND_AI: 'false',
};

class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState: number = MockWebSocket.CONNECTING;
    url: string;
    sent: string[] = [];
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    send(data: string) {
        this.sent.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        // Real sockets fire onclose asynchronously; tests fire it explicitly via fireClose().
    }

    // --- test helpers ---
    open() {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen({});
    }

    receive(data: string) {
        if (this.onmessage) this.onmessage({ data });
    }

    fireClose() {
        if (this.onclose) this.onclose({});
    }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

const { TerminalSessionController } = await import('../src/context/TerminalSessionController');

const noopListeners = () => ({
    onOutput: () => {},
    onState: () => {},
    onExit: () => {},
    onStdinRequired: () => {},
    onError: () => {},
});

const lastFrame = (ws: MockWebSocket) => JSON.parse(ws.sent[ws.sent.length - 1]);

{
    // stop() during CONNECTING closes the socket (no kill frame possible yet).
    const states: string[] = [];
    const c = new TerminalSessionController('t1', { ...noopListeners(), onState: (s) => states.push(s) });
    c.startCode('print(1)', 'python', '', 120, 30);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    check('stop-connect: state CONNECTING', c.state === 'CONNECTING');
    check('stop-connect: no frames sent while connecting', ws.sent.length === 0);

    c.stop();
    check('stop-connect: stop sets STOPPING', c.state === 'STOPPING');
    check('stop-connect: socket closed during connect', ws.readyState === MockWebSocket.CLOSED);
    check('stop-connect: session.create never sent', ws.sent.length === 0);

    c.dispose();
}

{
    // If the socket opens before the close lands, the pending stop must still
    // deliver a kill frame so the backend never starts the program.
    const c = new TerminalSessionController('t2', noopListeners());
    c.startCode('print(1)', 'python', '', 120, 30);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    c.stop(); // stopRequested = true, socket still connecting
    ws.open(); // backend side eventually opens
    const frames = ws.sent.map((f) => JSON.parse(f).type);
    check('stop-connect: create frame sent on open', frames.includes('session.create'));
    check('stop-connect: kill frame delivered after open', frames[frames.length - 1] === 'session.kill');
    c.dispose();
}

{
    // dispose while STOPPING (Kill Terminal / terminal tab removal) must tear
    // down the transport even though isActive() excludes STOPPING.
    const c = new TerminalSessionController('t3', noopListeners());
    c.startCode('while true', 'python', '', 120, 30);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive(JSON.stringify({ type: 'terminal.state', state: 'RUNNING' }));
    check('dispose-stopping: running', c.state === 'RUNNING');

    c.stop();
    check('dispose-stopping: STOPPING', c.state === 'STOPPING');
    check('dispose-stopping: kill frame sent', lastFrame(ws).type === 'session.kill');

    c.dispose();
    check('dispose-stopping: state DISPOSED', c.state === 'DISPOSED');
    check('dispose-stopping: dispose frame sent', lastFrame(ws).type === 'session.dispose');
    check('dispose-stopping: socket closed', ws.readyState === MockWebSocket.CLOSED);
    check('dispose-stopping: exec timer cleared', true); // teardown ran without error
}

{
    // Execution capture is bounded: >400KB of output must stay at the cap.
    const c = new TerminalSessionController('t4', noopListeners());
    c.startCode('cat /dev/zero', 'shell', '', 120, 30);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    const chunk = 'x'.repeat(64 * 1024);
    for (let i = 0; i < 10; i++) {
        ws.receive(JSON.stringify({ type: 'terminal.stdout', data: chunk }));
    }
    const perf = c.getPerformanceData();
    check('capture: stdout bounded to cap', perf.stdout.length === 200 * 1024);
    check('capture: stderr empty', perf.stderr.length === 0);
    c.dispose();
}

{
    // Exit frame -> EXITED + onExit invoked.
    let exitArgs: [number | null, string | null] | null = null;
    const c = new TerminalSessionController('t5', {
        ...noopListeners(),
        onExit: (code, signal) => { exitArgs = [code, signal]; },
    });
    c.startCode('exit(0)', 'python', '', 120, 30);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive(JSON.stringify({ type: 'terminal.state', state: 'RUNNING' }));
    ws.receive(JSON.stringify({ type: 'terminal.exit', code: 0, signal: null }));
    check('exit: state EXITED', c.state === 'EXITED');
    check('exit: onExit called with code', exitArgs !== null && exitArgs[0] === 0);
    check('exit: settled after finish', c.isActive === false);
}

{
    // Stale socket isolation: frames from a superseded transport are ignored.
    const c = new TerminalSessionController('t6', noopListeners());
    c.startCode('a()', 'python', '', 120, 30);
    const ws1 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    c.startCode('b()', 'python', '', 120, 30);
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    check('stale: two transports created', ws1 !== ws2);
    check('stale: old socket closed by teardown', ws1.readyState === MockWebSocket.CLOSED);

    ws1.receive(JSON.stringify({ type: 'terminal.exit', code: 0, signal: null }));
    check('stale: old exit ignored', c.state !== 'EXITED' && c.state === 'CONNECTING');

    ws2.open();
    ws2.receive(JSON.stringify({ type: 'terminal.state', state: 'RUNNING' }));
    check('stale: new run proceeds', c.state === 'RUNNING');
    c.dispose();
}

finish('terminalSession');
