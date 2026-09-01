/**
 * Semantic Intent → Action Plan Pipeline — Centralized AI interpretation layer.
 *
 * The model infers operation, target, scope, constraints, exceptions, and conditions
 * from the full natural-language request. No hard-coded keyword lists are used.
 * Deterministic executor handles safe execution; this module is purely for
 * understanding and planning.
 *
 * Pipeline:
 *   User request + fresh Monaco code (line-numbered) + selection + file tree
 *     → semantic planner prompt (instructs model to output JSON plan)
 *     → AI call (non-streaming, low temp)
 *     → tolerant JSON extraction + validation
 *     → caller converts to AIAction[] and executes via aiToolExecutor
 */

import type { ActiveEditorContext } from '../editor/activeEditorStore';
import type { ChatMessage } from './types';
import { sendChat } from './AIClient';

export type SemanticOperation = 'chat' | 'explain' | 'edit';

export type SemanticActionType =
    | 'chat'
    | 'explain'
    | 'add_comments'
    | 'remove_comments'
    | 'create_file'
    | 'delete_file'
    | 'rename_file'
    | 'update_file'
    | 'insert_code'
    | 'replace_code'
    | 'delete_code'
    | 'refactor'
    | 'fix'
    | 'read_file'
    | 'search_files'
    | 'list_files'
    | 'get_diagnostics'
    | 'get_editor_context'
    | 'open_file'
    | 'run_code';

export interface SemanticTarget {
    /** Absolute or workspace-relative path, e.g. "src/hello.c" */
    filePath?: string;
    /** Scope hint: file | selection | function | block | project */
    scope?: 'file' | 'selection' | 'function' | 'block' | 'project';
    selectionRange?: { startLine: number; endLine: number };
    lineRange?: { startLine: number; endLine: number };
}

export interface SemanticConstraints {
    /** Natural-language preservation requirements (e.g. "comment describing printf") */
    preserve?: string[];
    /** Must preserve program output/behavior */
    preserveOutput?: boolean;
    preserveBehavior?: boolean;
    /** Free-form scope description, e.g. "only where useful" */
    scopeDescription?: string;
    /** Other free-form constraints */
    description?: string;
}

export interface SemanticAction {
    type: SemanticActionType;
    target?: SemanticTarget;
    constraints?: SemanticConstraints;
    exceptions?: string[];
    conditions?: string[];
    /** Concrete payload — line numbers, comments, content, etc. Resolved by the model against CURRENT code. */
    payload?: {
        /**
          * For add_comments / update_comment / remove_comment.
          * Each entry: 1-based line the model saw, comment text WITHOUT markers,
          * optional mode ('add'|'replace' → upsert; 'remove'), optional anchor =
          * exact current content of that line so the executor can validate it.
          */
        comments?: Array<{ line: number; text: string; mode?: string; anchor?: string }>;
        /** For remove_comments: exact comment line numbers to KEEP (preserve) */
        preserveLines?: number[];
        /** For remove_comments alternative: exact line numbers to REMOVE */
        removeLines?: number[];
        /** For create_file / update_file / replace_code */
        content?: string;
        /** For create_file path override, rename newPath */
        path?: string;
        newPath?: string;
        /** For insert/replace/delete_code */
        line?: number;
        startLine?: number;
        endLine?: number;
        /** Exact current content of the first targeted line (stale-guard anchor) */
        anchor?: string;
        /** For chat/explain immediate answer */
        message?: string;
        /** For read/search/list/open/diagnostics */
        query?: string;
    };
    ordering?: number;
}

export interface SemanticPlan {
    analysis: {
        operation: SemanticOperation;
        wantsModification: boolean;
        wantsExplanation: boolean;
        summary: string;
    };
    actions: SemanticAction[];
    globalConstraints?: SemanticConstraints;
    /** For chat/explain, model may provide immediate answer */
    responseMessage?: string;
}

function buildLineNumberedCode(code: string, maxLines = 200): string {
    const lines = code.split('\n').slice(0, maxLines);
    const pad = String(lines.length).length;
    return lines.map((l, i) => `${String(i + 1).padStart(pad, ' ')} | ${l}`).join('\n');
}

