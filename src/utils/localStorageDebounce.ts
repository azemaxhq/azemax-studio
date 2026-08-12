// Coalesced localStorage writes: rapid state changes batch into a single
// synchronous write, so the main thread isn't blocked per keystroke/render.
// A flush-on-hide/unload guarantees no data is lost.

const pending = new Map<string, string>();
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export const flushLocalStorage = () => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    for (const key of queue) {
        const value = pending.get(key);
        if (value !== undefined) {
            try {
                localStorage.setItem(key, value);
            } catch {
                // Ignore quota / storage errors
            }
        }
    }
    pending.clear();
    queue.length = 0;
};

export const debouncedLocalStorageSet = (key: string, value: string, delay = 250) => {
    if (!pending.has(key)) queue.push(key);
    pending.set(key, value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushLocalStorage, delay);
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushLocalStorage);
    window.addEventListener('pagehide', flushLocalStorage);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushLocalStorage();
    });
}
