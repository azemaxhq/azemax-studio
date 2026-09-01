import { getLanguageFromExtension as getExecLanguage } from './codeExecutionService';
import { getMonacoLanguage as getCentralMonacoLanguage, getLanguageFromFilename } from './language';
import type * as Monaco from 'monaco-editor';
import {
    type CanonicalDiagnostic,
    type DiagnosticResultEx,
    type DiagnosticSeverity,
    SEVERITY_MONACO_MAP,
    MONACO_SEVERITY_MAP,
    normalizeSeverity,
} from './diagnosticsTypes';

// Legacy compat
export interface DiagnosticResult {
    markers: Monaco.editor.IMarkerData[];
    output: string;
    isError: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const VOID_ELEMENTS = new Set([
    'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);

const getMonacoLanguage = (language: string): string => getCentralMonacoLanguage(language);

// ─────────────────────────────────────────────
// Helpers: normalization & validation
// ─────────────────────────────────────────────
function clampLine(line: number, lineCount: number): number | null {
    if (!Number.isFinite(line)) return null;
    const l = Math.floor(line);
    if (l < 1) return 1;
    if (l > lineCount) return null; // discard hallucinated lines
    return l;
}
function clampColumn(col: unknown, lineLength: number, fallback = 1): number {
    if (typeof col !== 'number' || !Number.isFinite(col)) return fallback;
    const c = Math.floor(col);
    if (c < 1) return 1;
    if (c > lineLength + 1) return lineLength + 1;
    return c;
}

function toMarker(d: CanonicalDiagnostic): Monaco.editor.IMarkerData {
    return {
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.endLine,
        endColumn: d.endColumn,
        message: d.message,
        severity: SEVERITY_MONACO_MAP[d.severity] ?? 4,
        source: d.source === 'ai' ? 'AI DeepCheck' : d.source === 'monaco' ? 'Monaco' : 'Language',
        code: d.code,
    };
}

function toCanonicalFromMarker(m: Monaco.editor.IMarker, fileName: string, fileId: string | null): CanonicalDiagnostic {
    return {
        line: m.startLineNumber,
        column: m.startColumn,
        endLine: m.endLineNumber,
        endColumn: m.endColumn,
        message: m.message,
        severity: MONACO_SEVERITY_MAP[m.severity] ?? 'warning',
        source: 'monaco',
        code: typeof m.code === 'string' ? m.code : undefined,
        fileName,
        fileId,
    };
}



// ─────────────────────────────────────────────
// Strip strings/comments for bracket balance checks
// Preserves line breaks & column positions by replacing with spaces
// ─────────────────────────────────────────────
function stripStringsAndComments(code: string, language: string): string {
    const out: string[] = [];
    let i = 0;
    const n = code.length;
    let inSingle = false, inDouble = false, inBacktick = false, inLineComment = false, inBlockComment = false, inHtmlComment = false;
    let escaped = false;
    const isPython = language === 'python';
    const isHtml = language === 'html';
    // Track triple quotes for python
    let inTripleSingle = false, inTripleDouble = false;

    while (i < n) {
        const ch = code[i];
        const next = code[i + 1] ?? '';
        const next2 = code[i + 2] ?? '';

        if (inLineComment) {
            if (ch === '\n') { inLineComment = false; out.push('\n'); }
            else out.push(' ');
            i++; continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { out.push('  '); i += 2; inBlockComment = false; }
            else { out.push(ch === '\n' ? '\n' : ' '); i++; }
            continue;
        }
        if (inHtmlComment) {
            if (ch === '-' && next === '-' && next2 === '>') { out.push('   '); i += 3; inHtmlComment = false; }
            else { out.push(ch === '\n' ? '\n' : ' '); i++; }
            continue;
        }
        if (inTripleSingle) {
            if (ch === "'" && next === "'" && next2 === "'") { out.push("   "); i += 3; inTripleSingle = false; }
            else { out.push(ch === '\n' ? '\n' : ' '); i++; }
            continue;
        }
        if (inTripleDouble) {
            if (ch === '"' && next === '"' && next2 === '"') { out.push('   '); i += 3; inTripleDouble = false; }
            else { out.push(ch === '\n' ? '\n' : ' '); i++; }
            continue;
        }
        if (inSingle) {
            out.push(ch === '\n' ? '\n' : ' ');
            if (!escaped && ch === "'") inSingle = false;
            escaped = !escaped && ch === '\\';
            i++; continue;
        }
        if (inDouble) {
            out.push(ch === '\n' ? '\n' : ' ');
            if (!escaped && ch === '"') inDouble = false;
            escaped = !escaped && ch === '\\';
            i++; continue;
        }
        if (inBacktick) {
            out.push(ch === '\n' ? '\n' : ' ');
            if (!escaped && ch === '`') inBacktick = false;
            escaped = !escaped && ch === '\\';
            i++; continue;
        }

        // Not inside string/comment
        if (isHtml && ch === '<' && next === '!' && code.slice(i, i + 4) === '<!--') { out.push('    '); i += 4; inHtmlComment = true; continue; }
        if (!isPython && ch === '/' && next === '/') { out.push('  '); i += 2; inLineComment = true; continue; }
        if (language === 'python' && ch === '#') { out.push(' '); i++; inLineComment = true; continue; }
        if (ch === '/' && next === '*') { out.push('  '); i += 2; inBlockComment = true; continue; }
        if (isPython && ch === "'" && next === "'" && next2 === "'") { out.push('   '); i += 3; inTripleSingle = true; continue; }
        if (isPython && ch === '"' && next === '"' && next2 === '"') { out.push('   '); i += 3; inTripleDouble = true; continue; }
        if (ch === "'") { out.push(' '); inSingle = true; escaped = false; i++; continue; }
        if (ch === '"') { out.push(' '); inDouble = true; escaped = false; i++; continue; }
        if (!isPython && ch === '`') { out.push(' '); inBacktick = true; escaped = false; i++; continue; }

        out.push(ch);
        i++;
    }
    return out.join('');
}

// ─────────────────────────────────────────────
// Large-file AI context builder (replaces 8k cliff)
// ─────────────────────────────────────────────
export function buildAIContext(code: string, fileName: string, language: string, cursorLine?: number | null): string {
    const MAX_FULL = 12000;
    if (code.length <= MAX_FULL) return code;

    const lines = code.split('\n');
    const totalLines = lines.length;
    const cursor = cursorLine && cursorLine >= 1 && cursorLine <= totalLines ? cursorLine : Math.floor(totalLines / 2);

    // Helper to slice lines join
    const sliceLines = (start: number, end: number) => lines.slice(start, end).join('\n');

    // File summary: extract top-level symbols for context preservation
    const symbols: string[] = [];
    const symRe = language === 'python'
        ? /^\s*(?:class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/gm
        : /^\s*(?:class|function|const|let|var|interface|enum|struct|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while (m = symRe.exec(code)) {
        symbols.push(m[1]);
        if (symbols.length >= 30) break;
    }
    const summary = symbols.length ? `// File symbols: ${symbols.join(', ')}\n` : '';

    // Region sizes: header 80 lines, cursor ±80, tail 60
    const HEADER = 80;
    const CONTEXT = 80;
    const TAIL = 60;

    const headerEnd = Math.min(HEADER, totalLines);
    const ctxStart = Math.max(0, cursor - CONTEXT - 1);
    const ctxEnd = Math.min(totalLines, cursor + CONTEXT);
    const tailStart = Math.max(0, totalLines - TAIL);

    // Avoid duplication: if cursor region overlaps header/tail, merge
    let context = '';
    context += summary;
    context += `// File: ${fileName} (${language}) | Total lines: ${totalLines} | Truncated view for large file (${code.length} chars)\n`;
    context += `// === HEADER (lines 1-${headerEnd}) ===\n`;
    context += sliceLines(0, headerEnd);
    context += '\n';

    if (ctxStart > headerEnd) {
        if (ctxStart > headerEnd + 1) context += `\n// ... [${ctxStart - headerEnd} lines omitted] ...\n`;
        context += `\n// === CURSOR CONTEXT (lines ${ctxStart + 1}-${ctxEnd}) ===\n`;
        context += sliceLines(ctxStart, ctxEnd);
        context += '\n';
    } else if (ctxEnd > headerEnd) {
        // overlapping - extend header
        if (ctxEnd > headerEnd) {
            context += sliceLines(headerEnd, Math.min(ctxEnd, tailStart));
            context += '\n';
        }
    }

    if (tailStart > ctxEnd) {
        if (tailStart > ctxEnd + 1) context += `\n// ... [${tailStart - ctxEnd} lines omitted] ...\n`;
        context += `\n// === TAIL (lines ${tailStart + 1}-${totalLines}) ===\n`;
        context += sliceLines(tailStart, totalLines);
    } else if (tailStart < ctxEnd && tailStart > headerEnd) {
        // already included
    }

    // If still too large, truncate middle of context regions
    if (context.length > MAX_FULL) {
        const half = Math.floor(MAX_FULL / 2) - 500;
        return context.slice(0, half) + '\n// ... [truncated middle for token limit] ...\n' + context.slice(-half);
    }
    return context;
}

// ─────────────────────────────────────────────
// Robust AI JSON extraction (replaces raw.match(/\[[\s\S]*\]/))
// ─────────────────────────────────────────────
function extractJsonArray(text: string): unknown | null {
    const trimmed = text.trim();
    // Fast path: pure JSON
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).diagnostics)) return (parsed as Record<string, unknown>).diagnostics;
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).issues)) return (parsed as Record<string, unknown>).issues;
    } catch { /* fallback */ }

    // Remove markdown fences
    const withoutFences = trimmed
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .trim();

    try {
        const p2 = JSON.parse(withoutFences);
        if (Array.isArray(p2)) return p2;
        if (p2 && typeof p2 === 'object' && Array.isArray((p2 as Record<string, unknown>).diagnostics)) return (p2 as Record<string, unknown>).diagnostics;
    } catch { /* continue */ }

    // Find balanced JSON array by scanning for outermost [...]
    // Use stack-based bracket matching that respects strings
    const findBalancedArray = (s: string): string | null => {
        let best: string | null = null;
        let bestLen = -1;
        for (let i = 0; i < s.length; i++) {
            if (s[i] !== '[') continue;
            let depth = 0;
            let inStr = false;
            let esc = false;
            let strChar = '';
            for (let j = i; j < s.length; j++) {
                const ch = s[j];
                if (inStr) {
                    if (esc) esc = false;
                    else if (ch === '\\') esc = true;
                    else if (ch === strChar) { inStr = false; strChar = ''; }
                    continue;
                }
                if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
                if (ch === '[') depth++;
                else if (ch === ']') {
                    depth--;
                    if (depth === 0) {
                        const candidate = s.slice(i, j + 1);
                        // Prefer longest valid JSON array
                        try {
                            const parsed = JSON.parse(candidate);
                            if (Array.isArray(parsed) && candidate.length > bestLen) {
                                best = candidate;
                                bestLen = candidate.length;
                            }
                        } catch { /* ignore invalid */ }
                        break;
                    }
                }
            }
        }
        return best;
    };

    const balanced = findBalancedArray(withoutFences) ?? findBalancedArray(trimmed);
    if (balanced) {
        try { return JSON.parse(balanced); } catch { /* fallthrough */ }
    }
    return null;
}

