/**
 * Background backend wake-up for cold-start tolerance (e.g. Render free tier).
 *
 * The editor fires ONE lightweight, non-blocking GET to the existing public
 * liveness endpoint when the application initializes, so a sleeping backend
 * starts booting before the user makes their first AI request.
 *
 * Guarantees:
 * - Single attempt per page load: concurrent callers share one in-flight
 *   promise, and no retry loop / polling / keep-alive is ever scheduled.
 * - Never touches an AI provider and never sends credentials, API keys, or
 *   request bodies — a bare GET with no auth headers.
 * - Never throws: network errors, timeouts (AbortController), and non-2xx
 *   responses all resolve `false` and move to `unavailable` silently. The UI
 *   deliberately shows NO error for these — a cold start looks identical to
 *   a failure, and must not alarm the user.
 * - Existing AI transport (`AIClient`) is untouched: no replay, no fallback
 *   interference, no cancellation changes.
 */
import { API_BASE } from './apiClient';

export type BackendHealthStatus = 'idle' | 'connecting' | 'ready' | 'unavailable';

/** Bounded wait for a cold backend to answer; the boot continues server-side
 *  even if the browser gives up waiting (no retry — the first AI request will
 *  simply take the warm-up path as before). */
export const BACKEND_HEALTH_TIMEOUT_MS = 30_000;

/**
 * Joins the configured API base with the liveness path without duplicating
 * `/api`: the standard config already ends in `/api` (e.g.
 * `https://azemax-api.onrender.com/api` or relative `/api`), in which case
 * only `/health` is appended; a bare origin gets `/api/health`.
 */
export function buildHealthUrl(apiBase: string): string {
    const base = (apiBase || '/api').replace(/\/$/, '');
    if (/\/api$/i.test(base)) {
        return `${base}/health`;
    }
    return `${base}/api/health`;
}

/** Health URL derived from the app's configured backend base URL. */
export function getHealthUrl(): string {
    return buildHealthUrl(API_BASE);
}

type HealthListener = () => void;

let status: BackendHealthStatus = 'idle';
const listeners = new Set<HealthListener>();
let inFlight: Promise<boolean> | null = null;
let settled: Promise<boolean> | null = null;

function setStatus(next: BackendHealthStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch {
            // A throwing subscriber must never break the wake-up path.
        }
    }
}

export function subscribeBackendHealth(listener: HealthListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getBackendHealthSnapshot(): BackendHealthStatus {
    return status;
}

export interface BackendWakeOptions {
    /** Override for tests; production uses BACKEND_HEALTH_TIMEOUT_MS. */
    timeoutMs?: number;
}

/**
 * Starts (or joins) the single background health request. Safe to call from
 * any number of components/effects — re-renders and StrictMode remounts
 * share the same promise and never issue extra requests.
 */
export function wakeBackend(options: BackendWakeOptions = {}): Promise<boolean> {
    if (inFlight) return inFlight;
    if (settled) return settled;

    const timeoutMs = options.timeoutMs ?? BACKEND_HEALTH_TIMEOUT_MS;
    setStatus('connecting');

    const attempt = (async (): Promise<boolean> => {
        if (typeof fetch !== 'function') {
            setStatus('unavailable');
            return false;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(getHealthUrl(), {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            const ok = !!response && response.ok === true;
            setStatus(ok ? 'ready' : 'unavailable');
            return ok;
        } catch {
            // Network failure, timeout, or abort while the backend boots.
            // Silent by design: never surface a backend error for a cold start.
            setStatus('unavailable');
            return false;
        } finally {
            clearTimeout(timer);
        }
    })();

    inFlight = attempt;
    // Cache the outcome: exactly one attempt per page load, no retries.
    settled = attempt.then(
        (result) => {
            inFlight = null;
            return result;
        },
        () => {
            // Unreachable (attempt never rejects), kept for total safety.
            inFlight = null;
            return false;
        },
    );
    return inFlight;
}

/** Test-only reset for the page-load singleton (isolates test cases). */
export function __resetBackendHealthForTests(): void {
    status = 'idle';
    inFlight = null;
    settled = null;
}
