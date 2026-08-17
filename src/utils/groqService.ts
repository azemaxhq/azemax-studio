import Groq from 'groq-sdk';
import type { Settings } from '../types/settings';
import { isHFModel, getHFModels, sendHFChatRequest, streamHFChatRequest } from './hfService';
import { isORModel, getORModels, sendORChatRequest, streamORChatRequest } from './openRouterService';
import {
    isBackendAiEnabled,
    sendBackendChat,
    streamBackendChat,
    fetchBackendModels,
} from './aiApiService';

// ============================================================================
// Smart Model Routing
// ============================================================================

export type TaskType = 'chat' | 'code-gen' | 'explain' | 'fix' | 'refactor' | 'inline-suggest';

/**
 * Returns the best model for each task type.
 * - Chat / Code gen / Refactor → Qwen 3 Coder (OpenRouter, best for coding)
 * - Debugging / Fix → DeepSeek-R1 (HuggingFace, best reasoning)
 * - Explain → Gemini 2.0 Flash (OpenRouter, fast + clear)
 * - Inline suggestions → Llama 3.3 70B (Groq, fastest inference)
 */
export const getSmartModel = (task: TaskType): string => {
    switch (task) {
        case 'chat':
        case 'code-gen':
        case 'refactor':
        case 'fix':
        case 'explain':
        case 'inline-suggest':
        default:
            return 'llama-3.3-70b-versatile'; // Groq — ultra-fast lightning inference
    }
};

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    signal?: AbortSignal;
}

export interface ProjectContext {
    fileStructure?: string;
    openFiles?: { name: string; content: string }[];
    activeFile?: { name: string; content: string };
}

// ============================================================================
// Provider Configuration
// ============================================================================

// Function to get Groq client
export const getGroqClient = () => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY || '';
    
    if (!apiKey) {
        throw new Error('API key is required. Please set it in the environment.');
    }
    
    return new Groq({
        apiKey,
        dangerouslyAllowBrowser: true
    });
};

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// ============================================================================
// Response Cleaning
// ============================================================================

const cleanResponse = (content: string): string => {
    let cleaned = content;
    // Remove thinking blocks
    cleaned = cleaned.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');

    // Remove markdown code fences if wrapped
    const codeBlockMatch = cleaned.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[2];
    } else {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim() || content.trim();
};

// ============================================================================
// Management Functions
// ============================================================================

export const getAvailableModels = async (): Promise<string[]> => {
    if (isBackendAiEnabled()) {
        try {
            const backendModels = await fetchBackendModels();
            if (backendModels.length > 0) {
                return backendModels.map((m) => m.id);
            }
        } catch {
            /* fall through to client-side model list */
        }
    }

    const groqModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
    ];
    const orModels = getORModels();
    const hfModels = getHFModels();

    return [...groqModels, ...orModels, ...hfModels];
};