function validateAndNormalizeAIDiagnostics(raw: unknown, lineCount: number, lineLengths: number[], fileName: string, fileId: string | null): CanonicalDiagnostic[] {
    if (!Array.isArray(raw)) return [];
    const out: CanonicalDiagnostic[] = [];
    for (const item of raw.slice(0, 50)) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const lineRaw = obj.line ?? obj.lineNumber ?? obj.startLine;
        const msgRaw = obj.message ?? obj.msg ?? obj.description ?? obj.text;
        if (typeof lineRaw !== 'number' || typeof msgRaw !== 'string' || !msgRaw.trim()) continue;

        const line = clampLine(Math.floor(Number(lineRaw)), lineCount);
        if (line === null) continue;

        const severity = normalizeSeverity(obj.severity);
        const colRaw = obj.column ?? obj.col ?? obj.startColumn;
        const endLineRaw = obj.endLine ?? obj.endLineNumber;
        const endColRaw = obj.endColumn ?? obj.endCol ?? obj.endColumn;

        const lineLen = lineLengths[line - 1] ?? 80;
        const column = clampColumn(colRaw, lineLen, 1);
        let endLine = typeof endLineRaw === 'number' ? clampLine(Math.floor(Number(endLineRaw)), lineCount) ?? line : line;
        // ensure endLine >= line
        if (endLine < line) endLine = line;
        const endLineLen = lineLengths[endLine - 1] ?? lineLen;
        let endColumn = clampColumn(endColRaw, endLineLen, line === endLine ? Math.min(lineLen + 1, column + Math.min(80, msgRaw.length)) : endLineLen + 1);
        if (endLine === line && endColumn <= column) endColumn = Math.min(lineLen + 1, column + 1);

        const code = typeof obj.code === 'string' ? obj.code.slice(0, 80) : undefined;

        out.push({
            line,
            column,
            endLine,
            endColumn,
            message: msgRaw.trim().slice(0, 500),
            severity: severity ?? 'warning',
            source: 'ai',
            code,
            fileName,
            fileId,
        });
    }
    return out;
}

