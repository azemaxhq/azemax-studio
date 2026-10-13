import type * as Monaco from 'monaco-editor';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';
export type DiagnosticSource = 'monaco' | 'language' | 'ai';
export type DiagnosticStatus = 'idle' | 'checking' | 'success' | 'error' | 'cancelled' | 'stale';
export type AISourceStatus = 'idle' | 'checking' | 'success' | 'failed' | 'skipped' | 'cancelled';

export interface CanonicalDiagnostic {
    /** 1-based line */
    line: number;
    /** 1-based column */
    column: number;
    /** 1-based end line */
    endLine: number;
    /** 1-based end column */
    endColumn: number;
    message: string;
    severity: DiagnosticSeverity;
    source: DiagnosticSource;
    /** Optional diagnostic code (e.g. TS2304, E001) */
    code?: string;
    /** File context */
    fileName?: string;
    fileId?: string | null;
    /** Confidence for AI diagnostics */
    confidence?: number;
}

export interface DiagnosticRunMeta {
    requestId: string;
    fileId: string | null;
    fileName: string;
    filePath: string;
    versionId: number | null;
    timestamp: number;
}

export interface DiagnosticResultEx {
    diagnostics: CanonicalDiagnostic[];
    markers: Monaco.editor.IMarkerData[];
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
    isError: boolean;
    isStale?: boolean;
    /** Legacy output field - populated but not required for UI */
    output: string;
    /** Overall status */
    status: DiagnosticStatus;
    /** AI sub-status */
    aiStatus: AISourceStatus;
    /** Local sub-status */
    localStatus: AISourceStatus;
    /** Human readable summary */
    summary: string;
    /** If partial result (one source failed) */
    isPartial: boolean;
    /** Error messages per source */
    errors: { local?: string; ai?: string };
    meta: DiagnosticRunMeta | null;
}

export const SEVERITY_MONACO_MAP: Record<DiagnosticSeverity, number> = {
    error: 8,   // MarkerSeverity.Error
    warning: 4, // MarkerSeverity.Warning
    info: 2,    // MarkerSeverity.Info
    hint: 1,    // MarkerSeverity.Hint
};

export const MONACO_SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
    8: 'error',
    4: 'warning',
    2: 'info',
    1: 'hint',
};

export function normalizeSeverity(input: unknown): DiagnosticSeverity {
    if (typeof input !== 'string') return 'warning';
    const s = input.toLowerCase().trim();
    if (s === 'error' || s === 'err') return 'error';
    if (s === 'warning' || s === 'warn') return 'warning';
    if (s === 'info' || s === 'information') return 'info';
    if (s === 'hint' || s === 'suggestion') return 'hint';
    return 'warning';
}