export function buildSemanticPlannerPrompt(
    userMessage: string,
    editorContext: ActiveEditorContext | null,
    fileTreeString: string,
    history: ChatMessage[]
): { messages: ChatMessage[]; modelTask: 'chat' } {
    const fileName = editorContext?.fileName ?? '(no active file)';
    const filePath = editorContext?.filePath ?? fileName;
    const language = editorContext?.language ?? 'plaintext';
    const extension = editorContext?.extension ?? '';
    const className = editorContext?.className ?? null;
    const moduleName = editorContext?.moduleName ?? null;
    const lineCount = editorContext?.lineCount ?? 0;
    const selectionText = editorContext?.selectionText?.slice(0, 2000) ?? null;
    const selectionRange = editorContext?.selection;
    const code = editorContext?.code ?? '';
    const lineNumbered = code ? buildLineNumberedCode(code) : '(empty)';

    const historySnippet = history.slice(-6).map(m => `${m.role}: ${m.content.slice(0, 400)}`).join('\n');

    const systemPrompt = `You are the SEMANTIC INTENT PARSER for a code editor. Your only job is to understand the user's natural-language request against the provided code and output ONE validated JSON action plan. You must NOT hard-code keywords — infer intent from the full request, the code, and the selection/cursor context.

CRITICAL OUTPUT RULES:
- Output ONLY valid JSON. No markdown fences, no explanation, no reasoning.
- Infer operation, target, scope, constraints from the user's wording. Paraphrases must produce the same correct plan.
- Decide semantically whether the user wants: an edit to code/comments (operation "edit" with concrete actions), only an explanation (operation "explain"), or conversation (operation "chat").
- Be conservative: if the request is ambiguous — you cannot identify WHICH lines/file/symbol it targets — return a chat action asking for clarification. Never guess when the target is unclear.

TOOL SELECTION RULES (Cursor-style Agent):
- You have IDE tools: read_file(path), search_files(query), list_files(path), get_editor_context(), get_diagnostics(path), open_file(path), plus mutation tools below.
- If the user refers to "this/that/here/that function/this file" resolve via selection → cursor → active file → visible code. You already have that context — no tool needed.
- If the user asks about ANOTHER file ("in UserService", "that component", "the config") and you don't have its content, emit a read/search action FIRST. Reads are executed locally before any edit, so multi-file tasks work in one turn.
- Example multi-file: "Create UserService and update controller to use it" → read project structure, read controller, create_file(UserService), replace_code(controller import+usage).
- Reads/searches are non-mutating and never need anchors.

EDIT DECISION RULES:
- Choose the smallest sufficient operation set: prefer line/range ops (replace_code, delete_code, insert_code) and comment metadata over full-file rewrites.
- NEVER output update_file (whole-file content) unless the user explicitly asks to rewrite/regenerate/replace the ENTIRE file.
- Every line/range number MUST come from the line-numbered CURRENT file content below. Never invent line numbers; never reuse numbers from earlier turns if the file may have changed.
- For each targeted op include payload.anchor = the EXACT current text (without the line-number prefix) of the FIRST line in the target range. This lets the executor verify the target before editing.
- If the user asks to change/replace/remove something identifiable by surrounding context ("this", "the selected", "that function", "the print"), locate it precisely using the selection range (if any), the cursor position, and nearby code. Resolve references to exact line numbers.
- Replacing means REPLACING: the new content takes the place of the old — never append a copy of existing lines.
- Multiple independent changes in one request → multiple actions with distinct, non-overlapping ranges, ordered top-to-bottom by position.

COMMENT OPERATION RULES (metadata only — comments never alter executable code):
- add_comments payload.comments entries: {"line": N, "text": "...", "mode": "add"|"replace"|"remove", "anchor": "<exact current content of line N>"}.
  - mode "add": user wants a new comment for that line.
  - mode "replace": user wants an EXISTING comment changed/replaced — same mechanics as add (the executor updates the associated comment in place instead of duplicating).
  - mode "remove": delete the comment associated with that line (text may be empty).
- Identify the correct associated comment via selection/cursor/nearby-code context when the user says "this comment" / "the comment above X".
- Comment text describes THAT line's purpose in the user's requested style (simple/detailed/etc.) WITHOUT markers — the editor applies language-correct syntax.
- remove_comments (bulk) removes all comments in scope; use payload.preserveLines for exceptions the user names, resolved to actual comment-line numbers from the current file.

LANGUAGE & FILE CONSTRAINTS:
- Respect the language of the target file. For Java: the public class name MUST exactly match the filename (without extension), derived dynamically from fileName — never hard-coded. Examples: hello.java → class hello, HelloWorld.java → class HelloWorld, BinarySearch.java → class BinarySearch. Do NOT generate "public class BinarySearch" inside "hello.java"; if the user wants a BinarySearch class, create a separate file "BinarySearch.java" with "public class BinarySearch". When modifying an existing Java file, keep the class name equal to its filename.
- For .tsx/.jsx component names should match the base name; follow idiomatic conventions per language.
- If the user asks to write/generate a program into an existing non-empty file without naming another file, modify that file's content in place (insert_code/replace_code), honoring its filename-derived class. Use update_file only when user asks to rewrite/regenerate the entire file.

SCHEMA (exact keys):
{
  "analysis": {
    "operation": "chat" | "explain" | "edit",
    "wantsModification": boolean,
    "wantsExplanation": boolean,
    "summary": "short natural-language summary"
  },
  "actions": [
    {
      "type": "add_comments" | "remove_comments" | "create_file" | "delete_file" | "rename_file" | "update_file" | "insert_code" | "replace_code" | "delete_code" | "read_file" | "search_files" | "list_files" | "get_diagnostics" | "get_editor_context" | "open_file",
      "target": {
        "filePath": "string (defaults to the active editor file)",
        "scope": "file" | "selection" | "function" | "block",
        "selectionRange": {"startLine": number, "endLine": number},
        "lineRange": {"startLine": number, "endLine": number}
      },
      "constraints": {
        "preserve": ["natural-language preservation requirements"],
        "preserveOutput": boolean,
        "preserveBehavior": boolean,
        "scopeDescription": "e.g. 'only where useful'"
      },
      "payload": {
        "comments": [{"line": number, "text": "string", "mode": "add"|"replace"|"remove", "anchor": "string"}],
        "preserveLines": [number],
        "content": "string (only for create_file/update_file/insert_code/replace_code)",
        "path": "string", "newPath": "string", "query": "string (for search_files)",
        "line": number, "startLine": number, "endLine": number,
        "anchor": "exact current first-target-line content",
        "message": "chat/explain answer"
      },
      "ordering": number
    }
  ],
  "globalConstraints": {"preserveOutput": boolean, "preserveBehavior": boolean},
  "responseMessage": "optional immediate answer for chat/explain"
}

Context you receive is FRESH at request time. Base every decision on it. Output ONLY the JSON.`;

    // Build authoritative file identity block — class must match filename (derived dynamically, never hard-coded)
    const expectedClass = fileName ? fileName.replace(/\.[^/.]+$/, '') : null;
    const fileIdentityBlock = editorContext
        ? [
            `CURRENT FILE (authoritative — from active editor):`,
            `- fileName: ${fileName}`,
            `- filePath: ${filePath}`,
            `- extension: ${extension || '(none)'}`,
            `- language: ${language}`,
            `- expectedClass (derived from fileName, not hard-coded): ${expectedClass ?? '(none)'}`,
            className ? `- existingClass (parsed from content): ${className}` : `- existingClass: (none detected)`,
            moduleName && language !== 'java' ? `- moduleName: ${moduleName}` : null,
            language === 'java' ? `IMPORTANT: For Java, public class MUST exactly match filename-derived expectedClass "${expectedClass ?? '—'}" — derive from fileName, never hard-code. File "${fileName}" must contain class "${expectedClass ?? '—'}". If user wants BinarySearch, create "BinarySearch.java" with class "BinarySearch", not inside "${fileName}".` : `IMPORTANT: Preserve file identity "${fileName}" — use filePath "${filePath}" for all edits.`,
        ].filter(Boolean).join('\n')
        : `CURRENT FILE: (no active file)`;

    const userPrompt = [
        fileIdentityBlock,
        `Lines: ${lineCount} | DocumentVersion: ${editorContext?.documentVersionId ?? 'unknown'} | FileId: ${editorContext?.fileId ?? 'unknown'}`,
        selectionText
            ? `Selection (lines ${selectionRange?.startLine}-${selectionRange?.endLine}):\n\`\`\`${language}\n${selectionText}\n\`\`\``
            : `Selection: none`,
        editorContext?.cursor
            ? `Cursor: line ${editorContext.cursor.line}, column ${editorContext.cursor.column}`
            : `Cursor: unknown`,
        `File content with line numbers (1-based, CURRENT):`,
        '```' + language,
        lineNumbered.slice(0, 12000),
        '```',
        fileTreeString ? `Project file tree:\n${fileTreeString}` : `Project file tree: (unavailable)`,
        historySnippet ? `Recent conversation (oldest→newest):\n${historySnippet}` : `Recent conversation: (none)`,
        `User request (interpret semantically; resolve every reference to concrete line numbers/paths from the CURRENT content): "${userMessage}"`,
        ``,
        `Respond ONLY with the JSON plan. If the user wants chat or explanation, set wantsModification=false. If they want any file change, set wantsModification=true and provide concrete payload line numbers + anchors.`,
    ].join('\n\n');

    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    return { messages, modelTask: 'chat' };
}

