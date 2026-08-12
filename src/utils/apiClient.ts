export const API_BASE = import.meta.env.VITE_API_URL || '/api';

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
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

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

export function getWebSocketUrl(): string {
    if (import.meta.env.VITE_WS_URL) {
        return import.meta.env.VITE_WS_URL;
    }
    const port = import.meta.env.VITE_WS_PORT || '3001';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // In development, always use localhost since backend runs on same machine.
    // window.location.hostname can be a network IP (e.g., 172.20.10.8) which the backend may not bind to.
    const hostname = import.meta.env.DEV ? 'localhost' : window.location.hostname;
    return `${protocol}://${hostname}:${port}`;
}
