/**
 * Minimal shared test harness (no framework installed). Mirrors the style of
 * tests/safeTree.test.ts. Run each suite with: npx tsx tests/<file>.test.ts
 */
export let failed = 0;
export let total = 0;

export const check = (name: string, cond: boolean) => {
    total++;
    if (cond) {
        console.log(`ok: ${name}`);
    } else {
        failed++;
        console.error(`FAIL: ${name}`);
    }
};

export const finish = (label: string) => {
    console.log(failed === 0 ? `\n${label}: ALL PASS (${total})` : `\n${label}: ${failed}/${total} FAILURES`);
    // Under vitest, process.exit kills the worker and is reported as a suite
    // failure even when every assertion passed. Only exit in standalone mode.
    if (!process.env.VITEST) {
        process.exit(failed === 0 ? 0 : 1);
    }
};

/** In-memory localStorage stand-in (setItem/removeItem/getItem/key/length). */
export const makeLocalStorage = () => {
    const store = new Map<string, string>();
    let writes = 0;
    const storage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            store.set(k, String(v));
            writes++;
        },
        removeItem: (k: string) => {
            store.delete(k);
        },
        clear: () => {
            store.clear();
            writes = 0;
        },
        get writes() {
            return writes;
        },
        _store: store,
    };
    return storage;
};

export type LocalStorageMock = ReturnType<typeof makeLocalStorage>;

/** RequestAnimationFrame stub so AIStreamBuffer is testable under node. */
export const installRafStub = () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
        cb: FrameRequestCallback,
    ): number => {
        const id = ++nextId;
        callbacks.set(id, cb);
        return id;
    };
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number): void => {
        callbacks.delete(id);
    };
    return {
        /** Run all pending frames immediately. */
        tick: () => {
            const pending = [...callbacks.values()];
            callbacks.clear();
            for (const cb of pending) cb(0);
        },
        get pendingCount() {
            return callbacks.size;
        },
    };
};
