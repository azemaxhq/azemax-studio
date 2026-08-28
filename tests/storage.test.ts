/**
 * Regression tests for persistence bounds + corruption resilience:
 *   - chatStorage: session/message caps, message truncation, malformed-entry
 *     dropping, sort order, quota-safe payload trimming
 *   - localStorageDebounce: write coalescing + same-value write suppression
 *   - performanceAlerts: alert cap + corrupted/malformed storage recovery
 *
 * Globals (localStorage) are installed BEFORE the modules are imported because
 * performanceAlerts runs loadAlerts() at module-evaluation time.
 *
 * Run with: npx tsx tests/storage.test.ts
 */
import { check, finish, makeLocalStorage } from './_harness';

const storage = makeLocalStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

const chat = await import('../src/utils/chatStorage');
const { flushLocalStorage, debouncedLocalStorageSet } = await import('../src/utils/localStorageDebounce');
const { PerformanceAlertManager } = await import('../src/utils/performanceAlerts');

const KEY = 'deepcontext-chat-sessions';

const makeMessage = (i: number, text = `msg-${i}`, role: 'user' | 'ai' = 'user') => ({
    id: `m-${i}`,
    role,
    text,
    timestamp: i,
});

const makeSession = (i: number, msgCount = 1) => ({
    id: `s-${i}`,
    title: `Session ${i}`,
    messages: Array.from({ length: msgCount }, (_, m) => makeMessage(i * 100 + m)),
    createdAt: i,
    updatedAt: i,
});

// ============================================================================
// chatStorage
// ============================================================================
{
    // Fresh empty storage.
    check('chat: empty storage -> []', chat.loadSessions().length === 0);

    // Malformed payloads must never crash.
    storage.setItem(KEY, 'not json at all');
    check('chat: invalid JSON -> []', chat.loadSessions().length === 0);
    storage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    check('chat: non-array payload -> []', chat.loadSessions().length === 0);

    // Mixed array with garbage entries -> only well-formed sessions survive.
    storage.setItem(KEY, JSON.stringify([
        makeSession(1),
        null,
        'string',
        42,
        { id: 2 }, // missing messages
        makeSession(2),
        { id: 's-bad', title: 'x', messages: [{ id: 'm', text: 'no role' }] },
    ]));
    const loaded = chat.loadSessions();
    check('chat: garbage entries dropped', loaded.length === 3);
    check('chat: session with invalid messages still bounded', loaded[2].id === 's-bad' && loaded[2].messages.length === 0);
    check('chat: sorted by updatedAt desc', loaded[0].id === 's-2' && loaded[1].id === 's-1');

    // Session cap: 60 sessions -> 50 kept, most recent first.
    const many = Array.from({ length: 60 }, (_, i) => makeSession(i));
    storage.setItem(KEY, JSON.stringify(many));
    const capped = chat.loadSessions();
    check('chat: MAX_SESSIONS=50 enforced on read', capped.length === 50);
    check('chat: newest kept', capped[0].id === 's-59');

    // Message count cap: 250 messages -> last 200 kept.
    const fat = makeSession(1, 250);
    storage.setItem(KEY, JSON.stringify([fat]));
    const msgCapped = chat.loadSessions()[0].messages;
    check('chat: MAX_MESSAGES_PER_SESSION=200 enforced', msgCapped.length === 200);

    // Message text truncation to 20000 chars.
    const long = makeSession(1);
    long.messages = [{ id: 'm-long', role: 'user', text: 'x'.repeat(25000), timestamp: 1 }];
    storage.setItem(KEY, JSON.stringify([long]));
    const trunc = chat.loadSessions()[0].messages[0].text;
    check('chat: MAX_MESSAGE_CHARS=20000 truncation', trunc.length === 20000);
}

{
    // saveSessions bounds + sorts + caps BEFORE persisting.
    const many = Array.from({ length: 60 }, (_, i) => makeSession(i));
    chat.saveSessions(many);
    flushLocalStorage();
    const persisted = JSON.parse(storage.getItem(KEY)!);
    check('chat: save caps to 50', persisted.length === 50);
    check('chat: save sorts newest first', persisted[0].id === 's-59');

    // Quota-safe trimming: payload over the cap must never be persisted whole.
    const huge = Array.from({ length: 50 }, (_, i) => {
        const s = makeSession(i);
        s.messages = [{ id: `h-${i}`, role: 'user', text: 'y'.repeat(20000), timestamp: i }];
        return s;
    });
    chat.saveSessions(huge);
    flushLocalStorage();
    const rawPayload = storage.getItem(KEY)!;
    const trimmed = JSON.parse(rawPayload);
    check('chat: oversized payload trimmed below cap', rawPayload.length <= 900 * 1024);
    check('chat: trimming keeps at least one session', Array.isArray(trimmed) && trimmed.length >= 1);
    check('chat: trimmed sessions remain valid', chat.loadSessions().length === trimmed.length);

    // In-memory array helpers stay consistent with persistence.
    const keep = chat.createSession();
    const [kept] = chat.updateSession([keep], keep);
    check('chat: updateSession round-trips', kept.id === keep.id);
}

// ============================================================================
// localStorageDebounce
// ============================================================================
{
    storage.clear();
    debouncedLocalStorageSet('k1', 'one', 1);
    debouncedLocalStorageSet('k1', 'two', 1);
    debouncedLocalStorageSet('k2', 'other', 1);
    flushLocalStorage();
    check('debounce: coalesces same key to last value', storage.getItem('k1') === 'two');
    check('debounce: writes distinct keys', storage.getItem('k2') === 'other');

    const before = storage.writes;
    debouncedLocalStorageSet('k1', 'two', 1); // identical to last write
    flushLocalStorage();
    check('debounce: identical value skipped', storage.writes === before);
}

// ============================================================================
// performanceAlerts
// ============================================================================
const validAlert = (i: number) => ({
    id: `a-${i}`,
    type: 'warning',
    severity: 'low',
    title: 'alert',
    message: 'm',
    timestamp: i,
    metrics: { current: 1, previous: 0, change: 1 },
    category: 'cpu',
});

{
    check('alerts: fresh load -> []', PerformanceAlertManager.getAlerts().length === 0);

    PerformanceAlertManager.addAlerts(Array.from({ length: 70 }, (_, i) => validAlert(i)));
    const alerts = PerformanceAlertManager.getAlerts();
    check('alerts: capped to 50', alerts.length === 50);
    check('alerts: newest retained', alerts[alerts.length - 1].id === 'a-69');

    // Corrupted payload -> []; severity counts must not crash.
    storage.setItem('performance_alerts', '"not-an-array"');
    PerformanceAlertManager.loadAlerts();
    check('alerts: non-array payload -> []', PerformanceAlertManager.getAlerts().length === 0);
    PerformanceAlertManager.addAlerts([validAlert(99)]);
    check('alerts: getAlertCount survives corruption', PerformanceAlertManager.getAlertCount().low === 1);
    PerformanceAlertManager.clearAlerts();

    // Malformed entries filtered, cap applied on load.
    storage.setItem('performance_alerts', JSON.stringify([validAlert(1), null, { bad: true }, validAlert(2), 'x']));
    PerformanceAlertManager.loadAlerts();
    const reloaded = PerformanceAlertManager.getAlerts();
    check('alerts: malformed entries dropped on load', reloaded.length === 2);

    // clearAlerts persists an empty list.
    PerformanceAlertManager.clearAlerts();
    check('alerts: clear', PerformanceAlertManager.getAlerts().length === 0 && storage.getItem('performance_alerts') === '[]');
}

finish('storage');
