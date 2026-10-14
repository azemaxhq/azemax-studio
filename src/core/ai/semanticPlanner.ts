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

export type SemanticOperation = 'chat' | 'explain' | 'edit' | 'implement';

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
    | 'run_code'
    | 'create_directory'
    | 'implement';

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

function buildLineNumberedCode(code: string, maxLines = 400): string {
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
- Decide semantically whether the user wants: an edit to code/comments (operation "edit" with concrete actions), the construction of new files (operation "implement"), only an explanation (operation "explain"), or conversation (operation "chat").

CLARIFICATION POLICY (this is the most important rule):
- DO NOT ask the user to specify a stack, a file name, a directory, or a framework when they did not. That is not ambiguity — that is your job to decide.
- An ordinary, informal request ("create a simple website", "create a todo website", "make it responsive", "add dark mode", "add a contact form") is a COMPLETE, ACTIONABLE request. Set wantsModification=true and produce concrete actions.
- For an unspecified "build me X" request, choose a sensible default yourself and set operation="implement":
  - If the workspace is empty or has no web project: create plain HTML/CSS/JS files (index.html, styles.css, script.js). Do NOT introduce React, Vue, ASP.NET, a package manager, or a build step.
  - If the workspace already has a project (package.json, or existing source files), extend THAT project's structure instead of scaffolding something parallel.
- The ONLY acceptable reason to emit a chat action asking a question is a GENUINE BLOCKER:
  (a) required information is genuinely unavailable,
  (b) two readings of the request would produce materially different deliverables,
  (c) the operation is destructive or security-sensitive,
  (d) a permission or credential is missing,
  (e) the task cannot be completed safely without user input.
  Anything outside that list: proceed with a sensible default. Uncertainty is resolved by inspecting the workspace, not by asking.

FOLLOW-UP CONTEXT (critical):
- The TASK CONTEXT section below states the ORIGINAL task plus the user's follow-ups. A follow-up like "using html", "make it responsive", or "add dark mode" MODIFIES that task. Never treat a follow-up as a standalone request and never re-ask what the original request already established.
- If TASK CONTEXT lists FILES CREATED/MODIFIED SO FAR, a follow-up applies to those files.
- "continue" / "do the remaining work" means: continue the existing task, inspect the current state, and finish it.

TOOL SELECTION RULES (Cursor-style Agent):
- You have IDE tools: read_file(path), search_files(query), list_files(path), get_editor_context(), get_diagnostics(path), open_file(path), plus mutation tools below.
- If the user refers to "this/that/here/that function/this file" resolve via selection → cursor → active file → visible code. You already have that context — no tool needed.
- If the user asks about ANOTHER file ("in UserService", "that component", "the config") and you don't have its content, emit a read/search action FIRST. Reads are executed locally before any edit, so multi-file tasks work in one turn.
- Example multi-file: "Create UserService and update controller to use it" → read project structure, read controller, create_file(UserService), replace_code(controller import+usage).
- Reads/searches are non-mutating and never need anchors.

EDIT DECISION RULES:
- Choose the smallest sufficient operation set: prefer line/range ops (replace_code, delete_code, insert_code) and comment metadata over full-file rewrites.
- For refactor/simplify intents that fundamentally change structure (e.g., "make simple", "remove class", "flatten", "without boilerplate", "direct print"), WHOLE-FILE rewrites ARE allowed and preferred: use update_file with complete new content OR replace_code with startLine=1 endLine=N covering the entire file. This is the correct tool for class->script simplification.
- NEVER invent line numbers; every number MUST come from the CURRENT line-numbered file below. For whole-file update_file, no line numbers are needed — just path + content.
- For each targeted range op include payload.anchor = the EXACT current text (without the line-number prefix) of the FIRST line in the target range. This lets the executor verify the target before editing.
- If the user asks to change/replace/remove something identifiable by surrounding context ("this", "the selected", "that function", "the print"), locate it precisely using the selection range (if any), the cursor position, and nearby code. Resolve references to exact line numbers.
- Replacing means REPLACING: the new content takes the place of the old — never append a copy of existing lines.
- For "make simple" example: Python class hello with greet() printing Hello World -> update_file with print("Hello, World!") is correct. Do not preserve class boilerplate when user explicitly asks to simplify.
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
        if (!['chat', 'explain', 'edit', 'implement'].includes(operation)) return null;
        const wantsModification = Boolean(analysis.wantsModification);
        const wantsExplanation = Boolean(analysis.wantsExplanation);
        const summary = typeof analysis.summary === 'string' ? analysis.summary : '';

        const normalizedActions: SemanticAction[] = [];
        for (const a of actions) {
            if (!a || typeof a !== 'object' || typeof (a as any).type !== 'string') continue;
            const type = (a as any).type as SemanticActionType;
            const allowed: SemanticActionType[] = [
                'chat', 'explain', 'implement', 'add_comments', 'remove_comments', 'create_file', 'delete_file', 'rename_file', 'update_file', 'insert_code', 'replace_code', 'delete_code', 'refactor', 'fix',
                'read_file', 'search_files', 'list_files', 'get_diagnostics', 'get_editor_context', 'open_file', 'run_code', 'create_directory',
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
        // Latency-critical: intent parsing is a small JSON task — pin it to the
        // fast Groq model instead of the default (slow) primary. Measured
        // ~0.3s vs ~8s on NVIDIA for the same prompt. Backend still falls back
        // across all configured providers if Groq is unavailable.
        const raw = await sendChat(messages, {
            signal,
            model: 'qwen/qwen3.8-27b',
            task: 'chat',
            temperature: 0.1,
            maxTokens: 1200,
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
    if (op === 'implement') return 'generate';
    // Edit: map first action type to operation for loading indicator
    const first = plan.actions[0]?.type;
    if (first === 'add_comments') return 'comment';
    if (first === 'remove_comments') return 'remove-comment';
    if (first === 'fix') return 'fix';
    if (first === 'refactor') return 'refactor';
    if (['create_file', 'create_directory', 'delete_file', 'rename_file', 'update_file', 'insert_code', 'replace_code', 'delete_code'].includes(first)) return 'edit';
    return 'edit';
}
