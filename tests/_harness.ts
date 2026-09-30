/**
 * Shared test harness — works standalone AND under vitest.
 *
 * Standalone: `npx tsx tests/<file>.test.ts` prints ok/FAIL lines and exits
 * non-zero on failure (tsx resolves the vitest import harmlessly; it is only
 * *called* when VITEST is set).
 *
 * Under vitest (`npm test`): every check() registers a real `it()` test, so
 * failures fail the suite instead of hiding in console output.
 */
import { it as vitestIt, expect as vitestExpect } from 'vitest';

const IN_VITEST = !!process.env.VITEST;

export let failed = 0;
export let total = 0;

export const check = (name: string, cond: boolean) => {
    total++;
    if (IN_VITEST) {
        vitestIt(name, () => vitestExpect(cond).toBe(true));
        if (!cond) failed++;
        return;
    }
    if (cond) {
        console.log(`ok: ${name}`);
    } else {
        failed++;
        console.error(`FAIL: ${name}`);
    }
};

export const finish = (label: string) => {
    if (!IN_VITEST) {
        console.log(failed === 0 ? `\n${label}: ALL PASS (${total})` : `\n${label}: ${failed}/${total} FAILURES`);
    }
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
        callbacks,
        flush: (time = 0) => {
            for (const [, cb] of Array.from(callbacks)) cb(time);
            callbacks.clear();
        },
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