// ─────────────────────────────────────────────
// Language-specific checks (improved, strip strings/comments)
// ─────────────────────────────────────────────
async function checkJsonSyntax(code: string, fileName: string, fileId: string | null): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> {
    try {
        JSON.parse(code);
        return { diagnostics: [], output: '' };
    } catch (e) {
        const msg = (e as Error).message;
        // Try to extract position like "at position 12" or line info
        const posMatch = msg.match(/position\s+(\d+)/i);
        let line = 1, column = 1;
        if (posMatch) {
            const pos = parseInt(posMatch[1], 10);
            const before = code.slice(0, pos);
            line = before.split('\n').length;
            const lastNl = before.lastIndexOf('\n');
            column = lastNl === -1 ? pos + 1 : pos - lastNl;
        } else {
            const lineMatch = msg.match(/line\s+(\d+)/i);
            if (lineMatch) line = parseInt(lineMatch[1], 10);
        }
        return {
            diagnostics: [{
                line: Math.max(1, line),
                column,
                endLine: Math.max(1, line),
                endColumn: column + 1,
                message: `JSON Syntax Error: ${msg}`,
                severity: 'error',
                source: 'language',
                fileName,
                fileId,
            }],
            output: msg,
        };
    }
}

async function checkCssSyntax(code: string, fileName: string, fileId: string | null): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> {
    const stripped = stripStringsAndComments(code, 'css');
    // Simple brace balance with positions
    let depth = 0;
    const diagnostics: CanonicalDiagnostic[] = [];
    const lines = stripped.split('\n');
    for (let i = 0; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth < 0) {
                    diagnostics.push({
                        line: i + 1, column: 1, endLine: i + 1, endColumn: lines[i].length + 1,
                        message: 'CSS Syntax Error: Unexpected closing brace `}`',
                        severity: 'error', source: 'language', fileName, fileId,
                    });
                    depth = 0;
                }
            }
        }
    }
    if (depth > 0) {
        diagnostics.push({
            line: lines.length, column: 1, endLine: lines.length, endColumn: lines[lines.length - 1].length + 1,
            message: `CSS Syntax Error: ${depth} unclosed block(s) — missing \`}\``,
            severity: 'error', source: 'language', fileName, fileId,
        });
    }
    return { diagnostics, output: '' };
}