export function parseSemanticPlan(raw: string): SemanticPlan | null {
    if (!raw || typeof raw !== 'string') return null;
    let candidate = raw.trim();
    // Extract fenced JSON if present (tolerant)
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();
    // Find first JSON object
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]);
        if (!parsed || typeof parsed !== 'object') return null;
        const analysis = parsed.analysis;
        const actions = parsed.actions;
        if (!analysis || typeof analysis !== 'object') return null;
        if (!Array.isArray(actions)) return null;
        // Normalize and validate
        const operation = analysis.operation as string;
        if (!['chat', 'explain', 'edit'].includes(operation)) return null;
        const wantsModification = Boolean(analysis.wantsModification);
        const wantsExplanation = Boolean(analysis.wantsExplanation);
        const summary = typeof analysis.summary === 'string' ? analysis.summary : '';

        const normalizedActions: SemanticAction[] = [];
        for (const a of actions) {
            if (!a || typeof a !== 'object' || typeof (a as any).type !== 'string') continue;
            const type = (a as any).type as SemanticActionType;
            const allowed: SemanticActionType[] = [
                'chat', 'explain', 'add_comments', 'remove_comments', 'create_file', 'delete_file', 'rename_file', 'update_file', 'insert_code', 'replace_code', 'delete_code', 'refactor', 'fix',
                'read_file', 'search_files', 'list_files', 'get_diagnostics', 'get_editor_context', 'open_file', 'run_code',
            ];
            if (!allowed.includes(type)) continue;
            normalizedActions.push({
                type,
                target: (a as any).target && typeof (a as any).target === 'object' ? (a as any).target : undefined,
                constraints: (a as any).constraints && typeof (a as any).constraints === 'object' ? (a as any).constraints : undefined,
                exceptions: Array.isArray((a as any).exceptions) ? (a as any).exceptions : undefined,
                conditions: Array.isArray((a as any).conditions) ? (a as any).conditions : undefined,
                payload: (a as any).payload && typeof (a as any).payload === 'object' ? (a as any).payload : undefined,
                ordering: typeof (a as any).ordering === 'number' ? (a as any).ordering : undefined,
            });
        }

        if (normalizedActions.length === 0 && wantsModification) {
            // Empty actions but wants modification is inconsistent — treat as invalid
            // Allow chat/explain with empty actions if responseMessage provided
            if (parsed.responseMessage && typeof parsed.responseMessage === 'string' && parsed.responseMessage.trim()) {
                normalizedActions.push({ type: operation === 'explain' ? 'explain' : 'chat', payload: { message: parsed.responseMessage } });
            } else {
                return null;
            }
        }

        return {
            analysis: {
                operation: operation as SemanticOperation,
                wantsModification,
                wantsExplanation,
                summary,
            },
            actions: normalizedActions,
            globalConstraints: parsed.globalConstraints && typeof parsed.globalConstraints === 'object' ? parsed.globalConstraints : undefined,
            responseMessage: typeof parsed.responseMessage === 'string' ? parsed.responseMessage : undefined,
        };
    } catch {
        return null;
    }
}

