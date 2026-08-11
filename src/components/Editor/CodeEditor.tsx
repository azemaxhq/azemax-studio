import React, { useRef, useCallback, useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useProject } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../hooks/useTheme';
import { getCodeSuggestion, cancelPendingRequest, getInlineCompletion } from '../../utils/codeSuggestionService';
import { checkCodeErrors } from '../../utils/diagnosticsService';
import { AlertCircle, CheckCircle, Loader2, Minus, Plus, Map, WrapText, Code, GitBranch, Play, Zap, AlignLeft, Save } from 'lucide-react';
import { ModernAILogo } from '../Icons/ModernAILogo';
import { useTerminal } from '../../context/TerminalContext';
import { useDebounceCallback } from '../../hooks/useDebounce';

// Language detection helper
const getLanguage = (fileName: string): string => {
    if (!fileName) return 'typescript';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
        'ts': 'typescript', 'tsx': 'typescript',
        'js': 'javascript', 'jsx': 'javascript',
        'py': 'python', 'java': 'java',
        'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
        'go': 'go', 'rs': 'rust', 'rb': 'ruby',
        'php': 'php', 'cs': 'csharp', 'swift': 'swift', 'kt': 'kotlin',
        'css': 'css', 'scss': 'scss', 'json': 'json',
        'md': 'markdown', 'html': 'html', 'sh': 'shell', 'bash': 'shell'
    };
    return langMap[ext || ''] || 'typescript';
};

