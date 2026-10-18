

import { debouncedLocalStorageSet } from './localStorageDebounce';
import { nsGetItem, nsSetItem, nsRemoveItem, namespacedKey } from './userStorage';

export interface Message {
    id: string;
    role: 'user' | 'ai';
    text: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
}

/** Deletion marker so a conversation removed on one device is not resurrected
 *  by the union merge from another device that still has the old copy. */
export interface ChatTombstone {
    id: string;
    deletedAt: number;
}

const STORAGE_KEY = 'azemax-chat-sessions';
const LEGACY_STORAGE_KEY = 'deepcontext-chat-sessions';
const CURRENT_SESSION_KEY = 'azemax-current-session-id';
const LEGACY_CURRENT_SESSION_KEY = 'deepcontext-current-session-id';
const TOMBSTONES_KEY = 'azemax-chat-tombstones';
const CLEARED_AT_KEY = 'azemax-chat-cleared-at';
const MAX_TOMBSTONES = 500;

// Hard bounds so persistence can never grow without limit (each save would
// otherwise re-serialize the entire history on every message).
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_MESSAGE_CHARS = 20000;
// ~900KB cap keeps the serialized payload comfortably inside the localStorage
// quota even when text is near the per-message limit.
const MAX_SESSION_PAYLOAD_CHARS = 900 * 1024;

// Helper to generate IDs if uuid is not available or for simplicity
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

/**
 * Validate + bound a single untrusted session/message record. Malformed entries
 * are dropped; valid ones are truncated to the caps. Structural sharing is
 * preserved (only new arrays are allocated where fields actually change).
 */
const normalizeSession = (raw: unknown): ChatSession | null => {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string') return null;
    if (!Array.isArray(s.messages)) return null;

    const messages: Message[] = [];
    for (const rawMsg of s.messages.slice(-MAX_MESSAGES_PER_SESSION)) {
        if (!rawMsg || typeof rawMsg !== 'object') continue;
        const m = rawMsg as Record<string, unknown>;
        if (typeof m.id !== 'string' || typeof m.text !== 'string') continue;
        if (m.role !== 'user' && m.role !== 'ai') continue;
        const msg: Message = {
            id: m.id,
            role: m.role,
            text: m.text.slice(0, MAX_MESSAGE_CHARS),
            timestamp: typeof m.timestamp === 'number' ? m.timestamp : 0,
        };
        // Deduplicate consecutive identical messages within 1.5s (rapid double-send)
        const prev = messages[messages.length - 1];
        if (prev && prev.role === msg.role && prev.text === msg.text && Math.abs(msg.timestamp - prev.timestamp) < 1500) {
            continue;
        }
        messages.push(msg);
    }

    return {
        id: s.id,
        title: typeof s.title === 'string' ? s.title.slice(0, 200) : 'New Chat',
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
        messages,
    };
};

export const loadSessions = (): ChatSession[] => {
    try {
        const saved = nsGetItem(STORAGE_KEY, [LEGACY_STORAGE_KEY]);
        if (saved) {
            const sessions = JSON.parse(saved);
            // Defensive: the stored data is untrusted. Keep only well-formed
            // sessions so malformed/corrupt storage can never crash the panel,
            // and bound the history so a giant payload is trimmed on read too.
            if (Array.isArray(sessions)) {
                return sanitizeSessions(sessions);
            }
        }
    } catch (e) {
        console.warn('Failed to load chat sessions:', e);
    }
    return [];
};

/** Validate + bound an untrusted list of chat sessions (storage or server). */
export const sanitizeSessions = (sessions: unknown): ChatSession[] => {
    if (!Array.isArray(sessions)) return [];
    return sessions
        .map(normalizeSession)
        .filter((s): s is ChatSession => s !== null)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_SESSIONS);
};

/** Validate an untrusted "history cleared at" marker. */
export const sanitizeChatsClearedAt = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
    return Math.floor(value);
};

/**
 * Union two device histories by session id, keeping the newer copy of each
 * conversation. Used by account sync so signing in on a second device never
 * discards conversations that only exist there. Deletion tombstones remove
 * sessions that are not newer than the deletion marker; a `clearedAt` marker
 * removes every session older than a "clear all chats" action, including
 * conversations this device never saw. Sessions created after the clear have a
 * newer `updatedAt` and survive.
 */
export const mergeSessions = (
    local: unknown,
    remote: unknown,
    tombstones: unknown = [],
    clearedAt: unknown = 0,
): ChatSession[] => {
    const tombById = new Map<string, number>();
    for (const t of sanitizeChatTombstones(tombstones)) {
        tombById.set(t.id, Math.max(tombById.get(t.id) ?? 0, t.deletedAt));
    }
    const cleared = sanitizeChatsClearedAt(clearedAt);
    const byId = new Map<string, ChatSession>();
    for (const session of [...sanitizeSessions(local), ...sanitizeSessions(remote)]) {
        const updatedAt = session.updatedAt || 0;
        if (cleared > 0 && updatedAt < cleared) continue;
        const deletedAt = tombById.get(session.id) ?? 0;
        if (updatedAt <= deletedAt) continue;
        const existing = byId.get(session.id);
        if (!existing || updatedAt >= (existing.updatedAt || 0)) {
            byId.set(session.id, session);
        }
    }
    return Array.from(byId.values())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_SESSIONS);
};

