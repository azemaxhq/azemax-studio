/**
 * Code suggestion service for inline completions using OpenRouter AI
 */

import { modifyCode } from './groqService';
import { parseStructuredEdits } from '../core/ai/AIResponseParser';
import {
    aiAbortManager,
    NO_AUTO_COMMENTS_INSTRUCTION,
    sanitizeEditorOutputWithPolicy,
    isCommentingIntent,
    shiftReplacementIndent,
    AIError,
    aiErrorToUserMessage,
} from '../core/ai';

export interface SuggestionContext {
    code: string;           // Full code in the file
    cursorPosition: number; // Cursor position in the code
    language: string;       // Programming language
    fileName: string;       // Current file name
    documentVersion?: number; // Editor document version at request time
    isStale?: () => boolean;  // Optional live staleness check (editor moved on)
}

export interface SuggestionResult {
    text: string;
    replaceLength?: number;
    isModify?: boolean;
    startOffset?: number;
    error?: string;
    /** Structured edits if available for multi-line transformations */
    structuredEdits?: { startLine: number; endLine: number; replacement: string }[];
}

// Separate keys so /// commands and inline completions don't cancel each other.
const INLINE_SUGGESTION_KEY = 'inline-suggestion';
const COMMENT_SUGGESTION_KEY = 'comment-suggestion';
// Keep backward-compatible single-key cancel for callers that don't know which type is pending
const SUGGESTION_KEY = INLINE_SUGGESTION_KEY;

/**
 * Cancel any pending AI request (both inline and /// comment flows)
 */
export const cancelPendingRequest = (): void => {
    aiAbortManager.abort(INLINE_SUGGESTION_KEY, 'superseded');
    aiAbortManager.abort(COMMENT_SUGGESTION_KEY, 'superseded');
    aiAbortManager.abort(SUGGESTION_KEY, 'superseded');
};

/**
 * Check if a request is currently in progress
 */
export const isRequestInProgress = (): boolean => {
    return aiAbortManager.has(INLINE_SUGGESTION_KEY) || aiAbortManager.has(COMMENT_SUGGESTION_KEY);
};

/**
 * Main function to get AI code suggestion based on /// commands
 */
export const getCodeSuggestion = async (context: SuggestionContext): Promise<SuggestionResult | null> => {
    // Cancel only the previous /// request — inline completions run on a separate key
    aiAbortManager.abort(COMMENT_SUGGESTION_KEY, 'superseded');

    // Track the new request via the runtime abort manager. The controller is
    // kept so the /// request itself is abortable (it is what makes a stale
    // auto-replace vanish mid-flight when the user keeps typing).
    const controller = aiAbortManager.get(COMMENT_SUGGESTION_KEY);

    // Get text before cursor
    const textBeforeCursor = context.code.substring(
        Math.max(0, context.cursorPosition - 500),
        context.cursorPosition
    );

    const lines = textBeforeCursor.split('\n');
    const currentLine = lines[lines.length - 1];

    // Pattern: Current line has `/// command;`
    // Modified to support inline comments: [code prefix] /// [command];
    const sameLineMatch = currentLine.match(/^(.*?)\/\/\/\s*(.+);$/);

    if (!sameLineMatch) {
        aiAbortManager.release(COMMENT_SUGGESTION_KEY);
        return null;
    }

    const prefix = sameLineMatch[1] || '';
    const commandText = sameLineMatch[2].trim();

    // Extract actual indentation from the line start (leading whitespace)
    const indentationMatch = prefix.match(/^(\s*)/);
    const indentation = indentationMatch ? indentationMatch[1] : '';

    // Calculate replace offset. 
    // We want to replace the WHOLE line (prefix + command) with the AI result.
    // Replace start is the beginning of the line.
    const lineStartInPrefix = textBeforeCursor.lastIndexOf('\n') + 1;
    const prefixStartOffset = Math.max(0, context.cursorPosition - 500);
    const replaceStartOffset = prefixStartOffset + lineStartInPrefix;

    // Get context code for better suggestions
    const contextCode = context.code.substring(
        Math.max(0, context.cursorPosition - 1000),
        context.cursorPosition
    );

    try {
        // Use modifyCode instead of generateCode for inline instructions — pass fileName for Java class preservation
        const generatedCode = await modifyCode(
            contextCode,
            commandText,
            context.language,
            controller.signal,
            context.fileName
        );

        if (!generatedCode) {
            console.error('[AI] Empty response from API');
            aiAbortManager.release(COMMENT_SUGGESTION_KEY);
            return { text: '', error: 'Empty response - try rephrasing' };
        }

        // Reject stale edits: user kept typing / moved the cursor while the
        // request was in flight — never apply a response to text it no longer
        // describes.
        if (context.isStale?.()) {
            aiAbortManager.release(COMMENT_SUGGESTION_KEY);
            return { text: '', error: 'Cancelled' };
        }

        // Sanitize FIRST so reasoning/meta-commentary never reaches the editor.
        const finalCode = sanitizeEditorOutputWithPolicy(generatedCode, {
            task: 'comment',
            language: context.language,
            filename: context.fileName,
            userInstruction: commandText,
            outputMode: isCommentingIntent(commandText) ? 'comment' : 'edit',
            preserve: contextCode,
        });

        // Apply indentation relative to the target line. We only align the
        // FIRST content line to the line's base indentation; the rest of the
        // replacement keeps its internal relative indentation (multiline
        // replacements must not get the base indent prepended to every line).
        // String-aware: lines inside multiline strings are never re-indented.
        const indented = indentation
            ? (() => {
                const firstContentIndex = finalCode.split('\n').findIndex(l => l.trim() !== '');
                if (firstContentIndex === -1) return finalCode;
                const firstIndent = finalCode.split('\n')[firstContentIndex].match(/^[ \t]*/)?.[0] ?? '';
                return shiftReplacementIndent(finalCode, indentation.length - firstIndent.length);
            })()
            : finalCode;

        // Try to parse structured edits from the generated code for multi-line support
        let structuredEdits: { startLine: number; endLine: number; replacement: string }[] | undefined;
        try {
            const edits = parseStructuredEdits(generatedCode);
            if (edits && edits.edits.length > 0) {
                structuredEdits = edits.edits;
            }
        } catch {
            // Ignore parse errors, fall back to text replacement
        }

        const replaceLength = context.cursorPosition - replaceStartOffset;

        aiAbortManager.release(COMMENT_SUGGESTION_KEY);
        return {
            text: indented,
            replaceLength,
            isModify: true,
            startOffset: replaceStartOffset,
            structuredEdits
        };

        } catch (error) {
        console.error('[AI] Error:', error);
        aiAbortManager.release(COMMENT_SUGGESTION_KEY);

        if (error instanceof AIError) {
            // Typed provider failure: surface a user-safe message. The editor
            // write path MUST NOT receive the raw developer message or the
            // error string as generated code.
            return { text: '', error: aiErrorToUserMessage(error) };
        }

        if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('abort'))) {
            return { text: '', error: 'Cancelled' };
        }

        return { text: '', error: 'AI request failed' };
    }
};

