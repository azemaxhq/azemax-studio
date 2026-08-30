/**
 * Single Source of Truth for the active Monaco editor.
 *
 * Every AI operation MUST obtain the current code via `getActiveEditorValue()`
 * which calls `editor.getValue()` at request time — never from stale React
 * state, cached file content, or chat history.
 *
 * CodeEditor registers the active instance on mount / file switch;
 * AIAssistant and any other consumer reads it via `getActiveEditorContext()`.
 */

import type * as Monaco from 'monaco-editor';
import { getLanguageFromFilename } from '../../utils/language';

export interface ActiveEditorContext {
    /** Current file name, e.g. "hello.js" */
    fileName: string;
    /** Detected language, e.g. "javascript" */
    language: string;
    /** Fresh code from Monaco model — source of truth */
    code: string;
    /** Current selection text, if any */
    selectionText: string | null;
    /** Selection range in Monaco coordinates (1-based) */
    selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null;
    /** Cursor position */
    cursor: {
        line: number;
        column: number;
    } | null;
    /** Total line count */
    lineCount: number;
    /** File id for ProjectContext update */
    fileId: string | null;
}

let activeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let activeMonaco: typeof Monaco | null = null;
let activeFileMeta: { id: string; name: string } | null = null;

// Language detection helper — delegates to central language.ts (30+ languages)
function detectLanguage(fileName: string): string {
    return getLanguageFromFilename(fileName);
}

export function setActiveEditor(
    editor: Monaco.editor.IStandaloneCodeEditor | null,
    monaco: typeof Monaco | null,
    fileMeta: { id: string; name: string } | null,
): void {
    activeEditor = editor;
    activeMonaco = monaco;
    activeFileMeta = fileMeta;
    if (import.meta.env.DEV) {
        console.log('[EditorStore] setActiveEditor', {
            fileName: fileMeta?.name ?? null,
            hasEditor: !!editor,
            hasModel: !!editor?.getModel(),
        });
    }
}

export function getActiveEditor(): Monaco.editor.IStandaloneCodeEditor | null {
    return activeEditor;
}

export function getActiveMonaco(): typeof Monaco | null {
    return activeMonaco;
}

export function getActiveEditorValue(): string | null {
    const editor = activeEditor;
    if (!editor) return null;
    const model = editor.getModel();
    if (!model) return null;
    return model.getValue();
}

export function getActiveEditorContext(): ActiveEditorContext | null {
    const editor = activeEditor;
    if (!editor || !activeFileMeta) return null;
    const model = editor.getModel();
    if (!model) return null;

    const code = model.getValue();
    const selection = editor.getSelection();
    const position = editor.getPosition();

    let selectionText: string | null = null;
    let selectionRange: ActiveEditorContext['selection'] = null;
    if (selection && !selection.isEmpty()) {
        selectionText = model.getValueInRange(selection);
        selectionRange = {
            startLine: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLine: selection.endLineNumber,
            endColumn: selection.endColumn,
        };
    }

    return {
        fileName: activeFileMeta.name,
        language: detectLanguage(activeFileMeta.name),
        code,
        selectionText,
        selection: selectionRange,
        cursor: position ? { line: position.lineNumber, column: position.column } : null,
        lineCount: model.getLineCount(),
        fileId: activeFileMeta.id,
    };
}

export function getActiveFileMeta(): { id: string; name: string } | null {
    return activeFileMeta;
}

export function clearActiveEditor(): void {
    activeEditor = null;
    activeMonaco = null;
    activeFileMeta = null;
}