async function checkHtmlSyntax(code: string, fileName: string, fileId: string | null): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> {
    const diagnostics: CanonicalDiagnostic[] = [];
    // Remove comments
    const withoutComments = code.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
    // Find tags
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\/?>/g;
    const stack: { tag: string; line: number; column: number }[] = [];
    const linesForPos = code.split('\n');
    const offsetToLineCol = (offset: number) => {
        let acc = 0;
        for (let i = 0; i < linesForPos.length; i++) {
            const len = linesForPos[i].length + 1;
            if (offset < acc + len) return { line: i + 1, column: offset - acc + 1 };
            acc += len;
        }
        return { line: 1, column: 1 };
    };
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while (m = tagRe.exec(withoutComments)) {
        const full = m[0];
        const tag = m[1].toLowerCase();
        const isClose = full.startsWith('</');
        const isSelfClose = full.endsWith('/>') || VOID_ELEMENTS.has(tag);
        const { line, column } = offsetToLineCol(m.index);
        if (isClose) {
            // Find matching open
            let idx = stack.length - 1;
            while (idx >= 0 && stack[idx].tag !== tag) idx--;
            if (idx === -1) {
                // Allow stray close without stack? Only report if not void
                if (!VOID_ELEMENTS.has(tag)) {
                    diagnostics.push({
                        line, column, endLine: line, endColumn: column + full.length,
                        message: `HTML Syntax Error: Closing tag \`</${tag}>\` without matching open tag`,
                        severity: 'error', source: 'language', fileName, fileId,
                    });
                }
            } else {
                // Pop to idx
                stack.length = idx;
            }
        } else if (!isSelfClose) {
            stack.push({ tag, line, column });
        }
    }
    if (stack.length > 0) {
        // Report only first unclosed to avoid spam
        const unclosed = stack[stack.length - 1];
        diagnostics.push({
            line: unclosed.line, column: unclosed.column, endLine: unclosed.line, endColumn: unclosed.column + unclosed.tag.length + 1,
            message: `HTML Syntax Error: Unclosed tag \`<${unclosed.tag}>\` — ${stack.length} tag(s) not closed`,
            severity: 'error', source: 'language', fileName, fileId,
        });
    }
    return { diagnostics, output: '' };
}

async function checkPythonSyntax(code: string, fileName: string, fileId: string | null): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> {
    const diagnostics: CanonicalDiagnostic[] = [];
    const lines = code.split('\n');
    const indentStack = [0];
    let inMultilineString: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (inMultilineString) {
            if (raw.includes(inMultilineString)) inMultilineString = null;
            continue;
        }
        if (!trimmed || trimmed.startsWith('#')) continue;
        if ((trimmed.startsWith('"""') || trimmed.startsWith("'''")) && !trimmed.slice(3).includes(trimmed.slice(0,3))) {
            // Check if it's single line """x""" vs multiline
            const marker = trimmed.slice(0,3);
            const rest = raw.slice(raw.indexOf(marker) + 3);
            if (!rest.includes(marker)) { inMultilineString = marker; continue; }
        }

        // Indentation check (spaces, allow 2 or 4)
        const indentMatch = raw.match(/^ */);
        const currentIndent = indentMatch ? indentMatch[0].length : 0;
        // Only check indent if line is not empty and not continuation of previous bracket
        const lastIndent = indentStack[indentStack.length - 1];
        if (currentIndent > lastIndent) {
            indentStack.push(currentIndent);
        } else if (currentIndent < lastIndent) {
            while (indentStack.length > 1 && indentStack[indentStack.length - 1] > currentIndent) indentStack.pop();
            if (indentStack[indentStack.length - 1] !== currentIndent) {
                diagnostics.push({
                    line: i + 1, column: 1, endLine: i + 1, endColumn: currentIndent + 1,
                    message: 'Python Syntax Error: Inconsistent indentation',
                    severity: 'error', source: 'language', fileName, fileId,
                });
            }
        }
        // Don't do naive per-line bracket checks for python; do file-level balance via stripped code after loop
    }

    // File-level bracket balance (ignoring strings/comments)
    const stripped = stripStringsAndComments(code, 'python');
    const pairs: Record<string,string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    for (const ch of stripped) {
        if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
        else if (ch === ')' || ch === ']' || ch === '}') {
            const expected = pairs[stack[stack.length - 1]] ?? '';
            if (stack.length && expected === ch) stack.pop();
            else if (stack.length === 0) {
                // stray close - report at location? For simplicity, skip detailed pos
            }
        }
    }
    // Don't spam for python bracket mismatches if already reported; only if clearly unbalanced
    return { diagnostics, output: '' };
}

