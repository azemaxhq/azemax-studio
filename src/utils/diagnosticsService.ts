import { getLanguageFromExtension } from './codeExecutionService';
import { getMonacoLanguage as getCentralMonacoLanguage } from './language';
import type * as Monaco from 'monaco-editor';

// Marker severity map
const SEVERITY_ERROR = 8; // Monaco.MarkerSeverity.Error
const SEVERITY_WARNING = 4; // Monaco.MarkerSeverity.Warning

export interface DiagnosticResult {
    markers: Monaco.editor.IMarkerData[];
    output: string;
    isError: boolean;
}

// Delegate to central language.ts for 30+ languages — keeps diagnostics in sync with editor
const getMonacoLanguage = (language: string): string => getCentralMonacoLanguage(language);

export const checkCodeErrors = async (
    code: string,
    fileName: string,
    monaco?: typeof Monaco
): Promise<DiagnosticResult> => {
    const language = getLanguageFromExtension(fileName);

    try {
        console.log('Checking syntax for language:', language, 'file:', fileName);
        console.log('Code length:', code.length, 'Code preview:', code.substring(0, 100));

        // For empty or whitespace-only code, consider it valid
        if (!code || !code.trim()) {
            console.log('Empty code, considering valid');
            return { markers: [], output: '', isError: false };
        }

        // Use Monaco Editor's built-in syntax validation when available (fast, local)
        if (monaco) {
            return await checkWithMonacoDiagnostics(code, fileName, language, monaco);
        }

        // Fallback to language-specific syntax checking
        return await checkWithLanguageSpecificTools(code, fileName, language);

    } catch (error) {
        console.error('Diagnostics failed:', error);
        return {
            markers: [{
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1000,
                message: 'Failed to run code diagnostics. ' + (error as Error).message,
                severity: SEVERITY_ERROR,
                source: 'System'
            }],
            output: (error as Error).message,
            isError: true
        };
    }
};

// Premium AI-powered deep code analysis via DeepSeek/Minimax (full context, high quality)
export const checkCodeErrorsWithAI = async (
    code: string,
    fileName: string,
    language?: string,
    monaco?: typeof Monaco
): Promise<DiagnosticResult> => {
    const lang = language || getLanguageFromExtension(fileName);

    // First, run fast local checks in parallel with AI for instant feedback
    const localPromise = checkCodeErrors(code, fileName, monaco);

    // AI deep analysis - uses Minimax as primary (via /api/ai/chat) for high-quality semantic checks
    const aiPromise = (async () => {
        try {
            const { sendChat } = await import('../core/ai/AIClient');
            const system = `You are a senior code reviewer and security auditor for ${lang}. Analyze the code for ALL issues: syntax errors, type errors, logic bugs, security vulnerabilities (XSS, injection, auth), performance traps, and style violations. Be precise and actionable.`;
            const user = `File: ${fileName} (${lang})\n\nCode:\n\`\`\`${lang}\n${code.slice(0, 8000)}\n\`\`\`\n\nTask: List every issue as JSON array: [{"line": number, "message": "clear description", "severity": "error"|"warning", "source": "AI"}]. If no issues, return []. Output ONLY JSON, no markdown.`;
            const raw = await sendChat(
                [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                { task: 'complex_code', temperature: 0.1, maxTokens: 2048 },
            );
            // Parse AI JSON response
            const match = raw.match(/\[[\s\S]*\]/);
            if (!match) return { markers: [] as Monaco.editor.IMarkerData[], isError: false };
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) return { markers: [] as Monaco.editor.IMarkerData[], isError: false };
            const markers: Monaco.editor.IMarkerData[] = parsed
                .filter((item: any) => typeof item.line === 'number' && typeof item.message === 'string')
                .slice(0, 20)
                .map((item: any) => ({
                    startLineNumber: Math.max(1, Math.floor(item.line)),
                    startColumn: 1,
                    endLineNumber: Math.max(1, Math.floor(item.line)),
                    endColumn: 1000,
                    message: String(item.message).slice(0, 300),
                    severity: item.severity === 'warning' ? SEVERITY_WARNING : SEVERITY_ERROR,
                    source: 'AI DeepCheck',
                }));
            return { markers, isError: markers.some(m => m.severity === SEVERITY_ERROR) };
        } catch (e) {
            console.warn('[AI Diagnostics] AI check failed, using local only:', (e as Error).message);
            return { markers: [] as Monaco.editor.IMarkerData[], isError: false };
        }
    })();

    const [localResult, aiResult] = await Promise.all([localPromise, aiPromise]);

    // Merge markers: local + AI (deduplicate by line+message)
    const seen = new Set<string>();
    const merged: Monaco.editor.IMarkerData[] = [];
    for (const m of [...localResult.markers, ...aiResult.markers]) {
        const key = `${m.startLineNumber}:${m.message}`;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(m);
        }
    }

    return {
        markers: merged,
        output: localResult.output,
        isError: merged.some(m => m.severity === SEVERITY_ERROR),
    };
};