/** Validate + bound untrusted deletion markers (storage or server). */
export const sanitizeChatTombstones = (tombstones: unknown): ChatTombstone[] => {
    if (!Array.isArray(tombstones)) return [];
    const byId = new Map<string, number>();
    for (const raw of tombstones) {
        if (!raw || typeof raw !== 'object') continue;
        const t = raw as Record<string, unknown>;
        if (typeof t.id !== 'string' || !t.id) continue;
        if (typeof t.deletedAt !== 'number' || !Number.isFinite(t.deletedAt)) continue;
        byId.set(t.id, Math.max(byId.get(t.id) ?? 0, t.deletedAt));
    }
    return Array.from(byId.entries())
        .map(([id, deletedAt]) => ({ id, deletedAt }))
        .sort((a, b) => b.deletedAt - a.deletedAt)
        .slice(0, MAX_TOMBSTONES);
};

export const mergeChatTombstones = (local: unknown, remote: unknown): ChatTombstone[] =>
    sanitizeChatTombstones([...sanitizeChatTombstones(local), ...sanitizeChatTombstones(remote)]);

export const loadChatTombstones = (): ChatTombstone[] => {
    try {
        const saved = nsGetItem(TOMBSTONES_KEY);
        if (!saved) return [];
        return sanitizeChatTombstones(JSON.parse(saved));
    } catch {
        return [];
    }
};

export const saveChatTombstones = (tombstones: ChatTombstone[]): void => {
    try {
        nsSetItem(TOMBSTONES_KEY, JSON.stringify(sanitizeChatTombstones(tombstones)));
    } catch {
        /* best-effort */
    }
};

export const recordChatTombstones = (sessionIds: string[], at = Date.now()): void => {
    const existing = loadChatTombstones();
    const additions = sessionIds.map((id) => ({ id, deletedAt: at }));
    saveChatTombstones(mergeChatTombstones(existing, additions));
};

/** Timestamp of the last explicit "clear all chat history" action. */
export const loadChatsClearedAt = (): number => {
    try {
        return sanitizeChatsClearedAt(Number(nsGetItem(CLEARED_AT_KEY)));
    } catch {
        return 0;
    }
};

export const saveChatsClearedAt = (at: number): void => {
    const value = sanitizeChatsClearedAt(at);
    if (!value) return;
    try {
        nsSetItem(CLEARED_AT_KEY, String(value));
    } catch {
        /* best-effort */
    }
};

/**
 * Mark an explicit clear-all. Never moves backwards: adopting an older server
 * marker must not make previously deleted conversations eligible again.
 */
export const markChatsClearedAt = (at = Date.now()): number => {
    const next = Math.max(loadChatsClearedAt(), sanitizeChatsClearedAt(at));
    saveChatsClearedAt(next);
    return next;
};

/** Write a bootstrap/merged history without firing the debounced local saver. */
export const persistSessionsNow = (sessions: ChatSession[]): void => {
    try {
        const bounded = sanitizeSessions(sessions);
        localStorage.setItem(namespacedKey(STORAGE_KEY), JSON.stringify(bounded));
    } catch (e) {
        console.warn('Failed to persist merged chat sessions:', e);
    }
};

export const saveSessions = (sessions: ChatSession[]) => {
    try {
        // Bound before serializing so the payload is finite and quota-safe.
        const bounded = sessions
            .map(normalizeSession)
            .filter((s): s is ChatSession => s !== null)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, MAX_SESSIONS);

        let payload = JSON.stringify(bounded);
        // If a session is enormous, drop the oldest sessions until it fits —
        // writes must never fail silently from a quota error.
        if (payload.length > MAX_SESSION_PAYLOAD_CHARS) {
            const trimmed = [...bounded];
            while (trimmed.length > 1 && payload.length > MAX_SESSION_PAYLOAD_CHARS) {
                trimmed.pop();
                payload = JSON.stringify(trimmed);
            }
        }
        debouncedLocalStorageSet(namespacedKey(STORAGE_KEY), payload, 0);
    } catch (e) {
        console.warn('Failed to save chat sessions:', e);
    }
};

export const createSession = (initialMessage?: string): ChatSession => {
    const newSession: ChatSession = {
        id: generateId(),
        title: initialMessage ? initialMessage.slice(0, 30) + (initialMessage.length > 30 ? '...' : '') : 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    return newSession;
};

export const updateSession = (sessions: ChatSession[], updatedSession: ChatSession): ChatSession[] => {
    const newSessions = sessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    // Move updated session to top? Or keep sort order? Let's just save.
    saveSessions(newSessions);
    return newSessions;
};

export const saveCurrentSessionId = (id: string | null) => {
    if (id) {
        nsSetItem(CURRENT_SESSION_KEY, id);
    } else {
        nsRemoveItem(CURRENT_SESSION_KEY);
    }
};

export const loadCurrentSessionId = (): string | null => {
    return nsGetItem(CURRENT_SESSION_KEY, [LEGACY_CURRENT_SESSION_KEY]);
};