// ============================================================================
// Language-aware bracket balancing
// ============================================================================

/**
 * Bracket pairs to balance for each language category.
 * - Brace-based languages (Java, C, C++, JS, TS, Go, Rust, etc.): { } [ ] ( )
 * - Python: only ( ) [ ] { } (for dicts/lists/sets, not block scoping)
 * - Languages without braces (e.g., Ruby uses end): skip { }
 */
const getBracketPairs = (language: string): [string, string][] => {
    switch (language) {
        case 'python':
            // Python uses indentation for blocks but still has brackets for data structures
            return [['(', ')'], ['[', ']'], ['{', '}']];
        case 'ruby':
            // Ruby uses do/end for blocks; still balance parens and brackets
            return [['(', ')'], ['[', ']'], ['{', '}']];
        case 'java':
        case 'c':
        case 'cpp':
        case 'go':
        case 'rust':
        case 'swift':
        case 'kotlin':
        case 'typescript':
        case 'javascript':
        case 'php':
        case 'css':
        case 'scss':
            return [['(', ')'], ['[', ']'], ['{', '}']];
        default:
            return [['(', ')'], ['[', ']'], ['{', '}']];
    }
};

/**
 * Count unmatched opening brackets in a code string, ignoring brackets
 * inside string literals and comments.
 */