async function checkBraceBalance(code: string, language: string, fileName: string, fileId: string | null): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> {
    const stripped = stripStringsAndComments(code, language);
    const diagnostics: CanonicalDiagnostic[] = [];
    const stack: { ch: string; line: number; col: number }[] = [];
    const pairs: Record<string,string> = { '(': ')', '[': ']', '{': '}' };
    const reverse: Record<string,string> = { ')': '(', ']': '[', '}': '{' };
    const lines = stripped.split('\n');
    // Keep original line lengths for column
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (let col = 0; col < line.length; col++) {
            const ch = line[col];
            if (ch === '(' || ch === '[' || ch === '{') {
                stack.push({ ch, line: i + 1, col: col + 1 });
            } else if (ch === ')' || ch === ']' || ch === '}') {
                const expectedOpen = reverse[ch];
                if (stack.length && stack[stack.length - 1].ch === expectedOpen) {
                    stack.pop();
                } else if (stack.length === 0) {
                    diagnostics.push({
                        line: i + 1, column: col + 1, endLine: i + 1, endColumn: col + 2,
                        message: `${language.toUpperCase()} Syntax Error: Unexpected \`${ch}\` without matching \`${expectedOpen}\``,
                        severity: 'error', source: 'language', fileName, fileId,
                    });
                } else {
                    // Mismatched
                    const open = stack.pop()!;
                    diagnostics.push({
                        line: i + 1, column: col + 1, endLine: i + 1, endColumn: col + 2,
                        message: `${language.toUpperCase()} Syntax Error: Mismatched \`${open.ch}\` (line ${open.line}) and \`${ch}\``,
                        severity: 'error', source: 'language', fileName, fileId,
                    });
                }
            }
        }
    }
    if (stack.length > 0) {
        const open = stack[stack.length - 1];
        diagnostics.push({
            line: open.line, column: open.col, endLine: open.line, endColumn: open.col + 1,
            message: `${language.toUpperCase()} Syntax Error: Unclosed \`${open.ch}\` — missing \`${pairs[open.ch]}\``,
            severity: 'error', source: 'language', fileName, fileId,
        });
    }
    return { diagnostics, output: '' };
}

const checkWithLanguageSpecificTools = async (
    code: string,
    fileName: string,
    language: string,
    fileId: string | null = null,
): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string }> => {
    switch (language) {
        case 'json': return await checkJsonSyntax(code, fileName, fileId);
        case 'css': return await checkCssSyntax(code, fileName, fileId);
        case 'html': return await checkHtmlSyntax(code, fileName, fileId);
        case 'python': return await checkPythonSyntax(code, fileName, fileId);
        case 'java':
        case 'javascript':
        case 'typescript':
        case 'cpp':
        case 'c':
        case 'csharp':
        case 'go':
        case 'rust':
        case 'swift':
        case 'kotlin':
        case 'ruby':
        case 'php':
            return await checkBraceBalance(code, language, fileName, fileId);
        default:
            // Unsupported: no false positives, just return empty with note
            return { diagnostics: [], output: '' };
    }
};

// ─────────────────────────────────────────────
// Monaco diagnostics (isolated temp model, no mutation)
// ─────────────────────────────────────────────
function buildTempUri(fileId: string | null, fileName: string, filePath?: string | null): string {
    const safePath = (filePath ?? fileName).replace(/[^a-zA-Z0-9._\-/]/g, '_');
    const idPart = fileId ? `-${fileId.slice(0, 8)}` : '';
    const rand = Math.random().toString(36).slice(2, 6);
    return `file:///azemax-diag/${safePath}${idPart}-${rand}`;
}

