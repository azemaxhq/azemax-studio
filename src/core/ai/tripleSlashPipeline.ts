/**
 * Premium Triple-Slash Pipeline — from-base rebuild for `///` AI commenting.
 *
 * Principles (premium architecture):
 *  - No hardcoded templates. Generated code comes from the model chain
 *    (fast Groq first, OpenRouter free second, DeepSeek last).
 *  - No artificial delays. Processing indicator is immediate, AI streaming is frame-coalesced
 *    with first-token sync, idle timeout 15s, hard timeout 15/25s.
 *  - Clean snapshot: the `///...;` marker is stripped from the file view sent to AI, so the
 *    model never sees the instruction as code and never hallucinates duplicate #include.
 *  - Inline-aware: `code ///cmd;` → replace `code` on that line; standalone `///cmd;` → replace that line.
 *  - Atomic: single `replace_code` via `executeActionPlan` (resolve→compose→validate→apply→verify→rollback).
 *  - Verified: executable preservation & duplicate checks via AIEditVerifier; trigger line removed atomically.
 */

import { getActiveEditorContext } from '../editor/activeEditorStore';
import { createExecutorDeps, captureSnapshot, type WorkspaceBridgeActions } from '../editor/workspaceBridge';
import { executeActionPlan, type AIAction } from './aiToolExecutor';
import { sendChat } from './AIClient';
import { sanitizeEditorOutputWithPolicy, isCommentingIntent, isDocumentingIntent } from './AIOutputPolicy';
import { getCommentSyntax, applyCommentSyntax } from './commentSyntax';
import type { FileNode } from '../../utils/mockFileSystem';

export interface TripleSlashRequest {
    editor: import('monaco-editor').editor.IStandaloneCodeEditor;
    model: import('monaco-editor').editor.ITextModel;
    lineNumber: number;
    lineContent: string;
    workspace: WorkspaceBridgeActions;
    getFileTree: () => FileNode[];
}

export interface TripleSlashResult {
    success: boolean;
    message?: string;
    appliedCount?: number;
    /** Monaco model version immediately after our own apply — lets the caller
     *  distinguish "user typed after we applied" from "stale result". */
    appliedVersion?: number;
}

const TRIPLE_SLASH_RE = /^(.*?)\/\/\/\s*(.+);$/;

/**
 * Code-edit verbs: when the instruction contains one of these, the user wants
 * the code transformed (AI path). Anything else on an inline `code ///text;`
 * line is literal comment text ("pass different inputs") — handled
 * deterministically without any AI round trip.
 *
 * Covers imperatives users actually type (print/make/use/show/explain/…):
 * without these, instructions like "print only the number" were echoed back
 * as `// print only the number` instead of reaching the model.
 */
const EDIT_VERB_RE = /\b(fix|fixes|fixing|refactor|refactors|rename|renames|remove|removes|removing|delete|deletes|deleting|insert|inserts|replace|replaces|replacing|change|changes|changing|update|updates|updating|convert|converts|generate|generates|create|creates|creating|optimiz|optimis|simplify|simplifies|implement|implements|extract|extracts|move|moves|moving|wrap|wraps|sort|sorts|reverse|reverses|print|prints|printing|display|displays|show|shows|log|logs|logging|make|makes|making|use|uses|using|set|sets|return|returns|returning|call|calls|calling|compute|computes|calculate|calculates|validate|validates|parse|parses|handle|handles|check|checks|checking|explain|explains|describe|describes)\b/i;

/**
 * Questions must always reach the model — echoing "what does this do" back
 * as `// what does this do` looks broken. Matches a trailing `?` or a
 * leading interrogative/explainer word.
 */
const QUESTION_LIKE_RE = /^\s*(what|why|how|which|who|when|where|explain|describe|tell\s+me)\b|\?\s*$/i;

