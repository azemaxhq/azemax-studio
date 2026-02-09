import Groq from 'groq-sdk';

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

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

const groq = new Groq({
    apiKey: GROQ_API_KEY,
    dangerouslyAllowBrowser: true
});

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
    // Groq models often used
    return [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
    ];
};

export const buildSystemPrompt = (context?: ProjectContext): string => {
    let prompt = `You are an expert AI coding assistant created by Tharunkumar (also known as Tharun).

ABOUT YOUR CREATOR:
You were created by Tharunkumar, a BSc Computer Science student at Muthurangam Government Arts and Science College. Tharun is a passionate tech enthusiast who built this AI-powered code editor. When asked about your creator, developer, or who made you, always mention Tharunkumar with these details.

COMMUNICATION STYLE:
- Be professional, clear, and concise
- Use simple language that is easy to understand
- Avoid unnecessary jargon - explain technical terms when used
- Structure responses with clear headings and bullet points when helpful
- Break down complex concepts into digestible steps
- Provide practical examples when explaining code
- Be direct and get to the point quickly
- Use code blocks with proper language tags for all code
- Keep explanations focused and relevant

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

CODE EXPLANATION (Make it Easy to Understand):
- Explain code like you're teaching a friend who's new to programming
- Use simple, everyday analogies to explain complex concepts
  • Example: "A function is like a recipe - you give it ingredients (inputs) and it gives you a dish (output)"
- Break down code into small, digestible chunks
- Explain WHAT the code does first, then HOW it works
- Add inline comments in code examples to explain key lines
- Use visual formatting:
  • Separate logical sections with clear headers
  • Use code blocks with syntax highlighting
  • Bold key terms when introducing them
- Avoid assuming prior knowledge - define terms when first used
- Use step-by-step walkthroughs for complex logic
- Include "In simple terms:" summaries for technical explanations
- Give real-world examples of when/why you'd use a concept
- End explanations with a quick recap or key takeaway

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
    options: ChatOptions = {}
): Promise<string> => {
    if (!GROQ_API_KEY) throw new Error('VITE_GROQ_API_KEY is missing in .env');

    try {
        const completion = await groq.chat.completions.create({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: messages as any,
            model: options.model || DEFAULT_MODEL,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
            stream: false
        }, { signal: options.signal });

        const content = completion.choices[0]?.message?.content || '';
        return cleanResponse(content);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error('[GroqService] Error:', error);
        throw error;
    }
};

export async function* streamChatRequest(
    messages: ChatMessage[],
    options: ChatOptions = {}
): AsyncGenerator<string, void, unknown> {
    if (!GROQ_API_KEY) throw new Error('VITE_GROQ_API_KEY is missing in .env');

    try {
        const stream = await groq.chat.completions.create({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: messages as any,
            model: options.model || DEFAULT_MODEL,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
            stream: true
        }, { signal: options.signal });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error('[GroqService] Stream Error:', error);
        throw error;
    }
}

export const generateCode = async (
    prompt: string,
    language: string,
    context: string = '',
    signal?: AbortSignal
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
    ], { signal });
};

export const chatWithAI = async (
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
    signal?: AbortSignal,
    projectContext?: ProjectContext
): Promise<string> => {
    const systemPrompt = buildSystemPrompt(projectContext);
    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
    ];
    return sendChatRequest(messages, { signal });
};

export async function* streamChatWithAI(
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
    signal?: AbortSignal,
    projectContext?: ProjectContext,
    model: string = DEFAULT_MODEL
): AsyncGenerator<string, void, unknown> {
    const systemPrompt = buildSystemPrompt(projectContext);
    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
    ];
    yield* streamChatRequest(messages, { signal, model });
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
    return sendChatRequest([{ role: 'user', content: prompt }]);
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
    return sendChatRequest([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
};

export const refactorCode = async (code: string, language: string, instruction?: string): Promise<string> => {
    const systemPrompt = `You are a code refactoring expert. Improve code quality.
RULES:
- Output ONLY the refactored code
- No explanations or markdown`;
    const userPrompt = instruction
        ? `Refactor this ${language} code: ${instruction}\n\n${code}`
        : `Refactor and improve this ${language} code:\n\n${code}`;
    return sendChatRequest([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
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
