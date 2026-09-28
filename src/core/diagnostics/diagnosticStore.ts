/**
 * Global diagnostic store — single source of truth for Problems/status counts.
 * CodeEditor writes here after each Check; status bar / Problems panel read via subscription.
 */
import type { DiagnosticResultEx } from '../../utils/diagnosticsTypes';

type Listener = () => void;

interface StoreState {
    currentFileId: string | null;
    results: Map<string, DiagnosticResultEx>;
    lastGlobal: DiagnosticResultEx | null;
}

const listeners = new Set<Listener>();

const state: StoreState = {
    currentFileId: null,
    results: new Map(),
    lastGlobal: null,
};

function emit() {
    for (const l of listeners) {
        try { l(); } catch { /* ignore */ }
    }
}

export function subscribeDiagnostics(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function setDiagnosticResult(fileId: string | null, result: DiagnosticResultEx): void {
    if (fileId) {
        state.results.set(fileId, result);
        state.currentFileId = fileId;
    }
    state.lastGlobal = result;
    emit();
}

export function clearDiagnostics(fileId: string | null): void {
    if (fileId && state.results.has(fileId)) {
        const empty: DiagnosticResultEx = {
            diagnostics: [],
            markers: [],
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            hintCount: 0,
            isError: false,
            output: '',
            status: 'idle',
            aiStatus: 'idle',
            localStatus: 'idle',
            summary: 'No diagnostics',
            isPartial: false,
            errors: {},
            meta: null,
            isStale: false,
        };
        state.results.set(fileId, empty);
        state.lastGlobal = empty;
        emit();
    }
}

export function markStale(fileId: string | null): void {
    if (!fileId) return;
    const prev = state.results.get(fileId);
    if (prev && prev.diagnostics.length > 0) {
        state.results.set(fileId, { ...prev, isStale: true, status: 'stale' });
        if (state.currentFileId === fileId) state.lastGlobal = { ...prev, isStale: true, status: 'stale' };
        emit();
    }
}

export function getDiagnosticResult(fileId: string | null): DiagnosticResultEx | null {
    if (fileId) return state.results.get(fileId) ?? null;
    return state.lastGlobal;
}

export function getCurrentDiagnostics(): DiagnosticResultEx | null {
    if (state.currentFileId) return state.results.get(state.currentFileId) ?? state.lastGlobal;
    return state.lastGlobal;
}

export function getCounts(fileId?: string | null): { errors: number; warnings: number; infos: number; hints: number; total: number } {
    const r = fileId ? state.results.get(fileId) ?? state.lastGlobal : state.lastGlobal;
    if (!r) return { errors: 0, warnings: 0, infos: 0, hints: 0, total: 0 };
    return {
        errors: r.errorCount,
        warnings: r.warningCount,
        infos: r.infoCount,
        hints: r.hintCount,
        total: r.diagnostics.length,
    };
}

/** Returns all fileIds that have any diagnostic results registered. */
export function getAllFilesWithDiagnostics(): string[] {
    return Array.from(state.results.keys());
}

/** Returns all fileIds that have at least one error-severity diagnostic. */
export function getFilesWithErrors(): string[] {
    return Array.from(state.results.entries())
        .filter(([, r]) => r.errorCount > 0)
        .map(([id]) => id);
}

/** Returns the total error/warning count across ALL tracked files. */
export function getGlobalCounts(): { errors: number; warnings: number; total: number } {
    let errors = 0, warnings = 0, total = 0;
    for (const r of state.results.values()) {
        errors += r.errorCount;
        warnings += r.warningCount;
        total += r.diagnostics.length;
    }
    return { errors, warnings, total };
}
