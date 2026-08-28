/**
 * Centralized DEV-only lifecycle tracing for AI operations.
 * Only logs when import.meta.env.DEV is true; no-ops in production.
 * Every event must contain operation, requestId, event, timestamp, status.
 */

export type AILifecycleOperation = 'chat' | 'explanation' | 'explain-file' | 'explain-selection' | 'edit' | 'comment' | 'remove-comment' | 'generate' | 'fix' | 'refactor' | 'insert' | 'replace' | 'delete' | 'complete' | 'wrap';
export type AILifecycleEvent =
    | 'START'
    | 'PROVIDER_REQUEST'
    | 'FIRST_TOKEN'
    | 'STREAMING'
    | 'APPLYING'
    | 'COMPLETE'
    | 'ERROR'
    | 'CANCEL'
    | 'ABORT'
    | 'EMPTY_RESPONSE';

interface TraceData {
    operation: AILifecycleOperation;
    requestId: string;
    event: AILifecycleEvent;
    status?: string;
    timestamp?: number;
    source?: string;
    extra?: Record<string, unknown>;
}

function isDev(): boolean {
    try {
        // @ts-ignore
        return import.meta.env?.DEV === true;
    } catch {
        return false;
    }
}

export function traceAILifecycle(event: AILifecycleEvent, data: Omit<TraceData, 'event' | 'timestamp'>): void {
    if (!isDev()) return;
    const payload: TraceData = {
        event,
        timestamp: Date.now(),
        ...data,
    } as TraceData;
    const prefix = `[AI-LIFECYCLE] ${payload.operation.toUpperCase()} ${payload.event}`;
    const details = {
        requestId: payload.requestId?.slice(0, 8) ?? 'none',
        status: payload.status ?? 'unknown',
        source: payload.source ?? 'unknown',
        ...payload.extra,
    };
    // Use console.log for DEV visibility; grouped for readability
    console.log(prefix, details);
}

export function traceAIRequest(
    operation: string,
    requestId: string,
    event: AILifecycleEvent,
    extra?: Record<string, unknown>,
): void {
    traceAILifecycle(event, { operation: operation as AILifecycleOperation, requestId, extra, source: 'aiRequestStore' });
}