export async function generateSemanticPlan(
    userMessage: string,
    editorContext: ActiveEditorContext | null,
    fileTreeString: string,
    history: ChatMessage[],
    signal?: AbortSignal
): Promise<SemanticPlan | null> {
    const { messages } = buildSemanticPlannerPrompt(userMessage, editorContext, fileTreeString, history);
    try {
        const raw = await sendChat(messages, {
            signal,
            task: 'chat',
            temperature: 0.1,
            maxTokens: 800,
        });
        const plan = parseSemanticPlan(raw);
        if (import.meta.env.DEV) console.log('[SemanticPlanner] raw:', raw.slice(0, 800), 'parsed:', plan);
        return plan;
    } catch (e) {
        if (import.meta.env.DEV) console.warn('[SemanticPlanner] generate failed', e);
        return null;
    }
}

export function semanticPlanToAIOperationType(plan: SemanticPlan | null): import('./aiRequestStore').AIOperationType {
    if (!plan) return 'chat';
    const op = plan.analysis.operation;
    if (op === 'explain') return 'explanation';
    if (op === 'chat') return 'chat';
    // Edit: map first action type to operation for loading indicator
    const first = plan.actions[0]?.type;
    if (first === 'add_comments') return 'comment';
    if (first === 'remove_comments') return 'remove-comment';
    if (first === 'fix') return 'fix';
    if (first === 'refactor') return 'refactor';
    if (['create_file', 'delete_file', 'rename_file', 'update_file', 'insert_code', 'replace_code', 'delete_code'].includes(first)) return 'edit';
    return 'edit';
}
