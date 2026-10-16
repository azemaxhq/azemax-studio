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
import { checkDiagnosticsEx } from '../../utils/diagnosticsService';
import { setDiagnosticResult, markStale, subscribeDiagnostics, getDiagnosticResult, getCounts } from '../../core/diagnostics/diagnosticStore';
import type { DiagnosticResultEx } from '../../utils/diagnosticsTypes';
import { AlertCircle, CheckCircle, Loader2, Minus, Plus, Map as MapIcon, WrapText, GitBranch, Play, Zap, AlignLeft, Save } from 'lucide-react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { AICommentIndicator } from './AICommentIndicator';
import { FileTabs } from './FileTabs';
import { AIRequestStore } from '../../core/ai/aiRequestStore';
import ReactDOM from 'react-dom';
import { BRAND } from '../../core/branding';
import { useTerminal } from '../../context/TerminalContext';
import { useKeyedDebounceCallback } from '../../hooks/useDebounce';
import { setCursorPosition, useCursorPosition } from '../../core/runtime/cursorPositionStore';
import { setActiveEditor, clearActiveEditor } from '../../core/editor/activeEditorStore';
import { setupAzemaxDarkPlusHighlighting } from '../../core/editor/darkPlusHighlighting';
import { DisposableStore } from '../../core/runtime/DisposableStore';
import { getLanguageFromFilename as getMonacoLangId } from '../../utils/language';
import type { FileNode } from '../../utils/mockFileSystem';
import { pathOf, findNodeById } from '../../utils/safeTree';
import { isLargeFile } from '../../utils/fileLimits';
import { isEditableTarget, isMonacoTarget } from '../../utils/keyboardGuards';

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
    /**
     * Mobile presentation (<768px): hides the desktop toolbar row
     * (which duplicates the header Run action) in favour of a slim
     * icon-only action strip, clamps code type to 13–15px and parks
     * the minimap. Desktop rendering is untouched.
     */
    isMobile?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ isAiOpen, onToggleAi, isMobile = false }) => {
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
    // Previous file id — used to flush the outgoing file's pending autosave
    // synchronously on switch (C3 data-loss fix).
    const prevFileIdRef = useRef<string | null>(null);
    // Abort handle for the in-flight LOCAL diagnostics check (H4).
    const localCheckAbortRef = useRef<AbortController | null>(null);
    // Single owner for per-editor Monaco listeners (mirrors vscode-main DisposableStore pattern)
    const editorDisposablesRef = useRef<DisposableStore | null>(null);
    const formatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    // Diagnostics State — production-grade
    const [isChecking, setIsChecking] = useState(false);
    const [hasErrors, setHasErrors] = useState(false);
    const [hasWarnings, setHasWarnings] = useState(false);
    const [isCheckSuccess, setIsCheckSuccess] = useState(false);
    const [diagnosticSummary, setDiagnosticSummary] = useState<string>('');
    const [diagnosticStale, setDiagnosticStale] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const diagnosticRequestIdRef = useRef(0);
    const lastDiagnosticResultRef = useRef<DiagnosticResultEx | null>(null);
    const debouncedLocalCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [diagCounts, setDiagCounts] = useState({ errors: 0, warnings: 0, infos: 0, hints: 0, total: 0 });
    const [isFormatting, setIsFormatting] = useState(false);
    const [, setIsAiProcessing] = useState(false);
    const [activeAiLine, setActiveAiLine] = useState<number | null>(null);
    const [_activeAiIntent, setActiveAiIntent] = useState<string | null>(null);
    const pendingLocalCheckRef = useRef(false);
    const isCheckingRef = useRef(false);
    const scheduleLocalCheckRef = useRef<() => void>(() => {});
    useEffect(() => { isCheckingRef.current = isChecking; }, [isChecking]);
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

    // Status bar / Problems counts — subscribed to global diagnostic store
    useEffect(() => {
        const update = () => {
            const c = getCounts(activeFile?.id ?? null);
            setDiagCounts(c);
            // Keep button state in sync when store changes externally (e.g. clear)
            if (c.errors === 0 && c.warnings === 0 && c.total === 0) {
                // No need to force hasErrors; runDiagnostics already controls it, but ensure stale cleared
            }
        };
        update();
        const unsub = subscribeDiagnostics(update);
        return unsub;
    }, [activeFile?.id]);



    // Run diagnostics — production-grade: cancellable, version-guarded, file-aware
    const runDiagnostics = useCallback(async () => {
        // Settings guard — truthful disabled UX (button shows disabled, but guard here too)
        if (!settings.code.diagnostics) {
            return;
        }
        const file = activeFileRef.current;
        if (!file || !monacoRef.current || !editorRef.current) return;

        const editor = editorRef.current;
        const monaco = monacoRef.current;
        const model = editor.getModel();
        if (!model || model.isDisposed()) return;

        // Rapid-check protection: cancel previous run, start newest
        if (abortControllerRef.current) {
            try { abortControllerRef.current.abort(); } catch {}
            abortControllerRef.current = null;
        }
        const requestId = ++diagnosticRequestIdRef.current;
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const versionAtStart = model.getVersionId();
        const fileIdAtStart = file.id;
        const fileNameAtStart = file.name;
        const filePathAtStart = pathOf(getFileTree(), file.id) || file.name;
        const cursorLine = editor.getPosition()?.lineNumber ?? null;
        // Use actual editor content (unsaved) — single source of truth
        const code = model.getValue();
        const fileName = file.name;

        setIsChecking(true);
        setHasErrors(false);
        setHasWarnings(false);
        setIsCheckSuccess(false);
        setDiagnosticStale(false);
        setDiagnosticSummary('Checking...');

        // Clear previous error state but keep markers until new result arrives (stale visual deferred to onType)
        try {
            // Empty file → no issues, deterministic success
            if (!code.trim()) {
                if (monaco && model && !model.isDisposed()) {
                    monaco.editor.setModelMarkers(model, 'piston-diagnostics', []);
                }
                if (diagnosticsDecorationsRef.current) {
                    diagnosticsDecorationsRef.current.clear();
                    diagnosticsDecorationsRef.current = null;
                }
                const emptyResult: DiagnosticResultEx = {
                    diagnostics: [],
                    markers: [],
                    errorCount: 0,
                    warningCount: 0,
                    infoCount: 0,
                    hintCount: 0,
                    isError: false,
                    output: '',
                    status: 'success',
                    aiStatus: 'skipped',
                    localStatus: 'success',
                    summary: 'No issues found',
                    isPartial: false,
                    errors: {},
                    meta: { requestId: String(requestId), fileId: fileIdAtStart, fileName: fileNameAtStart, filePath: filePathAtStart, versionId: versionAtStart, timestamp: Date.now() },
                };
                lastDiagnosticResultRef.current = emptyResult;
                setDiagnosticResult(fileIdAtStart, emptyResult);
                setIsCheckSuccess(true);
                setDiagnosticSummary('No issues found');
                // Keep success visible until next edit or check (no 800ms auto-hide)
                setIsChecking(false);
                abortControllerRef.current = null;
                return;
            }

            const result = await checkDiagnosticsEx(code, fileName, {
                fileId: fileIdAtStart,
                filePath: filePathAtStart,
                versionId: versionAtStart,
                requestId: String(requestId),
                includeAI: true,
                monaco: monaco ?? undefined,
                signal: abortController.signal,
                cursorLine,
            });

            // Cancellation / stale-result protection: verify still current
            if (abortController.signal.aborted) {
                // Cancelled → return to idle without false success
                setIsChecking(false);
                return;
            }
            const currentModel = editorRef.current?.getModel();
            const currentFile = activeFileRef.current;
            if (
                !currentModel || currentModel.isDisposed() ||
                currentModel.getVersionId() !== versionAtStart ||
                currentFile?.id !== fileIdAtStart ||
                diagnosticRequestIdRef.current !== requestId
            ) {
                // Stale result — discard silently, do not overwrite newer state
                return;
            }

            // Apply markers — ONLY our owner, never wipe unrelated diagnostics
            if (currentModel && !currentModel.isDisposed()) {
                monaco.editor.setModelMarkers(currentModel, 'piston-diagnostics', result.markers);

                // Decorations: all diagnostics in markers, only top 15 get premium visuals
                if (diagnosticsDecorationsRef.current) {
                    diagnosticsDecorationsRef.current.clear();
                    diagnosticsDecorationsRef.current = null;
                }
                if (result.diagnostics.length > 0) {
                    const premiumDecorations: Monaco.editor.IModelDeltaDecoration[] = result.diagnostics.slice(0, 15).map(d => {
                        const isError = d.severity === 'error';
                        const isWarning = d.severity === 'warning';
                        // Truthful hover: no invented Why/Fix
                        let hover = `**${isError ? 'Error' : isWarning ? 'Warning' : d.severity === 'info' ? 'Info' : 'Hint'} — ${d.source === 'ai' ? 'AI DeepCheck' : d.source === 'monaco' ? 'Monaco' : 'Language'}**`;
                        if (d.code) hover += ` \`${d.code}\``;
                        hover += `  (line ${d.line})`;
                        hover += `\n\n${d.message}`;
                        if (d.fileName && d.fileName !== fileNameAtStart) hover += `\n\n*File: ${d.fileName}*`;
                        // No fake "Press Check again"
                        return {
                            range: new monaco.Range(d.line, d.column, d.endLine, d.endColumn),
                            options: {
                                isWholeLine: false,
                                inlineClassName: isError ? 'premium-diag-error-inline' : isWarning ? 'premium-diag-warning-inline' : 'premium-diag-info-inline',
                                className: isError ? 'premium-diag-error-line' : isWarning ? 'premium-diag-warning-line' : 'premium-diag-info-line',
                                glyphMarginClassName: isError ? 'premium-diag-glyph-error' : isWarning ? 'premium-diag-glyph-warning' : 'premium-diag-glyph-info',
                                overviewRuler: {
                                    color: isError ? 'rgba(255,125,139,0.9)' : isWarning ? 'rgba(240,198,116,0.9)' : 'rgba(127,168,240,0.9)',
                                    position: 4,
                                },
                                minimap: { color: isError ? '#FF7D8B' : isWarning ? '#F0C674' : '#5B8CFF', position: 2 },
                                hoverMessage: { value: hover },
                                stickiness: 1,
                            }
                        };
                    });
                    diagnosticsDecorationsRef.current = editorRef.current!.createDecorationsCollection(premiumDecorations);
                }
            }

            // Update store for Problems/status bar
            lastDiagnosticResultRef.current = result;
            setDiagnosticResult(fileIdAtStart, result);

            const hasErr = result.errorCount > 0;
            const hasWarn = result.warningCount > 0;
            setHasErrors(hasErr);
            setHasWarnings(hasWarn);
            setDiagnosticSummary(result.summary);
            // Success state persists until next edit/check (truthful)
            if (!hasErr) {
                setIsCheckSuccess(true);
            } else {
                setIsCheckSuccess(false);
            }

            // Partial / AI failure handling: keep local result, log AI error but don't scare
            if (result.aiStatus === 'failed' && result.errors.ai) {
                console.warn('[Diagnostics] AI check unavailable:', result.errors.ai);
            }
            if (result.localStatus === 'failed' && result.errors.local) {
                console.warn('[Diagnostics] Local diagnostics failed:', result.errors.local);
            }

        } catch (error) {
            if ((error as DOMException)?.name === 'AbortError' || abortController.signal.aborted) {
                // Cancelled — return to idle without error
                setIsChecking(false);
                return;
            }
            console.error('Failed to run diagnostics:', error);
            setHasErrors(true);
            setDiagnosticSummary('Check failed');
            // Only show generic marker if no result
            const m = editorRef.current?.getModel();
            if (m && !m.isDisposed() && monaco) {
                monaco.editor.setModelMarkers(m, 'piston-diagnostics', [{
                    startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1000,
                    message: 'Syntax check failed: ' + (error as Error).message,
                    severity: 8, source: 'System'
                }]);
            }
            const failed: DiagnosticResultEx = {
                diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 1000, message: 'Syntax check failed: ' + (error as Error).message, severity: 'error', source: 'language', fileName: fileNameAtStart, fileId: fileIdAtStart }],
                markers: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1000, message: 'Syntax check failed: ' + (error as Error).message, severity: 8, source: 'System' }],
                errorCount: 1, warningCount: 0, infoCount: 0, hintCount: 0, isError: true, output: (error as Error).message, status: 'error', aiStatus: 'failed', localStatus: 'failed', summary: 'Check failed', isPartial: false, errors: { local: (error as Error).message }, meta: { requestId: String(requestId), fileId: fileIdAtStart, fileName: fileNameAtStart, filePath: filePathAtStart, versionId: versionAtStart, timestamp: Date.now() },
            };
            setDiagnosticResult(fileIdAtStart, failed);
        } finally {
            // Only clear checking if this request is still current
            if (diagnosticRequestIdRef.current === requestId) {
                setIsChecking(false);
                if (abortControllerRef.current === abortController) abortControllerRef.current = null;
                if (pendingLocalCheckRef.current) {
                    pendingLocalCheckRef.current = false;
                    // Coalesced pending local check — delegate to ref (defined later) to avoid forward-reference
                    scheduleLocalCheckRef.current();
                }
            }
        }
    }, [settings.code.diagnostics, getFileTree]);

    // Debounced save — latest-wins. Captured `content` is from handleEditorChange
    // but the authoritative value at fire time is `editor.getValue()` for the active
    // file. Spec: dirty→saving must eventually persist latest editor content.
    // Debounced save — keyed per file. A shared single timer would discard
    // file A's pending save when the user types in file B inside the window
    // (silent data loss). Each file id owns its timer; the outgoing file is
    // flushed synchronously on switch (see switch effect) and on pagehide.
    const saveDebounced = useKeyedDebounceCallback((id: string, content: string) => {
        if (!settings.editor.autoSave) return;
        if (isProcessingAiCommandRef.current && activeFileRef.current?.id === id) return;
        if (activeFileRef.current?.id !== id) {
            // File no longer active — no live model; captured content is authoritative
            updateFileContent(id, content);
            return;
        }
        const ed = editorRef.current;
        const model = ed?.getModel();
        const latestEditorValue = model && !model.isDisposed() ? ed!.getValue() : undefined;
        // If active file and latest differs from captured, the user (or AI) typed
        // again after the debounce was scheduled. Persist LATEST, not stale capture.
        // This satisfies CASE 1 (A→AB→ABC → ABC), CASE 2 (AI XYZ wins), CASE 3 (user edit after AI).
        let finalContent: string;
        if (latestEditorValue !== undefined && latestEditorValue !== content) {
            finalContent = latestEditorValue;
        } else {
            finalContent = content;
        }
        // Verify target still exists before writing (CASE 4 file switch / delete)
        try {
            const tree = getFileTree();
            const node = findNodeById(tree, id) as FileNode | null;
            if (!node) return;
        } catch { return; }
        if (settings.code.formatOnSave && ed && model && !model.isDisposed()) {
            // Format the *latest* content, not the stale capture. Use captured model's value
            // if it matches finalContent to avoid formatting stale text.
            try {
                // Only run formatter if finalContent matches current model (active file)
                if (ed.getValue() === finalContent) {
                    ed.getAction('editor.action.formatDocument')?.run();
                    finalContent = ed.getValue();
                }
            } catch {
                // Formatter may not be registered; keep finalContent.
            }
        }
        updateFileContent(id, finalContent);
    }, settings.editor.autoSave ? settings.editor.autoSaveDelay : 0);

    // Local debounced check — lightweight, no AI, keeps diagnostics fresh while typing.
    // If a full Check is running, coalesce into one pending request run after it finishes.
    const runLocalCheckNow = useCallback(async () => {
        const file = activeFileRef.current;
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        const model = editor?.getModel();
        if (!file || !editor || !monaco || !model || model.isDisposed()) return;
        // H3: skip duplicate-model local checks for large files.
        if (isLargeFile(model.getValueLength())) return;
        // H4: cancel the previous in-flight local check — typing must not
        // stack unbounded concurrent full-model checks.
        try { localCheckAbortRef.current?.abort(); } catch { /* ignore */ }
        const localAbort = new AbortController();
        localCheckAbortRef.current = localAbort;
        const code = model.getValue();
        if (!code.trim()) return;
        const filePath = pathOf(getFileTree(), file.id) || file.name;
        const versionAtCapture = model.getVersionId();
        try {
            const localResult = await checkDiagnosticsEx(code, file.name, {
                fileId: file.id,
                filePath,
                versionId: versionAtCapture,
                includeAI: false,
                monaco: monaco ?? undefined,
                signal: localAbort.signal,
            });
            if (localAbort.signal.aborted) return;
            if (activeFileRef.current?.id !== file.id) return;
            const curModel = editorRef.current?.getModel();
            if (!curModel || curModel.isDisposed() || curModel.getVersionId() !== versionAtCapture) return;
            // Stale-guard: if a full Check started after we captured, don't overwrite its pending result
            if (isCheckingRef.current) return;
            const prev = getDiagnosticResult(file.id);
            const hasAI = prev && prev.diagnostics.some(d => d.source === 'ai');
            if (hasAI && localResult.diagnostics.length === 0) return;
            if (prev && prev.diagnostics.length > 0) {
                setDiagnosticStale(true);
                markStale(file.id);
                return;
            }
            if (curModel && !curModel.isDisposed()) {
                monaco.editor.setModelMarkers(curModel, 'piston-diagnostics', localResult.markers);
            }
        } catch { /* ignore */ }
    }, [getFileTree]);

    const scheduleLocalCheck = useCallback(() => {
        if (!settings.code.diagnostics) return;
        if (debouncedLocalCheckRef.current) clearTimeout(debouncedLocalCheckRef.current);
        debouncedLocalCheckRef.current = setTimeout(async () => {
            if (isCheckingRef.current) {
                pendingLocalCheckRef.current = true;
                return;
            }
            await runLocalCheckNow();
        }, 600);
    }, [settings.code.diagnostics, runLocalCheckNow]);
    useEffect(() => { scheduleLocalCheckRef.current = scheduleLocalCheck; }, [scheduleLocalCheck]);

    const handleEditorChange = (value: string | undefined) => {
        // Mark diagnostics as potentially stale rather than destroying them
        if (isCheckSuccess) setIsCheckSuccess(false);
        // Keep hasErrors/hasWarnings visible but mark stale
        if (hasErrors || hasWarnings) {
            setDiagnosticStale(true);
            const fid = activeFileRef.current?.id ?? null;
            if (fid) markStale(fid);
        }

        // Do NOT immediately clear markers — keep them as stale visual until next Check or debounced local
        // Decorations remain but will be faded via stale state if needed

        if (activeFile && value !== undefined) {
            saveDebounced.call(activeFile.id, activeFile.id, value);
        }
        scheduleLocalCheck();
    };

    // Add keyboard shortcut for syntax checking (Ctrl/Cmd + .) — same path as button.
    // H8: Monaco owns Ctrl+. (quick-fix) when the editor has focus — don't steal it.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '.') {
                if (isMonacoTarget(e.target)) return;
                // Honor disabled state — don't silently fail
                if (!settings.code.diagnostics) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                // Rapid protection: if already checking, shortcut triggers cancel+restart via runDiagnostics
                runDiagnostics();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [runDiagnostics, settings.code.diagnostics]);

    // Save shortcut — Ctrl/Cmd+S saves current Monaco content without recreating editor.
    // H8/M13: never hijack from an unrelated text input (settings search,
    // stdin box, AI composer) — only save when the editor has focus or when
    // focus is on non-editable chrome.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                if (isEditableTarget(e.target) && !isMonacoTarget(e.target)) return;
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
            if (abortControllerRef.current) {
                try { abortControllerRef.current.abort(); } catch {}
                abortControllerRef.current = null;
            }
            if (debouncedLocalCheckRef.current) {
                clearTimeout(debouncedLocalCheckRef.current);
                debouncedLocalCheckRef.current = null;
            }
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
            if (formatTimeoutRef.current) {
                clearTimeout(formatTimeoutRef.current);
                formatTimeoutRef.current = null;
            }
            commentDecorationsRef.current?.clear();
            commentDecorationsRef.current = null;
            loadingDecorationRef.current?.clear();
            loadingDecorationRef.current = null;
            if (commentErrorTimerRef.current) {
                clearTimeout(commentErrorTimerRef.current);
                commentErrorTimerRef.current = null;
            }
            commentErrorDecorationRef.current?.clear();
            commentErrorDecorationRef.current = null;
            diagnosticsDecorationsRef.current?.clear();
            diagnosticsDecorationsRef.current = null;
            if (completionProviderRef.current) {
                completionProviderRef.current.dispose();
                completionProviderRef.current = null;
            }
            editorDisposablesRef.current?.dispose();
            editorDisposablesRef.current = null;
        };
    }, []);

    // Pending sync when file switches while AI is processing — apply once AI finishes
    const pendingSyncRef = useRef<{ id: string; content: string; name: string } | null>(null);
    // Flush pending file-switch sync when AI completes or activeFile changes
    const flushPendingSync = useCallback(() => {
        if (isProcessingAiCommandRef.current || !pendingSyncRef.current || !editorRef.current || !activeFile) return;
        const pending = pendingSyncRef.current;
        if (pending.id !== activeFile.id || pending.content !== (activeFile.content || '')) {
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
        if (selection) { try { editor.setSelection(selection); } catch { /* ignore */ } }
        pendingSyncRef.current = null;
        const pendPath = pathOf(getFileTree(), pending.id) || pending.name;
        setActiveEditor(editor, monacoRef.current, { id: pending.id, name: pending.name, path: pendPath });
    }, [activeFile?.id, activeFile?.content, getFileTree]);

    // Glitch-free sync when activeFile changes externally (e.g., AI edit via file-tree).
    // Avoids flicker/cursor jump from setValue() by using executeEdits and respecting in-flight AI.
    useEffect(() => {
        if (!editorRef.current || !activeFile) return;
        const fullPath = pathOf(getFileTree(), activeFile.id) || activeFile.name;
        // If AI is currently applying a /// edit, queue the sync for when it finishes
        // instead of dropping it forever (which would leave editor showing stale file).
        if (isProcessingAiCommandRef.current) {
            pendingSyncRef.current = { id: activeFile.id, content: activeFile.content || '', name: activeFile.name };
            setActiveEditor(editorRef.current, monacoRef.current, { id: activeFile.id, name: activeFile.name, path: fullPath });
            return;
        }
        const editor = editorRef.current;
        const model = editor.getModel();
        if (!model || model.isDisposed()) return;
        const currentContent = editor.getValue();
        const nextContent = activeFile.content || '';
        if (currentContent === nextContent) {
            setActiveEditor(editor, monacoRef.current, { id: activeFile.id, name: activeFile.name, path: fullPath });
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
        setActiveEditor(editor, monacoRef.current, { id: activeFile.id, name: activeFile.name, path: fullPath });
    }, [activeFile?.id, activeFile?.content]);

    // Flush pending sync when AI completes or activeFile changes (replaces render-polling effect)
    useEffect(() => {
        flushPendingSync();
    }, [flushPendingSync]);
    useEffect(() => {
        // Also poll one frame after AI processing flag flips via state update
        if (!isProcessingAiCommandRef.current) flushPendingSync();
    });

    // Sync Single Source of Truth when file switches or is closed — also handles diagnostic staleness
    useEffect(() => {
        // C3 fix: flush the OUTGOING file's pending autosave synchronously
        // before the swap, so switching files can never discard its edits.
        const outgoingId = prevFileIdRef.current;
        if (outgoingId && activeFile && outgoingId !== activeFile.id) {
            saveDebounced.flush(outgoingId);
        }
        prevFileIdRef.current = activeFile ? activeFile.id : null;
        // Cancel any in-flight Check — stale result must never reach new file
        if (abortControllerRef.current) {
            try { abortControllerRef.current.abort(); } catch {}
            abortControllerRef.current = null;
        }
        diagnosticRequestIdRef.current++;
        setIsChecking(false);
        if (debouncedLocalCheckRef.current) {
            clearTimeout(debouncedLocalCheckRef.current);
            debouncedLocalCheckRef.current = null;
        }
        // Abort any in-flight local check — its result belongs to the old file.
        try { localCheckAbortRef.current?.abort(); } catch { /* ignore */ }
        localCheckAbortRef.current = null;

        if (!activeFile && editorRef.current) {
            clearActiveEditor();
            // Clear diagnostics UI for closed file
            if (editorRef.current && monacoRef.current) {
                const m = editorRef.current.getModel();
                if (m && !m.isDisposed()) monacoRef.current.editor.setModelMarkers(m, 'piston-diagnostics', []);
            }
            diagnosticsDecorationsRef.current?.clear();
            diagnosticsDecorationsRef.current = null;
            setHasErrors(false);
            setHasWarnings(false);
            setIsCheckSuccess(false);
            setDiagnosticSummary('');
            setDiagnosticStale(false);
        } else if (activeFile && editorRef.current && monacoRef.current) {
            const fp = pathOf(getFileTree(), activeFile.id) || activeFile.name;
            setActiveEditor(editorRef.current, monacoRef.current, { id: activeFile.id, name: activeFile.name, path: fp });
            // Restore diagnostics for new file from store, or clear if none
            const stored = getDiagnosticResult(activeFile.id);
            const model = editorRef.current.getModel();
            if (stored && stored.markers.length > 0 && model && !model.isDisposed()) {
                // Verify still same file (stale guard)
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', stored.markers);
                setHasErrors(stored.errorCount > 0);
                setHasWarnings(stored.warningCount > 0);
                setDiagnosticSummary(stored.summary);
                setIsCheckSuccess(stored.status === 'success' && stored.errorCount === 0);
                setDiagnosticStale(!!stored.isStale);
                // Recreate decorations for stored diagnostics (top 15)
                if (diagnosticsDecorationsRef.current) {
                    diagnosticsDecorationsRef.current.clear();
                    diagnosticsDecorationsRef.current = null;
                }
                if (stored.diagnostics.length > 0) {
                    const decos: Monaco.editor.IModelDeltaDecoration[] = stored.diagnostics.slice(0, 15).map(d => {
                        const isError = d.severity === 'error';
                        const isWarning = d.severity === 'warning';
                        let hover = `**${isError ? 'Error' : isWarning ? 'Warning' : d.severity === 'info' ? 'Info' : 'Hint'} — ${d.source === 'ai' ? 'AI DeepCheck' : d.source === 'monaco' ? 'Monaco' : 'Language'}**`;
                        if (d.code) hover += ` \`${d.code}\``;
                        hover += `  (line ${d.line})\n\n${d.message}`;
                        return {
                            range: new monacoRef.current!.Range(d.line, d.column, d.endLine, d.endColumn),
                            options: {
                                isWholeLine: false,
                                inlineClassName: isError ? 'premium-diag-error-inline' : isWarning ? 'premium-diag-warning-inline' : 'premium-diag-info-inline',
                                className: isError ? 'premium-diag-error-line' : isWarning ? 'premium-diag-warning-line' : 'premium-diag-info-line',
                                glyphMarginClassName: isError ? 'premium-diag-glyph-error' : isWarning ? 'premium-diag-glyph-warning' : 'premium-diag-glyph-info',
                                overviewRuler: { color: isError ? 'rgba(255,125,139,0.9)' : isWarning ? 'rgba(240,198,116,0.9)' : 'rgba(127,168,240,0.9)', position: 4 },
                                minimap: { color: isError ? '#FF7D8B' : isWarning ? '#F0C674' : '#5B8CFF', position: 2 },
                                hoverMessage: { value: hover },
                                stickiness: 1,
                            }
                        };
                    });
                    diagnosticsDecorationsRef.current = editorRef.current.createDecorationsCollection(decos);
                }
            } else {
                if (model && !model.isDisposed()) monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', []);
                diagnosticsDecorationsRef.current?.clear();
                diagnosticsDecorationsRef.current = null;
                setHasErrors(false);
                setHasWarnings(false);
                setIsCheckSuccess(false);
                setDiagnosticSummary('');
                setDiagnosticStale(false);
            }
        }
    }, [activeFile?.id, getFileTree]);

    // Clear active editor on unmount — and flush any pending autosave first
    // so unmount (or tab close) can never discard the last edits.
    useEffect(() => {
        return () => {
            saveDebounced.flushAll();
            clearActiveEditor();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Attempt persistence when the page is being hidden/closed. Browsers may
    // not run async work here — flushAll() is synchronous localStorage writes.
    useEffect(() => {
        const onHide = () => saveDebounced.flushAll();
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') saveDebounced.flushAll();
        };
        window.addEventListener('pagehide', onHide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', onHide);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Problems panel navigation — jump to diagnostic location
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { line: number; column?: number };
            if (!detail || typeof detail.line !== 'number') return;
            const editor = editorRef.current;
            if (!editor) return;
            try {
                editor.revealLineInCenter(detail.line);
                editor.setPosition({ lineNumber: detail.line, column: detail.column ?? 1 });
                editor.focus();
            } catch { /* ignore */ }
        };
        window.addEventListener('problems-navigate', handler as EventListener);
        return () => window.removeEventListener('problems-navigate', handler as EventListener);
    }, []);

    // Track if we're currently processing an AI command (to prevent re-triggering)
    const isProcessingAiCommandRef = useRef(false);
    // Deduplicate identical /// triggers per-file (same file + line + content + version) — prevents double invocation and cross-file suppression
    const lastAiTriggerRef = useRef<{ fileId: string; line: number; content: string; versionId: number } | null>(null);
    // Transient inline failure marker — makes a failed /// trigger diagnosable
    // in the editor instead of failing silently (trigger line is always kept).
    const commentErrorDecorationRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
    const commentErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearTripleSlashError = useCallback(() => {
        if (commentErrorTimerRef.current) {
            clearTimeout(commentErrorTimerRef.current);
            commentErrorTimerRef.current = null;
        }
        commentErrorDecorationRef.current?.clear();
        commentErrorDecorationRef.current = null;
    }, []);
    const showTripleSlashError = useCallback((lineNumber: number, message: string) => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco) return;
        const model = editor.getModel();
        if (!model || model.isDisposed()) return;
        clearTripleSlashError();
        const lineLen = model.getLineContent(lineNumber)?.length ?? 0;
        if (lineLen <= 0) return;
        commentErrorDecorationRef.current = editor.createDecorationsCollection([{
            range: new monaco.Range(lineNumber, 1, lineNumber, lineLen + 1),
            options: {
                isWholeLine: false,
                inlineClassName: 'ai-comment-error',
                hoverMessage: { value: `Azemax /// failed — ${message}` },
                stickiness: 1,
            },
        }]);
        // Transient: auto-dismiss so a stale marker never lingers
        commentErrorTimerRef.current = setTimeout(clearTripleSlashError, 4500);
    }, [clearTripleSlashError]);

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
        clearTripleSlashError();

        const model = editor.getModel();
        if (!model) {
            isProcessingAiCommandRef.current = false;
            return;
        }

        const fileIdAtStart = activeFileRef.current?.id ?? null;
        const intent = match[2].trim();
        setIsAiProcessing(true);
        setActiveAiLine(lineNumber);
        setActiveAiIntent(intent);
        let reqId: string | null = null;
        try { reqId = AIRequestStore.startRequest('comment', 'thinking'); } catch {}
        // Progressive phases: thinking -> generating
        if (reqId) { try { AIRequestStore.updateRequest(reqId, 'generating'); } catch {} }
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

            // NOTE: the pipeline's own apply bumps the model version, so a
            // version mismatch here is EXPECTED after success — it must not
            // be treated as stale. Only file-switch/dispose discards the result.
            if (model.isDisposed() || activeFileRef.current?.id !== fileIdAtStart) {
                return;
            }

            if (!result.success) {
                console.warn('[AI Auto-Replace] Premium pipeline failed:', result.message);
                if (reqId) { try { AIRequestStore.failRequest(reqId, result.message); } catch {} }
                showTripleSlashError(lineNumber, result.message || 'AI request failed — trigger kept, retry or rephrase');
                return;
            }
            if (reqId) { try { AIRequestStore.updateRequest(reqId, 'success'); } catch {} }
            // Keep completion visible briefly: "Comments added ✓" then fade
            setTimeout(() => { try { if (reqId) AIRequestStore.completeRequest(reqId); } catch {} }, 1200);

            // Reposition only when nothing else landed after our own apply —
            // otherwise we'd yank the cursor away from the user's newer edit.
            const settled = result.appliedVersion === undefined || model.getVersionId() === result.appliedVersion;
            if (settled) {
                const newContent = getActiveEditorContext()?.code ?? model.getValue();
                const newLines = newContent.split('\n');
                const targetIdx = Math.min(lineNumber, newLines.length) - 1;
                const col = (newLines[targetIdx]?.length || 0) + 1;
                editor.setPosition({ lineNumber: Math.min(lineNumber, newLines.length), column: col });
                editor.focus();
            }
        } catch (error) {
            console.error('[AI Auto-Replace] Error, editor left untouched:', error);
            if (reqId) { try { AIRequestStore.failRequest(reqId, (error as Error).message); } catch {} }
            // User-cancelled (ESC / superseded keystroke) stays silent — only
            // surface real failures so "nothing happens" becomes diagnosable.
            const cancelled = (error as Error)?.name === 'AbortError' || /abort|cancelled/i.test((error as Error)?.message ?? '');
            if (!cancelled && !model.isDisposed() && activeFileRef.current?.id === fileIdAtStart) {
                showTripleSlashError(lineNumber, (error as Error)?.message || 'AI request failed — trigger kept, retry or rephrase');
            }
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
    }, [getFileTree, createFile, deleteNode, renameNode, updateFileContent, showTripleSlashError, clearTripleSlashError]);

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

        // H3: skip the O(n) full-document scan for large files — thousands of
        // decorations per keystroke would freeze the tab.
        if (isLargeFile(model.getValueLength())) return;
        const content = model.getValue();
        const lines = content.split('\n');
        // Cap decorations even for normal files (a ///-heavy file must not
        // create unbounded decoration records per edit).
        const MAX_COMMENT_DECORATIONS = 600;
        const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

        for (const [index, line] of lines.entries()) {
            if (newDecorations.length >= MAX_COMMENT_DECORATIONS) break;
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
        }

        if (commentDecorationsRef.current) {
            commentDecorationsRef.current.clear();
        }
        commentDecorationsRef.current = editorRef.current.createDecorationsCollection(newDecorations);
    }, []);

    // Glyph-margin spinner handled by AICommentIndicator DOM overlay.
    // Decorations here: breathing animation on the /// text + trailing caret.
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
                // Subtle line background wash while processing
                {
                    range: new monacoRef.current!.Range(activeAiLine, 1, activeAiLine, 1),
                    options: {
                        isWholeLine: true,
                        className: 'az-ai-active-line',
                        stickiness: monacoRef.current!.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                    }
                },
                // Breathing animation on the /// command text
                {
                    range: new monacoRef.current!.Range(activeAiLine, commentStartCol, activeAiLine, endCol),
                    options: { isWholeLine: false, inlineClassName: 'ai-comment-breathing' }
                },
                // Blinking caret after the command
                {
                    range: new monacoRef.current!.Range(activeAiLine, endCol, activeAiLine, endCol),
                    options: { isWholeLine: false, inlineClassName: 'ai-comment-caret' }
                },
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
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (pendingInlineResolveRef.current) {
            pendingInlineResolveRef.current({ items: [] });
            pendingInlineResolveRef.current = null;
        }
        flushPendingSync();
    }, [activeFile?.id, flushPendingSync]);


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
        // H7 fix: capture identity BEFORE the (seconds-long) LLM round trip.
        // If the user switches files or edits meanwhile, the result is dropped
        // instead of being written into the wrong file.
        const fileIdAtStart = activeFile?.id ?? null;
        const versionAtStart = editor?.getModel()?.getVersionId() ?? null;
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
                task: 'format',
                language,
                filename: fileName,
                userInstruction: 'format code',
                outputMode: 'format',
                preserve: rawCode,
            });
            const finalCode = sanitized?.trim() ? sanitized.trim() : raw.trim();
            // Staleness gate: file switched or edited during the LLM call →
            // drop the result (formatting another file's text into this one
            // is silent corruption). No fallback, no write.
            const stillSameFile = activeFileRef.current?.id === fileIdAtStart && fileIdAtStart !== null;
            const liveEditor = editorRef.current;
            const liveModel = liveEditor?.getModel();
            const modelUntouched = liveModel && !liveModel.isDisposed() && versionAtStart !== null
                ? liveModel.getVersionId() === versionAtStart
                : false;
            if (!stillSameFile || !modelUntouched) {
                console.warn('[Format] Discarded stale format result (file switched or edited during request)');
                return;
            }
            if (finalCode && finalCode !== rawCode) {
                const { createExecutorDeps, captureSnapshot } = await import('../../core/editor/workspaceBridge');
                const { executeActionPlan } = await import('../../core/ai/aiToolExecutor');
                const deps: import('../../core/ai/aiToolExecutor').ExecutorDeps = createExecutorDeps({ getFileTree, createFile, deleteNode, renameNode, updateFileContent }, fileName, activeFile?.id || null);
                const snap = captureSnapshot(fileName, rawCode);
                const snapshotMap = snap ? new Map([[fileName, snap]]) : new Map();
                const result: import('../../core/ai/aiToolExecutor').ExecutionResult = await executeActionPlan([{ action: 'update_file', path: fileName, content: finalCode }], deps, { language, snapshot: snap, snapshotMap });
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
            if (formatTimeoutRef.current) clearTimeout(formatTimeoutRef.current);
            formatTimeoutRef.current = setTimeout(() => setIsFormatting(false), 800);
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

    // Latest-format ref so the mobile event listener below never calls a
    // stale closure (handleFormat is re-created per render by design).
    const handleFormatRef = useRef<() => void>(() => {});
    handleFormatRef.current = handleFormat;

    // Mobile surfaces (header More menu, slim strip overflow, command
    // palette) trigger the SAME editor actions via these events — no
    // duplicated logic, desktop shortcuts untouched.
    useEffect(() => {
        const onCheck = () => { runDiagnostics(); };
        const onFormat = () => { handleFormatRef.current(); };
        window.addEventListener('azemax-mobile-check', onCheck);
        window.addEventListener('azemax-mobile-format', onFormat);
        return () => {
            window.removeEventListener('azemax-mobile-check', onCheck);
            window.removeEventListener('azemax-mobile-format', onFormat);
        };
    }, [runDiagnostics]);

    const handleEditorBeforeMount: BeforeMount = (monaco) => {
        // Single authoritative syntax-highlighting setup (VS Code Dark+ token
        // colors on Azemax Midnight Blue + per-language Monarch tokenizer
        // shims). Registered BEFORE @monaco-editor/react calls
        // monaco.editor.setTheme(theme) during editor creation. The setup is
        // idempotent per Monaco instance; see darkPlusHighlighting.ts.
        setupAzemaxDarkPlusHighlighting(monaco);
    };

    const handleEditorMount: OnMount = (editor, monaco) => {
        monacoRef.current = monaco;
        editorRef.current = editor;
        setEditorInstance(editor);
        // Single Source of Truth: register active Monaco instance for AI context
        if (activeFile) {
            const fp2 = pathOf(getFileTree(), activeFile.id) || activeFile.name;
            setActiveEditor(editor, monaco, { id: activeFile.id, name: activeFile.name, path: fp2 });
        }

        // Track disposables for this editor instance (VS Code DisposableStore pattern)
        // Dispose previous store if remounting (StrictMode double-mount) to avoid leaks
        editorDisposablesRef.current?.dispose();
        const store = new DisposableStore();
        editorDisposablesRef.current = store;
        store.add(editor.onDidBlurEditorText(() => cancelPendingRequest()));
        store.add(editor.onDidChangeCursorPosition((e) => setCursorPosition({ lineNumber: e.position.lineNumber, column: e.position.column })));
        store.add(editor.onDidChangeCursorSelection((e) => {
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
        }));
        // Keep legacy field for any external consumers; owned by store
        (editor as unknown as { _codeEditorDisposables?: DisposableStore })._codeEditorDisposables = store;
        // E2E hook: expose editor/monaco for Playwright when running in test
        try {
            const w = window as unknown as Record<string, unknown>;
            w.__azemax_editor = editor;
            w.__azemax_monaco = monaco;
        } catch { /* ignore */ }

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
                    try { (monaco as unknown as { editor?: { remeasureFonts?: () => void } }).editor?.remeasureFonts?.(); editor.layout(); } catch { /* editor may be disposed */ }
                });
            }
            // Immediate remeasure to ensure initial mount aligns after CSS isolation
            requestAnimationFrame(() => { try { (monaco as unknown as { editor?: { remeasureFonts?: () => void } }).editor?.remeasureFonts?.(); editor.layout(); } catch { /* editor may be disposed */ } });
        } catch { /* fonts API unavailable */ }
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
        // Mobile: minimap is parked below 768px (it would steal ~15% of a
        // phone viewport). The Map toggle keeps working — it persists the
        // setting and applies on tablet/desktop widths.
        minimap: { enabled: isMobile ? false : settings.editor.showMinimap, renderCharacters: !settings.performance.optimizeEditorRendering },
        wordWrap: settings.editor.wordWrap ? 'on' : 'off',
        // Mobile: professional coding size, clamped to 13–15px regardless of
        // the desktop font-size setting (line numbers track ~2px smaller).
        fontSize: isMobile ? Math.min(15, Math.max(13, settings.editor.fontSize)) : settings.editor.fontSize,
        fontFamily: settings.editor.fontFamily,
        // Force geometric precision & no letter-spacing so char width matches guide math
        letterSpacing: 0,
        padding: densityPadding,
        inlineSuggest: { enabled: settings.ai.inlineSuggestions, mode: 'subwordSmart' },
        quickSuggestions: settings.code.quickSuggestions ? { other: true, comments: false, strings: false } : false,
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
        isMobile,
        densityPadding,
    ]);

    // When editor geometry deps change, force Monaco to remeasure character grid so guides stay in whitespace
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;
        try { (monacoRef.current as unknown as { editor?: { remeasureFonts?: () => void } }).editor?.remeasureFonts?.(); editorRef.current.layout(); } catch { /* editor may be disposed */ }
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
            <div className="w-full h-full flex flex-col items-center justify-center relative select-none" style={{ background: "var(--az-editor-bg)", color: "var(--az-text-muted)"}}>
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
            {/* Desktop toolbar — hidden on mobile. The mobile header owns the
                single Run action and the bottom nav owns AI, so rendering this
                row on phones would duplicate Run and waste vertical chrome. */}
            {!isMobile && (
            <div className="flex items-center justify-between px-3 shrink-0 overflow-hidden" style={{ height: 'var(--az-topbar-height)', minHeight: 'var(--az-topbar-height)', background: 'var(--az-bg)', borderBottom: '1px solid var(--az-border-subtle)' }}>
                <div ref={toolbarLeftRef} className={`flex items-center min-w-0 flex-1 overflow-hidden ${toolbarSize === 'mini' ? 'gap-0' : toolbarSize === 'compact' ? 'gap-0.5' : 'gap-1'}`}>
                    {/* Check Errors — Premium AI DeepCheck (production-grade) */}
                    {(() => {
                        const isDisabled = !settings.code.diagnostics;
                        const stateTitle = isDisabled
                            ? 'Diagnostics disabled — enable in Settings → Code → Diagnostics'
                            : isChecking
                                ? 'Checking... (click again to restart)'
                                : hasErrors
                                    ? diagnosticSummary || 'Has Errors'
                                    : hasWarnings
                                        ? diagnosticSummary || 'Has Warnings'
                                        : isCheckSuccess
                                            ? diagnosticSummary || 'No Errors'
                                            : 'Deep code check — AI + syntax (Minimax)';
                        return (
                    <button
                        onClick={isDisabled ? undefined : runDiagnostics}
                        disabled={isDisabled || isFormatting}
                        aria-disabled={isDisabled}
                        className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all active:opacity-90 overflow-hidden relative
                            ${toolbarSize === 'full' ? 'gap-1.5 px-3 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isDisabled
                                ? 'text-[var(--az-text-muted)] bg-[var(--az-surface-2)] border border-[var(--az-border)] opacity-60 cursor-not-allowed'
                                : isChecking
                                ? 'text-[var(--az-text-secondary)] bg-[var(--az-surface-3)] border border-[var(--az-border)]'
                                : hasErrors
                                    ? 'bg-[var(--az-error-soft)] text-[var(--az-error)] border border-[var(--az-error-border)]'
                                    : hasWarnings
                                        ? 'bg-[var(--az-warning-soft)] text-[#F0C674] border border-[var(--az-warning-border)]'
                                        : isCheckSuccess
                                            ? 'bg-[var(--az-success-soft)] text-[var(--az-success)] border border-[var(--az-success-border)]'
                                            : diagnosticStale
                                                ? 'text-[var(--az-text-secondary)] bg-[var(--az-surface-2)] border border-[var(--az-border)] opacity-80'
                                                : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title={stateTitle}
                    >
                        {isChecking ? (
                            <>
                                <span className="relative flex items-center justify-center">
                                    <span className="absolute h-3 w-3 rounded-full bg-[rgba(91,140,255,0.2)] animate-ping" />
                                    <Loader2 size={12} className="animate-spin text-[var(--az-text-muted)] relative" />
                                </span>
                                {toolbarSize === 'full' && <span className="text-[var(--az-text-secondary)]">Checking...</span>}
                                <span className="hidden" />
                            </>
                        ) : hasErrors ? (
                            <AlertCircle size={12} />
                        ) : hasWarnings ? (
                            <AlertCircle size={12} className="text-[#F0C674]" />
                        ) : isCheckSuccess ? (
                            <CheckCircle size={12} className="text-[var(--az-success)]" />
                        ) : (
                            <CheckCircle size={12} className={diagnosticStale ? 'opacity-50' : ''} />
                        )}
                        {!isChecking && toolbarSize === 'full' && (
                            <span>
                                {hasErrors ? 'Has Errors' : hasWarnings ? 'Has Warnings' : isCheckSuccess ? 'No Errors' : diagnosticStale ? 'Stale' : 'Check'}
                            </span>
                        )}
                    </button>
                        );
                    })()}

                    <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Code Suggestions Toggle */}
                    <button
                        onClick={() => updateSettings('ai', { inlineSuggestions: !settings.ai.inlineSuggestions })}
                        className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.ai.inlineSuggestions
                                ? 'text-[var(--az-accent-bright)] bg-[var(--az-accent-soft)] border border-[var(--az-accent-border)]'
                                : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title={settings.ai.inlineSuggestions ? "Disable AI Suggestions" : "Enable AI Suggestions"}
                    >
                        <Zap size={12} className="shrink-0" />
                        {toolbarSize === 'full' && <span>AI</span>}
                    </button>

                    <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Save Button - only show when auto-save is disabled */}
                    {!settings.editor.autoSave && (
                        <button
                            data-testid="save-button"
                            onClick={handleSave}
                            className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all active:opacity-90
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
                        className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all active:opacity-90 overflow-hidden relative
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isFormatting
                                ? 'text-[var(--az-text-secondary)] bg-[var(--az-surface-3)] border border-[var(--az-border)]'
                                : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[var(--az-surface-hover)] border border-transparent'}
                        `}
                        title="Format Document (Shift+Alt+F) — Premium DeepSeek"
                    >
                        {isFormatting ? (
                            <>
                                <span className="relative flex items-center justify-center">
                                    <span className="absolute h-3 w-3 rounded-full bg-[rgba(91,140,255,0.2)] animate-ping" />
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
                        className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all active:opacity-90
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.wordWrap ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border-strong)]' : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[var(--az-surface-hover)] border border-transparent'}`}
                        title="Toggle Word Wrap"
                    >
                        <WrapText size={12} />
                        {toolbarSize === 'full' && <span>Wrap</span>}
                    </button>

                    {/* Minimap */}
                    <button
                        onClick={() => updateSettings('editor', { showMinimap: !settings.editor.showMinimap })}
                        className={`shrink-0 flex items-center rounded-[7px] text-xs font-medium transition-all active:opacity-90
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.showMinimap ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border-strong)]' : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[var(--az-surface-hover)] border border-transparent'}`}
                        title="Toggle Minimap"
                    >
                        <MapIcon size={12} />
                        {toolbarSize === 'full' && <span>Map</span>}
                    </button>

                    {toolbarSize !== 'mini' && (
                        <>
                            <div className={`shrink-0 w-px bg-[var(--az-border)] ${toolbarSize === 'compact' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                            {/* Font Size — compact segmented control */}
                            <div className="shrink-0 flex items-center gap-0.5 rounded-[7px] border px-0.5 h-7" style={{ background: '#0D192B', borderColor: 'rgba(230,237,248,.08)' }}>
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.max(10, settings.editor.fontSize - 1) })}
                                    className="w-6 h-6 flex items-center justify-center text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[rgba(230,237,248,0.06)] rounded-[5px] transition-colors duration-150 shrink-0"
                                    aria-label="Decrease font size"
                                >
                                    <Minus size={12} className="shrink-0" />
                                </button>
                                <span className="text-[11px] text-[var(--az-text-secondary)] w-5 text-center font-mono leading-none tabular-nums select-none">{settings.editor.fontSize}</span>
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.min(24, settings.editor.fontSize + 1) })}
                                    className="w-6 h-6 flex items-center justify-center text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-[rgba(230,237,248,0.06)] rounded-[5px] transition-colors duration-150 shrink-0"
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
            )}

            {/* Mobile slim action strip — icon-only [Check][Format][Wrap][Map].
                No Run (single action lives in the mobile header), no AI toggle
                (bottom nav owns it), no font stepper. 40px tall with full
                40px touch targets. */}
            {isMobile && (
            <div
                role="toolbar"
                aria-label="Editor actions"
                className="flex items-center gap-0.5 px-1.5 shrink-0 overflow-x-auto no-scrollbar"
                style={{ height: '40px', minHeight: '40px', background: 'var(--az-bg)', borderBottom: '1px solid var(--az-border-subtle)' }}
            >
                <button
                    onClick={settings.code.diagnostics ? runDiagnostics : undefined}
                    disabled={!settings.code.diagnostics || isFormatting}
                    aria-label={hasErrors ? 'Has errors — tap to re-check' : 'Check code'}
                    title={diagnosticSummary || 'Check code'}
                    className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center transition-colors active:scale-95 border
                        ${!settings.code.diagnostics
                            ? 'text-[var(--az-text-disabled)] border-transparent opacity-50'
                            : hasErrors
                                ? 'text-[var(--az-error)] border-[var(--az-error-border)] bg-[var(--az-error-soft)]'
                                : hasWarnings || isCheckSuccess
                                    ? 'text-[var(--az-success)] border-[var(--az-success-border)] bg-[var(--az-success-soft)]'
                                    : 'text-[var(--az-icon)] border-transparent'
                        }`}
                >
                    {isChecking ? <Loader2 size={15} className="animate-spin" /> : hasErrors || hasWarnings ? <AlertCircle size={15} /> : <CheckCircle size={15} />}
                </button>
                <button
                    onClick={() => { handleFormat(); }}
                    disabled={isFormatting}
                    aria-label="Format document"
                    title="Format document"
                    className="w-10 h-10 shrink-0 rounded-md flex items-center justify-center text-[var(--az-icon)] border border-transparent transition-colors active:scale-95"
                >
                    {isFormatting ? <Loader2 size={15} className="animate-spin" /> : <AlignLeft size={15} />}
                </button>
                <button
                    onClick={() => updateSettings('editor', { wordWrap: !settings.editor.wordWrap })}
                    aria-label="Toggle word wrap"
                    aria-pressed={settings.editor.wordWrap}
                    title="Toggle word wrap"
                    className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center transition-colors active:scale-95 border
                        ${settings.editor.wordWrap
                            ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border-[var(--az-border-strong)]'
                            : 'text-[var(--az-icon)] border-transparent'}`}
                >
                    <WrapText size={15} />
                </button>
                <button
                    onClick={() => updateSettings('editor', { showMinimap: !settings.editor.showMinimap })}
                    aria-label="Toggle minimap"
                    aria-pressed={settings.editor.showMinimap}
                    title="Toggle minimap (applies on tablet/desktop widths)"
                    className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center transition-colors active:scale-95 border
                        ${settings.editor.showMinimap
                            ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border-[var(--az-border-strong)]'
                            : 'text-[var(--az-icon)] border-transparent'}`}
                >
                    <MapIcon size={15} />
                </button>
                <span className="flex-1" />
                <span className="text-[10px] font-mono tabular-nums px-1 shrink-0" style={{ color: 'var(--az-text-faint)' }} title="Diagnostics">
                    {diagCounts.errors > 0 && <span className="text-[#FF7D8B] font-semibold mr-1.5">●{diagCounts.errors}</span>}
                    {diagCounts.warnings > 0 && <span className="text-[#F0C674] font-semibold">●{diagCounts.warnings}</span>}
                    {diagCounts.total === 0 && <span>{language.toUpperCase()}</span>}
                </span>
            </div>
            )}

            {/* Desktop File Tabs */}
            <FileTabs className="hidden md:flex" />

            {/* Editor Area — uncontrolled to avoid wrapper's setValue() race with glitch-free executeEdits */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
                <Editor
                    height="100%"
                    language={language}
                    // Per-file model identity (C4 fix): one ITextModel per file id
                    // with a real URI. Undo/redo, view state, and markers are
                    // file-scoped — Cmd+Z after a file switch can no longer
                    // write another file's content into the current file.
                    // The wrapper reuses the model on revisit (undo preserved)
                    // and disposes all models on unmount.
                    path={activeFile ? `inmemory://azemax/${activeFile.id}` : 'inmemory://azemax/empty'}
                    defaultValue={activeFile?.content || ''}
                    theme={isDark ? 'azemax-midnight-signature' : 'vs-light'}
                    onChange={handleEditorChange}
                    beforeMount={handleEditorBeforeMount}
                    onMount={handleEditorMount}
                    options={editorOptions}
                />
                <AICommentIndicator activeLine={activeAiLine} editorRef={editorRef} monacoRef={monacoRef} />
            </div>

            {/* Status Bar — desktop only. On mobile the slim strip above already
                carries diagnostics + language, so this 24px row is parked to
                give the editor maximum space. */}
            {settings.general.showStatusBar && !isMobile && (
                <div className="h-6 min-h-6 text-[11px] leading-none flex items-center justify-between px-3 shrink-0 select-none font-medium overflow-hidden antialiased" style={{ background: 'var(--az-bg)', color: 'var(--az-text-muted)', borderTop: '1px solid var(--az-border-subtle)'}}>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-1.5 py-0.5 rounded-md cursor-pointer transition-colors leading-none">
                            <GitBranch size={11} className="shrink-0" />
                            <span>main</span>
                        </div>
                        <div className="flex items-center gap-1 hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text-secondary)] px-1.5 py-0.5 rounded-md cursor-pointer transition-colors leading-none" title={diagnosticSummary || (diagCounts.total === 0 ? 'No diagnostics' : `${diagCounts.errors} errors · ${diagCounts.warnings} warnings`)}>
                            <CheckCircle size={11} className={`shrink-0 ${diagCounts.errors > 0 ? 'text-[#FF7D8B]' : 'text-[var(--az-text-muted)]'}`} />
                            <span className={diagCounts.errors > 0 ? 'text-[#FF7D8B] font-semibold' : ''}>{diagCounts.errors}</span>
                            <AlertCircle size={11} className={`ml-1 shrink-0 ${diagCounts.warnings > 0 ? 'text-[#F0C674]' : 'text-[var(--az-text-muted)]'}`} />
                            <span className={diagCounts.warnings > 0 ? 'text-[#F0C674] font-semibold' : ''}>{diagCounts.warnings}</span>
                            {diagnosticStale && diagCounts.total > 0 && <span className="ml-1 text-[9px] px-1 py-0 rounded bg-[var(--az-surface-3)] border border-[var(--az-border)]">stale</span>}
                            {diagCounts.infos > 0 && <span className="ml-1 text-[9px] text-[#5B8CFF]">{diagCounts.infos}i</span>}
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