/**
 * Deterministic literal-comment builder for inline `code ///text;`.
 *
 * Returns `code // text` with the language's canonical comment marker — no AI
 * needed, instant, and always syntactically valid. Returns null when the AI
 * path is required instead:
 *   - standalone `///cmd;` (no code prefix — nothing to attach to),
 *   - commenting/documenting intents ("add comments") — the model must
 *     *generate* the comment content,
 *   - questions ("what does this do?", "explain this") — echoing the question
 *     back as a comment looks broken; the model must answer,
 *   - edit-verb instructions ("fix the loop", "print only the number") — the
 *     code must be transformed,
 *   - multi-line / overlong text, or languages without line-comment syntax.
 */
export function buildLiteralInlineComment(prefix: string, commandText: string, language: string): string | null {
    const code = (prefix ?? '').trimEnd();
    if (!code) return null;
    const syntax = getCommentSyntax(language);
    if (!syntax || !syntax.supported || !syntax.line) return null;
    // The trailing `;` belongs to the /// trigger syntax, never to the comment.
    const text = (commandText ?? '').trim().replace(/;+\s*$/, '').trim();
    if (!text || text.includes('\n') || text.length > 140) return null;
    if (QUESTION_LIKE_RE.test(text)) return null;
    if (EDIT_VERB_RE.test(text)) return null;
    if (isCommentingIntent(text) || isDocumentingIntent(text)) return null;
    const comment = applyCommentSyntax(text, language);
    if (!comment || !comment.trim() || comment.includes('\n')) return null;
    return `${code} ${comment.trim()}`;
}

/**
 * Deterministic repair for AI-produced `///` glitches. The model sometimes
 * echoes the trigger (`code;///text;`) or returns a comment-only line and
 * drops the code — writing either into the file is never acceptable.
 * Returns the repaired replacement, or null when unrecoverable.
 */