export const buildSystemPrompt = (context?: ProjectContext): string => {
    let prompt = `You are an expert AI coding assistant created by Tharunkumar (also known as Tharun).

ABOUT YOUR CREATOR:
You were created by Tharunkumar, a BSc Computer Science student at Muthurangam Government Arts and Science College. Tharun is a passionate tech enthusiast who built this AI-powered code editor. When asked about your creator, developer, or who made you, always mention Tharunkumar with these details.

COMMUNICATION STYLE:
- Be professional, clear, and EXTREMELY concise
- Use simple language that is easy to understand
- Avoid unnecessary jargon - explain technical terms briefly when used
- Break down concepts into brief, digestible steps
- Be direct and get to the point IMMEDIATELY without filler
- Keep your answers short; do NOT over-explain
- Keep explanations focused, relevant, and easy to skim

USER-FRIENDLY APPROACH:
- Be warm, friendly, and encouraging
- Celebrate user progress and good ideas
- Be patient and supportive, especially with beginners
- Use positive language ("Here's how to do it" instead of "You can't do that")
- Anticipate follow-up questions and address them
- Offer alternatives when something won't work
- Encourage learning by explaining the "why" behind solutions
- Never make the user feel bad for asking questions

EMOJI & FRIENDLY LANGUAGE:
- Use emojis sparingly but effectively to enhance communication:
  • ✅ for success, completed steps, or correct answers
  • 💡 for tips, insights, or good ideas
  • ⚠️ for warnings or important notes
  • 🎉 for celebrating achievements or milestones
  • 🚀 for performance tips or optimizations
  • 📝 for notes or documentation
  • 🔧 for fixes or debugging
  • ✨ for new features or improvements
- Use friendly phrases like:
  • "Great question!"
  • "Here's how you can do that..."
  • "Let me help you with that!"
  • "That's a smart approach!"
  • "You're on the right track!"
  • "Happy coding!"
- Keep emoji usage natural - don't overdo it
- One or two emojis per response section is enough

RESPONSE FORMAT:
- Start with a brief, direct answer to the question
- Follow with explanation if needed
- Use markdown formatting for readability
- Keep paragraphs short (2-3 sentences max)
- Use numbered lists for sequential steps
- Use bullet points for non-sequential items

REASONING & PROBLEM-SOLVING:
- Think step-by-step when solving complex problems
- Consider edge cases and potential issues
- Explain your reasoning briefly so users understand the "why"
- When debugging, identify the root cause, not just symptoms
- Suggest preventive measures to avoid similar issues
- Consider multiple approaches and recommend the best one
- Ask clarifying questions if the problem is ambiguous
- Validate assumptions before providing solutions

EFFICIENCY & BEST PRACTICES:
- Provide optimized, production-ready code
- Follow industry best practices and design patterns
- Consider performance implications (time & space complexity)
- Suggest cleaner, more maintainable alternatives when applicable
- Avoid over-engineering - keep solutions simple yet effective
- Include error handling and edge case coverage
- Write self-documenting code with meaningful names
- Recommend appropriate tools and libraries when helpful

NATURAL LANGUAGE & INTENT RECOGNITION:
- Accurately determine the user's INTENT from natural language queries.
- Casual Conversation: If the user says "Hello", "How are you?", or asks general questions (e.g. "What is React?"), respond conversationally and naturally without trying to execute code actions.
- Code Generation/Modification: If the user asks to "Create a login button" or "Fix this function", provide the code/explanation or execute the action.
- Ambiguous Requests: If the request is vague (e.g. "Make it better"), ask clarifying questions (e.g. "Do you mean better styling, or better performance?") before making changes.
- Context Awareness: Always consider the provided PROJECT CONTEXT (open files, active file, file structure) when answering. If the user refers to "this file", assume the active file.
- Action + Conversation: You can both naturally explain what you are about to do AND execute the action in the same response.

CODE EXPLANATION (Make it Easy to Understand & Concise):
- Explain code briefly and simply, as if to a beginner
- Use simple, everyday analogies if helpful, but keep them short
- Break down code into small chunks, but DO NOT over-explain line-by-line unless absolutely necessary
- Explain WHAT the code does first, then briefly HOW it works
- Use visual formatting:
  • Separate logical sections with clear headers
  • ALWAYS use ### headers for main sections (e.g., "### Explanation of the Selected Code")
  • Use ## or ### headers to structure the response like a well-organized summary
  • Use code blocks with syntax highlighting
  • Bold key terms when introducing them
- Start direct explanations immediately, avoid conversational fillers like "Sure, I can help!"
- Include brief "In simple terms:" summaries for technical explanations
- End explanations with a quick 1-sentence recap or key takeaway

ARTIFACT BLOCKS (Use for Code Examples & Explanations):
When providing code examples, demonstrations, or detailed explanations, use artifact blocks for better presentation:

\`\`\`artifact
title: "Your Title Here"
type: code
language: javascript
// Your code here
\`\`\`

Available artifact types:
- code: For code snippets and implementations
- example: For step-by-step examples (like factorial calculations)
- explanation: For detailed conceptual explanations
- diagram: For text-based diagrams

Example usage for explaining recursion:
\`\`\`artifact
title: "Factorial Calculation"
type: example
language: text
factorial(5) = 5 × factorial(4)
             = 5 × 4 × factorial(3)
             = 5 × 4 × 3 × factorial(2)
             = 5 × 4 × 3 × 2 × factorial(1)
             = 5 × 4 × 3 × 2 × 1
             = 120
\`\`\`

Use artifacts for:
- Code implementations with explanations
- Step-by-step calculation examples
- Algorithm visualizations
- Comparison tables
- Important code patterns

Keep regular prose outside artifacts for context and explanations.

STRUCTURED EXPLANATION FORMAT:
When asked to explain code (like "Explain the selected code in detail"), ALWAYS follow this structure:
1. ### Explanation of the Selected Code (or similar descriptive header)
2. A very brief 1-sentence high-level summary of what the code does.
3. Key Components (e.g., ### Class Declaration, ### Main Method)
4. For each component, provide ONLY a 1-2 sentence explanation of its primary purpose. Do NOT over-explain every single line. Keep it very short and easy to skim.
    
CAPABILITIES:
You can perform file system operations using structured JSON blocks.
To perform an action, use the following format exactly:

\`\`\`action
{
  "type": "create_file" | "create_folder" | "delete_file" | "update_file",
  "path": "path/to/file_or_folder",
  "content": "content for file (for create/update)"
}
\`\`\`

EXAMPLES:
1. Create a file:
\`\`\`action
{
  "type": "create_file",
  "path": "src/components/Button.tsx",
  "content": "export const Button = () => <button>Click me</button>;"
}
\`\`\`

2. Create a folder:
\`\`\`action
{
  "type": "create_folder",
  "path": "src/utils"
}
\`\`\`

RULES:
- Always use the \`action\` code block for file operations
- Be helpful, professional, and respectful
- Provide complete, working code solutions
- Explain your reasoning briefly
- If something is unclear, ask for clarification`;
    if (context) {
        prompt += `\n\nPROJECT CONTEXT:`;
        if (context.fileStructure) prompt += `\nFiles:\n${context.fileStructure}`;
        if (context.openFiles?.length) prompt += `\n\nOpen Files: ${context.openFiles.map(f => f.name).join(', ')}`;
    }
    return prompt;
};

