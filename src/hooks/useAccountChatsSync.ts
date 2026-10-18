/**
 * AI chat account sync.
 *
 * Chat storage is already per-user locally. Account sync additionally unions
 * conversations across devices by session id (newest copy wins) and then keeps
 * the merged history up to date with a debounced whole-document write. Merging
 * (instead of last-writer-wins) means signing in on a second device never
 * deletes conversations that only exist there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSession, ChatTombstone } from '../utils/chatStorage';
import {
    loadChatsClearedAt,
    loadChatTombstones,
    loadCurrentSessionId,
    mergeChatTombstones,
    mergeSessions,
    persistSessionsNow,
    sanitizeChatsClearedAt,
    sanitizeSessions,
    sanitizeChatTombstones,
    saveChatsClearedAt,
    saveChatTombstones,
    saveCurrentSessionId,
} from '../utils/chatStorage';
import {
    fetchAccountSection,
    putAccountSection,
} from '../core/sync/accountApi';
import {
    beginAccountSync,
    cancelAccountSync,
    endAccountSync,
    registerAccountSyncRetry,
} from '../core/sync/syncStatus';
import { getCurrentUserId } from '../utils/userStorage';

const PUSH_DEBOUNCE_MS = 1200;

interface ChatsPayload {
    sessions: ChatSession[];
    currentSessionId: string | null;
    tombstones: ChatTombstone[];
    /** Clear-all timestamp; conversations older than this stay deleted. */
    clearedAt: number;
}

export interface AccountChatsSync {
    retry: () => void;
}

interface Params {
    userId: string | null;
    enabled: boolean;
    sessions: ChatSession[];
    currentSessionId: string | null;
    onRemoteChats: (sessions: ChatSession[], currentSessionId: string | null) => void;
}

function serialize(
    sessions: ChatSession[],
    currentSessionId: string | null,
    tombstones: ChatTombstone[],
    clearedAt: number,
): string {
    return JSON.stringify({ sessions, currentSessionId, tombstones, clearedAt });
}

function sameTombstones(a: ChatTombstone[], b: ChatTombstone[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].deletedAt !== b[i].deletedAt) return false;
    }
    return true;
}

function sameSessions(a: ChatSession[], b: ChatSession[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id) return false;
        if ((a[i].updatedAt || 0) !== (b[i].updatedAt || 0)) return false;
        if (a[i].messages.length !== b[i].messages.length) return false;
    }
    return true;
}

