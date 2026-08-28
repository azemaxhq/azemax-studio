/**
 * Intent Resolver — intent-first, no hardcoded phrase lists.
 *
 * Responsibility: decide whether a user message *requires* an edit, is a pure chat/explain,
 * or is ambiguous and needs clarification. This is the GATE before any mutation.
 *
 * This resolver does NOT contain keyword tables (EDIT_INTENT_KEYWORDS, CHAT_ONLY_PATTERNS, etc.).
 * Intent is inferred structurally:
 *  - whether there is an active editor/file and selection
 *  - whether the message is empty/whitespace
 *  - otherwise defer to the semantic planner (model) for full natural-language understanding
 *
 * The semantic planner (AI) is the source of truth for variations like
 * add/remove comments, simplify, change line 4, remove line, replace, refactor, fix, rename, etc.
 * This resolver only provides a fast, safe pre-check that never mutates and never hardcodes phrases.
 */

export type AIOperation = 'chat' | 'edit' | 'clarify';

export type AIEditIntent =
    | 'comment'
    | 'remove_comment'
    | 'insert'
    | 'replace'
    | 'modify'
    | 'refactor'
    | 'delete'
    | 'complete'
    | 'fix';

export interface AIResolvedIntent {
    operation: AIOperation;
    editIntent?: AIEditIntent;
    confidence: number;
    targetScope?: 'selection' | 'function' | 'file' | 'project';
    reasoning?: string;
    needsClarification?: boolean;
    clarificationQuestion?: string;
}

/**
 * Lightweight structural intent check.
 * - No keyword lists. No phrase matching.
 * - Returns low confidence when ambiguous so the caller defers to semanticPlanner.
 * - If hasActiveFile is false, never return edit (cannot mutate without a file).
 * - If message is empty, ask clarification.
 * - Otherwise return a neutral `chat` with confidence 0.5 to force semantic resolution.
 *
 * The caller (AIAssistant) should treat confidence < 0.7 as "defer to AI planner".
 */
export function resolveIntent(
    userMessage: string,
    context: {
        hasSelection: boolean;
        hasActiveFile: boolean;
        activeLanguage?: string;
        cursorInComment?: boolean;
    }
): AIResolvedIntent {
    const trimmed = userMessage.trim();

    if (!trimmed) {
        return {
            operation: 'clarify',
            confidence: 1.0,
            needsClarification: true,
            clarificationQuestion: 'Could you say a bit more about what you want to do?',
            reasoning: 'Empty message',
        };
    }

    if (!context.hasActiveFile) {
        return {
            operation: 'chat',
            confidence: 1.0,
            reasoning: 'No active file to edit — default to chat/explain',
        };
    }

    // Ambiguous by default — let the semantic planner (model) understand the natural language.
    // We only use structural hint: if there is a selection, an edit likely targets it.
    const targetScope: AIResolvedIntent['targetScope'] = context.hasSelection ? 'selection' : 'file';

    return {
        operation: 'chat',
        confidence: 0.55,
        targetScope,
        reasoning: 'Deferred to semantic planner for intent-first understanding',
    };
}

/**
 * Resolves scope structurally, without keyword inspection.
 */
export function resolveEditScope(
    intent: AIResolvedIntent,
    context: {
        hasSelection: boolean;
        selectionRange?: { start: number; end: number; lines: number };
        cursorPosition?: number;
        fileContent: string;
    }
): { startLine: number; endLine: number; scope: 'selection' | 'function' | 'file' } {
    if (context.hasSelection && context.selectionRange) {
        return {
            startLine: Math.floor(context.selectionRange.start),
            endLine: Math.floor(context.selectionRange.end),
            scope: 'selection',
        };
    }
    if (intent.targetScope === 'function') {
        return { startLine: 1, endLine: context.fileContent.split('\n').length, scope: 'function' };
    }
    return {
        startLine: 1,
        endLine: context.fileContent.split('\n').length,
        scope: 'file',
    };
}

/**
 * Whether a request should use fast chat profile.
 * Now based purely on confidence, not keyword.
 */
export function shouldUseFastChat(intent: AIResolvedIntent): boolean {
    return intent.operation === 'chat' && intent.confidence > 0.9;
}
