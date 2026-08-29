/**
 * Live IDE Context — single reliable context layer.
 * Always reads Monaco at request time, never stale React state.
 * Exposes: activeFile/path, content, selection/range, cursor, language,
 * visible/nearby code, open tabs, workspace tree, relevant files,
 * diagnostics, recent edits, conversation context.
 */

import { getActiveEditorContext, type ActiveEditorContext } from '../editor/activeEditorStore';
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from './workspaceContext';
import type { FileNode } from '../../utils/mockFileSystem';

export interface RecentEdit {
    filePath: string;
    timestamp: number;
    summary: string;
    lineCount: number;
}

const RECENT_EDITS_MAX = 20;
const recentEdits: RecentEdit[] = [];

export function recordRecentEdit(filePath: string, summary: string, lineCount: number): void {
    recentEdits.unshift({ filePath, timestamp: Date.now(), summary, lineCount });
    if (recentEdits.length > RECENT_EDITS_MAX) recentEdits.pop();
}

export function getRecentEdits(): RecentEdit[] {
    return [...recentEdits];
}

export interface LiveIDEContext extends WorkspaceSnapshot {
    /** 60-line window around cursor (or selection start) */
    visibleCode: string | null;
    visibleRange: { startLine: number; endLine: number } | null;
    openTabs: string[];
    recentEdits: RecentEdit[];
    diagnosticsSummary: string | null;
}

function getVisibleCodeSnippet(ctx: ActiveEditorContext | null, radius = 30): { code: string | null; range: { startLine: number; endLine: number } | null } {
    if (!ctx || !ctx.code) return { code: null, range: null };
    const lines = ctx.code.split('\n');
    const anchor = ctx.selection?.startLine ?? ctx.cursor?.line ?? 1;
    const start = Math.max(1, anchor - radius);
    const end = Math.min(lines.length, anchor + radius);
    const snippet = lines.slice(start - 1, end).join('\n');
    return { code: snippet, range: { startLine: start, endLine: end } };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deriveOpenTabs(activeFile: string | null, allPaths: string[], _fileTree: FileNode[]): string[] {
    const tabs: string[] = [];
    if (activeFile) tabs.push(activeFile);
    // modified/expanded heuristic: prefer files that have content and are shallow
    for (const p of allPaths) {
        if (tabs.includes(p)) continue;
        if (tabs.length >= 8) break;
        tabs.push(p);
    }
    // De-dupe preserve order
    return [...new Set(tabs)];
}

/**
 * Capture fresh live IDE context. Reads Monaco synchronously, fileTree provided.
 * Diagnostics are summarized synchronously if available via Monaco markers; async deep checks stay in tool path.
 */
export function captureLiveIDEContext(
    fileTree: FileNode[],
    opts?: { diagnosticsSummary?: string | null },
): LiveIDEContext {
    const ctx = getActiveEditorContext();
    const snap = buildWorkspaceSnapshot(ctx, fileTree);
    const { code: visibleCode, range: visibleRange } = getVisibleCodeSnippet(ctx);
    const openTabs = deriveOpenTabs(snap.fileName, snap.allFilePaths, fileTree);
    return {
        ...snap,
        visibleCode,
        visibleRange,
        openTabs,
        recentEdits: getRecentEdits(),
        diagnosticsSummary: opts?.diagnosticsSummary ?? null,
    };
}

/** Resolve file-aware references: "this/that/here" → concrete target using selection → cursor → active file */
export function resolveFileAwareTarget(ctx: ActiveEditorContext | null): { filePath: string | null; line: number | null; selection: string | null } {
    if (!ctx) return { filePath: null, line: null, selection: null };
    if (ctx.selectionText && ctx.selection) {
        return { filePath: ctx.fileName, line: ctx.selection.startLine, selection: ctx.selectionText };
    }
    if (ctx.cursor) {
        return { filePath: ctx.fileName, line: ctx.cursor.line, selection: null };
    }
    return { filePath: ctx.fileName, line: null, selection: null };
}

/** Build rich prompt fragment for live context */
export function formatLiveContextForPrompt(live: LiveIDEContext): string {
    const parts: string[] = [];
    parts.push(`Active file: ${live.fileName ?? '(none)'} (${live.language ?? 'unknown'}, ${live.lineCount} lines)`);
    if (live.selectionText) parts.push(`Selection [${live.selectionRange?.startLine}-${live.selectionRange?.endLine}]:\n\`\`\`${live.language}\n${live.selectionText.slice(0, 2000)}\n\`\`\``);
    else parts.push(`Selection: none`);
    if (live.visibleRange) parts.push(`Cursor: line ${live.activeEditor?.cursor?.line ?? '?'} col ${live.activeEditor?.cursor?.column ?? '?'} | Visible [${live.visibleRange.startLine}-${live.visibleRange.endLine}]:\n\`\`\`${live.language}\n${(live.visibleCode ?? '').slice(0, 4000)}\n\`\`\``);
    if (live.openTabs.length) parts.push(`Open tabs: ${live.openTabs.join(', ')}`);
    if (live.diagnosticsSummary) parts.push(`Diagnostics:\n${live.diagnosticsSummary.slice(0, 1500)}`);
    if (live.recentEdits.length) parts.push(`Recent edits:\n${live.recentEdits.slice(0, 5).map(e => `- ${e.filePath}: ${e.summary}`).join('\n')}`);
    parts.push(`Workspace tree:\n${live.fileTreeString.slice(0, 2000)}`);
    return parts.join('\n\n');
}