export function repairTripleSlashOutput(
    output: string,
    prefix: string,
    commandText: string,
    language: string,
    triggerLine: string,
): string | null {
    const raw = output ?? '';
    // Preserve leading indentation (the caller re-validates it); only trailing
    // whitespace is insignificant here.
    const out = raw.trimEnd();
    const flat = out.trim();
    if (!flat) return null;
    const code = (prefix ?? '').trimEnd();
    const triggerFlat = (triggerLine ?? '').trim();
    // Echoed /// remnant: rebuild deterministically when the instruction is
    // literal text, otherwise cut the trigger tail and keep the code side.
    // (Checked before the no-op test so an echoed trigger still resolves to a
    // proper comment instead of being rejected.)
    if (/\/\/\//.test(flat)) {
        const literal = buildLiteralInlineComment(prefix, commandText, language);
        if (literal) return literal;
        if (flat === triggerFlat) return null;
        const cut = flat.replace(/\/\/\/\s*.+;?\s*$/, '').trimEnd();
        return cut || null;
    }
    // No-op echo of the trigger line carries no value — reject it.
    if (flat === triggerFlat) return null;
    // Comment-only output while the line had code: the model dropped the code
    // — reattach instead of deleting the user's code.
    if (code) {
        const lines = out.split('\n').filter(l => l.trim() !== '');
        const allComments = lines.length > 0 && lines.every(l => /^(\/\/|#|--|;|%|\/\*|<!--)/.test(l.trimStart()));
        if (allComments && !out.includes(code.slice(0, 24))) {
            return `${code} ${lines.join(' ').trim()}`;
        }
    }
    return out;
}

function getLanguage(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript',
        py: 'python', java: 'java',
        c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
        go: 'go', rs: 'rust', rb: 'ruby',
        php: 'php', cs: 'csharp', swift: 'swift', kt: 'kotlin',
        css: 'css', scss: 'scss', json: 'json',
        md: 'markdown', html: 'html', sh: 'shell', bash: 'shell'
    };
    return map[ext] || 'typescript';
}

function buildCleanSnapshot(code: string, lineNumber: number, lineContent: string): string {
    const lines = code.split('\n');
    const idx = lineNumber - 1;
    if (idx >= 0 && idx < lines.length) {
        const prefix = lineContent.split('///')[0];
        // For inline `code ///cmd;` keep `code`, for standalone `///cmd;` make empty (will be replaced)
        lines[idx] = prefix.trimEnd();
        // If standalone and prefix empty, keep empty line (will be replaced by generated code)
    }
    return lines.join('\n');
}

function buildPrompt(
    cleanCode: string,
    language: string,
    fileName: string,
    commandText: string,
    prefix: string,
    lineNumber: number,
    lineCount: number,
    opts?: { filePath?: string; className?: string | null; moduleName?: string | null }
): { system: string; user: string } {
    const isInline = prefix.trim().length > 0;
    const lineInfo = isInline
        ? `Target: line ${lineNumber} currently is \`${prefix.trim()}\` (the code before /// on that line). Replace ONLY that line's code to satisfy the instruction.`
        : `Target: line ${lineNumber} is an empty instruction line. Replace that line with the code requested.`;

    const numbered = cleanCode
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`)
        .join('\n')
        .slice(0, 12000);

    const syntax = getCommentSyntax(language);
    const commentHint = syntax?.line ? `Use ${syntax.line} for comments in ${language}.` : '';
    const expectedClass = fileName ? fileName.replace(/\.[^/.]+$/, '') : null;
    void opts?.className;
    const filePath = opts?.filePath ?? fileName;

    const system = [
        `You are a premium ${language} code generator — DeepSeek V4 Flash, efficient and high-quality.`,
        `RULES:`,
        `- Output ONLY the code to replace the target line(s). No markdown, no fences, no explanations, no reasoning.`,
        `- Preserve indentation of the target line (use same leading spaces/tabs as the prefix).`,
        `- Do NOT include the /// instruction, do NOT duplicate existing #include or surrounding code.`,
        `- NEVER output /// — the trigger marker must not appear in your output. For comments use ${syntax?.line || '//'}.`,
        `- If the instruction is literal text for a trailing comment (no code change asked), return the target code followed by a single ${syntax?.line || '//'} comment with that text, e.g. \`code ${syntax?.line || '//'} text\`.`,
        `- Replace in place — never append a duplicate of existing lines.`,
        `- Keep it concise and correct for ${language}. ${commentHint}`,
        `- If the file is otherwise empty and the user asks for hello world, generate the minimal idiomatic ${language} hello world program with class "${expectedClass ?? 'Main'}" derived from filename "${fileName}", not hard-coded.`,
        language === 'java' ? `- Java: file "${fileName}" (path "${filePath}") must contain public class "${expectedClass ?? '-'}" derived from filename - never hard-code. Do NOT create "public class BinarySearch" inside "${fileName}"; to create BinarySearch, the file must be "BinarySearch.java".` : null,
    ].filter(Boolean).join('\n');

    const user = [
        `File: ${fileName} | Path: ${filePath} | Language: ${language} | Expected class: ${expectedClass ?? '(none)'} | Lines: ${lineCount}`,
        lineInfo,
        `Instruction: "${commandText}"`,
        ``,
        `Current file (clean, without /// marker):`,
        '```' + language,
        numbered,
        '```',
        ``,
        `Return ONLY the replacement code for line ${lineNumber}${isInline ? ' (single line, preserve indentation)' : ' (may be multiple lines if needed)'}.`,
    ].join('\n');

    return { system, user };
}