// Check syntax using Monaco Editor's built-in diagnostics — waits for async TS/JS workers
const checkWithMonacoDiagnostics = async (
    code: string,
    fileName: string,
    language: string,
    monaco: typeof Monaco
): Promise<DiagnosticResult> => {
    const monacoLanguage = getMonacoLanguage(language);
    const uri = monaco.Uri.parse(`file:///${fileName.replace(/[^a-zA-Z0-9._\-\/]/g, '_')}`);
    // Reuse existing model if uri exists to avoid leaks, else create
    const existing = monaco.editor.getModel(uri);
    const model = existing ?? monaco.editor.createModel(code, monacoLanguage, uri);
    const created = !existing;
    if (existing) {
        // Ensure model language/content in sync
        if (existing.getLanguageId() !== monacoLanguage) monaco.editor.setModelLanguage(existing, monacoLanguage);
        if (existing.getValue() !== code) existing.setValue(code);
    }
    try {
        // TS/JS workers validate asynchronously — poll briefly then fallback to language-specific checks if still empty
        const maxWaitMs = monacoLanguage === 'typescript' || monacoLanguage === 'javascript' ? 500 : 250;
        const stepMs = 60;
        let monacoMarkers: Monaco.editor.IMarker[] = [];
        const start = Date.now();
        // Initial yield to let worker schedule
        await new Promise(r => setTimeout(r, stepMs));
        while (Date.now() - start < maxWaitMs) {
            monacoMarkers = monaco.editor.getModelMarkers({ resource: uri });
            if (monacoMarkers.length > 0) break;
            // Early exit if language has no worker (python etc returns 0 forever) — wait only 2 steps
            if (monacoLanguage !== 'typescript' && monacoLanguage !== 'javascript' && monacoLanguage !== 'json' && monacoLanguage !== 'css') {
                if (Date.now() - start > 120) break;
            }
            await new Promise(r => setTimeout(r, stepMs));
        }
        if (monacoMarkers.length > 0) {
            const markers: Monaco.editor.IMarkerData[] = monacoMarkers.map(m => ({
                startLineNumber: m.startLineNumber,
                startColumn: m.startColumn,
                endLineNumber: m.endLineNumber,
                endColumn: m.endColumn,
                message: m.message,
                severity: m.severity,
                source: m.source || 'Monaco'
            }));
            return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
        }
        // No worker markers — gracefully fall through to regex-based language checks for richer errors
        const fallback = await checkWithLanguageSpecificTools(code, fileName, language);
        return fallback;
    } catch (error) {
        console.error('Monaco diagnostics failed:', error);
        return {
            markers: [{
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1000,
                message: 'Monaco diagnostics failed: ' + (error as Error).message,
                severity: SEVERITY_ERROR,
                source: 'Monaco'
            }],
            output: (error as Error).message,
            isError: true
        };
    } finally {
        if (created && !model.isDisposed()) model.dispose();
        // If we reused, keep model alive — caller may expect persistence; but we created temp uri so dispose is fine
        // For reused case, do not dispose shared model.
    }
};

// Language-specific syntax checking tools
const checkWithLanguageSpecificTools = async (
    code: string,
    _fileName: string,
    language: string
): Promise<DiagnosticResult> => {
    
    try {
        switch (language) {
            case 'json':
                return await checkJsonSyntax(code);
            case 'css':
                return await checkCssSyntax(code);
            case 'html':
                return await checkHtmlSyntax(code);
            case 'javascript':
            case 'typescript':
                return await checkJavaScriptTypeScriptSyntax(code, language);
            case 'python':
                return await checkPythonSyntax(code);
            case 'java':
                return await checkJavaSyntax(code);
            case 'cpp':
            case 'c':
                return await checkCppSyntax(code);
            default:
                // For unsupported languages, try basic validation
                return await checkBasicSyntax(code, language);
        }
    } catch (error) {
        console.error(`Language-specific check failed for ${language}:`, error);
        return {
            markers: [{
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1000,
                message: `Syntax check failed for ${language}: ${(error as Error).message}`,
                severity: SEVERITY_ERROR,
                source: 'Language Checker'
            }],
            output: (error as Error).message,
            isError: true
        };
    }
};

