/**
 * Code suggestion service for inline completions using OpenRouter AI
 */

import { modifyCode } from './groqService';

export interface SuggestionContext {
    code: string;           // Full code in the file
    cursorPosition: number; // Cursor position in the code
    language: string;       // Programming language
    fileName: string;       // Current file name
}

export interface SuggestionResult {
    text: string;
    replaceLength?: number;
    isModify?: boolean;
    startOffset?: number;
    error?: string;
}

// Abort controller for cancellation
let abortController: AbortController | null = null;

/**
 * Cancel any pending AI request
 */
export const cancelPendingRequest = (): void => {
    if (abortController) {
        abortController.abort();
        abortController = null;
        console.log('[AI] Request cancelled by user');
    }
};

/**
 * Check if a request is currently in progress
 */
export const isRequestInProgress = (): boolean => {
    return abortController !== null;
};

/**
 * Main function to get AI code suggestion based on /// commands
 */
export const getCodeSuggestion = async (context: SuggestionContext): Promise<SuggestionResult | null> => {
    // Cancel any pending request
    cancelPendingRequest();

    // Create new abort controller
    abortController = new AbortController();

    console.log('[AI] getCodeSuggestion called. Cursor at:', context.cursorPosition);

    // Get text before cursor
    const textBeforeCursor = context.code.substring(
        Math.max(0, context.cursorPosition - 500),
        context.cursorPosition
    );

    const lines = textBeforeCursor.split('\n');
    const currentLine = lines[lines.length - 1];

    console.log('[AI] Current line:', currentLine);

    // Pattern: Current line has `/// command;`
    // Modified to support inline comments: [code prefix] /// [command];
    const sameLineMatch = currentLine.match(/^(.*?)\/\/\/\s*(.+);$/);

    if (!sameLineMatch) {
        console.log('[AI] No /// command detected. Exiting.');
        abortController = null;
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

    console.log('[AI] Processing command:', commandText, 'with prefix:', prefix.trim());

    // Get context code for better suggestions
    const contextCode = context.code.substring(
        Math.max(0, context.cursorPosition - 1000),
        context.cursorPosition
    );

    try {
        // Use modifyCode instead of generateCode for inline instructions
        const generatedCode = await modifyCode(
            contextCode,
            commandText,
            context.language
        );

        if (!generatedCode) {
            console.error('[AI] Empty response from API');
            abortController = null;
            return { text: '', error: 'Empty response - try rephrasing' };
        }

        // Apply indentation
        // We replace from column 1, so we must indent the first line too.
        // We should NOT trim the AI output lines because languages like Python
        // rely on internal relative indentation (e.g. loops, ifs).
        let finalCode = generatedCode;
        if (indentation) {
            finalCode = generatedCode
                .split('\n')
                .map(line => {
                    // Only apply base indentation if the line has content (not just a newline)
                    if (line.trim() === '') return line;
                    return indentation + line;
                })
                .join('\n');
        }

        console.log('[AI] Generated code length:', finalCode.length);

        const replaceLength = context.cursorPosition - replaceStartOffset;

        abortController = null;
        return {
            text: finalCode,
            replaceLength,
            isModify: true,
            startOffset: replaceStartOffset
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error('[AI] Error:', error.message);
        abortController = null;

        if (error.name === 'AbortError' || error.message?.includes('abort')) {
            return { text: '', error: 'Cancelled' };
        }

        return { text: '', error: error.message || 'AI request failed' };
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
    // Cancel any pending request
    cancelPendingRequest();
    abortController = new AbortController();

    const textBeforeCursor = context.code.substring(
        Math.max(0, context.cursorPosition - 1500),
        context.cursorPosition
    );

    const textAfterCursor = context.code.substring(
        context.cursorPosition,
        Math.min(context.code.length, context.cursorPosition + 500)
    );

    const lastLine = textBeforeCursor.split('\n').pop() || '';
    const totalCode = context.code.trim();
    const isEmptyOrNewFile = totalCode.length < 3;
    const fileBaseName = context.fileName.replace(/\.[^/.]+$/, ''); // e.g. "HelloWorld" from "HelloWorld.java"

    // Don't suggest if cursor is inside a regular comment (not ///)
    if (!isEmptyOrNewFile && lastLine.trim().startsWith('//') && !lastLine.includes('///')) {
        abortController = null;
        return null;
    }

    // Build a language-specific hint about file conventions
    let fileConventionHint = '';
    switch (context.language) {
        case 'java':
            fileConventionHint = `The file is named "${context.fileName}". In Java, the public class name MUST match the filename. So the class should be named "${fileBaseName}".`;
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

    const systemPrompt = `You are an expert ${context.language} code autocomplete engine embedded in a code editor. Your job is to predict what the developer wants to type next.

FILE CONTEXT:
${fileConventionHint}

RULES:
- Output ONLY the completion text that should be inserted at the cursor
- Do NOT repeat any code that already exists before the cursor
- Do NOT wrap output in markdown backticks or add language tags
- Do NOT add explanations or comments about what you're doing
- Match the existing code style, indentation, and patterns exactly
- For new/empty files: suggest the standard boilerplate for the language matching the filename
- For partial code: predict the most likely next 1-8 lines based on context
- If the user started a construct (function, class, loop, if, switch, try-catch, struct, enum, etc.), ALWAYS complete the ENTIRE skeleton including the closing brace/bracket/parenthesis
- ALWAYS ensure every opening { has a matching closing }. Every opening [ has a matching ]. Every opening ( has a matching )
- When completing a class or function body, include the full body with the closing brace on its own line
- For example, if the user typed "class HelloWorld {", you MUST include the closing "}" in the suggestion
- Be precise: only suggest what belongs at this exact cursor position
- Output empty string if unsure`;

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
        const { sendChatRequest } = await import('./groqService');
        const completion = await sendChatRequest(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            {
                temperature: 0.1,
                maxTokens: 300,
                signal: abortController.signal
            }
        );

        abortController = null;

        if (!completion || completion.trim() === '') {
            return null;
        }

        // Clean up the completion
        let cleanedCompletion = completion
            .replace(/^```\w*\n?/, '')
            .replace(/\n?```$/, '')
            .trimEnd();

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
        abortController = null;
        if (error.name === 'AbortError' || error.message?.includes('abort')) {
            return null;
        }
        console.error('[AI] Inline completion error:', error.message);
        return null;
    }
};

export const clearSuggestionCache = () => { /* no-op for now */ };
