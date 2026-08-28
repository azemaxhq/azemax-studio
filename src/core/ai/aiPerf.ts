/**
 * Development-only AI latency observability.
 *
 * Collects per-request timing milestones for the AI pipeline and prints a
 * single compact line per request in DEV builds:
 *
 *   requestStart → providerStart → firstByte → firstToken → lastToken → done
 *   TTFB, time-to-first-token, stream duration, tokens/sec, context size
 *
 * Disabled (no-op) unless `import.meta.env.DEV` is truthy, so production
 * bundles carry zero overhead. Never logs prompts, keys, or response content.
 */

export interface AIPerfTimings {
    task: string;
    requestId?: string;
    provider: string;
    model: string;
    contextChars: number;
    contextBuildMs?: number;
    requestStart: number;
    providerStart?: number;
    firstByte?: number;
    firstToken?: number;
    lastToken?: number;
    done?: number;
    status: 'ok' | 'error' | 'aborted';
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    streamChunkCount?: number;
}

const enabled = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export const isAIPerfEnabled = (): boolean => enabled;

/**
 * Aggregate dev-only counters for the whole AI runtime (bumped only in DEV).
 * Summed across requests so the pipeline health is visible at a glance:
 * total requests, completed / aborted / failed, provider fallbacks taken, and
 * token volumes. Never contains prompts or response content.
 */
export interface AIPerfAggregate {
    requests: number;
    completed: number;
    aborts: number;
    errors: number;
    fallbacks: number;
    inputTokens: number;
    outputTokens: number;
}

export const aiPerfCounters: AIPerfAggregate = {
    requests: 0,
    completed: 0,
    aborts: 0,
    errors: 0,
    fallbacks: 0,
    inputTokens: 0,
    outputTokens: 0,
};

/** One-line DEV summary of the aggregate counters. */
export function summarizeAIPerf(): string {
    const done = aiPerfCounters.completed + aiPerfCounters.aborts + aiPerfCounters.errors;
    const pct = (n: number): string => (done === 0 ? '-' : `${Math.round((n / done) * 100)}%`);
    return [
        `requests=${aiPerfCounters.requests}`,
        `completed=${aiPerfCounters.completed} (${pct(aiPerfCounters.completed)})`,
        `aborts=${aiPerfCounters.aborts} (${pct(aiPerfCounters.aborts)})`,
        `errors=${aiPerfCounters.errors} (${pct(aiPerfCounters.errors)})`,
        `fallbacks=${aiPerfCounters.fallbacks}`,
        `in=${aiPerfCounters.inputTokens}tok`,
        `out=${aiPerfCounters.outputTokens}tok`,
    ].join(' ');
}

/** Single-line summary. Pure + dependency-free so it is unit-testable. */
export function formatAIPerf(t: AIPerfTimings): string {
    const ms = (from?: number, to?: number): string => {
        if (from === undefined || to === undefined) return '-';
        return `${Math.max(0, Math.round(to - from))}ms`;
    };

    const ttfb = t.firstByte !== undefined ? ms(t.requestStart, t.firstByte) : '-';
    const ttft = t.firstToken !== undefined ? ms(t.requestStart, t.firstToken) : '-';
    const duration = t.done !== undefined ? ms(t.requestStart, t.done) : '-';
    const providerLatency = t.providerStart !== undefined && t.firstByte !== undefined
        ? ms(t.providerStart, t.firstByte)
        : '-';
    const generationMs = t.firstToken !== undefined && t.done !== undefined
        ? ms(t.firstToken, t.done)
        : '';
    const tps = t.done !== undefined && t.outputTokens
        ? `${Math.max(0, Math.round((t.outputTokens * 1000) / Math.max(1, t.done - t.requestStart)))}tok/s`
        : '';

    return [
        `task=${t.task}`,
        `provider=${t.provider}`,
        `model=${t.model}`,
        `ctx=${t.contextChars}chars`,
        t.contextBuildMs !== undefined ? `ctxBuild=${Math.round(t.contextBuildMs)}ms` : '',
        `provider=${providerLatency}`,
        `TTFB=${ttfb}`,
        `TTFT=${ttft}`,
        generationMs ? `gen=${generationMs}` : '',
        `duration=${duration}`,
        t.inputTokens ? `in=${t.inputTokens}tok` : '',
        t.outputTokens ? `out=${t.outputTokens}tok` : '',
        t.reasoningTokens ? `reason=${t.reasoningTokens}tok` : '',
        t.streamChunkCount !== undefined ? `chunks=${t.streamChunkCount}` : '',
        tps,
        `status=${t.status}`,
        t.error ? `error=${t.error}` : '',
    ]
        .filter(Boolean)
        .join(' ');
}

export class AIPerfTracker {
    private readonly timings: AIPerfTimings;
    private readonly now: () => number;

    constructor(init: {
        task: string;
        provider: string;
        model: string;
        contextChars: number;
        requestId?: string;
        contextBuildMs?: number;
        now?: () => number;
    }) {
        this.now = init.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
        this.timings = {
            task: init.task,
            requestId: init.requestId,
            provider: init.provider,
            model: init.model,
            contextChars: init.contextChars,
            contextBuildMs: init.contextBuildMs,
            requestStart: this.now(),
            status: 'ok',
        };
    }

    private mark(key: 'providerStart' | 'firstByte' | 'firstToken' | 'lastToken' | 'done'): void {
        if (this.timings[key] !== undefined) return;
        const value = this.now();
        switch (key) {
            case 'providerStart': this.timings.providerStart = value; break;
            case 'firstByte': this.timings.firstByte = value; break;
            case 'firstToken': this.timings.firstToken = value; break;
            case 'lastToken': this.timings.lastToken = value; break;
            case 'done': this.timings.done = value; break;
        }
    }

    providerStarted(): void {
        this.mark('providerStart');
    }

    firstByteReceived(): void {
        this.mark('firstByte');
    }

    firstTokenReceived(): void {
        this.mark('firstToken');
    }

    tokenReceived(): void {
        this.mark('lastToken');
    }

    complete(): void {
        this.mark('done');
        if (enabled) {
            aiPerfCounters.completed++;
            aiPerfCounters.inputTokens += this.timings.inputTokens || 0;
            aiPerfCounters.outputTokens += this.timings.outputTokens || 0;
        }
    }

    abort(): void {
        this.timings.status = 'aborted';
        this.mark('done');
        if (enabled) aiPerfCounters.aborts++;
    }

    fail(error?: string): void {
        this.timings.status = 'error';
        this.timings.error = error;
        this.mark('done');
        if (enabled) aiPerfCounters.errors++;
    }

    /** Records provider-reported token usage (non-stream + stream usage chunks). */
    reportUsage(inputTokens?: number, outputTokens?: number, reasoningTokens?: number): void {
        if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) this.timings.inputTokens = inputTokens;
        if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) this.timings.outputTokens = outputTokens;
        if (typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens)) this.timings.reasoningTokens = reasoningTokens;
    }

    /** Counts SSE chunk receipts (rough proxy for provider generation cadence). */
    chunkReceived(): void {
        this.timings.streamChunkCount = (this.timings.streamChunkCount || 0) + 1;
    }

    /** Prints the summary line when DEV is enabled. */
    log(): void {
        if (!enabled) return;
        console.log(`[AI perf] ${formatAIPerf(this.timings)}`);
    }
}