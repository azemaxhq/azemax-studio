// Defensive reads: Vite always provides import.meta.env, but server-side runs
// (tests, SSR tooling) may not — never crash on a missing env bag.
// In production VITE_API_URL should be an absolute URL like https://api.example.com/api
import { authHeaders } from './sessionToken';

export const API_BASE = (import.meta.env?.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
    status: number;
    details?: string;

    constructor(message: string, status: number, details?: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    // Bearer fallback: harmless when the httpOnly cookie is present (the
    // server accepts either credential); required when third-party cookies
    // are blocked on cross-site beta deploys. Never overrides an explicit
    // caller-provided Authorization header.
    let bearer: Record<string, string> = {};
    try {
        bearer = authHeaders();
    } catch {
        bearer = {};
    }
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...bearer,
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        // Session expired/revoked mid-use: bounce back to the login gate.
        // Guarded so background polling cannot loop the event.
        window.dispatchEvent(new CustomEvent('azemax:unauthorized'));
    }

    if (!response.ok) {
        let details: string | undefined;
        try {
            const body = await response.json();
            details = body.details || body.error;
        } catch {
            details = await response.text();
        }
        throw new ApiError(details || response.statusText, response.status, details);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

export function getWebSocketUrl(): string {
    // 1) Explicit override wins — EXCEPT a localhost override baked at build
    // time must never apply when the page is served from a public host
    // (stale .env in CI would otherwise point production WS at localhost).
    const override = import.meta.env?.VITE_WS_URL;
    if (override) {
        const clean = override.replace(/\/$/, '');
        const isLocalOverride = /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(clean);
        const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';
        if (!isLocalOverride || !pageHost || LOCALHOST_RE.test(pageHost)) {
            return clean;
        }
        // else: fall through to derivation from VITE_API_URL / page host
    }
    // 2) Derive from VITE_API_URL when it is absolute (production)
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    if (/^https?:\/\//i.test(apiUrl)) {
        try {
            const u = new URL(apiUrl);
            const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
            // Preserve host + port if present, drop /api path — WS is at root
            return `${wsProtocol}//${u.host}`;
        } catch {
            // fall through to hostname logic
        }
    }
    // 3) Development / relative API: use localhost + port
    const port = import.meta.env?.VITE_WS_PORT || '3001';
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = import.meta.env?.DEV
        ? 'localhost'
        : (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    return `${protocol}://${hostname}:${port}`;
}
