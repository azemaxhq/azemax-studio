import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../hooks/useTheme';
import { getCodeSuggestion, cancelPendingRequest, getInlineCompletion } from '../../utils/codeSuggestionService';
import { sanitizeAiCodeOutputForLanguage } from '../../utils/aiSanitizer';
import { getActiveEditorContext } from '../../core/editor/activeEditorStore';
import { checkCodeErrors } from '../../utils/diagnosticsService';
import { AlertCircle, CheckCircle, Loader2, Minus, Plus, Map as MapIcon, WrapText, GitBranch, Play, Zap, AlignLeft, Save } from 'lucide-react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { AICommentIndicator } from './AICommentIndicator';
import { AIRequestStore } from '../../core/ai/aiRequestStore';
import ReactDOM from 'react-dom';
import { BRAND } from '../../core/branding';
import { useTerminal } from '../../context/TerminalContext';
import { useDebounceCallback } from '../../hooks/useDebounce';
import { setCursorPosition, useCursorPosition } from '../../core/runtime/cursorPositionStore';
import { setActiveEditor, clearActiveEditor } from '../../core/editor/activeEditorStore';
import { getLanguageFromFilename as getMonacoLangId } from '../../utils/language';
import type { FileNode } from '../../utils/mockFileSystem';

// Isolated status-bar readout. Subscribes to the external cursor store, so
// cursor movement updates ONLY this tiny node instead of the whole editor tree.
const CursorStatus: React.FC = React.memo(() => {
    const pos = useCursorPosition();
    return (
        <div className="hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-2 py-0.5 rounded-md cursor-pointer transition-colors leading-none tabular-nums">
            Ln {pos.lineNumber}, Col {pos.column}
        </div>
    );
});

const RunButton: React.FC<{ activeFile: FileNode | null; language: string }> = ({ activeFile, language }) => {
    const { runCode, isRunning } = useTerminal();
    return (
        <button
            onClick={() => {
                if (activeFile) {
                    window.dispatchEvent(new CustomEvent('run-button-clicked'));
                    runCode(activeFile.content || '', language, activeFile.name);
                }
            }}
            disabled={isRunning || !activeFile}
            className="glass-run-button py-1 px-3 text-[11px] h-7 leading-none inline-flex items-center justify-center gap-1.5 antialiased"
        >
            {isRunning ? (
                <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Running...</span>
                </>
            ) : (
                <>
                    <Play size={12} />
                    <span>Run</span>
                </>
            )}
        </button>
    );
};

