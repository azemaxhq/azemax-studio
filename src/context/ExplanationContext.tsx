/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { useProjectActions, useProjectUI } from './ProjectContext';
import { useTerminal } from './TerminalContext';
import { explainFileOrSnippet } from '../utils/groqService';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';

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
        const activeFile = getActiveFile();
        if (!activeFile?.content) return;
        persist({ explanationError: null });
        setIsExplaining(true);
        try {
            const lang = getLanguage(activeFile.name || 'file.ts');
            const result = await explainFileOrSnippet(
                activeFile.content,
                lang,
                activeFile.name || undefined,
                false
            );
            persist({ explanation: result, explanationError: null, explainedFor: activeFile.id });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to generate explanation.';
            persist({ explanationError: message, explanation: null });
        } finally {
            setIsExplaining(false);
        }
    }, [getActiveFile, persist]);

    const handleExplainSelection = useCallback(() => {
        persist({ explanationError: null });
        setIsExplaining(true);
        const handler = (e: Event) => {
            const ce = e as CustomEvent<{ selection?: string; language?: string; fileName?: string }>;
            const detail = ce.detail ?? {};
            const selection = typeof detail.selection === 'string' ? detail.selection : '';
            const language = typeof detail.language === 'string' ? detail.language : 'plaintext';
            const fileName = detail.fileName;

            window.removeEventListener('editor-selection', handler);
            clearTimeout(timeoutId);

            if (!selection || !selection.trim()) {
                persist({ explanationError: 'No code selected. Select some code in the editor, then click Explain Selection.' });
                setIsExplaining(false);
                return;
            }

            explainFileOrSnippet(selection.trim(), language || 'plaintext', fileName, true)
                .then((result) => persist({
                    explanation: result,
                    explanationError: null,
                    explainedFor: activeFileMeta?.id ?? null
                }))
                .catch((err: unknown) => {
                    persist({
                        explanationError: err instanceof Error ? err.message : 'Failed to explain selection.',
                        explanation: null,
                    });
                })
                .finally(() => setIsExplaining(false));
        };
        const timeoutId = setTimeout(() => {
            window.removeEventListener('editor-selection', handler);
            persist({ explanationError: 'No selection received. Select code in the editor, then click Explain Selection.' });
            setIsExplaining(false);
        }, 5000);
        window.addEventListener('editor-selection', handler, { once: true });
        window.dispatchEvent(new CustomEvent('request-editor-selection'));
    }, [persist, activeFileMeta?.id]);

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
