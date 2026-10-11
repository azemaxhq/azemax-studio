import { useEffect, useSyncExternalStore } from 'react';
import {
    getBackendHealthSnapshot,
    subscribeBackendHealth,
    wakeBackend,
    type BackendHealthStatus,
} from '../utils/backendHealth';

/**
 * Subscribes to the background backend warm-up status.
 *
 * The wake-up request itself is a page-load singleton inside
 * `../utils/backendHealth` — this effect only *joins* it, so re-renders
 * (and StrictMode double-mounts) never issue extra requests. Non-blocking:
 * the editor renders and stays usable regardless of the outcome.
 */
export function useBackendHealth(): BackendHealthStatus {
    const status = useSyncExternalStore(
        subscribeBackendHealth,
        getBackendHealthSnapshot,
        getBackendHealthSnapshot,
    );
    useEffect(() => {
        wakeBackend();
    }, []);
    return status;
}