// Premium AI topbar toggle — Azemax signature control
// Quiet → elegant → branded: dark elevated surface, brand-blue mark, muted AI text
const AITopbarToggle: React.FC<{ isOpen?: boolean; onToggle?: () => void }> = ({ isOpen, onToggle }) => {
    const isWorking = false;
    const [showTip, setShowTip] = React.useState(false);
    const [rect, setRect] = React.useState<DOMRect | null>(null);
    const btnRef = React.useRef<HTMLButtonElement>(null);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const shortcut = isMac ? '⌘L' : 'Ctrl+L';

    const onEnter = React.useCallback(() => {
        timerRef.current = setTimeout(() => {
            if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
            setShowTip(true);
        }, 380);
    }, []);
    const onLeave = React.useCallback(() => {
        clearTimeout(timerRef.current);
        setShowTip(false);
        setRect(null);
    }, []);
    React.useEffect(() => () => clearTimeout(timerRef.current), []);
    if (!onToggle) return null;

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={onToggle}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                onFocus={() => {
                    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
                    setShowTip(true);
                }}
                onBlur={onLeave}
                aria-label={isWorking ? 'Azemax AI — working' : 'Azemax AI'}
                aria-pressed={!!isOpen}
                aria-busy={isWorking ? true : undefined}
                data-active={isOpen ? 'true' : 'false'}
                data-loading={isWorking ? 'true' : undefined}
                className="az-ai-topbar-btn"
            >
                <span className="az-ai-topbar-spinner" aria-hidden />
                <span className="az-ai-wordmark" aria-hidden>
                    <span className="az-ai-topbar-mark">
                        <AzemaxLogo size={19} className="!gap-0 [&_img]:!w-[19px] [&_img]:!h-[19px]" alt="" />
                    </span>
                    <span className="az-ai-topbar-i">i</span>
                </span>
            </button>
            {showTip && rect && ReactDOM.createPortal(
                <div className="az-ai-tooltip" style={{ left: rect.left + rect.width / 2, top: rect.bottom + 8 }} role="tooltip">
                    <div className="az-ai-tooltip-inner">
                        <span>{isWorking ? 'Azemax AI — working…' : 'Azemax AI'}</span>
                        <kbd>{shortcut}</kbd>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

// Language detection helper — delegates to central language.ts for 30+ languages, plaintext fallback
const getLanguage = (fileName: string): string => {
    if (!fileName) return 'plaintext';
    const monacoId = getMonacoLangId(fileName);
    return monacoId;
};



interface CodeEditorProps {
    isAiOpen?: boolean;
    onToggleAi?: () => void;
    isSidebarOpen?: boolean;
    onToggleSidebar?: () => void;
}

let githubDarkThemeDefined = false;

export const CodeEditor: React.FC<CodeEditorProps> = ({ isAiOpen, onToggleAi }) => {
    const { activeFile } = useProjectFile();
    const { updateFileContent, getFileTree, createFile, deleteNode, renameNode } = useProjectActions();
    const { settings, updateSettings } = useSettings();
    const { isDark } = useTheme();
    const monacoRef = useRef<typeof Monaco | null>(null);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const completionProviderRef = useRef<Monaco.IDisposable | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    type InlineCompletionsResult = Monaco.languages.InlineCompletions<Monaco.languages.InlineCompletion>;
    const pendingInlineResolveRef = useRef<((value: InlineCompletionsResult | PromiseLike<InlineCompletionsResult | null | undefined> | null | undefined) => void) | null>(null);
    const activeFileRef = useRef(activeFile);
    /** Cache last non-empty selection so Explain Selection still works after focus leaves editor */
    const lastSelectionRef = useRef<{ fileId: string; text: string; language: string; fileName?: string } | null>(null);

    // Editor State - cursor position lives in an external store (see CursorStatus)
    const isSuggestionsEnabledRef = useRef(settings.ai.inlineSuggestions);

    // Update ref when settings change
    useEffect(() => {
        isSuggestionsEnabledRef.current = settings.ai.inlineSuggestions;
    }, [settings.ai.inlineSuggestions]);

    useEffect(() => {
        activeFileRef.current = activeFile;
        if (activeFile?.id !== lastSelectionRef.current?.fileId) {
            lastSelectionRef.current = null;
        }
    }, [activeFile]);

    // Persist changes for non-settings state - removed for minimap and suggestions as they're now in settings

    // Diagnostics State
    const [isChecking, setIsChecking] = useState(false);
    const [hasErrors, setHasErrors] = useState(false);
    const [isCheckSuccess, setIsCheckSuccess] = useState(false);
    const [isFormatting, setIsFormatting] = useState(false);
    const [, setIsAiProcessing] = useState(false);
    const [activeAiLine, setActiveAiLine] = useState<number | null>(null);
    const [activeAiIntent, setActiveAiIntent] = useState<string | null>(null);
    // Tracks the LIVE editor instance. Unlike a boolean "ready" flag, this
    // changes identity whenever the inner Monaco editor is (re)created (e.g.
    // after the placeholder "no file" view), so effects that attach listeners
    // to the editor re-run on the new instance instead of silently pointing at
    // a disposed one.
    const [editorInstance, setEditorInstance] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);

    // Responsive toolbar sizing
    const toolbarLeftRef = useRef<HTMLDivElement>(null);
    const [toolbarSize, setToolbarSize] = useState<'full' | 'compact' | 'mini'>('full');

    useEffect(() => {
        const el = toolbarLeftRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                if (w >= 520) setToolbarSize('full');
                else if (w >= 340) setToolbarSize('compact');
                else setToolbarSize('mini');
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);



    // Run diagnostics — premium AI + local, version-guarded, with deep check
    const runDiagnostics = useCallback(async () => {
        if (!settings.code.diagnostics) return;
        const file = activeFileRef.current;
        if (!file || !monacoRef.current || !editorRef.current) return;

        const model = editorRef.current.getModel();
        const versionAtStart = model?.getVersionId() ?? -1;
        console.log('Starting diagnostics for file:', file.name);
        setIsChecking(true);
        setHasErrors(false);
        setIsCheckSuccess(false);

        const code = file.content || '';
        const fileName = file.name;

        try {
            // Clear existing markers first
            if (model && !model.isDisposed()) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', []);
            }

            // If code is empty, consider it valid
            if (!code.trim()) {
                console.log('Empty code, considering valid');
                if (diagnosticsDecorationsRef.current) {
                    diagnosticsDecorationsRef.current.clear();
                    diagnosticsDecorationsRef.current = null;
                }
                setIsCheckSuccess(true);
                setTimeout(() => setIsCheckSuccess(false), 800);
                return;
            }

            // Premium: Use AI deep check (Minimax/DeepSeek via /api/ai/chat) + local Monaco diagnostics
            // Falls back to local only if AI is unavailable — keeps Check fast and reliable
            let result;
            try {
                const { checkCodeErrorsWithAI } = await import('../../utils/diagnosticsService');
                // Use AI for files under 8k chars (efficient), local only for huge files
                if (code.length < 8000) {
                    result = await checkCodeErrorsWithAI(code, fileName, undefined, monacoRef.current || undefined);
                } else {
                    result = await checkCodeErrors(code, fileName, monacoRef.current || undefined);
                }
            } catch {
                result = await checkCodeErrors(code, fileName, monacoRef.current || undefined);
            }
            // If user typed during diagnostics, discard stale result
            if (!model || model.isDisposed() || model.getVersionId() !== versionAtStart) {
                console.log('Diagnostics: discarding stale result (version changed)');
                return;
            }
            console.log('Diagnostics result:', result);

            if (model && !model.isDisposed()) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', result.markers);

                // Premium smooth annotation: inline highlight + gutter + hover with "why"
                if (diagnosticsDecorationsRef.current) {
                    diagnosticsDecorationsRef.current.clear();
                    diagnosticsDecorationsRef.current = null;
                }
                if (result.markers.length > 0) {
                    const premiumDecorations: Monaco.editor.IModelDeltaDecoration[] = result.markers.slice(0, 15).map(m => {
                        const isError = m.severity === 8;
                        const lineContent = model.getLineContent(m.startLineNumber) || '';
                        const why = m.message.includes('Unclosed') ? 'Mismatched bracket/brace — usually a missing `)` or `}` on this line or previous.'
                            : m.message.toLowerCase().includes('python') && m.message.toLowerCase().includes('indent') ? 'Python is indentation-sensitive — this line is not aligned with its block.'
                                : m.source === 'AI DeepCheck' ? 'AI detected a semantic issue — logic, security, or style.'
                                    : `Syntax error in ${lineContent.slice(0, 40).trim() || 'this line'}.`;
                        const fix = isError ? 'Fix: close the bracket/brace or correct the syntax and press Check again.' : 'Tip: review the line and re-check.';
                        return {
                            range: new monacoRef.current!.Range(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn),
                            options: {
                                isWholeLine: false,
                                inlineClassName: isError ? 'premium-diag-error-inline' : 'premium-diag-warning-inline',
                                className: isError ? 'premium-diag-error-line' : 'premium-diag-warning-line',
                                glyphMarginClassName: isError ? 'premium-diag-glyph-error' : 'premium-diag-glyph-warning',
                                overviewRuler: {
                                    color: isError ? 'rgba(248,81,73,0.9)' : 'rgba(254,188,46,0.9)',
                                    position: 4, // OverviewRulerLane.Right
                                },
                                minimap: { color: isError ? '#f85149' : '#febc2e', position: 2 },
                                hoverMessage: { value: `**${isError ? 'Error' : 'Warning'} on line ${m.startLineNumber} — ${m.source}**\n\n${m.message}\n\n*Why:* ${why}\n\n*${fix}*` },
                                stickiness: 1,
                            }
                        };
                    });
                    diagnosticsDecorationsRef.current = editorRef.current.createDecorationsCollection(premiumDecorations);
                }
            }

            // Determine if there are actual errors (not warnings)
            const hasActualErrors = result.markers.some(marker => marker.severity === 8); // Severity.Error = 8

            setHasErrors(hasActualErrors);
            if (!hasActualErrors) {
                console.log('No errors detected, showing success');
                setIsCheckSuccess(true);
                setTimeout(() => setIsCheckSuccess(false), 800);
            } else {
                console.log('Errors detected:', result.markers.length);
                setIsCheckSuccess(false);
            }
        } catch (error) {
            console.error('Failed to run diagnostics:', error);
            setHasErrors(true);
            // Show a generic error marker
            if (model) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', [{
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 1000,
                    message: 'Syntax check failed: ' + (error as Error).message,
                    severity: 8,
                    source: 'System'
                }]);
            }
        } finally {
            setIsChecking(false);
        }
    }, [settings.code.diagnostics]);

    // Debounced save to project state with auto-save setting — race-safe vs AI atomic apply
    const debouncedSave = useDebounceCallback((id: string, content: string) => {
        if (!settings.editor.autoSave) return;
        // If an AI edit is in-flight for THIS file, skip — AI holds a snapshot. For other files, save normally.
        if (isProcessingAiCommandRef.current && activeFileRef.current?.id === id) return;
        // If user switched files, latestEditorValue is for the new file — don't use it to discard save for old file
        if (activeFileRef.current?.id !== id) {
            let finalContentForOtherFile = content;
            if (settings.code.formatOnSave) {
                // Don't run formatter for non-active file (no editor model) — save raw
            }
            updateFileContent(id, finalContentForOtherFile);
            return;
        }
        // For the active file, skip if editor already moved on (AI write or newer typing)
        const latestEditorValue = editorRef.current?.getValue();
        if (latestEditorValue !== undefined && latestEditorValue !== content) {
            return;
        }
        let finalContent = content;
        if (settings.code.formatOnSave && editorRef.current) {
            try {
                editorRef.current.getAction('editor.action.formatDocument')?.run();
                finalContent = editorRef.current.getValue();
            } catch {
                // Formatter may not be registered; keep the original content.
            }
        }
        updateFileContent(id, finalContent);
    }, settings.editor.autoSave ? settings.editor.autoSaveDelay : 0);

    const handleEditorChange = (value: string | undefined) => {
        // Clear check status when user starts typing
        if (isCheckSuccess) setIsCheckSuccess(false);
        if (hasErrors) setHasErrors(false);

        // Clear markers and premium annotations when user starts typing to avoid stale errors
        if (editorRef.current && monacoRef.current) {
            const model = editorRef.current.getModel();
            if (model) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', []);
            }
        }
        if (diagnosticsDecorationsRef.current) {
            diagnosticsDecorationsRef.current.clear();
            diagnosticsDecorationsRef.current = null;
        }

        if (activeFile && value !== undefined) {
            debouncedSave(activeFile.id, value);
        }
    };

    // Add keyboard shortcut for syntax checking (Ctrl/Cmd + .)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '.') {
                e.preventDefault();
                runDiagnostics();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [runDiagnostics]);

    // Save shortcut — Ctrl/Cmd+S saves current Monaco content without recreating editor
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                const ed = editorRef.current;
                const file = activeFileRef.current;
                if (ed && file) {
                    const content = ed.getValue();
                    updateFileContent(file.id, content);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [updateFileContent]);

    // Clean up inline-completion debounce timer, pending promise, decorations and
    // any in-flight AI request on unmount so a destroyed editor never leaks.
    useEffect(() => {
        return () => {
            cancelPendingRequest();
            isProcessingAiCommandRef.current = false;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            if (pendingInlineResolveRef.current) {
                pendingInlineResolveRef.current({ items: [] });
                pendingInlineResolveRef.current = null;
            }
            if (commentDecorationTimerRef.current) {
                clearTimeout(commentDecorationTimerRef.current);
                commentDecorationTimerRef.current = null;
            }
            commentDecorationsRef.current?.clear();
            commentDecorationsRef.current = null;
            loadingDecorationRef.current?.clear();
            loadingDecorationRef.current = null;
            if (completionProviderRef.current) {
                completionProviderRef.current.dispose();
                completionProviderRef.current = null;
            }
        };
    }, []);

    // Pending sync when file switches while AI is processing — apply once AI finishes
    const pendingSyncRef = useRef<{ id: string; content: string; name: string } | null>(null);

    // Glitch-free sync when activeFile changes externally (e.g., AI edit via file-tree).
    // Avoids flicker/cursor jump from setValue() by using executeEdits and respecting in-flight AI.
    useEffect(() => {
        if (!editorRef.current || !activeFile) return;
        // If AI is currently applying a /// edit, queue the sync for when it finishes
        // instead of dropping it forever (which would leave editor showing stale file).
        if (isProcessingAiCommandRef.current) {
            pendingSyncRef.current = { id: activeFile.id, content: activeFile.content || '', name: activeFile.name };
            setActiveEditor(editorRef.current, monacoRef.current, { id: activeFile.id, name: activeFile.name });
            return;
        }
        const editor = editorRef.current;
        const model = editor.getModel();
        if (!model || model.isDisposed()) return;
        const currentContent = editor.getValue();
        const nextContent = activeFile.content || '';
        if (currentContent === nextContent) {
            setActiveEditor(editor, monacoRef.current, { id: activeFile.id, name: activeFile.name });
            return;
        }
        // Preserve cursor/selection and undo stack: apply as a single edit, not setValue()
        const selection = editor.getSelection();
        editor.pushUndoStop();
        const fullRange = model.getFullModelRange();
        editor.executeEdits('file-sync', [{ range: fullRange, text: nextContent, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        if (selection) {
            try { editor.setSelection(selection); } catch { }
        }
        setActiveEditor(editor, monacoRef.current, { id: activeFile.id, name: activeFile.name });
    }, [activeFile?.id, activeFile?.content]);

    // Flush any pending file-switch sync once AI processing completes
    useEffect(() => {
        if (isProcessingAiCommandRef.current || !pendingSyncRef.current || !editorRef.current || !activeFile) return;
        const pending = pendingSyncRef.current;
        if (pending.id !== activeFile.id || pending.content !== (activeFile.content || '')) {
            // Active file changed again while we were processing — keep the latest
            pendingSyncRef.current = { id: activeFile.id, content: activeFile.content || '', name: activeFile.name };
            return;
        }
        const editor = editorRef.current;
        const model = editor.getModel();
        if (!model || model.isDisposed()) return;
        if (editor.getValue() === pending.content) {
            pendingSyncRef.current = null;
            return;
        }
        const selection = editor.getSelection();
        editor.pushUndoStop();
        editor.executeEdits('file-sync-pending', [{ range: model.getFullModelRange(), text: pending.content, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        if (selection) { try { editor.setSelection(selection); } catch { } }
        pendingSyncRef.current = null;
        setActiveEditor(editor, monacoRef.current, { id: pending.id, name: pending.name });
    });

    // Sync Single Source of Truth when file switches or is closed
    useEffect(() => {
        if (!activeFile && editorRef.current) {
            clearActiveEditor();
        } else if (activeFile && editorRef.current && monacoRef.current) {
            setActiveEditor(editorRef.current, monacoRef.current, { id: activeFile.id, name: activeFile.name });
        }
    }, [activeFile?.id]);

    // Clear active editor on unmount
    useEffect(() => {
        return () => {
            clearActiveEditor();
        };
    }, []);

    // Explain Selection: respond to request from Explanation panel
    useEffect(() => {
        const sendSelection = (detail: { selection: string; language: string; fileName?: string }) => {
            window.dispatchEvent(new CustomEvent('editor-selection', { detail }));
        };
        const handler = () => {
            const file = activeFileRef.current;
            if (!file) {
                sendSelection({ selection: '', language: 'plaintext', fileName: undefined });
                return;
            }
            const language = getLanguage(file.name || '');
            const cached = lastSelectionRef.current?.fileId === file.id ? lastSelectionRef.current : null;

            const readFromEditor = () => {
                const editor = editorRef.current;
                if (!editor) {
                    if (cached) sendSelection({ selection: cached.text, language: cached.language, fileName: cached.fileName });
                    else sendSelection({ selection: '', language, fileName: file.name });
                    return;
                }
                const model = editor.getModel();
                const selection = editor.getSelection();
                let selectionText = model && selection ? model.getValueInRange(selection) : '';
                if ((!selectionText || selectionText.trim() === '') && cached) {
                    selectionText = cached.text;
                }
                sendSelection({ selection: selectionText, language, fileName: file.name });
            };

            requestAnimationFrame(readFromEditor);
        };
        window.addEventListener('request-editor-selection', handler);
        return () => window.removeEventListener('request-editor-selection', handler);
    }, []);

    // Track if we're currently processing an AI command (to prevent re-triggering)
    const isProcessingAiCommandRef = useRef(false);
    // Deduplicate identical /// triggers per-file (same file + line + content + version) — prevents double invocation and cross-file suppression
    const lastAiTriggerRef = useRef<{ fileId: string; line: number; content: string; versionId: number } | null>(null);

    // Premium Triple-Slash — from-base rebuild, no hardcoded templates, pure DeepSeek Flash dynamic
    const handleAiCommentAutoReplace = useCallback(async (
        editor: Monaco.editor.IStandaloneCodeEditor,
        _monaco: typeof Monaco,
        lineNumber: number,
        lineContent: string
    ) => {
        const match = lineContent.match(/^(.*?)\/\/\/\s*(.+);$/);
        if (!match) return;
        if (isProcessingAiCommandRef.current) return;
        const modelForDedup = editor.getModel();
        const versionForDedup = modelForDedup?.getVersionId() ?? -1;
        const fileIdForDedup = activeFileRef.current?.id ?? 'unknown';
        const last = lastAiTriggerRef.current;
        if (last && last.fileId === fileIdForDedup && last.line === lineNumber && last.content === lineContent && last.versionId === versionForDedup) {
            return;
        }
        lastAiTriggerRef.current = { fileId: fileIdForDedup, line: lineNumber, content: lineContent, versionId: versionForDedup };
        isProcessingAiCommandRef.current = true;

        const model = editor.getModel();
        if (!model) {
            isProcessingAiCommandRef.current = false;
            return;
        }

        const fileIdAtStart = activeFileRef.current?.id ?? null;
        const intent = match[2].trim();
        console.log('[AI Auto-Replace] Detected command:', intent, 'on line:', lineNumber);
        setIsAiProcessing(true);
        setActiveAiLine(lineNumber);
        setActiveAiIntent(intent);
        let reqId: string | null = null;
        try { reqId = AIRequestStore.startRequest('comment', 'thinking'); } catch {}
        // Progressive phases: thinking -> generating
        if (reqId) { try { AIRequestStore.updateRequest(reqId, 'generating'); } catch {} }
        let versionId = model.getVersionId();
        const processingTimeout = setTimeout(() => {
            if (isProcessingAiCommandRef.current) {
                console.warn('[AI Auto-Replace] Timeout — clearing stuck processing state (65s)');
                setIsAiProcessing(false);
                setActiveAiLine(null);
                isProcessingAiCommandRef.current = false;
            }
        }, 65000);

        try {
            if (reqId) { try { AIRequestStore.updateRequest(reqId, 'generating'); } catch {} }
            const { executeTripleSlashPremium } = await import('../../core/ai/tripleSlashPipeline');
            if (reqId) { try { AIRequestStore.updateRequest(reqId, 'applying'); } catch {} }
            const result = await executeTripleSlashPremium({
                editor,
                model,
                lineNumber,
                lineContent,
                workspace: { getFileTree, createFile, deleteNode, renameNode, updateFileContent },
                getFileTree,
            });

            clearTimeout(processingTimeout);

            if (model.isDisposed() || model.getVersionId() !== versionId || activeFileRef.current?.id !== fileIdAtStart) {
                console.log('[AI Auto-Replace] Skipping stale post-check (file switch or version mismatch)');
                return;
            }

            if (!result.success) {
                console.warn('[AI Auto-Replace] Premium pipeline failed:', result.message);
                if (reqId) { try { AIRequestStore.failRequest(reqId, result.message); } catch {} }
                return;
            }
            if (reqId) { try { AIRequestStore.updateRequest(reqId, 'success'); } catch {} }
            // Keep completion visible briefly: "Comments added ✓" then fade
            setTimeout(() => { try { if (reqId) AIRequestStore.completeRequest(reqId); } catch {} }, 1200);
            console.log('[AI Auto-Replace] Premium edit applied:', result.message);

            const newContent = getActiveEditorContext()?.code ?? model.getValue();
            const newLines = newContent.split('\n');
            const targetIdx = Math.min(lineNumber, newLines.length) - 1;
            const col = (newLines[targetIdx]?.length || 0) + 1;
            editor.setPosition({ lineNumber: Math.min(lineNumber, newLines.length), column: col });
            editor.focus();
        } catch (error) {
            console.error('[AI Auto-Replace] Error, editor left untouched:', error);
            if (reqId) { try { AIRequestStore.failRequest(reqId, (error as Error).message); } catch {} }
        } finally {
            clearTimeout(processingTimeout);
            setIsAiProcessing(false);
            // Keep completion visible for 1.2s, otherwise clear immediately
            const isSuccess = reqId ? AIRequestStore.getRequest(reqId)?.status === 'success' : false;
            if (isSuccess) {
                setTimeout(() => {
                    setActiveAiLine(null);
                    setActiveAiIntent(null);
                    isProcessingAiCommandRef.current = false;
                    if (reqId) { try { AIRequestStore.completeRequest(reqId); } catch {} }
                }, 1200);
            } else {
                setActiveAiLine(null);
                setActiveAiIntent(null);
                isProcessingAiCommandRef.current = false;
                if (reqId) {
                    const st = AIRequestStore.getRequest(reqId)?.status;
                    if (st && !['success','error','cancelled'].includes(st)) { try { AIRequestStore.cancelRequest(reqId); } catch {} }
                }
            }
        }
    }, [getFileTree, createFile, deleteNode, renameNode, updateFileContent]);

    // Effect to listen for content changes and trigger AI auto-replace — zero delay
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const editor = editorRef.current;
        const monaco = monacoRef.current;

        const disposable = editor.onDidChangeModelContent((e) => {
            // A keystroke supersedes any pending suggestion or /// command so a
            // stale AI response can never write into text the user has moved on
            // from (the request aborts immediately via the runtime manager).
            cancelPendingRequest();

            // Skip if already processing
            if (isProcessingAiCommandRef.current) return;

            // Check if the change includes a semicolon (handles paste and multi-char inputs)
            const changes = e.changes;
            const triggerLines: number[] = [];
            for (const change of changes) {
                if (change.text.includes(';')) {
                    const model = editor.getModel();
                    if (!model) continue;
                    const startLine = change.range.startLineNumber;
                    const endLine = change.range.startLineNumber + (change.text.split('\n').length - 1);
                    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
                        const lineContent = model.getLineContent(lineNum);
                        if (/^(.*?)\/\/\/\s*.+;$/.test(lineContent)) {
                            if (!triggerLines.includes(lineNum)) triggerLines.push(lineNum);
                        }
                    }
                }
            }

            if (triggerLines.length > 0 && !isProcessingAiCommandRef.current) {
                // Process all trigger lines sequentially (e.g., paste of 3 /// lines)
                for (const lineNum of triggerLines) {
                    const model = editor.getModel();
                    if (!model) break;
                    const currentLineContent = model.getLineContent(lineNum);
                    if (/^(.*?)\/\/\/\s*.+;$/.test(currentLineContent)) {
                        // Only process first immediately; subsequent will be deduped and queued via versionId
                        handleAiCommentAutoReplace(editor, monaco, lineNum, currentLineContent);
                        break; // Process one per change batch to avoid concurrent AI calls
                    }
                }
            }
        });

        return () => {
            disposable.dispose();
        };
    }, [handleAiCommentAutoReplace, editorInstance]);

    // ESC key listener to cancel AI requests
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isProcessingAiCommandRef.current) {
                e.preventDefault();
                e.stopPropagation();
                console.log('[AI] ESC pressed - cancelling request');

                // Cancel the AI request first
                cancelPendingRequest();

                // Use requestAnimationFrame to batch the state updates
                // This prevents visual glitches by ensuring updates happen in sync
                requestAnimationFrame(() => {
                    isProcessingAiCommandRef.current = false;
                    setIsAiProcessing(false);
                    setActiveAiLine(null);
                });
            }
        };

        // Use capture phase to intercept before Monaco handles ESC
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    // AI Comment Decoration Logic - Split into static and loading collections
    const commentDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
    const loadingDecorationRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
    const diagnosticsDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

    // Update static comment decorations (only on content change)
    const updateCommentDecorations = useCallback(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const model = editorRef.current.getModel();
        if (!model) return;

        const content = model.getValue();
        const lines = content.split('\n');
        const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

        lines.forEach((line, index) => {
            const slashIdx = line.indexOf('///');
            if (slashIdx !== -1) {
                const startCol = slashIdx + 1;
                const slashEndCol = startCol + 3;
                // /// prefix → muted accent, keeps source syntax recognizable
                newDecorations.push({
                    range: new monacoRef.current!.Range(index + 1, startCol, index + 1, slashEndCol),
                    options: { isWholeLine: false, inlineClassName: 'ai-comment-slash' }
                });
                // AI suggestion text → slightly brighter secondary, premium italic
                if (line.length >= slashEndCol) {
                    newDecorations.push({
                        range: new monacoRef.current!.Range(index + 1, slashEndCol, index + 1, line.length + 1),
                        options: { isWholeLine: false, inlineClassName: 'ai-comment-suggestion' }
                    });
                }
                // Subtle line container for hover affordance — no large bg
                newDecorations.push({
                    range: new monacoRef.current!.Range(index + 1, 1, index + 1, 1),
                    options: { isWholeLine: true, className: 'ai-comment-line-premium', glyphMarginClassName: 'ai-comment-glyph-premium' }
                });
            }
        });

        if (commentDecorationsRef.current) {
            commentDecorationsRef.current.clear();
        }
        commentDecorationsRef.current = editorRef.current.createDecorationsCollection(newDecorations);
    }, []);

    // Premium — breathing on comment range + caret; spinner is overlay widget (no layout shift)
    const updateLoadingDecoration = useCallback(() => {
        if (!editorRef.current || !monacoRef.current) return;
        if (loadingDecorationRef.current) {
            loadingDecorationRef.current.clear();
            loadingDecorationRef.current = null;
        }
        if (activeAiLine !== null) {
            const model = editorRef.current.getModel();
            const lineContent = model ? model.getLineContent(activeAiLine) : '';
            const slashIdx = lineContent.indexOf('///');
            const commentStartCol = slashIdx !== -1 ? slashIdx + 1 : 1;
            const endCol = lineContent.length + 1;
            loadingDecorationRef.current = editorRef.current.createDecorationsCollection([
                {
                    range: new monacoRef.current!.Range(activeAiLine, commentStartCol, activeAiLine, endCol),
                    options: {
                        isWholeLine: false,
                        inlineClassName: 'ai-comment-breathing'
                    }
                },
                {
                    range: new monacoRef.current!.Range(activeAiLine, endCol, activeAiLine, endCol),
                    options: {
                        isWholeLine: false,
                        inlineClassName: 'ai-comment-caret'
                    }
                }
            ]);
        }
    }, [activeAiLine]);

    // Update comment decorations on content change (debounced to avoid full-file scan per keystroke)
    const commentDecorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!editorRef.current) return;
        const disposable = editorRef.current.onDidChangeModelContent((e) => {
            // Immediate rebuild when the change touches /// (keeps AI-command highlight snappy)
            const touchesAiComment = e.changes.some(c => c.text.includes('///'));
            if (touchesAiComment) {
                if (commentDecorationTimerRef.current) {
                    clearTimeout(commentDecorationTimerRef.current);
                    commentDecorationTimerRef.current = null;
                }
                updateCommentDecorations();
                return;
            }
            // Immediate update — no debounce for faster AI feedback
            if (commentDecorationTimerRef.current) return;
            commentDecorationTimerRef.current = setTimeout(() => {
                commentDecorationTimerRef.current = null;
                updateCommentDecorations();
            }, 0);
        });
        return () => {
            disposable.dispose();
            if (commentDecorationTimerRef.current) {
                clearTimeout(commentDecorationTimerRef.current);
                commentDecorationTimerRef.current = null;
            }
        };
    }, [updateCommentDecorations, editorInstance]);

    // Update loading decoration when activeAiLine changes
    useEffect(() => {
        updateLoadingDecoration();
    }, [updateLoadingDecoration]);

    // Initial decoration update
    useEffect(() => {
        if (editorRef.current && activeFile) {
            updateCommentDecorations();
        }
    }, [activeFile, updateCommentDecorations]);

    // Switching files invalidates any in-flight /// command or inline-completion
    // request so a stale suggestion can never apply to the wrong file.
    useEffect(() => {
        cancelPendingRequest();
        isProcessingAiCommandRef.current = false;
    }, [activeFile?.id]);


    // Fetch suggestion from API
    const fetchSuggestion = async (
        model: Monaco.editor.ITextModel,
        position: Monaco.Position,
        monaco: typeof Monaco,
        token?: Monaco.CancellationToken
    ) => {
        // Stale-guard: capture the document version up-front; if the user types
        // while we're awaiting, every write path below is discarded so a stale
        // suggestion can never be inserted at the wrong place.
        const versionId = model.getVersionId();
        const code = model.getValue();
        const offset = model.getOffsetAt(position);
        const currentActiveFile = activeFileRef.current;
        const fileName = currentActiveFile?.name || 'untitled.ts';
        const language = getLanguage(fileName);

        const isStale = () => Boolean(token?.isCancellationRequested) || model.isDisposed() || model.getVersionId() !== versionId;

        try {
            const result = await getCodeSuggestion({
                code,
                cursorPosition: offset,
                language,
                fileName,
                documentVersion: versionId,
                isStale
            });
            if (isStale()) return { items: [] };

            // If getCodeSuggestion returned a result (/// command), use it
            if (result && result.text !== null && result.text !== undefined && result.text !== '') {
                const safeText = sanitizeAiCodeOutputForLanguage(result.text, language);
                // Never insert an empty/whitespace suggestion after sanitization.
                if (!safeText || safeText.trim() === '') return { items: [] };
                if (result.isModify && result.startOffset !== undefined) {
                    const startPos = model.getPositionAt(result.startOffset);
                    const endPos = position;
                    const range = new monaco.Range(
                        startPos.lineNumber,
                        startPos.column,
                        endPos.lineNumber,
                        endPos.column
                    );
                    return {
                        items: [{
                            insertText: safeText,
                            range: range
                        }]
                    };
                }

                const range = new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column
                );
                return {
                    items: [{
                        insertText: safeText,
                        range: range
                    }]
                };
            }

            // No /// command detected — try general inline completion
            const inlineResult = await getInlineCompletion({
                code,
                cursorPosition: offset,
                language,
                fileName,
                documentVersion: versionId,
                isStale
            });
            if (isStale()) return { items: [] };

            if (inlineResult && inlineResult.text) {
                const safeText = sanitizeAiCodeOutputForLanguage(inlineResult.text, language);
                if (!safeText || safeText.trim() === '') return { items: [] };
                const range = new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column
                );
                return {
                    items: [{
                        insertText: safeText,
                        range: range
                    }]
                };
            }

            return { items: [] };
        } catch (error) {
            console.error('Error fetching suggestion:', error);
            return { items: [] };
        }
    };

    // Keep a ref to the latest fetchSuggestion to avoid stale closures in the provider
    const fetchSuggestionRef = useRef(fetchSuggestion);
    useEffect(() => { fetchSuggestionRef.current = fetchSuggestion; });

    // Register inline completion provider
    const registerInlineCompletionProvider = useCallback((monaco: typeof Monaco) => {
        // Dispose existing provider
        if (completionProviderRef.current) {
            completionProviderRef.current.dispose();
        }

        completionProviderRef.current = monaco.languages.registerInlineCompletionsProvider(
            ['typescript', 'javascript', 'python', 'java', 'c', 'cpp', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'css', 'scss', 'json', 'markdown', 'html', 'shell'],
            {
                provideInlineCompletions: async (model, position, context, token) => {
                    // Logic to check trigger
                    const lineContent = model.getLineContent(position.lineNumber);

                    // Check if this is a completed AI command (ends with ;)
                    // These are handled by handleAiCommentAutoReplace, so skip them here
                    const isCompletedAiCommand = /^\s*\/\/\/\s*.+;\s*$/.test(lineContent);
                    if (isCompletedAiCommand) {
                        return { items: [] };
                    }

                    // Check for in-progress /// commands (without semicolon) - don't auto-suggest
                    // User should complete their command with ; to trigger AI
                    const isAiCommand = /\/\/\//.test(lineContent);

                    // Only provide suggestions for regular code, not /// commands in progress
                    if (isAiCommand) {
                        return { items: [] };
                    }

                    if (!isSuggestionsEnabledRef.current) {
                        return { items: [] };
                    }

                    if (context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic) {
                        // Resolve any previous pending promise (Monaco keeps calling per keystroke;
                        // leaving the old one hanging leaks pending promises)
                        if (pendingInlineResolveRef.current) {
                            pendingInlineResolveRef.current({ items: [] });
                            pendingInlineResolveRef.current = null;
                        }

                        return new Promise((resolve) => {
                            pendingInlineResolveRef.current = resolve;
                            // Zero-delay: fire AI request immediately for fastest response
                            (async () => {
                                if (token.isCancellationRequested || !isSuggestionsEnabledRef.current) {
                                    pendingInlineResolveRef.current = null;
                                    resolve({ items: [] });
                                    return;
                                }
                                try {
                                    const suggestion = await fetchSuggestionRef.current(model, position, monaco, token);
                                    if (pendingInlineResolveRef.current === resolve) {
                                        pendingInlineResolveRef.current = null;
                                    }
                                    resolve(suggestion);
                                } catch (error) {
                                    console.error('[CodeEditor] Error fetching suggestion:', error);
                                    if (pendingInlineResolveRef.current === resolve) {
                                        pendingInlineResolveRef.current = null;
                                    }
                                    resolve({ items: [] });
                                }
                            })();
                        });
                    }

                    // Direct trigger (e.g., from explicit request)
                    try {
                        return await fetchSuggestionRef.current(model, position, monaco, token);
                    } catch (error) {
                        console.error('[CodeEditor] Error fetching suggestion:', error);
                        return { items: [] };
                    }
                },
                disposeInlineCompletions: () => { }
            }
        );
    }, []);

    // Format Document — dynamic via DeepSeek (high-quality, preserves functionality)
    const handleFormat = async () => {
        const editor = editorRef.current;
        const rawCode = editor?.getValue() ?? activeFile?.content ?? '';
        if (!rawCode.trim()) return;
        const fileName = activeFile?.name || 'untitled.js';
        const language = getLanguage(fileName);
        // Don't format if already processing AI
        if (isProcessingAiCommandRef.current) {
            editor?.getAction('editor.action.formatDocument')?.run();
            return;
        }
        setIsFormatting(true);
        try {
            const { sendChat } = await import('../../core/ai/AIClient');
            const { sanitizeEditorOutputWithPolicy } = await import('../../core/ai/AIOutputPolicy');
            const system = `You are a premium code formatter for ${language}. Format the code with proper indentation, line breaks, and idiomatic style. Output ONLY the formatted code, no markdown, no fences, no explanations. Preserve functionality exactly. Use ${language === 'python' ? 'PEP 8' : language === 'javascript' || language === 'typescript' ? 'Prettier' : 'standard'} style.`;
            const user = `File: ${fileName} (${language})\n\nCode to format:\n\`\`\`${language}\n${rawCode}\n\`\`\`\n\nReturn ONLY the formatted code.`;
            const raw = await sendChat(
                [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                { task: 'simple_edit', temperature: 0.1, maxTokens: 2048 },
            );
            const sanitized = sanitizeEditorOutputWithPolicy(raw, {
                task: 'format' as any,
                language,
                filename: fileName,
                userInstruction: 'format code',
                outputMode: 'format' as any,
                preserve: rawCode,
            });
            const finalCode = sanitized?.trim() ? sanitized.trim() : raw.trim();
            if (finalCode && finalCode !== rawCode) {
                const { createExecutorDeps, captureSnapshot } = await import('../../core/editor/workspaceBridge');
                const { executeActionPlan } = await import('../../core/ai/aiToolExecutor');
                const deps: any = createExecutorDeps({ getFileTree, createFile, deleteNode, renameNode, updateFileContent } as any, fileName, activeFile?.id || null);
                const snap: any = captureSnapshot(fileName, rawCode);
                const snapshotMap: any = snap ? new Map([[fileName, snap]]) : new Map();
                const result: any = await executeActionPlan([{ action: 'update_file', path: fileName, content: finalCode } as any], deps, { language, snapshot: snap, snapshotMap } as any);
                if (!result.success) {
                    // Fallback to direct edit if atomic plan was rejected (e.g., stale snapshot)
                    editor?.pushUndoStop();
                    editor?.executeEdits('format', [{ range: editor.getModel()!.getFullModelRange(), text: finalCode }]);
                    editor?.pushUndoStop();
                    if (activeFile) updateFileContent(activeFile.id, finalCode);
                }
            }
        } catch (e) {
            console.warn('[Format] DeepSeek failed, falling back to Prettier', e);
            editor?.getAction('editor.action.formatDocument')?.run();
        } finally {
            setIsFormatting(false);
            setTimeout(() => setIsFormatting(false), 800);
        }
    };

    // Manual save function
    const handleSave = useCallback(() => {
        if (activeFile && editorRef.current) {
            const content = editorRef.current.getValue();
            updateFileContent(activeFile.id, content);
            // Show save indicator (could add a toast notification here)
        }
    }, [activeFile, updateFileContent]);

    const handleEditorBeforeMount: BeforeMount = (monaco) => {
        // Register the custom dark theme BEFORE @monaco-editor/react calls
        // monaco.editor.setTheme(theme) during editor creation. If it were
        // registered only in onMount (which runs after setTheme), Monaco would
        // not find it, fall back to the default light theme, and never re-apply.
        if (!githubDarkThemeDefined) {
            githubDarkThemeDefined = true;
            monaco.editor.defineTheme('github-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '707680', fontStyle: 'italic' },
                    { token: 'comment.doc', foreground: '8B949E', fontStyle: 'italic' },
                    { token: 'keyword', foreground: '58A6FF' },
                    { token: 'keyword.control', foreground: '58A6FF' },
                    { token: 'type', foreground: '79C0FF' },
                    { token: 'type.identifier', foreground: '79C0FF' },
                    { token: 'class', foreground: '79C0FF', fontStyle: 'bold' },
                    { token: 'interface', foreground: '79C0FF' },
                    { token: 'string', foreground: 'A5D6FF' },
                    { token: 'string.escape', foreground: 'FFAB70' },
                    { token: 'number', foreground: '79C0FF' },
                    { token: 'constant', foreground: '79C0FF' },
                    { token: 'variable', foreground: 'F2F3F5' },
                    { token: 'variable.parameter', foreground: 'FFA657' },
                    { token: 'function', foreground: 'D2A8FF' },
                    { token: 'method', foreground: 'D2A8FF' },
                    { token: 'operator', foreground: 'F2F3F5' },
                    { token: 'delimiter', foreground: 'A7ACB5' },
                    { token: 'annotation', foreground: 'FFA657' },
                    { token: 'tag', foreground: '7EE787' },
                    { token: 'attribute.name', foreground: '79C0FF' },
                    { token: 'attribute.value', foreground: 'A5D6FF' },
                    { token: 'regexp', foreground: 'FFAB70' },
                ],
                colors: {
                    'editor.background': '#101318',
                    'editor.foreground': '#F2F3F5',
                    'editorLineNumber.foreground': '#5A5F6A',
                    'editorLineNumber.activeForeground': '#A7ACB5',
                    'editor.lineHighlightBackground': '#14171C',
                    'editorCursor.foreground': '#F2F3F5',
                    'editor.selectionBackground': '#2A3040',
                    'editor.inactiveSelectionBackground': '#232830',
                    'editorIndentGuide.background': '#1E222A',
                    'editorIndentGuide.activeBackground': '#2A344A',
                    'editorBracketPairGuide.background1': '#242830',
                    'editorBracketPairGuide.background2': '#283142',
                    'editorBracketPairGuide.background3': '#1E4D40',
                    'editorBracketPairGuide.background4': '#4D2E1E',
                    'editorBracketPairGuide.activeBackground1': '#303640',
                    'editorBracketPairGuide.activeBackground2': '#3A4A6A',
                    'editorGutter.background': '#101318',
                    'scrollbarSlider.background': '#232830',
                    'scrollbarSlider.hoverBackground': '#303640',
                    'editorOverviewRuler.border': '#101318',
                    'editorRuler.foreground': '#242830',
                    'editor.foldBackground': '#14171C',
                    'editorStickyScroll.background': '#101318',
                    'editorStickyScroll.border': '#242830',
                    'editor.findMatchBackground': '#3B82F633',
                    'editor.findMatchHighlightBackground': '#3B82F61A',
                    'editor.lineHighlightBorder': '#00000000',
                }
            });
        }
    };

    const handleEditorMount: OnMount = (editor, monaco) => {
        monacoRef.current = monaco;
        editorRef.current = editor;
        setEditorInstance(editor);
        // Single Source of Truth: register active Monaco instance for AI context
        if (activeFile) {
            setActiveEditor(editor, monaco, { id: activeFile.id, name: activeFile.name });
        }

        // Track disposables for this editor instance to avoid leaks on remount
        const disposables: Monaco.IDisposable[] = [];
        disposables.push(
            editor.onDidBlurEditorText(() => cancelPendingRequest()),
            editor.onDidChangeCursorPosition((e) => setCursorPosition({ lineNumber: e.position.lineNumber, column: e.position.column })),
            editor.onDidChangeCursorSelection((e) => {
                const model = editor.getModel();
                const sel = e.selection;
                if (!model || !sel) return;
                const text = model.getValueInRange(sel);
                if (text.trim().length > 0 && activeFileRef.current) {
                    lastSelectionRef.current = {
                        fileId: activeFileRef.current.id,
                        text,
                        language: getLanguage(activeFileRef.current.name || ''),
                        fileName: activeFileRef.current.name
                    };
                }
            })
        );
        // Store for cleanup when editor is disposed/remounted
        (editor as any)._codeEditorDisposables = disposables;

        // Powerful AI Commenting — available everywhere via context menu (right-click) and Cmd+Shift+C
        editor.addAction({
            id: 'ai-add-comments',
            label: 'Add AI Comments (Powerful)',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyC],
            contextMenuGroupId: '1_modification',
            contextMenuOrder: 1.5,
            run: async (ed) => {
                const model = ed.getModel();
                if (!model) return;
                const selection = ed.getSelection();
                const hasSelection = !!(selection && !selection.isEmpty());
                const prompt = hasSelection
                    ? 'Add comprehensive comments to the selected code'
                    : 'Add comprehensive comments to this code';
                window.dispatchEvent(new CustomEvent('ai-chat-prefill', { detail: { prompt } }));
                // Focus AI panel if available
                window.dispatchEvent(new CustomEvent('ai-panel-open'));
            }
        });

        editor.addAction({
            id: 'ai-remove-comments',
            label: 'Remove AI Comments',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
            contextMenuGroupId: '1_modification',
            contextMenuOrder: 1.6,
            run: async () => {
                window.dispatchEvent(new CustomEvent('ai-chat-prefill', { detail: { prompt: 'Remove comments' } }));
                window.dispatchEvent(new CustomEvent('ai-panel-open'));
            }
        });

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monaco.languages.typescript.ModuleKind.CommonJS,
            noEmit: true,
            esModuleInterop: true,
            jsx: monaco.languages.typescript.JsxEmit.React,
            reactNamespace: 'React',
            allowJs: true,
            typeRoots: ['node_modules/@types'],
            lib: ['dom', 'dom.iterable', 'esnext'],
            strict: false,
            noImplicitAny: false,
        });

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ESNext,
            allowNonTsExtensions: true,
            allowJs: true,
        });

        registerInlineCompletionProvider(monaco);

        editor.updateOptions({
            inlineSuggest: { enabled: true, mode: 'subwordSmart' },
            quickSuggestions: settings.code.quickSuggestions,
            suggestOnTriggerCharacters: settings.code.quickSuggestions,
            formatOnPaste: settings.code.formatOnPaste,
            formatOnType: settings.code.formatOnType,
        });

        // Geometry fix: after web-font loads the glyph width changes so guide x drifts onto text.
        // Remeasure once fonts are ready and on every mount/resize.
        try {
            if (document.fonts?.ready) {
                document.fonts.ready.then(() => {
                    try { (monaco as any).editor?.remeasureFonts?.(); editor.layout(); } catch {}
                });
            }
            // Immediate remeasure to ensure initial mount aligns after CSS isolation
            requestAnimationFrame(() => { try { (monaco as any).editor?.remeasureFonts?.(); editor.layout(); } catch {} });
        } catch {}
    };

    const language = getLanguage(activeFile?.name || '');

    const densityPadding = useMemo(() => {
        switch (settings.general.uiDensity) {
            case 'compact': return { top: 8, bottom: 8 };
            case 'comfortable': return { top: 24, bottom: 24 };
            default: return { top: 16, bottom: 16 };
        }
    }, [settings.general.uiDensity]);

    const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
        minimap: { enabled: settings.editor.showMinimap, renderCharacters: !settings.performance.optimizeEditorRendering },
        wordWrap: settings.editor.wordWrap ? 'on' : 'off',
        fontSize: settings.editor.fontSize,
        fontFamily: settings.editor.fontFamily,
        // Force geometric precision & no letter-spacing so char width matches guide math
        letterSpacing: 0,
        padding: densityPadding,
        inlineSuggest: { enabled: settings.ai.inlineSuggestions, mode: 'subwordSmart' },
        quickSuggestions: settings.code.quickSuggestions ? { other: true, comments: false, strings: false } : false as any,
        suggestOnTriggerCharacters: settings.code.quickSuggestions,
        quickSuggestionsDelay: 80,
        suggest: {
            showKeywords: true,
            showSnippets: true,
            preview: true,
            insertMode: 'insert' as const,
            filterGraceful: true,
        } as any,
        acceptSuggestionOnEnter: 'on' as const,
        acceptSuggestionOnCommitCharacter: true,
        snippetSuggestions: 'top' as const,
        tabCompletion: 'on',
        wordBasedSuggestions: 'off' as const,
        autoClosingBrackets: 'always' as const,
        autoClosingQuotes: 'always' as const,
        autoClosingDelete: 'always' as const,
        autoSurround: 'languageDefined' as const,
        autoIndent: 'advanced' as const,
        formatOnPaste: settings.code.formatOnPaste,
        formatOnType: settings.code.formatOnType,
        folding: settings.editor.codeFolding,
        foldingStrategy: 'indentation' as const,
        showFoldingControls: 'mouseover' as const,
        unfoldOnClickAfterEndOfLine: false,
        bracketPairColorization: { enabled: settings.editor.bracketPairColorization },
        matchBrackets: 'always' as const,
        // Explicit guide configuration — guides must live in indentation whitespace, not over glyphs
        guides: {
            indentation: true,
            bracketPairs: true,
            bracketPairsHorizontal: false,
            highlightActiveIndentation: true,
            highlightActiveBracketPair: true,
        } as any,
        find: {
            seedSearchStringFromSelection: 'always' as const,
            autoFindInSelection: 'never' as const,
            addExtraSpaceOnTop: false,
        } as any,
        scrollBeyondLastLine: true,
        smoothScrolling: settings.editor.smoothScrolling,
        cursorBlinking: settings.editor.cursorBlinking,
        cursorStyle: settings.editor.cursorStyle,
        cursorSmoothCaretAnimation: settings.performance.optimizeEditorRendering ? 'off' : 'on',
        cursorSurroundingLines: 2,
        renderLineHighlight: settings.performance.optimizeEditorRendering ? 'none' : 'all',
        renderLineHighlightOnlyWhenFocus: false,
        occurrencesHighlight: settings.performance.optimizeEditorRendering ? 'off' : 'singleFile',
        selectionHighlight: true,
        largeFileOptimizations: settings.performance.optimizeEditorRendering,
        fontLigatures: settings.performance.optimizeEditorRendering ? false : undefined,
        tabSize: settings.editor.tabSize,
        insertSpaces: settings.editor.insertSpaces,
        detectIndentation: false,
        lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 10,
        glyphMargin: true,
        renderWhitespace: settings.editor.renderWhitespace,
        stickyScroll: { enabled: settings.editor.stickyScroll },
        linkedEditing: true,
        dragAndDrop: true,
        multiCursorModifier: 'ctrlCmd' as const,
        multiCursorMergeOverlapping: true,
        columnSelection: false,
        copyWithSyntaxHighlighting: true,
        accessibilitySupport: 'off' as const,
        // Prevent layout shifts and ensure guides track glyph metrics
        automaticLayout: true,
        scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
        },
        overviewRulerBorder: false,
        overviewRulerLanes: 3,
        rulers: [] as number[],
    }), [
        settings.editor.showMinimap,
        settings.editor.wordWrap,
        settings.editor.fontSize,
        settings.editor.fontFamily,
        settings.editor.tabSize,
        settings.editor.lineNumbers,
        settings.editor.smoothScrolling,
        settings.editor.cursorBlinking,
        settings.editor.cursorStyle,
        settings.editor.insertSpaces,
        settings.editor.bracketPairColorization,
        settings.editor.renderWhitespace,
        settings.editor.stickyScroll,
        settings.editor.codeFolding,
        settings.code.quickSuggestions,
        settings.code.formatOnPaste,
        settings.code.formatOnType,
        settings.performance.optimizeEditorRendering,
        settings.ai.inlineSuggestions,
        densityPadding,
    ]);

    // When editor geometry deps change, force Monaco to remeasure character grid so guides stay in whitespace
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;
        try { (monacoRef.current as any).editor?.remeasureFonts?.(); editorRef.current.layout(); } catch {}
    }, [settings.editor.fontFamily, settings.editor.fontSize, settings.editor.tabSize, settings.editor.lineNumbers]);

    useEffect(() => {
        if (activeFile?.name) {
            document.title = `${activeFile.name} — ${BRAND.name}`;
        } else {
            document.title = BRAND.name;
        }
    }, [activeFile?.name]);

    if (!activeFile) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center relative select-none" style={{ background: "var(--az-surface)", color: "var(--az-text-muted)"}}>
                <div className="flex flex-col items-center gap-3 mb-6">
                    <AzemaxLogo size={40} />
                    <span className="text-[13px] font-semibold tracking-tight leading-none" style={{ color: "var(--az-text)"}}>{BRAND.name}</span>
                    <p className="text-[11px] leading-relaxed max-w-sm text-center antialiased" style={{ color: "var(--az-text-muted)"}}>
                        Select a file from the explorer or create a new one to get started.
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs" style={{ color: "var(--az-text-muted)"}}>
                    <span className="flex items-center gap-2 px-2.5 py-1 rounded-md border" style={{ background: "var(--az-surface-2)", borderColor: "var(--az-border)"}}>
                        <kbd className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: "var(--az-surface-3)", color: "var(--az-text-secondary)"}}>⌘P</kbd> Search files
                    </span>
                    <span className="flex items-center gap-2 px-2.5 py-1 rounded-md border" style={{ background: "var(--az-surface-2)", borderColor: "var(--az-border)"}}>
                        <kbd className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: "var(--az-surface-3)", color: "var(--az-text-secondary)"}}>⌘B</kbd> Toggle sidebar
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-transparent flex flex-col relative group">
            {/* Toolbar — shares --az-topbar-height with Explorer header for perfect alignment */}
            <div className="flex items-center justify-between px-3 shrink-0 overflow-hidden" style={{ height: 'var(--az-topbar-height)', minHeight: 'var(--az-topbar-height)', background: 'var(--az-surface)', borderBottom: '1px solid var(--az-border)' }}>
                <div ref={toolbarLeftRef} className={`flex items-center min-w-0 flex-1 overflow-hidden ${toolbarSize === 'mini' ? 'gap-0' : toolbarSize === 'compact' ? 'gap-0.5' : 'gap-1'}`}>
                    {/* Check Errors — Premium AI DeepCheck */}
                    <button
                        onClick={runDiagnostics}
                        disabled={isChecking}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:opacity-90 overflow-hidden relative
                            ${toolbarSize === 'full' ? 'gap-1.5 px-3 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isChecking
                                ? 'text-[var(--az-text-secondary)] bg-[var(--az-surface-3)] border border-[var(--az-border)]'
                                : hasErrors
                                    ? 'bg-[var(--az-error-soft)] text-[var(--az-error)] border border-[var(--az-error-border)]'
                                    : isCheckSuccess
                                        ? 'bg-[var(--az-success-soft)] text-[var(--az-success)] border border-[var(--az-success-border)]'
                                        : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title="Deep code check — AI + syntax (Minimax)"
                    >
                        {isChecking ? (
                            <>
                                <span className="relative flex items-center justify-center">
                                    <span className="absolute h-3 w-3 rounded-full bg-violet-500/20 animate-ping" />
                                    <Loader2 size={12} className="animate-spin text-[var(--az-text-muted)] relative" />
                                </span>
                                {toolbarSize === 'full' && <span className="text-[var(--az-text-secondary)]">Checking...</span>}
                                <span className="hidden" />
                            </>
                        ) : hasErrors ? (
                            <AlertCircle size={12} />
                        ) : isCheckSuccess ? (
                            <CheckCircle size={12} className="text-green-300" />
                        ) : (
                            <CheckCircle size={12} />
                        )}
                        {!isChecking && toolbarSize === 'full' && (
                            <span>
                                {hasErrors ? 'Has Errors' : isCheckSuccess ? 'No Errors' : 'Check'}
                            </span>
                        )}
                    </button>

                    <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Code Suggestions Toggle */}
                    <button
                        onClick={() => updateSettings('ai', { inlineSuggestions: !settings.ai.inlineSuggestions })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.ai.inlineSuggestions
                                ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border-strong)]'
                                : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title={settings.ai.inlineSuggestions ? "Disable AI Suggestions" : "Enable AI Suggestions"}
                    >
                        <Zap size={12} className={settings.ai.inlineSuggestions ? "fill-yellow-400" : ""} />
                        {toolbarSize === 'full' && <span>AI</span>}
                    </button>

                    <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Save Button - only show when auto-save is disabled */}
                    {!settings.editor.autoSave && (
                        <button
                            onClick={handleSave}
                            className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:opacity-90
                                ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                                text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border)] hover:bg-[var(--az-surface-hover)]`}
                            title="Save File (Ctrl+S)"
                        >
                            <Save size={12} />
                            {toolbarSize === 'full' && <span>Save</span>}
                        </button>
                    )}

                    {/* Format — Premium DeepSeek with animated loading */}
                    <button
                        onClick={handleFormat}
                        disabled={isFormatting}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:opacity-90 overflow-hidden relative
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isFormatting
                                ? 'text-[var(--az-text-secondary)] bg-[var(--az-surface-3)] border border-[var(--az-border)]'
                                : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title="Format Document (Shift+Alt+F) — Premium DeepSeek"
                    >
                        {isFormatting ? (
                            <>
                                <span className="relative flex items-center justify-center">
                                    <span className="absolute h-3 w-3 rounded-full bg-violet-500/20 animate-ping" />
                                    <span className="absolute h-2 w-2 rounded-full animate-spin" style={{ background: "var(--az-text-muted)", borderTopColor: 'transparent', borderWidth: '1.5px', borderStyle: 'solid' } as React.CSSProperties} />
                                    <Loader2 size={12} className="animate-spin text-[var(--az-text-muted)] relative" />
                                </span>
                                <span className="text-[var(--az-text-secondary)]">
                                    {toolbarSize === 'full' ? 'Formatting...' : ''}
                                </span>
                                <span className="hidden" />
                            </>
                        ) : (
                            <>
                                <AlignLeft size={12} className="group-hover:rotate-3 transition-transform" />
                                {toolbarSize === 'full' && <span>Format</span>}
                            </>
                        )}
                    </button>

                    {/* Word Wrap */}
                    <button
                        onClick={() => updateSettings('editor', { wordWrap: !settings.editor.wordWrap })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:opacity-90
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.wordWrap ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border-strong)]' : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border border-transparent'}`}
                        title="Toggle Word Wrap"
                    >
                        <WrapText size={12} />
                        {toolbarSize === 'full' && <span>Wrap</span>}
                    </button>

                    {/* Minimap */}
                    <button
                        onClick={() => updateSettings('editor', { showMinimap: !settings.editor.showMinimap })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:opacity-90
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.showMinimap ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border-strong)]' : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border border-transparent'}`}
                        title="Toggle Minimap"
                    >
                        <MapIcon size={12} />
                        {toolbarSize === 'full' && <span>Map</span>}
                    </button>

                    {toolbarSize !== 'mini' && (
                        <>
                            <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'compact' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                            {/* Font Size */}
                            <div className="shrink-0 flex items-center gap-0.5 bg-[var(--az-surface-2)] rounded-md border border-[var(--az-border)] px-1 h-7">
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.max(10, settings.editor.fontSize - 1) })}
                                    className="w-6 h-6 flex items-center justify-center text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] rounded transition-colors shrink-0"
                                    aria-label="Decrease font size"
                                >
                                    <Minus size={12} className="shrink-0" />
                                </button>
                                <span className="text-[11px] text-[var(--az-text-secondary)] w-5 text-center font-mono leading-none tabular-nums">{settings.editor.fontSize}</span>
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.min(24, settings.editor.fontSize + 1) })}
                                    className="w-6 h-6 flex items-center justify-center text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] rounded transition-colors shrink-0"
                                    aria-label="Increase font size"
                                >
                                    <Plus size={12} className="shrink-0" />
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3 relative mr-2 shrink-0">
                    <RunButton activeFile={activeFile} language={language} />
                    <AITopbarToggle isOpen={isAiOpen} onToggle={onToggleAi} />
                </div>
            </div>

            {/* Editor Area — uncontrolled to avoid wrapper's setValue() race with glitch-free executeEdits */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
                <Editor
                    height="100%"
                    language={language}
                    defaultValue={activeFile?.content || ''}
                    theme={isDark ? 'github-dark' : 'vs-light'}
                    onChange={handleEditorChange}
                    beforeMount={handleEditorBeforeMount}
                    onMount={handleEditorMount}
                    options={editorOptions}
                />
                <AICommentIndicator activeLine={activeAiLine} intent={activeAiIntent} editorRef={editorRef} monacoRef={monacoRef} />
            </div>

            {/* Status Bar — neutral, calm */}
            {settings.general.showStatusBar && (
                <div className="h-6 min-h-6 text-[11px] leading-none flex items-center justify-between px-3 shrink-0 select-none font-medium overflow-hidden antialiased" style={{ background: 'var(--az-surface-2)', color: 'var(--az-text-muted)', borderTop: '1px solid var(--az-border)'}}>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-1.5 py-0.5 rounded-md cursor-pointer transition-colors leading-none">
                            <GitBranch size={11} className="shrink-0" />
                            <span>main</span>
                        </div>
                        <div className="flex items-center gap-1 hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-1.5 py-0.5 rounded-md cursor-pointer transition-colors leading-none">
                            <CheckCircle size={11} className="shrink-0" />
                            <span>0</span>
                            <AlertCircle size={11} className="ml-1 shrink-0" />
                            <span>0</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <CursorStatus />
                        <div className="w-px h-3" style={{ background: "var(--az-border)"}} />
                        <div className="hidden sm:flex hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-2 py-0.5 rounded-md cursor-pointer transition-colors">
                            UTF-8
                        </div>
                        <div className="w-px h-3" style={{ background: "var(--az-border)"}} />
                        <div className="hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-2 py-0.5 rounded-md cursor-pointer transition-colors font-semibold">
                            {language.toUpperCase()}
                        </div>
                        <div className="w-px h-3" style={{ background: "var(--az-border)"}} />
                        <div className="hidden sm:flex hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-2 py-0.5 rounded-md cursor-pointer transition-colors">
                            Prettier
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};
