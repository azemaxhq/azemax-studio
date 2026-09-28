import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { subscribeDiagnostics, getDiagnosticResult, getCurrentDiagnostics, getGlobalCounts, getAllFilesWithDiagnostics } from '../../core/diagnostics/diagnosticStore';
import type { DiagnosticResultEx, CanonicalDiagnostic } from '../../utils/diagnosticsTypes';
import { useProjectFile } from '../../context/ProjectContext';

const severityIcon = (s: CanonicalDiagnostic['severity']) => {
    switch (s) {
        case 'error': return <AlertCircle size={12} className="text-[#FF647C] shrink-0" />;
        case 'warning': return <AlertTriangle size={12} className="text-[#F5B94C] shrink-0" />;
        case 'info': return <Info size={12} className="text-[#5B8CFF] shrink-0" />;
        case 'hint': return <Lightbulb size={12} className="text-[#7F8A9A] shrink-0" />;
    }
};

export const ProblemsPanel: React.FC = () => {
    const { activeFile } = useProjectFile();
    const [result, setResult] = useState<DiagnosticResultEx | null>(() => getCurrentDiagnostics());
    const [global, setGlobal] = useState(() => getGlobalCounts());
    const [trackedFiles, setTrackedFiles] = useState<string[]>(() => getAllFilesWithDiagnostics());

    useEffect(() => {
        const update = () => {
            const r = activeFile?.id ? getDiagnosticResult(activeFile.id) : getCurrentDiagnostics();
            setResult(r);
            setGlobal(getGlobalCounts());
            setTrackedFiles(getAllFilesWithDiagnostics());
        };
        update();
        const unsub = subscribeDiagnostics(update);
        return unsub;
    }, [activeFile?.id]);

    const handleNavigate = (d: CanonicalDiagnostic) => {
        // Navigate editor to diagnostic location
        window.dispatchEvent(new CustomEvent('problems-navigate', { detail: { line: d.line, column: d.column, fileId: d.fileId } }));
        // Also try via active editor store
        const event = new CustomEvent('problems-navigate-diagnostic', { detail: d });
        window.dispatchEvent(event);
    };

    // Listen for navigation and focus editor (reserved for future cross-file navigation)
    useEffect(() => {
        const handler = (_e: Event) => {
            // Intentionally empty - navigation is handled via problems-navigate event in CodeEditor
        };
        window.addEventListener('problems-navigate-diagnostic', handler);
        return () => window.removeEventListener('problems-navigate-diagnostic', handler);
    }, []);

    if (!result || result.diagnostics.length === 0) {
        // Cross-file awareness: active file clean but other files have problems
        if (global.total > 0) {
            return (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
                    <div className="w-8 h-8 rounded-full bg-[var(--az-surface-3)] flex items-center justify-center">
                        <Info size={16} className="text-[var(--az-text-muted)]" />
                    </div>
                    <span className="text-xs text-[var(--az-text-muted)]">No problems in current file</span>
                    <span className="text-[10px] text-[var(--az-text-muted)] opacity-70">
                        {global.errors > 0 && `${global.errors} error${global.errors === 1 ? '' : 's'}`}
                        {global.errors > 0 && global.warnings > 0 && ' · '}
                        {global.warnings > 0 && `${global.warnings} warning${global.warnings === 1 ? '' : 's'}`}
                        {' '}across {trackedFiles.length} file{trackedFiles.length === 1 ? '' : 's'}
                    </span>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <div className="w-8 h-8 rounded-full bg-[var(--az-surface-3)] flex items-center justify-center">
                    <Info size={16} className="text-[var(--az-text-muted)]" />
                </div>
                <span className="text-xs text-[var(--az-text-muted)]">No problems found</span>
                <span className="text-[10px] text-[var(--az-text-muted)] opacity-70">Run Check to analyze current file</span>
                {result?.isPartial && <span className="text-[10px] text-[#F5B94C]">Partial result — {result.errors.ai || result.errors.local}</span>}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-3 py-2 text-[11px] border-b shrink-0" style={{ background: 'var(--az-surface-2)', borderColor: 'var(--az-border)' }}>
                <span className="flex items-center gap-1.5">
                    <AlertCircle size={12} className="text-[#FF647C]" />
                    <span className="font-semibold">{result.errorCount}</span> errors
                </span>
                <span className="flex items-center gap-1.5">
                    <AlertTriangle size={12} className="text-[#F5B94C]" />
                    <span className="font-semibold">{result.warningCount}</span> warnings
                </span>
                {result.infoCount > 0 && <span className="flex items-center gap-1.5"><Info size={12} className="text-[#5B8CFF]" />{result.infoCount} infos</span>}
                {global.total > result.diagnostics.length && (
                    <span className="ml-auto text-[10px] text-[var(--az-text-muted)]" title={`${global.errors} errors, ${global.warnings} warnings across ${trackedFiles.length} files`}>
                        +{global.total - result.diagnostics.length} elsewhere
                    </span>
                )}
                {result.isPartial && <span className="ml-auto text-[10px] text-[#F5B94C]">partial</span>}
                {result.isStale && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-[var(--az-surface-3)] border border-[var(--az-border)]">stale</span>}
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
                {result.diagnostics.map((d, idx) => (
                    <button
                        key={`${d.line}-${d.column}-${idx}`}
                        onClick={() => handleNavigate(d)}
                        className="w-full text-left px-3 py-2 flex gap-2.5 hover:bg-[var(--az-surface-hover)] border-b border-[var(--az-border)]/50 transition-colors group"
                    >
                        <span className="mt-0.5">{severityIcon(d.severity)}</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[12px] leading-snug text-[var(--az-text)] group-hover:text-[var(--az-text)] line-clamp-2">{d.message}</div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--az-text-muted)]">
                                <span>Line {d.line}:{d.column}</span>
                                <span className="px-1 py-0 rounded text-[9px] border" style={{ background: 'var(--az-surface-3)', borderColor: 'var(--az-border)' }}>{d.source === 'ai' ? 'AI' : d.source === 'monaco' ? 'Monaco' : 'Language'}{d.code ? ` · ${d.code}` : ''}</span>
                                {d.fileName && <span className="truncate">{d.fileName}</span>}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
            <div className="px-3 py-1.5 text-[10px] text-[var(--az-text-muted)] border-t shrink-0" style={{ borderColor: 'var(--az-border)', background: 'var(--az-surface-2)' }}>
                {result.summary} {result.aiStatus === 'failed' && '· AI unavailable'} {result.localStatus === 'failed' && '· Local failed'}
            </div>
        </div>
    );
};