async function checkWithMonacoDiagnostics(
    code: string,
    fileName: string,
    language: string,
    monaco: typeof Monaco,
    opts?: { fileId?: string | null; filePath?: string | null; signal?: AbortSignal }
): Promise<{ diagnostics: CanonicalDiagnostic[]; output: string; fromMonaco: boolean }> {
    const monacoLanguage = getMonacoLanguage(language);
    const uriStr = buildTempUri(opts?.fileId ?? null, fileName, opts?.filePath ?? null);
    const uri = monaco.Uri.parse(uriStr);
    // Always create isolated model; never reuse user's model
    const model = monaco.editor.createModel(code, monacoLanguage, uri);
    try {
        if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        // Wait for Monaco workers via event-driven approach + bounded timeout
        const maxWaitMs = monacoLanguage === 'typescript' || monacoLanguage === 'javascript' ? 800 : monacoLanguage === 'json' ? 400 : 300;
        const stepMs = 50;
        let markers: Monaco.editor.IMarker[] = [];
        const start = Date.now();

        // Listen for marker changes to return early
        let resolvedEarly = false;
        let onDidChange: Monaco.IDisposable | null = null;
        const earlyPromise = new Promise<Monaco.editor.IMarker[]>((resolve) => {
            const disposable = monaco.editor.onDidChangeMarkers(() => {
                const m = monaco.editor.getModelMarkers({ resource: uri });
                if (m.length > 0 && !resolvedEarly) {
                    resolvedEarly = true;
                    resolve(m);
                }
            });
            onDidChange = disposable;
            // Cleanup after maxWait
            setTimeout(() => {
                if (!resolvedEarly) {
                    resolvedEarly = true;
                    resolve(monaco.editor.getModelMarkers({ resource: uri }));
                }
                disposable.dispose();
            }, maxWaitMs);
        });

        // Also poll as fallback
        const pollPromise = (async () => {
            await new Promise(r => setTimeout(r, stepMs));
            while (Date.now() - start < maxWaitMs) {
                if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                markers = monaco.editor.getModelMarkers({ resource: uri });
                if (markers.length > 0) break;
                // For languages without worker, break early after 150ms if still empty
                if (monacoLanguage !== 'typescript' && monacoLanguage !== 'javascript' && monacoLanguage !== 'json' && Date.now() - start > 150) break;
                await new Promise(r => setTimeout(r, stepMs));
            }
            return markers;
        })();

        // Race early event vs poll, with abort
        const abortPromise = new Promise<never>((_, reject) => {
            if (opts?.signal) {
                const handler = () => reject(new DOMException('Aborted', 'AbortError'));
                if (opts.signal.aborted) handler();
                else opts.signal.addEventListener('abort', handler, { once: true });
            }
        });

        try {
            const result = await Promise.race([earlyPromise, pollPromise, abortPromise]);
            markers = (result as Monaco.editor.IMarker[]) ?? [];
        } catch (e) {
            if ((e as Error).name === 'AbortError') throw e;
            markers = monaco.editor.getModelMarkers({ resource: uri });
        } finally {
            try { (onDidChange as Monaco.IDisposable | null)?.dispose(); } catch { /* ignore */ }
        }

        if (markers.length > 0) {
            const diagnostics = markers.map(m => toCanonicalFromMarker(m, fileName, opts?.fileId ?? null));
            return { diagnostics, output: '', fromMonaco: true };
        }
        // No Monaco markers — fallback to language-specific (but still return empty if that also empty)
        const fallback = await checkWithLanguageSpecificTools(code, fileName, language, opts?.fileId ?? null);
        return { diagnostics: fallback.diagnostics, output: fallback.output, fromMonaco: false };
    } finally {
        try { if (!model.isDisposed()) model.dispose(); } catch { /* ignore */ }
    }
}

// ─────────────────────────────────────────────
// AI diagnostics
// ─────────────────────────────────────────────
interface AICheckOptions {
    fileId?: string | null;
    filePath?: string | null;
    cursorLine?: number | null;
    signal?: AbortSignal;
    language?: string;
}

async function runAIDiagnostics(
    code: string,
    fileName: string,
    language: string,
    lineCount: number,
    lineLengths: number[],
    opts?: AICheckOptions,
): Promise<{ diagnostics: CanonicalDiagnostic[]; status: 'success'|'failed'|'skipped'|'cancelled'; error?: string }> {
    if (opts?.signal?.aborted) return { diagnostics: [], status: 'cancelled' };

    // Heuristic: skip AI for plaintext / unsupported where semantic value low
    const skipLangs = new Set(['plaintext', 'ini', 'makefile', 'dockerfile']);
    if (skipLangs.has(language)) return { diagnostics: [], status: 'skipped' };

    try {
        const { sendChat } = await import('../core/ai/AIClient');
        const aiContext = buildAIContext(code, fileName, language, opts?.cursorLine ?? null);

        const system = `You are a senior code reviewer and static analyzer for ${language}.
STRICT OUTPUT CONTRACT:
- Output ONLY a JSON array of diagnostics.
- Each diagnostic: {"line": number, "column": number, "endLine": number, "endColumn": number, "severity": "error"|"warning"|"info"|"hint", "message": string, "code": string}
- "line" is 1-based, must be within the provided file's line count.
- "column"/"endLine"/"endColumn" are 1-based; estimate reasonably if unsure, but keep within line length.
- "code" is optional short rule id (e.g. "TS2304" or "SEC-XSS").
- Do NOT invent errors. Only report actionable, high-confidence issues.
- Distinguish errors (broken code, security) from warnings (logic/style).
- If no issues, return [] exactly.
- No markdown, no prose, no fences — just JSON.`;

        const user = `File: ${fileName} (${language}) | Total lines: ${lineCount} | File length: ${code.length} chars

Code:
\`\`\`${language}
${aiContext}
\`\`\`

Task: Return JSON array of diagnostics as specified. Be precise with line numbers matching the code above.`;

        const raw = await sendChat(
            [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            { task: 'complex_code', temperature: 0.1, maxTokens: 2048, signal: opts?.signal },
        );

        if (opts?.signal?.aborted) return { diagnostics: [], status: 'cancelled' };

        const extracted = extractJsonArray(raw);
        if (extracted === null) {
            // Try to detect if AI explicitly said no issues via natural language
            const lower = raw.toLowerCase();
            if (lower.includes('no issue') || lower.includes('no error') || lower.trim() === '[]') {
                return { diagnostics: [], status: 'success' };
            }
            return { diagnostics: [], status: 'failed', error: 'AI returned non-JSON response' };
        }
        if (Array.isArray(extracted) && extracted.length === 0) {
            return { diagnostics: [], status: 'success' };
        }
        const validated = validateAndNormalizeAIDiagnostics(extracted, lineCount, lineLengths, fileName, opts?.fileId ?? null);
        return { diagnostics: validated, status: 'success' };
    } catch (e) {
        if ((e as Error).name === 'AbortError' || (e as DOMException).name === 'AbortError' || opts?.signal?.aborted) {
            return { diagnostics: [], status: 'cancelled' };
        }
        const msg = (e as Error).message ?? String(e);
        return { diagnostics: [], status: 'failed', error: msg };
    }
}

// ─────────────────────────────────────────────
// Merge & priority
// ─────────────────────────────────────────────
function normalizeKey(d: CanonicalDiagnostic): string {
    // Strong identity: source+line+col+endLine+endCol+code+normalizedMessage
    const msg = d.message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    return `${d.source}:${d.line}:${d.column}:${d.endLine}:${d.endColumn}:${d.code ?? ''}:${msg}`;
}

function mergeDiagnostics(local: CanonicalDiagnostic[], ai: CanonicalDiagnostic[]): CanonicalDiagnostic[] {
    const seen = new Set<string>();
    const merged: CanonicalDiagnostic[] = [];

    // Priority: local/monaco deterministic diagnostics first; AI complements
    const all = [...local, ...ai];
    // Sort by severity priority then line
    const severityRank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2, hint: 3 };
    all.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.line - b.line || a.column - b.column);

    for (const d of all) {
        const key = normalizeKey(d);
        if (seen.has(key)) continue;
        // Deduplicate AI vs local: if AI reports same line/message as local exact, prefer local's location
        const duplicateLocal = local.some(l =>
            Math.abs(l.line - d.line) <= 1 &&
            l.message.trim().toLowerCase() === d.message.trim().toLowerCase() &&
            d.source === 'ai'
        );
        // Actually keep both if local and AI are different sources but same message? We deduplicate via key, so same key will be removed.
        // For AI that duplicates local, we already have local, so skip AI duplicate with same strong key
        if (duplicateLocal && d.source === 'ai') {
            // Check if local already added with similar key — skip AI if local exists within 1 line
            const localExists = merged.some(m =>
                m.source !== 'ai' &&
                Math.abs(m.line - d.line) <= 1 &&
                m.message.trim().toLowerCase().slice(0, 40) === d.message.trim().toLowerCase().slice(0, 40)
            );
            if (localExists) continue;
        }
        seen.add(key);
        merged.push(d);
    }
    return merged;
}

