// Coalesced localStorage writes: rapid state changes batch into a single
// write at idle time, so the main thread isn't blocked per keystroke/render.
// A flush-on-hide/unload guarantees no data is lost, and identical values
// (same serialized string as the last actual write) are skipped entirely.

const pending = new Map<string, string>();
const lastWritten = new Map<string, string>();
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let idleHandle: number | ReturnType<typeof setTimeout> | null = null;

const writePending = () => {
    timer = null;
    idleHandle = null;
    for (const key of queue) {
        const value = pending.get(key);
        if (value !== undefined && value !== lastWritten.get(key)) {
            try {
                localStorage.setItem(key, value);
                lastWritten.set(key, value);
            } catch {
                // Ignore quota / storage errors
            }
        }
    }
    pending.clear();
    queue.length = 0;
};

export const flushLocalStorage = () => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (typeof idleHandle === 'number' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleHandle);
    }
    idleHandle = null;
    writePending();
};

const scheduleWrite = () => {
    if (timer) clearTimeout(timer);
    // Defer the actual write to idle time so a burst of changes coalesces into
    // a single main-thread pass; fall back to a timeout if rIC is unavailable.
    timer = setTimeout(() => {
        timer = null;
        if (typeof requestIdleCallback === 'function') {
            idleHandle = requestIdleCallback(writePending, { timeout: 100 });
        } else {
            idleHandle = setTimeout(writePending, 0);
        }
    }, 0);
};

export const debouncedLocalStorageSet = (key: string, value: string, delay = 0) => {
    if (!pending.has(key)) queue.push(key);
    pending.set(key, value);
    if (timer) clearTimeout(timer);
    if (delay === 0) scheduleWrite();
    else timer = setTimeout(scheduleWrite, delay);
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushLocalStorage);
    window.addEventListener('pagehide', flushLocalStorage);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushLocalStorage();
    });
}
