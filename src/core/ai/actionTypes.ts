/**
 * Shared AI Action Types — the canonical mutation contract.
 *
 * These types are the SINGLE wire format for all AI-driven file mutations.
 * Defined here to break circular dependencies between aiToolExecutor,
 * editEngine, responseFormatter, structuredOperationParser, and semanticPlanner.
 *
 * This module has NO imports from other AI modules — it is the foundation.
 */

// Re-export core types from types.ts that are needed by action types
export type { AiTaskKey, ResponseLength, TaskType, ProjectContext, AIRequestOptions, AIRequestContext, AIResult, ChatMessage, AIStreamEvent, AIToolCall, AIToolDefinition, AIToolChoice, AIToolParameters, AIUsage } from './types';

/**
 * Comment Target — used for add_comments and remove_comments actions.
 */
export type CommentTarget = { line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string | null };

/**
 * AI Action Types — the canonical mutation contract.
 *
 * These types are the SINGLE wire format for all AI-driven file mutations.
 * Every AI mutation must be one of these.
 */
export type AIAction =
    | { action: 'add_comments'; comments: CommentTarget[]; file?: string }
    | { action: 'remove_comments'; file?: string; preserveLines?: number[]; scope?: 'file' | 'selection'; selectionRange?: { startLine: number; endLine: number } }
    | { action: 'create_file'; path: string; content: string }
    | { action: 'delete_file'; path: string }
    | { action: 'rename_file'; path: string; newPath: string }
    | { action: 'update_file'; path: string; content: string }
    | { action: 'insert_code'; path?: string; line: number; content: string; anchor?: string | null }
    | { action: 'replace_code'; path?: string; startLine: number; endLine: number; content: string; anchor?: string | null }
    | { action: 'delete_code'; path?: string; startLine: number; endLine: number }
    | { action: 'read_file'; path: string }
    | { action: 'search_files'; query: string }
    | { action: 'list_files'; path?: string }
    | { action: 'get_diagnostics'; path: string }
    | { action: 'get_editor_context' }
    | { action: 'open_file'; path: string };

export type AIActionPlan = {
    actions: AIAction[];
    reasoning?: string;
};

/**
 * Executor dependencies — the minimal interface needed to execute actions.
 */
export type ExecutorDeps = {
    getFileContent: (path: string) => string | null;
    getFileIdByPath: (path: string) => string | null;
    createFile: (path: string, content: string) => { success: boolean; error?: string };
    deleteNode: (id: string) => void;
    renameNode: (id: string, newName: string) => { success: boolean; error?: string };
    updateFileContent: (fileId: string, content: string) => { success: boolean; error?: string };
    getActiveFilePath: () => string | null;
    getActiveFileId: () => string | null;
    getFileTree?: () => import('../../utils/mockFileSystem').FileNode[];
};

/**
 * Execution result from the action executor.
 */
export type ExecutionResult = {
    success: boolean;
    appliedCount: number;
    message: string;
    details?: string;
    rolledBack?: boolean;
};

/**
 * Edit snapshot for rollback support.
 */
export interface FileSnapshot {
    filePath: string;
    content: string;
    lines: string[];
    timestamp: number;
}

export type EditSnapshot = FileSnapshot;