interface CodeEditorProps {
    isAiOpen?: boolean;
    onToggleAi?: () => void;
    isSidebarOpen?: boolean;
    onToggleSidebar?: () => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ isAiOpen, onToggleAi }) => {
    const { activeFile, updateFileContent } = useProject();
    const { settings, updateSettings } = useSettings();
    const { isDark } = useTheme();
    const { runCode, isRunning } = useTerminal();
    const monacoRef = useRef<typeof Monaco | null>(null);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const completionProviderRef = useRef<Monaco.IDisposable | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeFileRef = useRef(activeFile);
    /** Cache last non-empty selection so Explain Selection still works after focus leaves editor */
    const lastSelectionRef = useRef<{ fileId: string; text: string; language: string; fileName?: string } | null>(null);

    // Editor State - Use settings context instead of local state
    const [cursorPosition, setCursorPosition] = useState({ lineNumber: 1, column: 1 });

    const isSuggestionsEnabledRef = useRef(settings.editor.isSuggestionsEnabled);

    // Update ref when settings change
    useEffect(() => {
        isSuggestionsEnabledRef.current = settings.editor.isSuggestionsEnabled;
    }, [settings.editor.isSuggestionsEnabled]);

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
    const [_isAiProcessing, setIsAiProcessing] = useState(false);
    const [activeAiLine, setActiveAiLine] = useState<number | null>(null);
    const [editorReady, setEditorReady] = useState(false);

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



    // Run diagnostics
    const runDiagnostics = async () => {
        if (!activeFile || !monacoRef.current || !editorRef.current) return;

        console.log('Starting diagnostics for file:', activeFile.name);
        setIsChecking(true);
        setHasErrors(false);
        setIsCheckSuccess(false);
        
        const code = activeFile.content || '';
        const fileName = activeFile.name;
        const model = editorRef.current.getModel();

        try {
            // Clear existing markers first
            if (model) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', []);
            }

            // If code is empty, consider it valid
            if (!code.trim()) {
                console.log('Empty code, considering valid');
                setIsCheckSuccess(true);
                setTimeout(() => setIsCheckSuccess(false), 2000);
                return;
            }

            const result = await checkCodeErrors(code, fileName, monacoRef.current || undefined);
            console.log('Diagnostics result:', result);

            if (model) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', result.markers);
            }

            // Determine if there are actual errors (not warnings)
            const hasActualErrors = result.markers.some(marker => marker.severity === 8); // Severity.Error = 8
            
            setHasErrors(hasActualErrors);
            if (!hasActualErrors) {
                console.log('No errors detected, showing success');
                setIsCheckSuccess(true);
                setTimeout(() => setIsCheckSuccess(false), 3000); // Show success for 3 seconds
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
    };

    // Debounced save to project state with auto-save setting
    const debouncedSave = useDebounceCallback((id: string, content: string) => {
        if (settings.autoFeatures.autoSave) {
            updateFileContent(id, content);
        }
    }, settings.autoFeatures.autoSave ? 500 : 0);

    const handleEditorChange = (value: string | undefined) => {
        // Clear check status when user starts typing
        if (isCheckSuccess) setIsCheckSuccess(false);
        if (hasErrors) setHasErrors(false);
        
        // Clear markers when user starts typing to avoid stale errors
        if (editorRef.current && monacoRef.current) {
            const model = editorRef.current.getModel();
            if (model) {
                monacoRef.current.editor.setModelMarkers(model, 'piston-diagnostics', []);
            }
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

    // Force update editor content when activeFile changes content (e.g. from AI)
    // We only update if it differs from what the editor already holds
    useEffect(() => {
        if (editorRef.current && activeFile) {
            const currentContent = editorRef.current.getValue();
            if (currentContent !== activeFile.content) {
                editorRef.current.setValue(activeFile.content || '');
            }
        }
    }, [activeFile?.id, activeFile?.content]);

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

    // Auto-replace AI comments when user types semicolon
    const handleAiCommentAutoReplace = useCallback(async (
        editor: Monaco.editor.IStandaloneCodeEditor,
        monaco: typeof Monaco,
        lineNumber: number,
        lineContent: string
    ) => {
        // Check if it's an AI command pattern (now supports inline)
        // Matches: [code] /// [command];
        const match = lineContent.match(/^(.*?)\/\/\/\s*(.+);$/);
        if (!match) return;

        // Prevent re-triggering while processing
        if (isProcessingAiCommandRef.current) return;
        isProcessingAiCommandRef.current = true;

        const commandText = match[2].trim();
        const model = editor.getModel();
        if (!model) {
            isProcessingAiCommandRef.current = false;
            return;
        }

        console.log('[AI Auto-Replace] Detected command:', commandText, 'on line:', lineNumber);

        // Show loading state
        setIsAiProcessing(true);
        setActiveAiLine(lineNumber);

        try {
            const currentFile = activeFileRef.current;
            const fileName = currentFile?.name || 'untitled.ts';
            const language = getLanguage(fileName);
            const code = model.getValue();
            const cursorOffset = model.getOffsetAt({ lineNumber, column: lineContent.length + 1 });

            // Call the AI service
            const result = await getCodeSuggestion({
                code,
                cursorPosition: cursorOffset,
                language,
                fileName
            });

            // Handle cancellation
            if (result?.error === 'Cancelled') {
                console.log('[AI Auto-Replace] Request was cancelled');
                return;
            }

            console.log('[AI Auto-Replace] Result:', result);

            // Check if we have valid generated code (explicit length check)
            if (result && result.text && result.text.length > 0) {
                // Apply indentation/formatting to generated code
                const generatedCode = result.text;

                // If this was an inline comment, we might want to preserve the prefix
                // usage: let x = 1; /// change to 2; -> let x = 2; (AI usually returns full line)
                // But if AI returns just the snippet, we might need to handle it.
                // For now, assume AI returns the replacement for the *entire line* or *block* if it was a modification.

                // If the result looks like a direct replacement, use it.

                console.log('[AI Auto-Replace] Inserting code:', generatedCode.substring(0, 100) + '...');

                // Replace the ENTIRE line (including the code before the comment) with the new code
                // This allows "let x = 1; /// change to 2;" -> "let x = 2;"
                const range = new monaco.Range(
                    lineNumber,
                    1,
                    lineNumber,
                    lineContent.length + 1
                );

                // Apply the edit
                editor.executeEdits('ai-auto-replace', [{
                    range,
                    text: generatedCode,
                    forceMoveMarkers: true
                }]);

                // Move cursor to end of inserted code
                const newLines = generatedCode.split('\n');
                const newEndLine = lineNumber + newLines.length - 1;
                const newEndColumn = newLines[newLines.length - 1].length + 1;
                editor.setPosition({ lineNumber: newEndLine, column: newEndColumn });
                editor.focus();

                console.log('[AI Auto-Replace] Code inserted successfully');
            } else if (result?.error) {
                // Show the specific error from the AI service
                console.warn('[AI Auto-Replace] Error from service:', result.error);
                const range = new monaco.Range(lineNumber, lineContent.length + 1, lineNumber, lineContent.length + 1);
                editor.executeEdits('ai-auto-replace', [{
                    range,
                    text: ` // AI: ${result.error}`,
                    forceMoveMarkers: true
                }]);
            } else {
                console.warn('[AI Auto-Replace] No code generated, result was:', result);
                const range = new monaco.Range(lineNumber, lineContent.length + 1, lineNumber, lineContent.length + 1);
                editor.executeEdits('ai-auto-replace', [{
                    range,
                    text: ' // AI: No response - try again',
                    forceMoveMarkers: true
                }]);
            }
        } catch (error) {
            console.error('[AI Auto-Replace] Error:', error);
            // Add error feedback to the editor
            const range = new monaco.Range(lineNumber, lineContent.length + 1, lineNumber, lineContent.length + 1);
            editor.executeEdits('ai-auto-replace', [{
                range,
                text: ' // AI: Error - try again',
                forceMoveMarkers: true
            }]);
        } finally {
            setIsAiProcessing(false);
            setActiveAiLine(null);
            isProcessingAiCommandRef.current = false;
        }
    }, []);

    // Effect to listen for content changes and trigger AI auto-replace
    // Uses debouncing to handle rapid typing and edge cases
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const editor = editorRef.current;
        const monaco = monacoRef.current;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const disposable = editor.onDidChangeModelContent((e) => {
            // Clear any pending debounce
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            // Skip if already processing
            if (isProcessingAiCommandRef.current) return;

            // Check if the change includes a semicolon (handles paste and multi-char inputs)
            const changes = e.changes;
            let triggerLine: number | null = null;

            for (const change of changes) {
                if (change.text.includes(';')) {
                    const model = editor.getModel();
                    if (!model) continue;

                    // Check the affected line(s)
                    const startLine = change.range.startLineNumber;
                    const endLine = change.range.startLineNumber + (change.text.split('\n').length - 1);

                    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
                        const lineContent = model.getLineContent(lineNum);
                        // Check if this line matches the AI command pattern (now supports inline)
                        if (/^(.*?)\/\/\/\s*.+;$/.test(lineContent)) {
                            triggerLine = lineNum;
                            break;
                        }
                    }
                    if (triggerLine) break;
                }
            }

            if (triggerLine !== null) {
                const model = editor.getModel();
                if (!model) return;

                const lineNum = triggerLine;

                // Small debounce to ensure typing is complete
                debounceTimer = setTimeout(() => {
                    // Double-check the line still matches (user might have continued typing)
                    const currentLineContent = model.getLineContent(lineNum);
                    if (/^(.*?)\/\/\/\s*.+;$/.test(currentLineContent) && !isProcessingAiCommandRef.current) {
                        handleAiCommentAutoReplace(editor, monaco, lineNum, currentLineContent);
                    }
                }, 50); // 50ms debounce
            }
        });

        return () => {
            disposable.dispose();
            if (debounceTimer) clearTimeout(debounceTimer);
        };
    }, [handleAiCommentAutoReplace, editorReady]);

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

    // Update static comment decorations (only on content change)
    const updateCommentDecorations = useCallback(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const model = editorRef.current.getModel();
        if (!model) return;

        const content = model.getValue();
        const lines = content.split('\n');
        const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

        lines.forEach((line, index) => {
            // Check for /// pattern
            if (line.indexOf('///') !== -1) {
                const startCol = line.indexOf('///') + 1;
                // Always highlight the AI command part, even if incomplete (while typing)
                newDecorations.push({
                    range: new monacoRef.current!.Range(index + 1, startCol, index + 1, line.length + 1),
                    options: {
                        isWholeLine: false,
                        inlineClassName: 'ai-comment-decoration',
                    }
                });
            }
        });

        if (commentDecorationsRef.current) {
            commentDecorationsRef.current.clear();
        }
        commentDecorationsRef.current = editorRef.current.createDecorationsCollection(newDecorations);
    }, []);

    // Update loading decoration separately (only when activeAiLine changes)
    const updateLoadingDecoration = useCallback(() => {
        if (!editorRef.current || !monacoRef.current) return;

        // Clear existing loading decoration
        if (loadingDecorationRef.current) {
            loadingDecorationRef.current.clear();
            loadingDecorationRef.current = null;
        }

        // Add new loading decoration if there's an active AI line
        if (activeAiLine !== null) {
            loadingDecorationRef.current = editorRef.current.createDecorationsCollection([{
                range: new monacoRef.current!.Range(activeAiLine, 1, activeAiLine, 1),
                options: {
                    isWholeLine: true,
                    afterContentClassName: 'ai-loading-spinner',
                    className: 'glass-line-highlight'
                }
            }]);
        }
    }, [activeAiLine]);

    // Update comment decorations on content change
    useEffect(() => {
        if (editorRef.current) {
            const disposable = editorRef.current.onDidChangeModelContent(() => {
                updateCommentDecorations();
            });
            return () => disposable.dispose();
        }
    }, [updateCommentDecorations]);

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


    // Fetch suggestion from API
    const fetchSuggestion = async (
        model: Monaco.editor.ITextModel,
        position: Monaco.Position,
        monaco: typeof Monaco
    ) => {
        const code = model.getValue();
        const offset = model.getOffsetAt(position);
        const currentActiveFile = activeFileRef.current;
        const fileName = currentActiveFile?.name || 'untitled.ts';
        const language = getLanguage(fileName);

        try {
            const result = await getCodeSuggestion({
                code,
                cursorPosition: offset,
                language,
                fileName
            });

            // If getCodeSuggestion returned a result (/// command), use it
            if (result && result.text !== null && result.text !== undefined && result.text !== '') {
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
                            insertText: result.text,
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
                        insertText: result.text,
                        range: range
                    }]
                };
            }

            // No /// command detected — try general inline completion
            const inlineResult = await getInlineCompletion({
                code,
                cursorPosition: offset,
                language,
                fileName
            });

            if (inlineResult && inlineResult.text) {
                const range = new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column
                );
                return {
                    items: [{
                        insertText: inlineResult.text,
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
    fetchSuggestionRef.current = fetchSuggestion;

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
                        console.log('[CodeEditor] Skipping inline completion - completed AI command handled by auto-replace');
                        return { items: [] };
                    }

                    // Check for in-progress /// commands (without semicolon) - don't auto-suggest
                    // User should complete their command with ; to trigger AI
                    const isAiCommand = /\/\/\//.test(lineContent);

                    // Only provide suggestions for regular code, not /// commands in progress
                    if (isAiCommand) {
                        console.log('[CodeEditor] Skipping inline completion - AI command in progress, waiting for semicolon');
                        return { items: [] };
                    }

                    console.log('[CodeEditor] InlineCompletion Triggered. Line:', position.lineNumber, 'Content:', lineContent);

                    if (!isSuggestionsEnabledRef.current) {
                        return { items: [] };
                    }

                    if (context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic) {
                        if (debounceTimerRef.current) {
                            clearTimeout(debounceTimerRef.current);
                        }

                        return new Promise((resolve) => {
                            debounceTimerRef.current = setTimeout(async () => {
                                if (token.isCancellationRequested || !isSuggestionsEnabledRef.current) {
                                    resolve({ items: [] });
                                    return;
                                }

                                try {
                                    // Use REF to get latest function
                                    const suggestion = await fetchSuggestionRef.current(model, position, monaco);
                                    resolve(suggestion);
                                } catch (error) {
                                    console.error('[CodeEditor] Error fetching suggestion:', error);
                                    resolve({ items: [] });
                                }
                            }, 800);
                        });
                    }

                    // Direct trigger (e.g., from explicit request)
                    try {
                        return await fetchSuggestionRef.current(model, position, monaco);
                    } catch (error) {
                        console.error('[CodeEditor] Error fetching suggestion:', error);
                        return { items: [] };
                    }
                },
                disposeInlineCompletions: () => { }
            }
        );
    }, []);

    // Format Document - use auto-format setting
    const handleFormat = () => {
        setIsFormatting(true);
        if (editorRef.current) {
            if (settings.autoFeatures.autoFormat) {
                editorRef.current.getAction('editor.action.formatDocument')?.run();
                setTimeout(() => setIsFormatting(false), 600);
            } else {
                // Just show that format is disabled
                setTimeout(() => setIsFormatting(false), 500);
            }
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

    const handleEditorMount: OnMount = (editor, monaco) => {
        monacoRef.current = monaco;
        editorRef.current = editor;

        monaco.editor.defineTheme('github-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#0d1117',
                'editor.foreground': '#c9d1d9',
                'editorLineNumber.foreground': '#8b949e',
                'editor.lineHighlightBackground': '#161b22',
                'editorCursor.foreground': '#58a6ff',
                'editor.selectionBackground': '#30363d',
                'editor.inactiveSelectionBackground': '#30363d'
            }
        });
        monaco.editor.setTheme('github-dark');

        editor.onDidChangeCursorPosition((e) => {
            setCursorPosition({
                lineNumber: e.position.lineNumber,
                column: e.position.column
            });
        });

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
            // Do not clear cache when selection collapses (e.g. on blur) so Explain Selection still has the last selection
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
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
        });

        // Signal that editor is ready - this triggers effects that depend on the editor
        setEditorReady(true);
    };

    const language = getLanguage(activeFile?.name || '');

    if (!activeFile) {
        return (
            <div className="w-full h-full bg-transparent flex flex-col items-center justify-center text-muted glass-panel-light relative group">
                <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full animate-glass-pulse" />
                    <div className="relative p-8 rounded-full bg-gradient-to-br from-white/5 to-transparent border border-white/10">
                        <Code size={64} className="text-white/20" />
                    </div>
                </div>
                <p className="text-lg font-medium text-white/40">Select a file to start coding</p>
                <div className="mt-6 text-sm text-white/30 flex gap-6">
                    <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                        <kbd className="text-xs bg-white/10 px-1.5 py-0.5 rounded">⌘P</kbd> Search files
                    </span>
                    <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                        <kbd className="text-xs bg-white/10 px-1.5 py-0.5 rounded">⌘⇧F</kbd> Search code
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-transparent flex flex-col relative group">
            {/* Toolbar */}
            <div className="h-11 bg-[#0d1117] border-b border-white/10 flex items-center justify-between px-3 shrink-0">
                <div ref={toolbarLeftRef} className={`flex items-center min-w-0 flex-1 overflow-hidden transition-all duration-200 ${toolbarSize === 'mini' ? 'gap-0' : toolbarSize === 'compact' ? 'gap-0.5' : 'gap-1'}`}>
                    {/* Check Errors Button */}
                    <button
                        onClick={runDiagnostics}
                        disabled={isChecking}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:scale-95
                            ${toolbarSize === 'full' ? 'gap-1.5 px-3 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isChecking 
                                ? 'text-zinc-400 bg-white/5 border border-transparent animate-pulse'
                                : hasErrors
                                    ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/30'
                                    : isCheckSuccess
                                        ? 'bg-green-500/15 text-green-300 border border-green-500/30'
                                        : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'}
                        `}
                        title="Check for syntax errors"
                    >
                        {isChecking ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : hasErrors ? (
                            <AlertCircle size={12} />
                        ) : isCheckSuccess ? (
                            <CheckCircle size={12} className="text-green-300" />
                        ) : (
                            <CheckCircle size={12} />
                        )}
                        {toolbarSize === 'full' && (
                            <span>
                                {isChecking ? 'Checking...' : hasErrors ? 'Has Errors' : isCheckSuccess ? 'No Errors' : 'Check'}
                            </span>
                        )}
                    </button>

                    <div className={`shrink-0 w-px bg-white/10 ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Code Suggestions Toggle */}
                    <button
                        onClick={() => updateSettings('editor', { isSuggestionsEnabled: !settings.editor.isSuggestionsEnabled })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.isSuggestionsEnabled
                                ? 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/20'
                                : 'text-white/60 hover:text-white hover:bg-white/10 border border-transparent'}
                        `}
                        title={settings.editor.isSuggestionsEnabled ? "Disable AI Suggestions" : "Enable AI Suggestions"}
                    >
                        <Zap size={12} className={settings.editor.isSuggestionsEnabled ? "fill-yellow-400" : ""} />
                        {toolbarSize === 'full' && <span>AI</span>}
                    </button>

                    <div className={`shrink-0 w-px bg-white/10 ${toolbarSize === 'mini' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                    {/* Save Button - only show when auto-save is disabled */}
                    {!settings.autoFeatures.autoSave && (
                        <button
                            onClick={handleSave}
                            className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:scale-95
                                ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                                text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:text-blue-300 hover:bg-blue-400/25`}
                            title="Save File (Ctrl+S)"
                        >
                            <Save size={12} />
                            {toolbarSize === 'full' && <span>Save</span>}
                        </button>
                    )}

                    {/* Format */}
                    <button
                        onClick={handleFormat}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:scale-95
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${isFormatting
                                ? 'text-green-400 bg-green-400/10 border border-green-400/20'
                                : 'text-white/60 hover:text-white hover:bg-white/10 border border-transparent'}
                        `}
                        title="Format Document (Shift+Alt+F)"
                    >
                        {isFormatting ? <CheckCircle size={12} /> : <AlignLeft size={12} />}
                        {toolbarSize === 'full' && <span>{isFormatting ? 'Formatted' : 'Format'}</span>}
                    </button>

                    {/* Word Wrap */}
                    <button
                        onClick={() => updateSettings('editor', { wordWrap: !settings.editor.wordWrap })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:scale-95
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.wordWrap ? 'text-primary bg-primary/15 border border-primary/30' : 'text-white/60 hover:text-white hover:bg-white/10 border border-transparent'}`}
                        title="Toggle Word Wrap"
                    >
                        <WrapText size={12} />
                        {toolbarSize === 'full' && <span>Wrap</span>}
                    </button>

                    {/* Minimap */}
                    <button
                        onClick={() => updateSettings('editor', { showMinimap: !settings.editor.showMinimap })}
                        className={`shrink-0 flex items-center rounded-lg text-xs font-medium transition-all active:scale-95
                            ${toolbarSize === 'full' ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1'}
                            ${settings.editor.showMinimap ? 'text-primary bg-primary/15 border border-primary/30' : 'text-white/60 hover:text-white hover:bg-white/10 border border-transparent'}`}
                        title="Toggle Minimap"
                    >
                        <Map size={12} />
                        {toolbarSize === 'full' && <span>Map</span>}
                    </button>

                    {toolbarSize !== 'mini' && (
                        <>
                            <div className={`shrink-0 w-px bg-white/10 ${toolbarSize === 'compact' ? 'h-3 mx-0.5' : 'h-5 mx-1'}`} />

                            {/* Font Size */}
                            <div className="shrink-0 flex items-center gap-0.5 bg-white/5 rounded-lg border border-white/10 px-1">
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.max(10, settings.editor.fontSize - 1) })}
                                    className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-all"
                                >
                                    <Minus size={12} />
                                </button>
                                <span className="text-xs text-white/70 w-5 text-center font-mono">{settings.editor.fontSize}</span>
                                <button
                                    onClick={() => updateSettings('editor', { fontSize: Math.min(24, settings.editor.fontSize + 1) })}
                                    className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-all"
                                >
                                    <Plus size={12} />
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3 relative mr-2 shrink-0">
                    <span className="text-[10px] text-blue-300 font-bold uppercase tracking-wider bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)]">
                        {language}
                    </span>

                    <button
                        onClick={() => {
                            if (activeFile) {
                                // Dispatch event to switch to terminal tab first
                                window.dispatchEvent(new CustomEvent('run-button-clicked'));
                                
                                // Small delay to allow tab switching before running code
                                setTimeout(() => {
                                    runCode(activeFile.content || '', language, activeFile.name);
                                }, 100);
                            }
                        }}
                        disabled={isRunning || !activeFile}
                        className="glass-run-button py-1 px-3 text-[11px] h-7"
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

                    {/* AI Sidebar Toggle - Interactive Animated */}
                    {onToggleAi && (
                        <button
                            onClick={(e) => {
                                // Add burst animation class
                                const btn = e.currentTarget;
                                btn.classList.add('burst');

                                // Create ripple effect
                                const rippleContainer = btn.querySelector('.ai-toggle-ripple');
                                if (rippleContainer) {
                                    const ripple = document.createElement('span');
                                    ripple.className = 'ripple';
                                    rippleContainer.appendChild(ripple);
                                    setTimeout(() => ripple.remove(), 600);
                                }

                                // Remove burst class after animation
                                setTimeout(() => btn.classList.remove('burst'), 500);

                                onToggleAi();
                            }}
                            className={`
                                ai-toggle-btn group relative h-8 flex items-center justify-center gap-2 rounded-lg border transition-all duration-300 ease-out
                                ${isAiOpen
                                    ? 'active pl-3 pr-3.5 bg-gradient-to-r from-purple-600/25 to-violet-600/20 border-purple-400/40'
                                    : 'px-3 bg-white/[0.03] border-white/[0.08] text-white/60 hover:bg-purple-500/10 hover:border-purple-400/30 hover:text-purple-100'
                                }
                            `}
                            title={isAiOpen ? "Close AI Sidebar" : "Open AI Sidebar"}
                        >
                            {/* Shimmer sweep effect */}
                            <div className="ai-toggle-shimmer" />

                            {/* Ripple container */}
                            <div className="ai-toggle-ripple" />

                            {/* Orbiting particles (visible when active) */}
                            <div className="ai-toggle-particles">
                                <span className="particle" />
                                <span className="particle" />
                                <span className="particle" />
                            </div>

                            {/* Star burst effect */}
                            <div className="ai-toggle-stars">
                                <span className="star" />
                                <span className="star" />
                                <span className="star" />
                                <span className="star" />
                            </div>

                            {/* Icon with animation class */}
                            <ModernAILogo className={`
                                ai-toggle-icon w-4 h-4 shrink-0 relative z-10 transition-all duration-300
                                ${isAiOpen
                                    ? "text-purple-200 drop-shadow-[0_0_10px_rgba(168,85,247,0.6)] scale-110"
                                    : "opacity-60 group-hover:opacity-100 group-hover:scale-110 group-hover:text-purple-300"
                                }
                            `} />

                            {/* Label */}
                            <span className={`
                                text-[11px] font-semibold tracking-wider whitespace-nowrap transition-all duration-300 relative z-10 uppercase
                                ${isAiOpen
                                    ? 'text-purple-100 drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                                    : 'text-white/70 group-hover:text-purple-200'
                                }
                            `}>
                                AI
                            </span>

                            {/* Active indicator dot */}
                            {isAiOpen && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 to-violet-400 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 min-h-0 relative">
                <Editor
                    height="100%"
                    language={language}
                    value={activeFile?.content || ''}
                    theme={isDark ? 'vs-dark' : 'vs-light'}
                    onChange={handleEditorChange}
                    onMount={handleEditorMount}
                    options={{
                        minimap: { enabled: settings.editor.showMinimap },
                        wordWrap: settings.editor.wordWrap ? 'on' : 'off',
                        fontSize: settings.editor.fontSize,
                        fontFamily: settings.appearance.fontFamily,
                        padding: { top: 20, bottom: 20 },
                        inlineSuggest: { enabled: true, mode: 'subwordSmart' },
                        quickSuggestions: true,
                        suggestOnTriggerCharacters: true,
                        tabCompletion: 'on',
                        scrollBeyondLastLine: true,
                        smoothScrolling: true,
                        cursorBlinking: 'smooth',
                        cursorSmoothCaretAnimation: 'on',
                        renderLineHighlight: 'all',
                        tabSize: settings.editor.tabSize,
                        insertSpaces: true,
                        detectIndentation: false,
                        autoIndent: 'advanced',
                        lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
                    }}
                />
            </div>

            {/* Glass Status Bar */}
            <div className="h-7 bg-gradient-to-r from-primary/90 to-primary/70 text-white text-[11px] flex items-center justify-between px-3 shrink-0 select-none font-medium backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all">
                        <GitBranch size={11} />
                        <span>main</span>
                    </div>
                    <div className="flex items-center gap-1.5 hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all">
                        <CheckCircle size={11} />
                        <span>0</span>
                        <AlertCircle size={11} className="ml-1" />
                        <span>0</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all">
                        Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
                    </div>
                    <div className="w-px h-3 bg-white/30" />
                    <div className="hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all">
                        UTF-8
                    </div>
                    <div className="w-px h-3 bg-white/30" />
                    <div className="hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all font-semibold">
                        {language.toUpperCase()}
                    </div>
                    <div className="w-px h-3 bg-white/30" />
                    <div className="hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer transition-all">
                        Prettier
                    </div>
                </div>
            </div>
        </div >
    );
};
