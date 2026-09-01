/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { useProjectActions, useProjectUI } from './ProjectContext';
import { useTerminal } from './TerminalContext';
import { explainFileOrSnippet } from '../utils/groqService';
import { aiRequestManager, type AIAbortController } from '../core/ai';
import { AIRequestStore } from '../core/ai/aiRequestStore';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';
import { getActiveEditorContext } from '../core/editor/activeEditorStore';

const STORAGE_KEY = 'explanation-panel-persisted';

const getLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', java: 'java', c: 'c', cpp: 'cpp', go: 'go',
        rs: 'rust', rb: 'ruby', php: 'php', css: 'css', html: 'html',
        json: 'json', md: 'markdown', sh: 'shell', yml: 'yaml', yaml: 'yaml',
    };
    return map[ext] || 'plaintext';
};

function loadPersisted(): { explanation: string | null; explanationError: string | null; explainedFor: string | null } {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { explanation: null, explanationError: null, explainedFor: null };
        const d = JSON.parse(raw);
        return {
            explanation: typeof d.explanation === 'string' ? d.explanation : null,
            explanationError: typeof d.explanationError === 'string' ? d.explanationError : null,
            explainedFor: typeof d.explainedFor === 'string' ? d.explainedFor : null,
        };
    } catch {
        return { explanation: null, explanationError: null, explainedFor: null };
    }
}

interface ExplanationContextType {
    explanation: string | null;
    explanationError: string | null;
    isExplaining: boolean;
    handleExplain: () => Promise<void>;
    handleExplainSelection: () => void;
    handleClearExplanation: () => void;
    handleRetryExplanation: () => void;
    handleSendExplanationToTerminal: () => void;
    canSendToTerminal: boolean;
}

const ExplanationContext = createContext<ExplanationContextType | undefined>(undefined);