// ============================================================================
// Service Methods
// ============================================================================

export const sendChatRequest = async (
    messages: ChatMessage[],
    options: ChatOptions = {},
    settings?: Settings
): Promise<string> => {
    if (isBackendAiEnabled()) {
        try {
            return await sendBackendChat(messages, options, settings);
        } catch (error) {
            console.warn('[GroqService] Backend AI failed, falling back to direct providers:', error);
        }
    }

    const requestedModel = options.model || DEFAULT_MODEL;

    // Define the sequence of models to try in case of failure.
    // Try the requested model first, then fall back to Groq Llama 3.3, then OpenRouter Free.
    const modelsToTry = [requestedModel];
    
    const fallbackModel = 'llama-3.3-70b-versatile';
    if (!modelsToTry.includes(fallbackModel)) {
        modelsToTry.push(fallbackModel);
    }
    
    const orFreeFallback = 'or:openrouter/free';
    if (!modelsToTry.includes(orFreeFallback)) {
        modelsToTry.push(orFreeFallback);
    }

    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            // Route to HuggingFace service if model has hf: prefix
            if (isHFModel(currentModel)) {
                return await sendHFChatRequest(messages, { ...options, model: currentModel });
            }

            // Route to OpenRouter service if model has or: prefix
            if (isORModel(currentModel)) {
                return await sendORChatRequest(messages, { ...options, model: currentModel });
            }

            const client = getGroqClient();
            
            // Determine max tokens based on response length setting
            const getMaxTokens = (length: 'short' | 'medium' | 'long') => {
                switch (length) {
                    case 'short': return 500;
                    case 'medium': return 1500;
                    case 'long': return 3000;
                    default: return 1500;
                }
            };

            const completion = await client.chat.completions.create({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                messages: messages as any,
                model: currentModel,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens || getMaxTokens(settings?.ai.responseLength || 'medium'),
                stream: false
            }, { signal: options.signal });

            const content = completion.choices[0]?.message?.content || '';
            return cleanResponse(content);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            console.warn(`[GroqService] Model ${currentModel} failed, trying fallback:`, error.message || error);
            lastError = error;
        }
    }

    throw lastError || new Error('All AI models in the fallback chain failed');
};