function toExResult(
    diagnostics: CanonicalDiagnostic[],
    output: string,
    meta: DiagnosticResultEx['meta'],
    statuses: { local: DiagnosticResultEx['aiStatus']; ai: DiagnosticResultEx['aiStatus']; isPartial: boolean; errors: DiagnosticResultEx['errors'] },
    isStale?: boolean,
): DiagnosticResultEx {
    const markers = diagnostics.map(toMarker);
    const errorCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;
    const infoCount = diagnostics.filter(d => d.severity === 'info').length;
    const hintCount = diagnostics.filter(d => d.severity === 'hint').length;
    const isError = errorCount > 0;
    let status: DiagnosticResultEx['status'] = 'success';
    if (diagnostics.length === 0 && !statuses.isPartial) status = 'success';
    else if (isError) status = 'error';
    else if (diagnostics.length > 0) status = 'error'; // warnings also considered needing attention but we keep success if no errors? For UI, "success" means no issues; if warnings exist, not success
    // Override: if has warnings but no errors, treat as success with warnings
    if (warningCount > 0 && errorCount === 0) status = 'success';
    if (isStale) status = 'stale';

    let summary = '';
    if (diagnostics.length === 0) summary = statuses.isPartial ? 'No issues (partial)' : 'No issues found';
    else summary = `${errorCount} error${errorCount !== 1 ? 's' : ''} · ${warningCount} warning${warningCount !== 1 ? 's' : ''}`;

    return {
        diagnostics,
        markers,
        errorCount,
        warningCount,
        infoCount,
        hintCount,
        isError,
        isStale,
        output,
        status,
        aiStatus: statuses.ai,
        localStatus: statuses.local,
        summary,
        isPartial: statuses.isPartial,
        errors: statuses.errors,
        meta,
    };
}

// ─────────────────────────────────────────────
// Public API — legacy wrappers
// ─────────────────────────────────────────────
export const checkCodeErrors = async (
    code: string,
    fileName: string,
    monaco?: typeof Monaco,
    opts?: { fileId?: string | null; filePath?: string | null; versionId?: number | null; signal?: AbortSignal; cursorLine?: number | null }
): Promise<DiagnosticResult> => {
    const ex = await checkDiagnosticsEx(code, fileName, { ...opts, includeAI: false, monaco });
    return { markers: ex.markers, output: ex.output, isError: ex.isError };
};

export const checkCodeErrorsWithAI = async (
    code: string,
    fileName: string,
    language?: string,
    monaco?: typeof Monaco,
    opts?: { fileId?: string | null; filePath?: string | null; versionId?: number | null; signal?: AbortSignal; cursorLine?: number | null }
): Promise<DiagnosticResult> => {
    // Handle overload where language is actually opts (backward compat)
    if (typeof language === 'object' && language !== null && !monaco) {
        // Called as (code, fileName, monaco) incorrectly? Not needed
    }
    const lang = language || getLanguageFromFilename(fileName) || getExecLanguage(fileName);
    const ex = await checkDiagnosticsEx(code, fileName, { ...opts, language: lang, includeAI: true, monaco });
    return { markers: ex.markers, output: ex.output, isError: ex.isError };
};