export const ExplanationProvider: React.FC<{ children: React.ReactNode }> = memo(({ children }) => {
    const { activeFileMeta } = useProjectUI();
    const { getActiveFile } = useProjectActions();
    const { writeToTerminal, activeTerminalId } = useTerminal();
    const [state, setState] = useState(() => loadPersisted());
    const { explanation, explanationError, explainedFor } = state;
    const [isExplaining, setIsExplaining] = useState(false);

    // Guards against state writes after unmount and lets a newer explanation
    // request supersede an older in-flight one (no stale response wins, and a
    // stale `finally` can never turn off the spinner for a request that is
    // still running). The request is ALSO registered in aiRequestManager so
    // cancellation flows through the same registry as every other AI feature.
    const mountedRef = useRef(true);
    const explainAbortRef = useRef<AIAbortController | null>(null);
    const explainRequestIdRef = useRef<string | null>(null);
    const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Monotonic request identity: every new explain bumps this counter. State
    // writes and spinner clears are only allowed when they belong to the LATEST
    // request — an older one (even one that resolves after a newer request
    // started) is discarded.
    const explainSeqRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            explainAbortRef.current?.abort('unmount');
            aiRequestManager.abortAllForOwner('explain', 'unmount');
            if (selectionTimeoutRef.current != null) clearTimeout(selectionTimeoutRef.current);
        };
    }, []);

    const clearSelectionTimeout = useCallback(() => {
        if (selectionTimeoutRef.current != null) {
            clearTimeout(selectionTimeoutRef.current);
            selectionTimeoutRef.current = null;
        }
    }, []);

    /** Supersedes the previous explain request and begins the next one. */
    const beginExplain = useCallback((operation: import('../core/ai/aiRequestStore').AIOperationType = 'explanation'): { controller: AIAbortController; requestId: string; seq: number } => {
        // Abort the previous request (if any) so an old response can never
        // overwrite the newer result. Aborting via the registry deletes its
        // record, so the old request's completion becomes a no-op.
        if (explainRequestIdRef.current) {
            aiRequestManager.abort(explainRequestIdRef.current, 'superseded');
            for (const op of ['explanation', 'explain-file', 'explain-selection'] as const) {
                const activePrev = AIRequestStore.getActiveRequestForOperation(op);
                if (activePrev) AIRequestStore.cancelRequest(activePrev.id);
            }
        }
        clearSelectionTimeout();
        const seq = ++explainSeqRef.current;
        const record = aiRequestManager.begin({ owner: 'explain', task: 'explanation' });
        explainAbortRef.current = record.controller;
        explainRequestIdRef.current = record.requestId;
        // Use specific operation for contextual status
        AIRequestStore.startRequest(operation, 'thinking');
        // Store the requestId also in the store's latestByOperation; we need to keep them in sync
        // For now, we store the aiRequestManager's requestId as the store's id via a hidden map
        // Instead, we just ensure the store has an active request for 'explanation'
        return { controller: record.controller, requestId: record.requestId, seq };
    }, [clearSelectionTimeout]);

    /** Releases a request's registry entry + spinner ONLY if it is still current. */
    const endExplain = useCallback((requestId: string, controller: AIAbortController, seq: number) => {
        aiRequestManager.markStatus(requestId, 'complete');
        if (explainSeqRef.current !== seq) {
            // Stale finally — do not clear the newer request's store entry
            return;
        }
        if (explainAbortRef.current === controller) explainAbortRef.current = null;
        if (explainRequestIdRef.current === requestId) explainRequestIdRef.current = null;
        if (mountedRef.current) setIsExplaining(false);
        // Complete the store's explanation request (any of the three operation keys)
        for (const op of ['explanation', 'explain-file', 'explain-selection'] as const) {
            const active = AIRequestStore.getActiveRequestForOperation(op);
            if (active) AIRequestStore.completeRequest(active.id);
        }
    }, []);

    const persist = useCallback((next: Partial<{ explanation: string | null; explanationError: string | null; explainedFor: string | null }>) => {
        setState((prev) => {
            const s = { ...prev, ...next };
            try {
                debouncedLocalStorageSet(STORAGE_KEY, JSON.stringify({
                    explanation: s.explanation,
                    explanationError: s.explanationError,
                    explainedFor: s.explainedFor,
                }));
            } catch {
                // Ignore localStorage errors
            }
            return s;
        });
    }, []);

    useEffect(() => {
        if (activeFileMeta?.id != null && explainedFor != null && explainedFor !== activeFileMeta.id) {
            persist({ explanation: null, explanationError: null, explainedFor: null });
        }
    }, [activeFileMeta?.id, explainedFor, persist]);

    const handleExplain = useCallback(async () => {
        const ctx = getActiveEditorContext();
        const activeFile = getActiveFile();
        const fileContent = ctx?.code ?? activeFile?.content ?? '';
        const fileName = ctx?.fileName ?? activeFile?.name ?? '';
        if (!fileContent.trim()) return;
        persist({ explanationError: null });
        setIsExplaining(true);
        const { controller, requestId, seq } = beginExplain('explain-file');
        // Real lifecycle: thinking already set by beginExplain (before await), now generating
        const activeExplain = AIRequestStore.getActiveRequestForOperation('explanation');
        if (activeExplain) AIRequestStore.updateRequest(activeExplain.id, 'generating');
        try {
            const lang = ctx?.language ?? getLanguage(fileName || 'file.ts');
            const result = await explainFileOrSnippet(
                fileContent,
                lang,
                fileName || undefined,
                false,
                controller.signal
            );
            if (!mountedRef.current || controller.signal.aborted || explainSeqRef.current !== seq) return;
            persist({ explanation: result, explanationError: null, explainedFor: ctx?.fileId ?? activeFile?.id ?? null });
            const active2 = AIRequestStore.getActiveRequestForOperation('explanation');
            if (active2) AIRequestStore.updateRequest(active2.id, 'success');
        } catch (error: unknown) {
            if (!mountedRef.current || controller.signal.aborted || explainSeqRef.current !== seq) {
                const activeErr = AIRequestStore.getActiveRequestForOperation('explanation');
                if (activeErr) AIRequestStore.updateRequest(activeErr.id, 'cancelled');
                return;
            }
            const message = error instanceof Error ? error.message : 'Failed to generate explanation.';
            persist({ explanationError: message, explanation: null });
            const activeErr = AIRequestStore.getActiveRequestForOperation('explanation');
            if (activeErr) AIRequestStore.failRequest(activeErr.id, message);
        } finally {
            endExplain(requestId, controller, seq);
        }
    }, [getActiveFile, persist, beginExplain, endExplain]);

    const handleExplainSelection = useCallback(() => {
        // Supersede previous explain if still running (requestId guards, not boolean)
        persist({ explanationError: null });
        setIsExplaining(true);
        const { controller, requestId, seq } = beginExplain('explain-selection');
        const activeExplain = AIRequestStore.getActiveRequestForOperation('explanation');
        if (activeExplain) AIRequestStore.updateRequest(activeExplain.id, 'generating');
        const handler = (e: Event) => {
            const ce = e as CustomEvent<{ selection?: string; language?: string; fileName?: string }>;
            const detail = ce.detail ?? {};
            const selection = typeof detail.selection === 'string' ? detail.selection : '';
            const language = typeof detail.language === 'string' ? detail.language : 'plaintext';
            const fileName = detail.fileName;

            window.removeEventListener('editor-selection', handler);
            clearSelectionTimeout();

            if (!mountedRef.current || controller.signal.aborted || explainSeqRef.current !== seq) return;

            if (!selection || !selection.trim()) {
                persist({ explanationError: 'No code selected. Select some code in the editor, then click Explain Selection.' });
                endExplain(requestId, controller, seq);
                return;
            }

            explainFileOrSnippet(selection.trim(), language || 'plaintext', fileName, true, controller.signal)
                .then((result) => {
                    if (!mountedRef.current || controller.signal.aborted || explainSeqRef.current !== seq) return;
                    persist({
                        explanation: result,
                        explanationError: null,
                        explainedFor: activeFileMeta?.id ?? null
                    });
                    const active = AIRequestStore.getActiveRequestForOperation('explanation');
                    if (active) AIRequestStore.updateRequest(active.id, 'success');
                })
                .catch((err: unknown) => {
                    if (!mountedRef.current || controller.signal.aborted || explainSeqRef.current !== seq) {
                        const activeErr = AIRequestStore.getActiveRequestForOperation('explanation');
                        if (activeErr) AIRequestStore.updateRequest(activeErr.id, 'cancelled');
                        return;
                    }
                    const msg = err instanceof Error ? err.message : 'Failed to explain selection.';
                    persist({
                        explanationError: msg,
                        explanation: null,
                    });
                    const activeErr = AIRequestStore.getActiveRequestForOperation('explanation');
                    if (activeErr) AIRequestStore.failRequest(activeErr.id, msg);
                })
                .finally(() => {
                    endExplain(requestId, controller, seq);
                });
        };
        selectionTimeoutRef.current = setTimeout(() => {
            window.removeEventListener('editor-selection', handler);
            // Only the LATEST request may report a timeout; a stale timer from a
            // superseded request must never clobber a newer explanation.
            if (!mountedRef.current || explainSeqRef.current !== seq) return;
            persist({ explanationError: 'No selection received. Select code in the editor, then click Explain Selection.' });
            const activeTimeout = AIRequestStore.getActiveRequestForOperation('explanation');
            if (activeTimeout) AIRequestStore.failRequest(activeTimeout.id, 'No selection received');
            endExplain(requestId, controller, seq);
        }, 300);
        window.addEventListener('editor-selection', handler, { once: true });
        window.dispatchEvent(new CustomEvent('request-editor-selection'));
    }, [persist, activeFileMeta?.id, isExplaining, beginExplain, endExplain, clearSelectionTimeout]);

    const handleClearExplanation = useCallback(() => {
        persist({ explanation: null, explanationError: null, explainedFor: null });
    }, [persist]);

    const handleRetryExplanation = useCallback(() => {
        persist({ explanationError: null });
        if (getActiveFile()?.content) {
            handleExplain();
        }
    }, [getActiveFile, handleExplain, persist]);

    const handleSendExplanationToTerminal = useCallback(() => {
        if (!explanation || !activeTerminalId) return;
        writeToTerminal(activeTerminalId, explanation);
    }, [explanation, activeTerminalId, writeToTerminal]);

    const canSendToTerminal = Boolean(explanation && activeTerminalId);

    const value = useMemo(() => ({
        explanation,
        explanationError,
        isExplaining,
        handleExplain,
        handleExplainSelection,
        handleClearExplanation,
        handleRetryExplanation,
        handleSendExplanationToTerminal,
        canSendToTerminal,
    }), [explanation, explanationError, isExplaining, handleExplain, handleExplainSelection, handleClearExplanation, handleRetryExplanation, handleSendExplanationToTerminal, canSendToTerminal]);

    return (
        <ExplanationContext.Provider value={value}>
            {children}
        </ExplanationContext.Provider>
    );
});

export const useExplanation = () => {
    const ctx = useContext(ExplanationContext);
    if (!ctx) throw new Error('useExplanation must be used within an ExplanationProvider');
    return ctx;
};
