/**
 * AI Comment Service
 * Full-featured AI commenting system using G4F (GPT4Free)
 * 
 * Features:
 * - Streaming code generation for real-time feedback
 * - Smart context awareness for better suggestions
 * - Multiple free AI providers (Pollinations, DeepInfra)
 * - Automatic code formatting and indentation
 * - Comment-based command parsing (/// syntax)
 */

import { streamChatRequest, sendChatRequest, type ChatMessage } from './groqService';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CommentCommand {
    type: 'generate' | 'modify' | 'explain' | 'refactor' | 'fix' | 'document';
    instruction: string;
    language: string;
    context: {
        beforeCode: string;
        afterCode: string;
        fullCode: string;
        cursorPosition: number;
        lineNumber: number;
        indentation: string;
    };
}

export interface GenerationResult {
    success: boolean;
    code?: string;
    explanation?: string;
    error?: string;
    replaceRange?: {
        start: number;
        end: number;
    };
}

export interface StreamingCallbacks {
    onStart?: () => void;
    onChunk?: (chunk: string, fullContent: string) => void;
    onComplete?: (result: GenerationResult) => void;
    onError?: (error: Error) => void;
}

// ============================================================================
// Constants & Configuration
// ============================================================================

const COMMAND_PATTERNS = {
    // Triple slash comment commands: [code] /// do something;
    tripleSlash: /^(.*?)\/\/\/\s*(.+);?\s*$/,
    // Hash comment commands for Python: ### do something
    hashComment: /^(\s*)###\s*(.+)$/,
    // Block comment commands: /** do something */
    blockComment: /^(\s*)\/\*\*\s*(.+?)\s*\*\/\s*$/,
};

const SYSTEM_PROMPTS = {
    generate: `You are an expert programmer. Generate clean, production-ready code.
CRITICAL RULES:
- Output ONLY the code, NO explanations or markdown
- Use proper indentation to match the surrounding code
- Follow best practices and conventions for the language
- Be concise but complete
- Never wrap code in markdown backticks`,

    modify: `You are an expert code modifier. Update the existing code as instructed.
CRITICAL RULES:
- Output ONLY the modified code
- Preserve the original code structure where possible
- Maintain consistent formatting and style
- Do NOT include explanations or markdown`,

    explain: `You are a helpful code explainer. Explain the code clearly.
- Use simple language
- Break down complex concepts
- Include examples if helpful
- Be concise`,

    refactor: `You are a code refactoring expert. Improve the code quality.
CRITICAL RULES:
- Output ONLY the refactored code
- Improve readability and maintainability
- Apply design patterns where appropriate
- Maintain functionality`,

    fix: `You are a debugging expert. Fix the code issues.
CRITICAL RULES:
- Output ONLY the corrected code
- Identify and fix bugs
- Handle edge cases
- Add error handling if needed`,

    document: `You are a documentation expert. Add proper documentation.
CRITICAL RULES:
- Output ONLY the documented code
- Add clear JSDoc/docstrings
- Document parameters and return values
- Keep comments concise but informative`,
};

// ============================================================================
// State Management
// ============================================================================

let activeController: AbortController | null = null;
let isProcessing = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a comment command from the current line
 */
export const parseCommentCommand = (
    line: string,
    language: string
): { indentation: string; instruction: string } | null => {
    // Try triple slash (universal)
    const tripleSlashMatch = line.match(COMMAND_PATTERNS.tripleSlash);
    if (tripleSlashMatch) {
        const prefix = tripleSlashMatch[1] || '';
        const indentMatch = prefix.match(/^(\s*)/);
        return {
            indentation: indentMatch ? indentMatch[1] : '',
            instruction: tripleSlashMatch[2].trim().replace(/;$/, ''),
        };
    }

    // Try hash comments for Python, Ruby, Shell
    if (language === 'python' || language === 'ruby' || language === 'shell' || language === 'bash') {
        const hashMatch = line.match(COMMAND_PATTERNS.hashComment);
        if (hashMatch) {
            return {
                indentation: hashMatch[1] || '',
                instruction: hashMatch[2].trim(),
            };
        }
    }

    // Try block comment
    const blockMatch = line.match(COMMAND_PATTERNS.blockComment);
    if (blockMatch) {
        return {
            indentation: blockMatch[1] || '',
            instruction: blockMatch[2].trim(),
        };
    }

    return null;
};

/**
 * Detect the command type from the instruction
 */
export const detectCommandType = (instruction: string): CommentCommand['type'] => {
    const lowerInstruction = instruction.toLowerCase();

    if (lowerInstruction.startsWith('explain') || lowerInstruction.startsWith('what')) {
        return 'explain';
    }
    if (lowerInstruction.startsWith('refactor') || lowerInstruction.startsWith('improve')) {
        return 'refactor';
    }
    if (lowerInstruction.startsWith('fix') || lowerInstruction.startsWith('debug')) {
        return 'fix';
    }
    if (lowerInstruction.startsWith('document') || lowerInstruction.startsWith('comment')) {
        return 'document';
    }
    if (lowerInstruction.startsWith('modify') || lowerInstruction.startsWith('change') || lowerInstruction.startsWith('update')) {
        return 'modify';
    }

    return 'generate';
};

/**
 * Cancel any in-progress generation
 */
export const cancelGeneration = (): boolean => {
    if (activeController) {
        activeController.abort();
        activeController = null;
        isProcessing = false;
        console.log('[AI Comment] Generation cancelled');
        return true;
    }
    return false;
};

