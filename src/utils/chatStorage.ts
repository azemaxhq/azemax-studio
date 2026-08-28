

import { debouncedLocalStorageSet } from './localStorageDebounce';

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

const STORAGE_KEY = 'deepcontext-chat-sessions';
const CURRENT_SESSION_KEY = 'deepcontext-current-session-id';

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
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const sessions = JSON.parse(saved);
            // Defensive: the stored data is untrusted. Keep only well-formed
            // sessions so malformed/corrupt storage can never crash the panel,
            // and bound the history so a giant payload is trimmed on read too.
            if (Array.isArray(sessions)) {
                return sessions
                    .map(normalizeSession)
                    .filter((s): s is ChatSession => s !== null)
                    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                    .slice(0, MAX_SESSIONS);
            }
        }
    } catch (e) {
        console.warn('Failed to load chat sessions:', e);
    }
    return [];
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
        debouncedLocalStorageSet(STORAGE_KEY, payload, 0);
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

export const deleteSession = (sessions: ChatSession[], sessionId: string): ChatSession[] => {
    const newSessions = sessions.filter(s => s.id !== sessionId);
    saveSessions(newSessions);
    return newSessions;
};

export const saveCurrentSessionId = (id: string | null) => {
    if (id) {
        localStorage.setItem(CURRENT_SESSION_KEY, id);
    } else {
        localStorage.removeItem(CURRENT_SESSION_KEY);
    }
};

export const loadCurrentSessionId = (): string | null => {
    return localStorage.getItem(CURRENT_SESSION_KEY);
};