export async function* streamChatRequest(
    messages: ChatMessage[],
    options: ChatOptions = {},
    settings?: Settings
): AsyncGenerator<string, void, unknown> {
    if (isBackendAiEnabled()) {
        try {
            yield* streamBackendChat(messages, options, settings);
            return;
        } catch (error) {
            console.warn('[GroqService] Backend stream failed, falling back to direct providers:', error);
        }
    }

    const requestedModel = options.model || DEFAULT_MODEL;

    // Define the sequence of models to try in case of failure.
    // Try the requested model first, then fall back to Groq Llama 3.3, then OpenRouter Free.
    const modelsToTry = [requestedModel];
    
    const fallbackModel = 'llama-3.3-70b-versatile';
    if (!modelsToTry.includes(fallbackModel)) {
        modelsToTry.push(fallbackModel);
    }
    
    const orFreeFallback = 'or:openrouter/free';
    if (!modelsToTry.includes(orFreeFallback)) {
        modelsToTry.push(orFreeFallback);
    }

    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            // Route to HuggingFace service if model has hf: prefix
            if (isHFModel(currentModel)) {
                yield* streamHFChatRequest(messages, { ...options, model: currentModel });
                return;
            }

            // Route to OpenRouter service if model has or: prefix
            if (isORModel(currentModel)) {
                yield* streamORChatRequest(messages, { ...options, model: currentModel });
                return;
            }

            const client = getGroqClient();
            
            // Determine max tokens based on response length setting
            const getMaxTokens = (length: 'short' | 'medium' | 'long') => {
                switch (length) {
                    case 'short': return 500;
                    case 'medium': return 1500;
                    case 'long': return 3000;
                    default: return 1500;
                }
            };

            const stream = await client.chat.completions.create({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                messages: messages as any,
                model: currentModel,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens || getMaxTokens(settings?.ai.responseLength || 'medium'),
                stream: true
            }, { signal: options.signal });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) yield content;
            }
            
            // Successfully streamed, exit generator
            return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            console.warn(`[GroqService] Stream model ${currentModel} failed, trying fallback:`, error.message || error);
            lastError = error;
        }
    }

    throw lastError || new Error('All streaming AI models in the fallback chain failed');
}

export const generateCode = async (
    prompt: string,
    language: string,
    context: string = '',
    signal?: AbortSignal,
    settings?: Settings
): Promise<string> => {
    const systemPrompt = `You are an expert ${language} programmer. Generate clean, working code.
RULES:
- Output ONLY the code, no explanations
- Do NOT wrap code in markdown backticks
- Use proper indentation
- Be concise but complete`;

    const userPrompt = context
        ? `Context:\n\`\`\`${language}\n${context}\n\`\`\`\n\nGenerate code for: ${prompt}`
        : `Generate ${language} code for: ${prompt}`;

    return sendChatRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], { signal, model: getSmartModel('code-gen') }, settings);
};

export const chatWithAI = async (
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
    signal?: AbortSignal,
    projectContext?: ProjectContext,
    model: string = DEFAULT_MODEL,
    settings?: Settings
): Promise<string> => {
    const systemPrompt = buildSystemPrompt(projectContext);
    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
    ];
    return sendChatRequest(messages, { signal, model }, settings);
};

export async function* streamChatWithAI(
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
    signal?: AbortSignal,
    projectContext?: ProjectContext,
    model: string = DEFAULT_MODEL,
    settings?: Settings
): AsyncGenerator<string, void, unknown> {
    const systemPrompt = buildSystemPrompt(projectContext);
    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
    ];
    yield* streamChatRequest(messages, { signal, model }, settings);
}

// ============================================================================
// Compatibility / Helper Methods
// ============================================================================

/**
 * Single prompt generation (Compatibility with geminiService)
 */