// Language-specific syntax checking functions
const checkJsonSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    try {
        JSON.parse(code);
        return { markers: [], output: '', isError: false };
    } catch (error) {
        const errorMessage = (error as Error).message;
        const lineMatch = errorMessage.match(/line (\d+)/i);
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 1;
        
        markers.push({
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1000,
            message: `JSON Syntax Error: ${errorMessage}`,
            severity: SEVERITY_ERROR,
            source: 'JSON Parser'
        });
        
        return { markers, output: errorMessage, isError: true };
    }
};

const checkCssSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    
    if (openBraces !== closeBraces) {
        markers.push({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1000,
            message: `CSS Syntax Error: Mismatched braces. Open: ${openBraces}, Close: ${closeBraces}`,
            severity: SEVERITY_ERROR,
            source: 'CSS Parser'
        });
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkHtmlSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Basic HTML tag matching
    const openTags = (code.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (code.match(/<\/[^>]*>/g) || []).length;
    const selfClosingTags = (code.match(/<[^>]*\/>/g) || []).length;
    
    if (openTags - selfClosingTags !== closeTags) {
        markers.push({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1000,
            message: `HTML Syntax Error: Mismatched tags. Open: ${openTags - selfClosingTags}, Close: ${closeTags}`,
            severity: SEVERITY_ERROR,
            source: 'HTML Parser'
        });
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkJavaScriptTypeScriptSyntax = async (code: string, language: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Basic syntax checks for JS/TS
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Check for unclosed brackets
        const openBrackets = (line.match(/\(/g) || []).length;
        const closeBrackets = (line.match(/\)/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: `${language.toUpperCase()} Syntax Error: Unclosed parentheses`,
                severity: SEVERITY_ERROR,
                source: `${language} Parser`
            });
        }
        
        // Check for unclosed braces
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        
        if (openBraces !== closeBraces) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: `${language.toUpperCase()} Syntax Error: Unclosed braces`,
                severity: SEVERITY_ERROR,
                source: `${language} Parser`
            });
        }
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkPythonSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Basic Python syntax checks
    const lines = code.split('\n');
    const indentStack = [0];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith('#')) {
            continue;
        }
        
        // Check indentation
        const currentIndentation = line.match(/^ */)?.[0]?.length || 0;
        const lastIndentation = indentStack[indentStack.length - 1];
        
        if (currentIndentation > lastIndentation) {
            // New indentation level
            indentStack.push(currentIndentation);
        } else if (currentIndentation < lastIndentation) {
            // Dedentation - pop levels
            while (indentStack.length > 1 && indentStack[indentStack.length - 1] > currentIndentation) {
                indentStack.pop();
            }
            
            if (indentStack[indentStack.length - 1] !== currentIndentation) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: currentIndentation + 1,
                    message: 'Python Syntax Error: Inconsistent indentation',
                    severity: SEVERITY_ERROR,
                    source: 'Python Parser'
                });
            }
        }
        
        // Check for unclosed brackets
        const openBrackets = (line.match(/\(/g) || []).length;
        const closeBrackets = (line.match(/\)/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Python Syntax Error: Unclosed parentheses',
                severity: SEVERITY_ERROR,
                source: 'Python Parser'
            });
        }
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkJavaSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Basic Java syntax checks
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Check for unclosed brackets
        const openBrackets = (line.match(/\(/g) || []).length;
        const closeBrackets = (line.match(/\)/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Java Syntax Error: Unclosed parentheses',
                severity: SEVERITY_ERROR,
                source: 'Java Parser'
            });
        }
        
        // Check for unclosed braces
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        
        if (openBraces !== closeBraces) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Java Syntax Error: Unclosed braces',
                severity: SEVERITY_ERROR,
                source: 'Java Parser'
            });
        }
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkCppSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Basic C++ syntax checks
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Check for unclosed brackets
        const openBrackets = (line.match(/\(/g) || []).length;
        const closeBrackets = (line.match(/\)/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'C++ Syntax Error: Unclosed parentheses',
                severity: SEVERITY_ERROR,
                source: 'C++ Parser'
            });
        }
        
        // Check for unclosed braces
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        
        if (openBraces !== closeBraces) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'C++ Syntax Error: Unclosed braces',
                severity: SEVERITY_ERROR,
                source: 'C++ Parser'
            });
        }
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkBasicSyntax = async (code: string, language: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    // Very basic syntax validation for unsupported languages
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Check for common syntax issues
        const openBrackets = (line.match(/\(/g) || []).length;
        const closeBrackets = (line.match(/\)/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: `${language} Syntax Error: Unclosed parentheses`,
                severity: SEVERITY_WARNING,
                source: 'Basic Parser'
            });
        }
    }
    
    return { markers, output: '', isError: false };
};