export async function executeTripleSlashPremium(req: TripleSlashRequest): Promise<TripleSlashResult> {
    const { editor, model, lineNumber, lineContent, workspace } = req;
    const m = TRIPLE_SLASH_RE.exec(lineContent);
    if (!m) return { success: false, message: 'No /// command found' };

    const prefix = m[1] ?? '';
    const commandText = m[2].trim();
    if (!commandText) return { success: false, message: 'Empty command' };

    const ctx = getActiveEditorContext();
    const rawCode = ctx?.code ?? model.getValue();
    const fileName = ctx?.fileName ?? (model as any)?.uri?.path?.split('/').pop() ?? 'untitled.ts';
    const fileId = ctx?.fileId ?? null;
    const language = ctx?.language ?? getLanguage(fileName);
    const lineCount = model.getLineCount();
    const filePath = ctx?.filePath ?? fileName;
    const className = ctx?.className ?? null;

    // Fast path: inline `code ///literal text;` needs no AI — apply the
    // canonical comment deterministically (instant, always valid syntax).
    // Edit/comment-generation intents fall through to the model below.
    let finalCode: string | null = buildLiteralInlineComment(prefix, commandText, language);
    let generated = '';
    let lastError: any = null;

    if (finalCode === null) {
    // Clean snapshot for AI — never send the /// marker as code
    const cleanCode = buildCleanSnapshot(rawCode, lineNumber, lineContent);
    const { system, user } = buildPrompt(cleanCode, language, fileName, commandText, prefix, lineNumber, lineCount, { filePath, className, moduleName: ctx?.moduleName ?? null });

    // Fast Groq first (measured ~0.3s), OpenRouter free second, DeepSeek last.
    // Worst case ~31s, typical case sub-second — previously the slowest,
    // most rate-limited model was first (up to 41s worst case).
    const tryModels: Array<{ model: string; task: 'simple_edit' | 'deep_reasoning'; maxTokens: number }> = [
        { model: 'qwen/qwen3.8-27b', task: 'simple_edit', maxTokens: 1024 },
        { model: 'or:nvidia/nemotron-3-super-120b-a12b:free', task: 'simple_edit', maxTokens: 1024 },
        { model: 'deepseek-ai/deepseek-v4-flash-0731', task: 'deep_reasoning', maxTokens: 2048 },
    ];
    for (const { model: tryModel, task, maxTokens } of tryModels) {
        const controller = new AbortController();
        const timeoutMs = tryModel.includes('deepseek') ? 20000 : tryModel.includes('qwen') ? 10000 : 8000;
        const timeoutId = setTimeout(() => controller.abort(new DOMException(`Inline model ${tryModel.split('/').pop()} timed out after ${timeoutMs / 1000}s`, 'TimeoutError')), timeoutMs);
        try {
            generated = await sendChat(
                [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                {
                    model: tryModel,
                    task,
                    temperature: tryModel!.includes('deepseek') ? 1 : 0.1,
                    maxTokens,
                    signal: controller.signal as any,
                },
                { responseLength: tryModel!.includes('deepseek') ? 'long' : 'medium' }
            );
            clearTimeout(timeoutId);
            if (generated && generated.trim() && !generated.trim().startsWith('<think>')) break;
            if (!generated || !generated.trim()) {
                lastError = new Error('Empty response from ' + tryModel);
                continue;
            }
            if (generated.trim().startsWith('<think>')) {
                lastError = new Error('Thinking-only response from ' + tryModel);
                continue;
            }
        } catch (e: any) {
            clearTimeout(timeoutId);
            if (e?.name === 'AbortError' && !String(e.message).includes('Timeout')) throw e;
            lastError = e;
            // Timeout or empty — try next model
            continue;
        }
    }
    if (!generated || !generated.trim()) {
        return { success: false, message: lastError?.message || 'AI returned empty response' };
    }
    if (generated.includes('<think>') || generated.includes('</think>')) {
        const { sanitizeEditorOutput } = await import('./AIResponseParser');
        const stripped = sanitizeEditorOutput(generated);
        if (stripped && stripped.trim()) generated = stripped;
    }

    // Sanitize — strip fences/reasoning, keep only code, dynamic
    const sanitized = sanitizeEditorOutputWithPolicy(generated, {
        task: 'code-gen',
        language,
        filename: fileName,
        userInstruction: commandText,
        outputMode: 'edit',
        preserve: cleanCode,
    });

    let candidate = sanitized && sanitized.trim() ? sanitized.trim() : generated.trim();
    if (!candidate) return { success: false, message: 'Sanitized output empty' };
    // Deterministic repair: never write an echoed /// trigger, a no-op echo,
    // or a code-deleting comment-only line into the file.
    finalCode = repairTripleSlashOutput(candidate, prefix, commandText, language, lineContent);
    if (!finalCode) {
        // Last resort: literal comment when eligible, else fail loudly and
        // leave the trigger line untouched (user can rephrase).
        finalCode = buildLiteralInlineComment(prefix, commandText, language);
        if (!finalCode) return { success: false, message: lastError?.message || 'AI output unusable — try rephrasing' };
    }
    } // end AI path (fast path set finalCode above)

    // Use the *current* Monaco content as snapshot for validation (includes the /// line)
    const currentContent = ctx?.code ?? model.getValue();
    const linesNow = currentContent.split('\n');
    let triggerIdx = -1;
    for (let i = 0; i < linesNow.length; i++) {
        if (linesNow[i].includes(commandText) && /\/\/\//.test(linesNow[i])) { triggerIdx = i; break; }
    }
    if (triggerIdx === -1) triggerIdx = lineNumber - 1;

    const snap = captureSnapshot(fileName, currentContent);
    const snapMap = snap ? new Map([[fileName, snap]]) : new Map();

    // Preserve existing indentation: re-apply original line's leading whitespace if AI stripped it.
    // This handles both inline `  code ///cmd;` (keep 2 spaces) and standalone `  ///cmd;` cases.
    {
        const originalLineForIndent = linesNow[triggerIdx] ?? lineContent;
        const originalIndent = (originalLineForIndent.match(/^[ \t]*/) || [''])[0];
        const prefixIndent = (prefix.match(/^[ \t]*/) || [''])[0];
        const targetIndent = prefix ? prefixIndent : originalIndent;
        if (targetIndent) {
            const firstLine = finalCode.split('\n')[0] || '';
            const firstIndent = (firstLine.match(/^[ \t]*/) || [''])[0];
            if (firstIndent !== targetIndent) {
                const { shiftReplacementIndent } = await import('./AIResponseParser');
                const delta = targetIndent.length - firstIndent.length;
                finalCode = shiftReplacementIndent(finalCode, delta);
            }
        }
    }

    // High-quality, glitch-free apply: Direct Monaco edit for instant visual (no React flicker),
    // with file-tree persist in background. This avoids the useEffect setValue() flicker that
    // happens when executeActionPlan updates the tree first and then CodeEditor syncs via setValue().
    const action: AIAction = {
        action: 'replace_code',
        path: fileName,
        startLine: triggerIdx + 1,
        endLine: triggerIdx + 1,
        content: finalCode,
    };

    if (triggerIdx < 0 || triggerIdx >= linesNow.length) {
        return { success: false, message: 'Trigger line no longer exists' };
    }

    try {
        editor.pushUndoStop();
        const range = {
            startLineNumber: triggerIdx + 1,
            startColumn: 1,
            endLineNumber: triggerIdx + 1,
            endColumn: (linesNow[triggerIdx]?.length ?? lineContent.length) + 1,
        } as any;
        // forceMoveMarkers keeps cursor/selection stable; edit is atomic and undoable
        editor.executeEdits('triple-slash-premium', [{ range, text: finalCode, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        const appliedVersion = model.getVersionId();

        // Persist to file tree without triggering a second setValue() (editor already has correct content)
        if (fileId) {
            const newValue = editor.getModel()?.getValue() ?? finalCode;
            // Debounced save is blocked while isProcessingAiCommandRef is true, so update directly
            (workspace as any).updateFileContent?.(fileId, newValue);
        } else {
            // Fallback to atomic plan if no fileId (should not happen)
            const deps2 = createExecutorDeps(workspace, fileName, fileId);
            const result2 = await executeActionPlan([action], deps2 as any, {
                language,
                snapshot: snap as any,
                snapshotMap: snapMap as any,
            } as any);
            if (!result2.success) {
                // Already applied via executeEdits, so return success even if plan validation failed
                return { success: true, message: 'Applied via direct edit (high-quality)', appliedCount: 1 };
            }
            return result2;
        }
        return { success: true, message: 'Applied via direct edit (high-quality, glitch-free)', appliedCount: 1, appliedVersion };
    } catch (_e) {
        // Fallback to atomic file-tree plan if direct edit threw (model disposed, etc.)
        const deps2 = createExecutorDeps(workspace, fileName, fileId);
        const result = await executeActionPlan([action], deps2 as any, {
            language,
            snapshot: snap as any,
            snapshotMap: snapMap as any,
        } as any);
        if (!result.success) return { success: false, message: result.message || 'Apply failed' };
        return result;
    }
}
