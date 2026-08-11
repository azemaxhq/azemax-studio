import { getLanguageFromExtension } from './codeExecutionService';
import type * as Monaco from 'monaco-editor';

// Marker severity map
const SEVERITY_ERROR = 8; // Monaco.MarkerSeverity.Error
const SEVERITY_WARNING = 4; // Monaco.MarkerSeverity.Warning

export interface DiagnosticResult {
    markers: Monaco.editor.IMarkerData[];
    output: string;
    isError: boolean;
}

// Language mapping for syntax checking
const getMonacoLanguage = (language: string): string => {
    const languageMap: Record<string, string> = {
        'typescript': 'typescript',
        'javascript': 'javascript',
        'python': 'python',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'go': 'go',
        'rust': 'rust',
        'php': 'php',
        'ruby': 'ruby',
        'swift': 'swift',
        'kotlin': 'kotlin',
        'csharp': 'csharp',
        'json': 'json',
        'css': 'css',
        'scss': 'scss',
        'html': 'html',
        'xml': 'xml',
        'yaml': 'yaml',
        'sql': 'sql',
        'bash': 'shell',
        'plaintext': 'plaintext'
    };
    
    return languageMap[language] || 'plaintext';
};

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

        // Use Monaco Editor's built-in syntax validation when available
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

// Check syntax using Monaco Editor's built-in diagnostics
const checkWithMonacoDiagnostics = async (
    code: string,
    fileName: string,
    language: string,
    monaco: typeof Monaco
): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
    try {
        const monacoLanguage = getMonacoLanguage(language);
        
        // Create a temporary model for syntax checking
        const model = monaco.editor.createModel(code, monacoLanguage, monaco.Uri.parse(`file:///${fileName}`));
        
        // Wait for Monaco to complete its language services initialization
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get any syntax markers from Monaco
        const monacoMarkers = monaco.editor.getModelMarkers({ resource: model.uri });
        
        // Convert Monaco markers to our format
        for (const marker of monacoMarkers) {
            markers.push({
                startLineNumber: marker.startLineNumber,
                startColumn: marker.startColumn,
                endLineNumber: marker.endLineNumber,
                endColumn: marker.endColumn,
                message: marker.message,
                severity: marker.severity,
                source: marker.source || 'Monaco'
            });
        }
        
        // Clean up the temporary model
        model.dispose();
        
        return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
        
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
    let indentStack = [0];
    
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
