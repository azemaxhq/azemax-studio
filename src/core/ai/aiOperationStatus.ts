import type { AIOperationType } from './aiRequestStore';
import type { AILoadingStatus } from '../../hooks/useAILoading';

/**
 * Centralized operation → user-facing status mapping.
 * Only place where loading text is defined. Every AI feature reuses it.
 * Hides internal lifecycle (thinking/generating/streaming) — shows what the user asked for.
 */

export type AIUserFacingStatus = string;

const OPERATION_LABELS: Record<AIOperationType, string> = {
    chat: 'Preparing response…',
    explanation: 'Explaining code…',
    'explain-file': 'Explaining code…',
    'explain-selection': 'Explaining selection…',
    edit: 'Applying changes…',
    comment: 'Adding comments…',
    'remove-comment': 'Removing comments…',
    generate: 'Generating code…',
    fix: 'Fixing code…',
    refactor: 'Refactoring code…',
};

// Fallbacks for any future operation
const GENERIC_FALLBACK: Record<AIOperationType, string> = {
    chat: 'Preparing response…',
    explanation: 'Analyzing code…',
    'explain-file': 'Explaining code…',
    'explain-selection': 'Explaining selection…',
    edit: 'Applying changes…',
    comment: 'Adding comments…',
    'remove-comment': 'Removing comments…',
    generate: 'Generating code…',
    fix: 'Fixing code…',
    refactor: 'Refactoring code…',
};

export function getUserFacingStatus(
    operation: AIOperationType | string,
    status: AILoadingStatus,
): string | null {
    if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;
    // For chat, distinguish fast_chat vs normal? But operation is 'chat' for both; we use generic
    // For any loading status (preparing/thinking/generating/streaming/applying), show the operation label
    // This hides internal states and shows the user's intent
    const op = operation as AIOperationType;
    if (op in OPERATION_LABELS) return OPERATION_LABELS[op];
    if (op in GENERIC_FALLBACK) return GENERIC_FALLBACK[op as AIOperationType];
    // Fallback for unknown operations — map based on common substrings
    if (op.includes('comment') && op.includes('remove')) return 'Removing comments…';
    if (op.includes('comment')) return 'Adding comments…';
    if (op.includes('explain')) return 'Explaining code…';
    if (op.includes('fix') || op.includes('debug')) return 'Fixing code…';
    if (op.includes('refactor')) return 'Refactoring code…';
    if (op.includes('optimize')) return 'Optimizing code…';
    if (op.includes('generate')) return 'Generating code…';
    if (op.includes('search')) return 'Searching the project…';
    if (op.includes('run')) return 'Running code…';
    if (op.includes('review')) return 'Reviewing code…';
    // Default for chat
    return 'Preparing response…';
}

// For legacy status-only callers (no operation known), map lifecycle to generic
export function getLegacyStatusLabel(status: AILoadingStatus): string | null {
    const map: Record<AILoadingStatus, string | null> = {
        idle: null,
        preparing: 'Preparing response…',
        thinking: 'Preparing response…',
        generating: 'Writing response…',
        streaming: 'Writing response…',
        applying: 'Applying changes…',
        success: null,
        error: null,
        cancelled: null,
    };
    return map[status] ?? null;
}
