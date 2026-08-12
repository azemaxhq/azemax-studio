

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

// Helper to generate IDs if uuid is not available or for simplicity
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export const loadSessions = (): ChatSession[] => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const sessions = JSON.parse(saved);
            // Sort by updatedAt desc
            return sessions.sort((a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt);
        }
    } catch (e) {
        console.warn('Failed to load chat sessions:', e);
    }
    return [];
};

export const saveSessions = (sessions: ChatSession[]) => {
    try {
        debouncedLocalStorageSet(STORAGE_KEY, JSON.stringify(sessions), 300);
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