/**
 * Check if a generation is in progress
 */
export const isGenerating = (): boolean => isProcessing;

/**
 * Generate code from a comment command with streaming
 */
export async function* streamGenerateFromComment(
    command: CommentCommand,
    callbacks?: StreamingCallbacks
): AsyncGenerator<string, GenerationResult, unknown> {
    // Cancel any existing request
    cancelGeneration();

    activeController = new AbortController();
    isProcessing = true;

    callbacks?.onStart?.();

    const systemPrompt = SYSTEM_PROMPTS[command.type];
    const userPrompt = buildUserPrompt(command);

    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    let fullContent = '';

    try {
        const stream = streamChatRequest(messages, {
            signal: activeController.signal,
            maxTokens: 4000,
            temperature: 0.1,
        });

        for await (const chunk of stream) {
            if (activeController?.signal.aborted) {
                throw new Error('Generation cancelled');
            }

            fullContent += chunk;
            callbacks?.onChunk?.(chunk, fullContent);
            yield chunk;
        }

        // Clean up and format the final result
        const processedCode = processGeneratedCode(fullContent, command);

        const result: GenerationResult = {
            success: true,
            code: processedCode,
            replaceRange: calculateReplaceRange(command),
        };

        callbacks?.onComplete?.(result);
        return result;

    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (err.name === 'AbortError' || err.message.includes('cancel')) {
            const cancelResult: GenerationResult = {
                success: false,
                error: 'Generation cancelled',
            };
            callbacks?.onComplete?.(cancelResult);
            return cancelResult;
        }

        callbacks?.onError?.(err);

        const errorResult: GenerationResult = {
            success: false,
            error: err.message,
        };
        callbacks?.onComplete?.(errorResult);
        return errorResult;

    } finally {
        activeController = null;
        isProcessing = false;
    }
}

/**
 * Non-streaming code generation (for simpler use cases)
 */
export const generateFromComment = async (
    command: CommentCommand
): Promise<GenerationResult> => {
    cancelGeneration();

    activeController = new AbortController();
    isProcessing = true;

    const systemPrompt = SYSTEM_PROMPTS[command.type];
    const userPrompt = buildUserPrompt(command);

    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    try {
        const response = await sendChatRequest(messages, {
            signal: activeController.signal,
            maxTokens: 4000,
            temperature: 0.1,
        });

        const processedCode = processGeneratedCode(response, command);

        return {
            success: true,
            code: processedCode,
            replaceRange: calculateReplaceRange(command),
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage || 'Generation failed',
        };

    } finally {
        activeController = null;
        isProcessing = false;
    }
};

/**
 * Quick generate - simplified interface for common use cases
 */
export const quickGenerate = async (
    instruction: string,
    language: string,
    context: string = '',
    indentation: string = ''
): Promise<GenerationResult> => {
    const command: CommentCommand = {
        type: detectCommandType(instruction),
        instruction,
        language,
        context: {
            beforeCode: context,
            afterCode: '',
            fullCode: context,
            cursorPosition: context.length,
            lineNumber: context.split('\n').length,
            indentation,
        },
    };

    return generateFromComment(command);
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the user prompt based on the command
 */
const buildUserPrompt = (command: CommentCommand): string => {
    const { type, instruction, language, context } = command;

    let prompt = '';

    // Add context if available
    if (context.beforeCode.trim()) {
        prompt += `Existing code context:\n\`\`\`${language}\n${context.beforeCode.slice(-1500)}\n\`\`\`\n\n`;
    }

    // Add the main instruction based on type
    switch (type) {
        case 'generate':
            prompt += `Generate ${language} code for: ${instruction}`;
            break;
        case 'modify':
            prompt += `Modify the code: ${instruction}`;
            break;
        case 'explain':
            prompt += `Explain this code: ${instruction}`;
            break;
        case 'refactor':
            prompt += `Refactor this code: ${instruction}`;
            break;
        case 'fix':
            prompt += `Fix this code: ${instruction}`;
            break;
        case 'document':
            prompt += `Add documentation: ${instruction}`;
            break;
    }

    // Add special instructions for code output
    if (type !== 'explain') {
        prompt += `\n\nRemember: Output ONLY the ${language} code, no markdown or explanations.`;
    }

    return prompt;
};

/**
 * Process and format the generated code
 */
const processGeneratedCode = (rawCode: string, command: CommentCommand): string => {
    let code = rawCode
        // Remove any thinking blocks
        .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
        // Remove markdown code fences
        .replace(/^```[a-z]*\n?/gim, '')
        .replace(/```$/gm, '')
        .replace(/```/g, '')
        .trim();

    // Apply indentation if provided
    const { indentation } = command.context;
    if (indentation && code) {
        code = code
            .split('\n')
            .map((line, index) => (index === 0 ? line : indentation + line))
            .join('\n');
    }

    return code;
};

/**
 * Calculate the range to replace in the editor
 */
const calculateReplaceRange = (command: CommentCommand): { start: number; end: number } => {
    const { context } = command;

    // Find the start of the command line
    const lastLineStart = context.beforeCode.lastIndexOf('\n') + 1;

    return {
        start: lastLineStart,
        end: context.cursorPosition,
    };
};

// ============================================================================
// Exports
// ============================================================================

export default {
    parseCommentCommand,
    detectCommandType,
    cancelGeneration,
    isGenerating,
    streamGenerateFromComment,
    generateFromComment,
    quickGenerate,
};