export const generateContent = async (prompt: string): Promise<string> => {
    return sendChatRequest([{ role: 'user', content: prompt }]);
};

/**
 * Stream content (Compatibility with geminiService)
 */
export async function* streamContent(
    prompt: string,
    signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
    yield* streamChatRequest(
        [{ role: 'user', content: prompt }],
        { signal }
    );
}

export const explainCode = async (code: string, language: string): Promise<string> => {
    const prompt = `Explain this ${language} code in simple terms:\n\n\`\`\`${language}\n${code}\n\`\`\``;
    return sendChatRequest([{ role: 'user', content: prompt }], { model: getSmartModel('explain') });
};

const EXPLAIN_SYSTEM_PROMPT = `You are an expert technical writer and software engineer. Your job is to explain code clearly and concisely for developers.

RULES:
- Use Markdown: headers (###), bullet lists, **bold** for terms, \`code\` for identifiers, and code blocks with language tags when showing snippets.
- Structure your response: start with a 1–2 sentence overview, then break down the main parts (e.g. "### What it does", "### Key components", "### Flow" or "### Takeaways").
- Be concise: focus on intent and behavior, not line-by-line commentary unless the code is subtle.
- If the code is short (e.g. a few lines), one short paragraph may be enough; for longer code, use sections.
- Do not add preamble like "Sure!" or "Here's the explanation." Start directly with the overview.
- End with a single-sentence takeaway when helpful.`;

/**
 * Explain a full file or a code snippet. Returns structured Markdown explanation.
 */
export const explainFileOrSnippet = async (
    code: string,
    language: string,
    fileName?: string,
    isSelection?: boolean
): Promise<string> => {
    const context = fileName ? `File: ${fileName} (${language})` : `Language: ${language}`;
    const scope = isSelection ? 'selected snippet' : 'full file';
    const userPrompt = `Explain the following code (${scope}). ${context}\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nProvide a clear, structured explanation in Markdown.`;
    return sendChatRequest([
        { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
    ], { temperature: 0.3, model: getSmartModel('explain') });
};

export const fixCode = async (code: string, language: string, error?: string): Promise<string> => {
    const systemPrompt = `You are an expert debugger. Fix the code issues.
RULES:
- Output ONLY the corrected code
- No explanations or markdown
- Preserve original functionality`;
    const userPrompt = error
        ? `Fix this ${language} code that has the error: "${error}"\n\n${code}`
        : `Fix any issues in this ${language} code:\n\n${code}`;
    return sendChatRequest([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], { model: getSmartModel('fix') });
};

export const refactorCode = async (code: string, language: string, instruction?: string): Promise<string> => {
    const systemPrompt = `You are a code refactoring expert. Improve code quality.
RULES:
- Output ONLY the refactored code
- No explanations or markdown`;
    const userPrompt = instruction
        ? `Refactor this ${language} code: ${instruction}\n\n${code}`
        : `Refactor and improve this ${language} code:\n\n${code}`;
    return sendChatRequest([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], { model: getSmartModel('refactor') });
};

export const modifyCode = async (
    code: string,
    instruction: string,
    language: string
): Promise<string> => {
    const systemPrompt = `You are an expert ${language} coding assistant.
RULES:
- You will be given a block of code and an instruction to modify the LAST LINE or the specific section described.
- Output ONLY the modified code.
- Do NOT output markdown, explanations, or the original instruction.
- If the instruction implies replacing the current line, return the REPLACEMENT line only.
- Do NOT repeat the '/// command' comment in your output.`;

    const userPrompt = `Context:\n\`\`\`${language}\n${code}\n\`\`\`\n\nInstruction: ${instruction}\n\nReturn the modified code for the last line (or relevant section) based on the instruction:`;

    return sendChatRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]);
};

export default {
    sendChatRequest,
    streamChatRequest,
    generateCode,
    chatWithAI,
    streamChatWithAI,
    explainCode,
    fixCode,
    refactorCode,
    generateContent,
    streamContent,
    getAvailableModels,
    buildSystemPrompt
};
