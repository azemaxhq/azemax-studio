import { useCallback, useSyncExternalStore } from 'react';
import { AIRequestStore, type AIOperationType, type AIRequestStatus, type AgentTaskPhase, type AgentProgressEvent } from '../core/ai/aiRequestStore';

export type AILoadingStatus = AIRequestStatus;

export interface UseAILoadingReturn {
    status: AILoadingStatus;
    /** Explicit agent lifecycle phase for the active request. */
    phase: AgentTaskPhase;
    /** Latest internal execution event (orchestration, never assistant prose). */
    latestProgress: AgentProgressEvent | null;
    operation: AIOperationType | null;
    requestId: string | null;
    isLoading: boolean;
    error: string | null;
    start: (initialStatus?: AILoadingStatus) => string;
    setThinking: () => void;
    setGenerating: () => void;
    setStreaming: () => void;
    setApplying: () => void;
    setSuccess: () => void;
    setError: (message?: string) => void;
    stop: () => void;
    cancel: () => void;
    isStale: (id: string) => boolean;
}

/**
 * Centralized AI loading lifecycle — single source of truth via AIRequestStore (outside React).
 * React subscribes via useSyncExternalStore, never copies into random useState/useRef.
 * Each operation (chat, explanation, etc.) has independent requestId/status; global boolean removed.
 *
 * Guarantees:
 * - ONE owner per request (store), UI just renders store.getSnapshot()
 * - STATE MUST CHANGE BEFORE async request (startRequest -> thinking before await provider)
 * - No artificial delays (transitions reflect real provider lifecycle)
 * - Concurrent protection per operation (request A cannot clear request B, and chat cannot clear explanation)
 * - Deterministic cleanup via try/finally with isCurrent(requestId) check
 */
export function useAILoading(operation: AIOperationType = 'chat'): UseAILoadingReturn {
    const request = useSyncExternalStore(
        AIRequestStore.subscribe,
        () => AIRequestStore.getActiveRequestForOperation(operation) ?? null,
        () => AIRequestStore.getActiveRequestForOperation(operation) ?? null,
    );

    const status: AILoadingStatus = request?.status ?? 'idle';
    const phase: AgentTaskPhase = request?.phase ?? 'idle';
    const progressEvents = request?.progress ?? [];
    const latestProgress: AgentProgressEvent | null = progressEvents.length ? progressEvents[progressEvents.length - 1] : null;
    const requestOperation: AIOperationType | null = request?.operation ?? null;
    const requestId = request?.id ?? null;
    const error = request?.error ?? null;
    const isLoading = status !== 'idle' && status !== 'success' && status !== 'error' && status !== 'cancelled';

    const start = useCallback(
        (initialStatus: AILoadingStatus = 'thinking'): string => {
            return AIRequestStore.startRequest(operation, initialStatus);
        },
        [operation],
    );

    const setThinking = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.updateRequest(id, 'thinking');
    }, [operation]);

    const setGenerating = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.updateRequest(id, 'generating');
    }, [operation]);

    const setStreaming = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.updateRequest(id, 'streaming');
    }, [operation]);

    const setApplying = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.updateRequest(id, 'applying');
    }, [operation]);

    const setSuccess = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.completeRequest(id);
    }, [operation]);

    const setError = useCallback(
        (message?: string) => {
            const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
            if (id) AIRequestStore.failRequest(id, message);
            else {
                // No active request but need to surface error — create ephemeral error then clear
                const newId = AIRequestStore.startRequest(operation, 'error');
                AIRequestStore.failRequest(newId, message);
            }
        },
        [operation],
    );

    const stop = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.cancelRequest(id);
    }, [operation]);

    const cancel = useCallback(() => {
        const id = AIRequestStore.getActiveRequestForOperation(operation)?.id;
        if (id) AIRequestStore.cancelRequest(id);
    }, [operation]);

    const isStale = useCallback(
        (id: string) => {
            const current = AIRequestStore.getActiveRequestForOperation(operation)?.id;
            return current !== id;
        },
        [operation],
    );

    return {
        status,
        phase,
        latestProgress,
        operation: requestOperation,
        requestId,
        isLoading,
        error,
        start,
        setThinking,
        setGenerating,
        setStreaming,
        setApplying,
        setSuccess,
        setError,
        stop,
        cancel,
        isStale,
    };
}
