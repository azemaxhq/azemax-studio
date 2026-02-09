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
        // We also trim the AI output lines to avoid double indentation if the AI added some.
        let finalCode = generatedCode;
        if (indentation) {
            finalCode = generatedCode
                .split('\n')
                .map(line => indentation + line.trim())
                .join('\n');
        } else {
            // Even if no indentation detected (e.g. top level), trim AI's potential indentation
            finalCode = generatedCode
                .split('\n')
                .map(line => line.trim())
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

export const clearSuggestionCache = () => { /* no-op for now */ };
