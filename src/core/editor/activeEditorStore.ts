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

/**
 * Canonical active-file context — single source of truth for Explorer → Editor → Chat → AI.
 * Every consumer MUST read via `getActiveEditorContext()`; never from stale React state or chat history.
 */
export interface ActiveEditorContext {
    /** Current file name, e.g. "hello.java" */
    fileName: string;
    /** Full workspace path, e.g. "src/hello.java" or "hello.java" (name when at root) */
    filePath: string;
    /** Lowercase extension without dot, e.g. "java" */
    extension: string;
    /** Detected language, e.g. "java" */
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
    /** File id (opaque document identity; stable across rename/move) */
    fileId: string | null;
    /** Monaco model version at capture time — for stale-write guard */
    documentVersionId: number | null;
    /** Java public class name parsed from current code, if java */
    className: string | null;
    /** Module name for other languages (Python/C#/TS heuristic) */
    moduleName: string | null;
}

/** Lightweight file-context object for request pinning */
export interface ActiveFileContext {
    path: string;
    name: string;
    extension: string;
    language: string;
    content: string;
    className: string | null;
    moduleName: string | null;
    fileId: string | null;
    documentVersionId: number | null;
}

let activeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let activeMonaco: typeof Monaco | null = null;
let activeFileMeta: { id: string; name: string; path?: string | null } | null = null;

// Change listeners so UI (chips) stay in sync without polling ProjectContext
type Listener = () => void;
const listeners = new Set<Listener>();
function emitChange(): void {
    for (const l of listeners) {
        try { l(); } catch { /* ignore */ }
    }
}
export function subscribeActiveEditor(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

// Language detection helper — delegates to central language.ts (30+ languages)
function detectLanguage(fileName: string): string {
    return getLanguageFromFilename(fileName);
}

function getExtension(fileName: string): string {
    const base = fileName.split('/').pop() ?? fileName;
    const idx = base.lastIndexOf('.');
    return idx >= 0 ? base.slice(idx + 1).toLowerCase() : '';
}

function extractJavaClassName(code: string): string | null {
    // Matches the top-level public type in a Java file: class / interface / enum / record / @interface
    // Captures the first occurrence like `public class Foo`, `public interface Bar`, `public enum Baz`, `public record Qux(...)`
    // Also handles modifiers: final/abstract/sealed
    const re = /\bpublic\s+(?:(?:final|abstract|sealed)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_][A-Za-z0-9_]*)/;
    const m = code.match(re);
    if (m) return m[1];
    // Fallback: if no public type but a single top-level class exists (package-private), return it
    // This helps identify HelloWorld when file is hello.java but class is package-private
    const fallback = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(code);
    return fallback ? fallback[1] : null;
}

export function extractJavaTopLevelType(code: string): string | null {
    return extractJavaClassName(code);
}

function extractModuleName(code: string, language: string): string | null {
    if (language === 'python') {
        const m = code.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/m);
        if (m) return m[1];
    }
    if (language === 'csharp') {
        const m = code.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (m) return m[1];
    }
    if (language === 'typescript' || language === 'javascript') {
        const m = code.match(/^\s*(?:export\s+)?(?:class|function)\s+([A-Za-z_][A-Za-z0-9_]*)/m);
        if (m) return m[1];
    }
    return null;
}

export function setActiveEditor(
    editor: Monaco.editor.IStandaloneCodeEditor | null,
    monaco: typeof Monaco | null,
    fileMeta: { id: string; name: string; path?: string | null } | null,
): void {
    activeEditor = editor;
    activeMonaco = monaco;
    activeFileMeta = fileMeta;
    if (import.meta.env.DEV) {
        console.log('[EditorStore] setActiveEditor', {
            fileName: fileMeta?.name ?? null,
            filePath: fileMeta?.path ?? fileMeta?.name ?? null,
            hasEditor: !!editor,
            hasModel: !!editor?.getModel(),
        });
    }
    emitChange();
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

    const fileName = activeFileMeta.name;
    const filePath = (activeFileMeta.path ?? fileName) || fileName;
    const extension = getExtension(fileName);
    const language = detectLanguage(fileName);
    const className = language === 'java' ? extractJavaClassName(code) : null;
    const moduleName = extractModuleName(code, language);

    return {
        fileName,
        filePath,
        extension,
        language,
        code,
        selectionText,
        selection: selectionRange,
        cursor: position ? { line: position.lineNumber, column: position.column } : null,
        lineCount: model.getLineCount(),
        fileId: activeFileMeta.id,
        documentVersionId: model.getVersionId(),
        className,
        moduleName,
    };
}

export function getActiveFileContext(): ActiveFileContext | null {
    const ctx = getActiveEditorContext();
    if (!ctx) return null;
    return {
        path: ctx.filePath,
        name: ctx.fileName,
        extension: ctx.extension,
        language: ctx.language,
        content: ctx.code,
        className: ctx.className,
        moduleName: ctx.moduleName,
        fileId: ctx.fileId,
        documentVersionId: ctx.documentVersionId,
    };
}

export function getActiveFileMeta(): { id: string; name: string; path?: string | null } | null {
    return activeFileMeta;
}

export function updateActiveFileMeta(meta: { id: string; name: string; path?: string | null } | null): void {
    activeFileMeta = meta;
    emitChange();
}

export function clearActiveEditor(): void {
    activeEditor = null;
    activeMonaco = null;
    activeFileMeta = null;
    emitChange();
}

/** Lightweight validation helper — re-exported for executor */
export { extractJavaClassName, getExtension };