export function useAccountChatsSync({
    userId,
    enabled,
    sessions,
    currentSessionId,
    onRemoteChats,
}: Params): AccountChatsSync {
    const [ready, setReady] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const retry = useCallback(() => setRetryNonce((n) => n + 1), []);
    useEffect(() => registerAccountSyncRetry(retry), [retry]);

    const sessionsRef = useRef(sessions);
    const currentIdRef = useRef(currentSessionId);
    const onRemoteRef = useRef(onRemoteChats);
    sessionsRef.current = sessions;
    currentIdRef.current = currentSessionId;
    onRemoteRef.current = onRemoteChats;

    const lastPushedRef = useRef<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pushingRef = useRef(false);
    const pendingPushRef = useRef<{
        sessions: ChatSession[];
        currentSessionId: string | null;
        tombstones: ChatTombstone[];
        clearedAt: number;
    } | null>(null);

    const pushNow = useCallback(async (
        nextSessions: ChatSession[],
        nextCurrentId: string | null,
        nextTombstones: ChatTombstone[] = loadChatTombstones(),
        nextClearedAt: number = loadChatsClearedAt(),
    ) => {
        if (!userId || !enabled) return;
        if (getCurrentUserId() !== userId) return;
        if (pushingRef.current) {
            // Keep the newest payload; it is sent when the current write ends.
            pendingPushRef.current = {
                sessions: nextSessions,
                currentSessionId: nextCurrentId,
                tombstones: nextTombstones,
                clearedAt: nextClearedAt,
            };
            return;
        }
        const bounded = sanitizeSessions(nextSessions);
        const tombstones = sanitizeChatTombstones(nextTombstones);
        const clearedAt = sanitizeChatsClearedAt(nextClearedAt);
        const payload: ChatsPayload = {
            sessions: bounded,
            currentSessionId: nextCurrentId,
            tombstones,
            clearedAt,
        };
        const serialized = serialize(payload.sessions, payload.currentSessionId, payload.tombstones, clearedAt);
        if (serialized === lastPushedRef.current) return;

        pushingRef.current = true;
        beginAccountSync('chats');
        try {
            await putAccountSection('chats', payload);
            if (getCurrentUserId() !== userId) { cancelAccountSync('chats'); return; }
            lastPushedRef.current = serialized;
            endAccountSync(undefined, 'chats');
        } catch (err) {
            endAccountSync(err, 'chats');
        } finally {
            pushingRef.current = false;
            const pending = pendingPushRef.current;
            pendingPushRef.current = null;
            if (pending) {
                void pushNow(pending.sessions, pending.currentSessionId, pending.tombstones, pending.clearedAt);
            }
        }
    }, [enabled, userId]);

    useEffect(() => {
        if (!userId || !enabled) {
            setReady(false);
            return;
        }
        let cancelled = false;
        setReady(false);
        beginAccountSync('chats');

        void (async () => {
            try {
                const remote = await fetchAccountSection<ChatsPayload>('chats');
                if (cancelled || getCurrentUserId() !== userId) { cancelAccountSync('chats'); return; }

                const remoteSessions = sanitizeSessions(remote.data?.sessions);
                const remoteTombstones = sanitizeChatTombstones(remote.data?.tombstones);
                const tombstones = mergeChatTombstones(loadChatTombstones(), remoteTombstones);
                saveChatTombstones(tombstones);
                // Adopt the newest clear-all marker from either side. Sessions
                // older than it stay deleted even if this device never saw the
                // original conversation (e.g. clear performed on another
                // device before the first sync completed here).
                const remoteClearedAt = sanitizeChatsClearedAt(remote.data?.clearedAt);
                const clearedAt = Math.max(loadChatsClearedAt(), remoteClearedAt);
                if (clearedAt > 0) saveChatsClearedAt(clearedAt);
                // Merge the live in-memory history with the cloud copy. If the
                // panel has not hydrated yet this is just the cloud copy.
                const merged = mergeSessions(sessionsRef.current, remoteSessions, tombstones, clearedAt);
                const storedCurrent = loadCurrentSessionId();
                const remoteCurrent = remote.data?.currentSessionId ?? null;
                const nextCurrent = merged.some((s) => s.id === storedCurrent)
                    ? storedCurrent
                    : (merged.some((s) => s.id === remoteCurrent) ? remoteCurrent : (merged[0]?.id ?? null));

                const remoteMatchesMerged = sameSessions(merged, remoteSessions)
                    && (remote.data?.currentSessionId ?? null) === nextCurrent
                    && sameTombstones(tombstones, remoteTombstones)
                    && remoteClearedAt === clearedAt;

                const hasState = merged.length > 0 || Boolean(remote.data) || tombstones.length > 0 || clearedAt > 0;
                if (hasState) {
                    persistSessionsNow(merged);
                    saveCurrentSessionId(nextCurrent);
                    onRemoteRef.current(merged, nextCurrent);
                }

                const needsPush = !remoteMatchesMerged && hasState;
                lastPushedRef.current = remoteMatchesMerged
                    ? serialize(merged, nextCurrent, tombstones, clearedAt)
                    : null;

                if (cancelled) { cancelAccountSync('chats'); return; }
                setReady(true);
                endAccountSync(undefined, 'chats');
                if (needsPush) {
                    // New local conversations, a newer current session, a
                    // deletion marker, or a clear-all marker that the cloud has
                    // not seen yet. Tracked separately so a failed write leaves
                    // the status in error.
                    void pushNow(merged, nextCurrent, tombstones, clearedAt);
                }
            } catch (err) {
                if (cancelled) { cancelAccountSync('chats'); return; }
                setReady(false);
                endAccountSync(err, 'chats');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, pushNow, retryNonce, userId]);

    useEffect(() => {
        if (!userId || !enabled || !ready) return;
        const tombstones = loadChatTombstones();
        const clearedAt = loadChatsClearedAt();
        const payload = {
            sessions: sanitizeSessions(sessions),
            currentSessionId,
            tombstones,
            clearedAt,
        };
        const serialized = serialize(payload.sessions, payload.currentSessionId, payload.tombstones, payload.clearedAt);
        if (serialized === lastPushedRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            void pushNow(payload.sessions, payload.currentSessionId, payload.tombstones, payload.clearedAt);
        }, PUSH_DEBOUNCE_MS);
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [currentSessionId, enabled, pushNow, ready, sessions, userId]);

    useEffect(() => {
        if (!ready) return;
        const flush = () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
                void pushNow(sessionsRef.current, currentIdRef.current, loadChatTombstones(), loadChatsClearedAt());
            }
        };
        window.addEventListener('pagehide', flush);
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pushNow, ready]);

    return {
        retry,
    };
}