const balanceBrackets = (
    existingCode: string,
    suggestion: string,
    language: string
): string => {
    const pairs = getBracketPairs(language);
    const combined = existingCode + suggestion;

    // Track counts for each bracket type
    const counts = new Map<string, number>();
    for (const [open] of pairs) {
        counts.set(open, 0);
    }

    // Build open→close map
    const openToClose = new Map<string, string>();
    const openSet = new Set<string>();
    const closeToOpen = new Map<string, string>();
    for (const [open, close] of pairs) {
        openToClose.set(open, close);
        openSet.add(open);
        closeToOpen.set(close, open);
    }

    // Simple state machine to skip strings and comments
    let inString: string | null = null;   // tracks quote char: ' " `
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < combined.length; i++) {
        const ch = combined[i];
        const next = combined[i + 1];

        // Handle line comments
        if (!inString && !inBlockComment && ch === '/' && next === '/') {
            inLineComment = true;
            i++; // skip next
            continue;
        }
        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }

        // Handle block comments
        if (!inString && !inLineComment && ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        // Handle Python # comments
        if (!inString && language === 'python' && ch === '#') {
            inLineComment = true;
            continue;
        }

        // Handle strings (including triple-quoted strings for Python)
        if (!inString) {
            // Check for triple-quoted strings: """ or '''
            if ((ch === '"' || ch === '\'') && combined[i + 1] === ch && combined[i + 2] === ch) {
                inString = ch + ch + ch; // e.g. '"""' or "'''"
                i += 2; // skip the next two quotes
                continue;
            }
            // Single/double quotes and backticks
            if (ch === '"' || ch === '\'' || ch === '`') {
                inString = ch;
                continue;
            }
        }
        if (inString) {
            // Check for closing triple-quote
            if (inString.length === 3 && ch === inString[0] && combined[i + 1] === inString[0] && combined[i + 2] === inString[0]) {
                inString = null;
                i += 2;
                continue;
            }
            // Check for closing single quote
            if (inString.length === 1) {
                if (ch === '\\') { i++; continue; } // skip escaped char
                if (ch === inString) inString = null;
            }
            continue;
        }

        // Count brackets
        if (openSet.has(ch)) {
            counts.set(ch, (counts.get(ch) || 0) + 1);
        } else if (closeToOpen.has(ch)) {
            const open = closeToOpen.get(ch)!;
            const current = counts.get(open) || 0;
            counts.set(open, Math.max(0, current - 1));
        }
    }

    // Append missing closing brackets to the suggestion
    // Process in reverse order of typical nesting: { before [ before (
    let result = suggestion;
    const closingOrder: [string, string][] = [...pairs].reverse();

    for (const [open, close] of closingOrder) {
        const unmatched = counts.get(open) || 0;
        if (unmatched > 0) {
            // Determine indentation for closing brackets
            const lines = (existingCode + result).split('\n');
            const lastLine = lines[lines.length - 1];
            const lastLineIndent = lastLine.match(/^(\s*)/)?.[1] || '';

            for (let j = 0; j < unmatched; j++) {
                // For braces, put on new line with proper indentation
                if (close === '}') {
                    // Reduce indentation by one level (estimate from existing code)
                    const indentUnit = existingCode.includes('\t') ? '\t' : '    ';
                    const baseIndent = lastLineIndent.length > indentUnit.length
                        ? lastLineIndent.substring(0, lastLineIndent.length - indentUnit.length)
                        : '';
                    result += `\n${baseIndent}${close}`;
                } else {
                    // For ) and ], append inline
                    result += close;
                }
            }
        }
    }

    return result;
};

/**
 * General-purpose inline code completion for regular typing.
 * This provides Copilot-like suggestions based on the code context,
 * file name, and language conventions.
 */