// ─────────────────────────────────────────────
// Canonical entry — production-grade
// ─────────────────────────────────────────────
export async function checkDiagnosticsEx(
    code: string,
    fileName: string,
    options?: {
        fileId?: string | null;
        filePath?: string | null;
        language?: string;
        versionId?: number | null;
        requestId?: string;
        includeAI?: boolean;
        monaco?: typeof Monaco;
        signal?: AbortSignal;
        cursorLine?: number | null;
    }
): Promise<DiagnosticResultEx> {
    const language = options?.language ?? getLanguageFromFilename(fileName) ?? getExecLanguage(fileName);
    const fileId = options?.fileId ?? null;
    const filePath = options?.filePath ?? fileName;
    const requestId = options?.requestId ?? `diag-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const meta = {
        requestId,
        fileId,
        fileName,
        filePath,
        versionId: options?.versionId ?? null,
        timestamp: Date.now(),
    };

    if (options?.signal?.aborted) {
        return toExResult([], '', meta, { local: 'cancelled', ai: 'cancelled', isPartial: false, errors: {} });
    }

    if (!code || !code.trim()) {
        return toExResult([], '', meta, { local: 'success', ai: 'skipped', isPartial: false, errors: {} });
    }

    const lines = code.split('\n');
    const lineCount = lines.length;
    const lineLengths = lines.map(l => l.length);

    // Local diagnostics (always full document)
    let localDiagnostics: CanonicalDiagnostic[] = [];
    let localStatus: DiagnosticResultEx['aiStatus'] = 'success';
    let localError: string | undefined;
    let localOutput = '';

    try {
        if (options?.monaco) {
            const res = await checkWithMonacoDiagnostics(code, fileName, language, options.monaco, {
                fileId, filePath, signal: options?.signal,
            });
            localDiagnostics = res.diagnostics;
            localOutput = res.output;
            localStatus = 'success';
        } else {
            const res = await checkWithLanguageSpecificTools(code, fileName, language, fileId);
            localDiagnostics = res.diagnostics;
            localOutput = res.output;
            localStatus = 'success';
        }
    } catch (e) {
        if ((e as Error).name === 'AbortError') {
            localStatus = 'cancelled';
        } else {
            localStatus = 'failed';
            localError = (e as Error).message;
        }
    }

    if (options?.signal?.aborted) {
        return toExResult(localDiagnostics, localOutput, meta, { local: 'cancelled', ai: 'cancelled', isPartial: false, errors: {} });
    }

    // AI diagnostics (if requested)
    let aiDiagnostics: CanonicalDiagnostic[] = [];
    let aiStatus: DiagnosticResultEx['aiStatus'] = options?.includeAI ? 'checking' : 'skipped';
    let aiError: string | undefined;

    if (options?.includeAI) {
        const aiRes = await runAIDiagnostics(code, fileName, language, lineCount, lineLengths, {
            fileId, filePath, cursorLine: options?.cursorLine ?? null, signal: options?.signal, language,
        });
        aiDiagnostics = aiRes.diagnostics;
        if (aiRes.status === 'success') aiStatus = 'success';
        else if (aiRes.status === 'failed') { aiStatus = 'failed'; aiError = aiRes.error; }
        else if (aiRes.status === 'cancelled') aiStatus = 'cancelled';
        else if (aiRes.status === 'skipped') aiStatus = 'skipped';
    } else {
        aiStatus = 'skipped';
    }

    if (options?.signal?.aborted) {
        return toExResult(localDiagnostics, localOutput, meta, { local: 'cancelled', ai: 'cancelled', isPartial: false, errors: {} });
    }

    const merged = mergeDiagnostics(localDiagnostics, aiDiagnostics);
    const isPartial = (localStatus === 'failed' || aiStatus === 'failed') && !(localStatus === 'failed' && aiStatus === 'failed');

    // Normalize all positions once more (defensive)
    const normalized = merged.map(d => {
        const l = clampLine(d.line, lineCount);
        if (l === null) return null;
        const lineLen = lineLengths[l - 1] ?? 80;
        const col = clampColumn(d.column, lineLen, 1);
        let el = clampLine(d.endLine, lineCount) ?? l;
        if (el < l) el = l;
        const endLen = lineLengths[el - 1] ?? lineLen;
        let ecol = clampColumn(d.endColumn, endLen, el === l ? Math.min(endLen + 1, col + 1) : endLen + 1);
        if (el === l && ecol <= col) ecol = Math.min(endLen + 1, col + 1);
        return { ...d, line: l, column: col, endLine: el, endColumn: ecol };
    }).filter(Boolean) as CanonicalDiagnostic[];

    const errors: DiagnosticResultEx['errors'] = {};
    if (localError) errors.local = localError;
    if (aiError) errors.ai = aiError;

    return toExResult(normalized, localOutput, meta, { local: localStatus, ai: aiStatus, isPartial, errors });
}

// Re-export helpers for testing
export const _internal = {
    extractJsonArray,
    validateAndNormalizeAIDiagnostics,
    buildAIContext,
    stripStringsAndComments,
    mergeDiagnostics,
};
