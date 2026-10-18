/**
 * Settings account sync.
 *
 * Settings are a whole-document, last-writer-wins value. On sign-in we restore
 * the cloud copy when it is newer than this device; otherwise we upload the
 * local copy. After reconciliation every settings change is debounced to the
 * backend.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    fetchAccountSection,
    parseRemoteTimestamp,
    putAccountSection,
} from '../core/sync/accountApi';
import {
    beginAccountSync,
    cancelAccountSync,
    endAccountSync,
    registerAccountSyncRetry,
} from '../core/sync/syncStatus';
import {
    getSettings,
    hydrateSettings,
    subscribe,
} from '../settings/settingsStore';
import {
    loadSettingsUpdatedAt,
    markSettingsUpdatedAt,
    saveSettings,
    SETTINGS_STORAGE_KEY,
    withoutSettingsTimestamp,
} from '../settings/settingsPersistence';
import { getCurrentUserId, nsGetItem } from '../utils/userStorage';

const PUSH_DEBOUNCE_MS = 1000;

export interface AccountSettingsSync {
    retry: () => void;
}

interface Params {
    userId: string | null;
    enabled: boolean;
}

export function useAccountSettingsSync({ userId, enabled }: Params): AccountSettingsSync {
    const [ready, setReady] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const retry = useCallback(() => setRetryNonce((n) => n + 1), []);
    useEffect(() => registerAccountSyncRetry(retry), [retry]);

    const suppressionRef = useRef(false);
    const lastPushedRef = useRef<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pushingRef = useRef(false);
    const pendingPushRef = useRef(false);

    const pushNow = useCallback(async () => {
        if (!userId || !enabled) return;
        if (getCurrentUserId() !== userId) return;
        const payload = getSettings();
        const serialized = JSON.stringify(payload);
        if (serialized === lastPushedRef.current) return;
        if (pushingRef.current) {
            // Re-run once the in-flight write settles so the last change wins.
            pendingPushRef.current = true;
            return;
        }
        pushingRef.current = true;
        beginAccountSync('settings');
        try {
            const result = await putAccountSection('settings', payload);
            if (getCurrentUserId() !== userId) { cancelAccountSync('settings'); return; }
            lastPushedRef.current = serialized;
            markSettingsUpdatedAt(parseRemoteTimestamp(result.updatedAt) || Date.now());
            endAccountSync(undefined, 'settings');
        } catch (err) {
            endAccountSync(err, 'settings');
        } finally {
            pushingRef.current = false;
            if (pendingPushRef.current) {
                pendingPushRef.current = false;
                void pushNow();
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
        beginAccountSync('settings');

        const startedLocalAt = loadSettingsUpdatedAt();
        const hasLocalSettings = nsGetItem(SETTINGS_STORAGE_KEY) !== null;

        void (async () => {
            try {
                const remote = await fetchAccountSection<Record<string, unknown>>('settings');
                if (cancelled || getCurrentUserId() !== userId) { cancelAccountSync('settings'); return; }

                const localAt = loadSettingsUpdatedAt();
                const editedDuringFetch = localAt > startedLocalAt;
                const remoteAt = parseRemoteTimestamp(remote.updatedAt);
                const remoteIsAuthoritative = Boolean(remote.data) && !editedDuringFetch && remoteAt >= localAt;

                if (remoteIsAuthoritative) {
                    // Suppress the echo notification so hydration is not
                    // immediately pushed back as a local change.
                    suppressionRef.current = true;
                    try {
                        // Suppress timestamp stamping for the echo write: the
                        // restored document is persisted and the timestamp is
                        // anchored to the server below, so this device does not
                        // appear to have edited the settings.
                        withoutSettingsTimestamp(() => {
                            hydrateSettings(remote.data as never);
                            saveSettings(getSettings());
                        });
                    } finally {
                        suppressionRef.current = false;
                    }
                    markSettingsUpdatedAt(remoteAt);
                    lastPushedRef.current = JSON.stringify(getSettings());
                } else if (localAt > 0 || hasLocalSettings) {
                    // The post-reconciliation push below reads the latest
                    // settings, including edits made while this fetch ran.
                    lastPushedRef.current = null;
                } else {
                    lastPushedRef.current = JSON.stringify(getSettings());
                }

                if (cancelled) { cancelAccountSync('settings'); return; }
                setReady(true);
                endAccountSync(undefined, 'settings');
                // Catch any change made while reconciliation was in flight and
                // close the gap before the subscription effect attaches.
                void pushNow();
            } catch (err) {
                if (cancelled) { cancelAccountSync('settings'); return; }
                setReady(false);
                endAccountSync(err, 'settings');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, pushNow, retryNonce, userId]);

    useEffect(() => {
        if (!userId || !enabled || !ready) return;
        const unsubscribe = subscribe(() => {
            if (suppressionRef.current) return;
            const serialized = JSON.stringify(getSettings());
            if (serialized === lastPushedRef.current) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                void pushNow();
            }, PUSH_DEBOUNCE_MS);
        });
        return () => {
            unsubscribe();
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [enabled, pushNow, ready, userId]);

    // Don't leave the last toggle stranded when the tab is closed.
    useEffect(() => {
        if (!ready) return;
        const flush = () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
                void pushNow();
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        window.addEventListener('pagehide', flush);
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