export const getInlineCompletion = async (context: SuggestionContext): Promise<SuggestionResult | null> => {
    // Cancel any pending request and register the new one via the runtime manager.
    aiAbortManager.abort(INLINE_SUGGESTION_KEY, 'superseded');
    const controller = aiAbortManager.get(INLINE_SUGGESTION_KEY);

    const textBeforeCursor = context.code.substring(
        Math.max(0, context.cursorPosition - 1000),
        context.cursorPosition
    );

    const textAfterCursor = context.code.substring(
        context.cursorPosition,
        Math.min(context.code.length, context.cursorPosition + 300)
    );

    const lastLine = textBeforeCursor.split('\n').pop() || '';
    const totalCode = context.code.trim();
    const isEmptyOrNewFile = totalCode.length < 3;
    const fileBaseName = context.fileName.replace(/\.[^/.]+$/, ''); // e.g. "HelloWorld" from "HelloWorld.java"

    // Don't suggest if cursor is inside a regular comment (not ///)
    if (!isEmptyOrNewFile && lastLine.trim().startsWith('//') && !lastLine.includes('///')) {
        aiAbortManager.release(INLINE_SUGGESTION_KEY);
        return null;
    }

    // Build a language-specific hint — class must match filename, derived dynamically, never hard-coded
    let fileConventionHint = '';
    switch (context.language) {
        case 'java':
            fileConventionHint = `The file is named "${context.fileName}" — in Java, the public class MUST exactly match the filename without extension, derived dynamically as "${fileBaseName}" (not hard-coded). File "${context.fileName}" must contain "public class ${fileBaseName}". Do NOT generate "public class BinarySearch" inside "${context.fileName}" — for BinarySearch, file must be "BinarySearch.java".`;
            break;
        case 'python':
            fileConventionHint = `The file is named "${context.fileName}". Follow Python naming conventions (snake_case for functions, PascalCase for classes).`;
            break;
        case 'typescript':
        case 'javascript':
            fileConventionHint = `The file is named "${context.fileName}". Follow standard JS/TS conventions for the file type (component if .tsx/.jsx, module if .ts/.js).`;
            break;
        case 'c':
        case 'cpp':
            fileConventionHint = `The file is named "${context.fileName}". Follow standard C/C++ conventions with proper includes and main function.`;
            break;
        case 'csharp':
            fileConventionHint = `The file is named "${context.fileName}". Follow standard C# conventions. The main entry point should typically be 'public static void Main(string[] args)' inside a 'class Program'.`;
            break;
        default:
            fileConventionHint = `The file is named "${context.fileName}". Follow standard ${context.language} conventions.`;
            break;
    }

    const systemPrompt = `You are a ${context.language} autocomplete engine. Predict what the developer types next.

FILE: "${context.fileName}". ${fileConventionHint}

RULES:
- Output ONLY the text to insert at the cursor
- Do NOT repeat existing code before the cursor
- No markdown, no explanations
- Match the existing indentation and style
- Complete the ENTIRE skeleton for any started construct (function/class/loop/if/try), including closing braces
- For new/empty files: minimal standard boilerplate for the language
- Predict the most likely next 1-8 lines; output empty string if unsure
- ${NO_AUTO_COMMENTS_INSTRUCTION}`;

    let userPrompt: string;

    if (isEmptyOrNewFile) {
        // For empty files, suggest boilerplate based on filename and language
        userPrompt = `The user just created a new empty file called "${context.fileName}" (${context.language}).
Generate MINIMAL, CLEAN starting boilerplate code for this file. Keep it short and practical.

Language-specific rules:
- Java: public class ${fileBaseName} with public static void main(String[] args) and a System.out.println("Hello, World!");
- Python: just def main() with print("Hello, World!") and if __name__ == "__main__": main(). NO encoding comments, NO docstrings, NO imports unless needed.
- C: #include <stdio.h> with int main() that has printf("Hello, World!\\n") and return 0;
- C++: #include <iostream> with int main() that has std::cout << "Hello, World!" << std::endl and return 0;
- Go: package main with import "fmt" and func main() with fmt.Println("Hello, World!")
- Rust: fn main() with println!("Hello, World!");
- JavaScript/TypeScript: console.log("Hello, World!");
- Kotlin: fun main() with println("Hello, World!")
- Swift: print("Hello, World!")
- C#: using System; with class Program { static void Main() { Console.WriteLine("Hello, World!"); } }

Do NOT add encoding declarations, file docstrings, or unnecessary comments.
Output ONLY the code, nothing else.`;
    } else {
        userPrompt = `File: ${context.fileName}

Complete the code at the cursor position (marked with █):

\`\`\`${context.language}
${textBeforeCursor}█${textAfterCursor}
\`\`\`

Output ONLY the text to insert at █. Do not repeat existing code.`;
    }

    try {
        const { sendChatRequest, getSmartModel } = await import('./groqService');
        const completion = await sendChatRequest(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            {
                model: getSmartModel('inline-suggest'),
                task: 'autocomplete',
                signal: controller.signal,
                allowFallback: false,
            }
        );

        aiAbortManager.release(INLINE_SUGGESTION_KEY);

        if (!completion || completion.trim() === '') {
            return null;
        }

        // Reject stale completions: typing/cursor moved on while awaiting.
        if (context.isStale?.()) return null;

        // Sanitize: strip thinking, fences, conversational wrappers, and any
        // AI meta-commentary. Mode "autocomplete" forbids new comments; comments
        // already present in the surrounding code are preserved.
        let cleanedCompletion = sanitizeEditorOutputWithPolicy(completion, {
            task: 'inline-suggest',
            language: context.language,
            filename: context.fileName,
            outputMode: 'autocomplete',
            preserve: context.code,
        });

        // If the completion starts with the last line's content, strip it (AI repeated context)
        if (!isEmptyOrNewFile && lastLine.trim() && cleanedCompletion.startsWith(lastLine.trim())) {
            cleanedCompletion = cleanedCompletion.slice(lastLine.trim().length);
        }

        if (!cleanedCompletion || cleanedCompletion.trim() === '') {
            return null;
        }

        // Language-aware bracket balancing: ensure all opened brackets are closed
        cleanedCompletion = balanceBrackets(textBeforeCursor, cleanedCompletion, context.language);

        return {
            text: cleanedCompletion,
            isModify: false
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        aiAbortManager.release(INLINE_SUGGESTION_KEY);
        if (error.name === 'AbortError' || error.message?.includes('abort')) {
            return null;
        }
        console.error('[AI] Inline completion error:', error.message);
        return null;
    }
};

export const clearSuggestionCache = () => { /* no-op for now */ };
