import { executeCode, getLanguageFromExtension } from './codeExecutionService';
import type * as Monaco from 'monaco-editor';

// Marker severity map
const SEVERITY_ERROR = 8; // Monaco.MarkerSeverity.Error
const SEVERITY_WARNING = 4; // Monaco.MarkerSeverity.Warning
const SEVERITY_INFO = 2; // Monaco.MarkerSeverity.Info

export interface DiagnosticResult {
    markers: Monaco.editor.IMarkerData[];
    output: string;
    isError: boolean;
}

// Parse Python error output
const parsePythonErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = stderr.split('\n');

    // Regex for: File "main.py", line 2
    // Piston usually runs as 'main.py' or '<string>'
    const regex = /File "([^"]*)", line (\d+)/;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(regex);
        if (match) {
            const lineNumber = parseInt(match[2], 10);

            // Try to find column indicator (the ^ character in python tracebacks)
            let columnOffset = 1;
            let errorLength = 1000;

            // Look ahead for the error message and the ^ indicator
            let errorMessage = "Error occurred";
            for (let j = i + 1; j < lines.length; j++) {
                // If we see the pointer line
                if (lines[j].includes('^')) {
                    columnOffset = lines[j].indexOf('^') + 1;
                    // Count consecutive ^ to get the error length
                    const caretCount = (lines[j].match(/\^/g) || []).length;
                    if (caretCount > 1) {
                        errorLength = caretCount;
                    } else {
                        // Estimate token length based on the previous line's code at that position
                        const codeLine = lines[j - 1] || '';
                        const restOfCode = codeLine.substring(columnOffset - 1);
                        const tokenMatch = restOfCode.match(/^[a-zA-Z0-9_]+/);
                        if (tokenMatch) {
                            errorLength = tokenMatch[0].length;
                        } else {
                            errorLength = 1; // Default to 1 character if we can't estimate
                        }
                    }
                }

                // If we hit the actual Exception name
                if (lines[j].match(/^[a-zA-Z0-9_]+Error:/) || lines[j].match(/^[a-zA-Z0-9_]+Exception:/)) {
                    errorMessage = lines[j];
                    break;
                }
            }

            markers.push({
                startLineNumber: lineNumber,
                startColumn: columnOffset,
                endLineNumber: lineNumber,
                endColumn: columnOffset + errorLength,
                message: errorMessage,
                severity: SEVERITY_ERROR,
                source: 'Piston Runtime'
            });
        }
    }
    return markers;
};

// Parse JavaScript/Node error output
const parseJavascriptErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];

    // JS/TS errors from node often look like:
    // /path/to/script.js:4
    // console.log(foo);
    //             ^
    // ReferenceError: foo is not defined

    const lines = stderr.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // Check for file path with line number (e.g., script.js:5)
        const match = line.match(/:(\d+)(?::(\d+))?/);
        if (match && !line.trim().startsWith('at ')) { // Avoid matching stack trace lines immediately if they just say "at ...:line"
            const lineNumber = parseInt(match[1], 10);
            let columnOffset = match[2] ? parseInt(match[2], 10) : 1;
            let errorLength = 1000;
            let errorMessage = "Runtime Error";
            let foundErrorType = false;

            // Look ahead for the ^ indicator and the actual error message
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                if (lines[j].includes('^')) {
                    columnOffset = lines[j].indexOf('^') + 1;
                    // Count ^ if they are multiple
                    const caretCount = (lines[j].match(/\^/g) || []).length;
                    if (caretCount > 1) {
                        errorLength = caretCount;
                    } else if (j > 0) {
                        // Guess token length based on context code above it
                        const codeLine = lines[j - 1] || '';
                        const restOfCode = codeLine.substring(columnOffset - 1);
                        const tokenMatch = restOfCode.match(/^[a-zA-Z0-9_$]+/);
                        errorLength = tokenMatch ? tokenMatch[0].length : 1;
                    }
                }

                // Typical node error starts with ErrorType: message
                if (lines[j].match(/^[A-Z][a-zA-Z0-9_]*Error:/)) {
                    errorMessage = lines[j].trim();
                    foundErrorType = true;
                    break;
                }
            }

            // Fallback for simple stack traces if we didn't find the exact header block
            if (!foundErrorType && line.includes('Error')) {
                errorMessage = line.trim();
            }

            markers.push({
                startLineNumber: lineNumber,
                startColumn: columnOffset,
                endLineNumber: lineNumber,
                endColumn: columnOffset + errorLength < 1000 ? columnOffset + errorLength : 1000,
                message: errorMessage,
                severity: SEVERITY_ERROR,
                source: 'Piston Runtime'
            });

            // Advance past this error block
            if (foundErrorType) i += 3;
        }
        i++;
    }
    return markers;
};

// Generic parser for C/C++/Java/other compilers compilation and simple line number detection
const parseGenericErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = stderr.split('\n');
    
    console.log('Parsing generic errors from:', stderr);
    
    // Generic error patterns - handle multiple formats
    const patterns = [
        // Pattern 1: "filename:line: error: message"
        /"?([^"]+)"?:?(\d+):(?:\d+:)?\s*error:\s*(.+)/i,
        // Pattern 2: "filename:line:column: error: message"
        /"?([^"]+)"?:?(\d+):(\d+):\s*error:\s*(.+)/i,
        // Pattern 3: "error: message (at line: column)"
        /error:\s*(.+?)\s+\(at line:\s*(\d+)\s*(?:column:\s*(\d+))?\)/i,
        // Pattern 4: "filename:line: message"
        /"?([^"]+)"?:?(\d+):\s*(.+)/i,
        // Pattern 5: "[ERROR] filename:line - message"
        /\[ERROR\]\s*"?([^"]+)"?:?(\d+)\s*-\s*(.+)/i,
        // Pattern 6: Just "error: message" without file info
        /error:\s*(.+)/i,
        // Pattern 7: "at line" format
        /at line\s*(\d+)\s*(.*)/i,
        // Pattern 8: "line X:" format
        /line\s*(\d+):\s*(.+)/i
    ];
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        console.log('Processing generic line:', trimmedLine);
        
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = trimmedLine.match(pattern);
            if (match) {
                console.log('Matched generic pattern', i + 1, ':', match);
                
                let lineNumber = 1;
                let columnNumber = 1;
                let message = '';
                
                // Extract based on pattern
                if (match.length >= 4 && pattern.source.includes('error:')) {
                    // Patterns with filename, line, column, message
                    lineNumber = parseInt(match[2], 10);
                    columnNumber = match[3] && !isNaN(parseInt(match[3])) ? parseInt(match[3], 10) : 1;
                    message = match[match.length - 1].trim();
                } else if (match.length >= 3) {
                    // Patterns with filename, line, message
                    lineNumber = parseInt(match[2], 10);
                    message = match[match.length - 1].trim();
                } else if (match.length === 2) {
                    // Pattern with just line and message or just message
                    if (!isNaN(parseInt(match[1]))) {
                        lineNumber = parseInt(match[1], 10);
                        message = match[2] || 'Syntax error';
                    } else {
                        message = match[1].trim();
                    }
                } else if (match.length === 1) {
                    message = match[0].trim();
                }
                
                // Clean up the message
                message = message.replace(/^error:\s*/i, '').replace(/^\[ERROR\]\s*/i, '').trim();
                
                // Skip if line number is invalid
                if (isNaN(lineNumber) || lineNumber < 1) {
                    lineNumber = 1; // Default to line 1
                }
                
                console.log('Creating generic marker:', { lineNumber, columnNumber, message });
                
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: columnNumber,
                    endLineNumber: lineNumber,
                    endColumn: columnNumber + 50,
                    message: message,
                    severity: SEVERITY_ERROR,
                    source: 'Language Processor'
                });
                
                // Move to next line after finding a match
                break;
            }
        }
    }
    
    // If no specific markers found but there's stderr content, add a generic marker
    if (markers.length === 0 && stderr.trim()) {
        console.log('No specific generic markers found, creating fallback marker');
        
        // Try to extract line number from any pattern
        const lineMatch = stderr.match(/line\s*(\d+)/i);
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 1;
        
        // Get the first non-empty line as the error message
        const firstLine = stderr.split('\n').find(line => line.trim()) || 'Syntax error';
        const message = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
        
        markers.push({
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: Math.min(message.length + 10, 200),
            message: message,
            severity: SEVERITY_ERROR,
            source: 'Language Processor'
        });
    }
    
    console.log('Final generic markers:', markers);
    return markers;
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
        // Create a temporary model for syntax checking
        const uri = monaco.Uri.file(fileName);
        const model = monaco.editor.createModel(code, getMonacoLanguage(language), uri);
        
        // Force Monaco to validate the model by triggering validation
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get Monaco's built-in diagnostics for all owners
        const allDiagnostics = monaco.editor.getModelMarkers({ resource: uri });
        
        console.log('Monaco diagnostics found:', allDiagnostics.length, 'issues');
        console.log('Diagnostics:', allDiagnostics);
        
        // Convert Monaco diagnostics to our format
        for (const diagnostic of allDiagnostics) {
            markers.push({
                startLineNumber: diagnostic.startLineNumber,
                startColumn: diagnostic.startColumn,
                endLineNumber: diagnostic.endLineNumber,
                endColumn: diagnostic.endColumn,
                message: diagnostic.message,
                severity: diagnostic.severity,
                source: diagnostic.source || 'Monaco Syntax Checker'
            });
        }
        
        // Clean up the temporary model
        model.dispose();
        
        // If Monaco didn't find any issues, trust it for languages with built-in Monaco support
        if (markers.length === 0) {
            // TypeScript and JavaScript have full Monaco language support — trust the result
            if (language === 'typescript' || language === 'javascript') {
                console.log('Monaco found no issues for', language, '- trusting result');
                return { markers: [], output: '', isError: false };
            }
            console.log('Monaco found no issues, using custom validation');
            return await checkWithLanguageSpecificTools(code, fileName, language);
        }
        
        return {
            markers,
            output: markers.map(m => m.message).join('\n'),
            isError: markers.some(m => m.severity === SEVERITY_ERROR)
        };
        
    } catch (error) {
        console.error('Monaco diagnostics failed:', error);
        // Fallback to language-specific tools
        return await checkWithLanguageSpecificTools(code, fileName, language);
    }
};

// Get Monaco language identifier
const getMonacoLanguage = (language: string): string => {
    const languageMap: Record<string, string> = {
        'typescript': 'typescript',
        'javascript': 'javascript',
        'python': 'python',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'csharp': 'csharp',
        'php': 'php',
        'ruby': 'ruby',
        'go': 'go',
        'rust': 'rust',
        'sql': 'sql',
        'json': 'json',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'less': 'less',
        'xml': 'xml',
        'yaml': 'yaml',
        'markdown': 'markdown',
        'dockerfile': 'dockerfile',
        'shell': 'shell',
        'bash': 'shell',
        'plaintext': 'plaintext'
    };
    
    return languageMap[language] || 'plaintext';
};

// Language-specific syntax checking tools
const checkWithLanguageSpecificTools = async (
    code: string,
    fileName: string,
    language: string
): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    
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
    
    const openTags = (code.match(/<[^\/>][^>]*>/g) || []).length;
    const closeTags = (code.match(/<\/[^>]*>/g) || []).length;
    const selfClosingTags = (code.match(/<[^>]*\s*\/>/g) || []).length;
    const expectedCloseTags = openTags - selfClosingTags;
    
    if (expectedCloseTags !== closeTags) {
        markers.push({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1000,
            message: `HTML Syntax Error: Mismatched tags. Open: ${expectedCloseTags}, Close: ${closeTags}`,
            severity: SEVERITY_ERROR,
            source: 'HTML Parser'
        });
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

const checkJavaScriptTypeScriptSyntax = async (code: string, language: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = code.split('\n');
    const isTypeScript = language === 'typescript';
    
    // Track brace and parenthesis balance across lines
    let braceBalance = 0;
    let parenBalance = 0;
    let bracketBalance = 0;
    
    // Helper: strip TypeScript type annotations from a line for regex validation
    // This prevents type annotations from triggering false positives
    const stripTypeAnnotations = (line: string): string => {
        if (!isTypeScript) return line;
        // Remove generic type params like <T>, <T, U>, <T extends Foo>
        let stripped = line.replace(/<[^>]+>/g, '');
        // Remove return type annotations like ): number {
        stripped = stripped.replace(/\)\s*:\s*[\w\[\]|&<>,\s.]+\s*([{=])/g, ') $1');
        // Remove parameter type annotations like (n: number, m: string)
        stripped = stripped.replace(/(\w+)\s*:\s*[\w\[\]|&<>,\s.]+/g, '$1');
        // Remove type assertions like `as Type`
        stripped = stripped.replace(/\s+as\s+\w+/g, '');
        return stripped;
    };
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
            continue;
        }

        // Skip TypeScript-only declaration lines entirely
        if (isTypeScript) {
            if (trimmedLine.startsWith('interface ') ||
                trimmedLine.startsWith('type ') ||
                trimmedLine.startsWith('enum ') ||
                trimmedLine.startsWith('namespace ') ||
                trimmedLine.startsWith('declare ') ||
                trimmedLine.startsWith('abstract ') ||
                trimmedLine.startsWith('readonly ') ||
                trimmedLine.startsWith('implements ') ||
                trimmedLine.startsWith('as ') ||
                trimmedLine.startsWith('keyof ') ||
                trimmedLine.startsWith('typeof ') ||
                trimmedLine.match(/^\w+\s*\?\s*:/) || // optional property like  name?: string
                trimmedLine.match(/^\w+\s*:\s*[\w<\[|&]/) // type property like  name: string
            ) {
                // Still count braces for balance
                braceBalance += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
                parenBalance += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
                bracketBalance += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
                continue;
            }
        }
        
        // Update balances
        braceBalance += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        parenBalance += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
        bracketBalance += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        
        // Use stripped line for regex checks
        const checkLine = stripTypeAnnotations(trimmedLine);
        
        // Check for common JavaScript/TypeScript syntax errors
        
        // Missing semicolon check (basic)
        if (checkLine && 
            !checkLine.endsWith('{') && 
            !checkLine.endsWith('}') && 
            !checkLine.endsWith(';') && 
            !checkLine.endsWith(',') &&
            !checkLine.endsWith('(') &&
            !checkLine.startsWith('if ') &&
            !checkLine.startsWith('else ') &&
            !checkLine.startsWith('else{') &&
            !checkLine.startsWith('for ') &&
            !checkLine.startsWith('while ') &&
            !checkLine.startsWith('function ') &&
            !checkLine.startsWith('class ') &&
            !checkLine.startsWith('try ') &&
            !checkLine.startsWith('catch ') &&
            !checkLine.startsWith('finally ') &&
            !checkLine.includes('=>') &&
            !checkLine.includes('return ') &&
            !checkLine.includes('break') &&
            !checkLine.includes('continue') &&
            !checkLine.includes('throw ') &&
            !checkLine.includes('import ') &&
            !checkLine.includes('export ') &&
            !checkLine.includes('switch ') &&
            !checkLine.includes('case ') &&
            !checkLine.includes('default ') &&
            !checkLine.includes('default:') &&
            !(isTypeScript && (checkLine.startsWith('interface ') || checkLine.startsWith('type ') || checkLine.startsWith('enum ') || checkLine.startsWith('namespace ') || checkLine.startsWith('declare ') || checkLine.startsWith('abstract ')))) {
            
            markers.push({
                startLineNumber: lineNumber,
                startColumn: line.length + 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 2,
                message: 'Missing semicolon',
                severity: SEVERITY_WARNING,
                source: `${language.toUpperCase()} Syntax Checker`
            });
        }
        
        // Check for invalid function declarations — use stripped line
        if (checkLine.includes('function ') && !checkLine.match(/function\s+\w+\s*\(/) && !checkLine.match(/function\s*\(/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Invalid function declaration',
                severity: SEVERITY_ERROR,
                source: `${language.toUpperCase()} Syntax Checker`
            });
        }
        
        // Check for invalid variable declarations — use stripped line
        if (checkLine.match(/^(var|let|const)\s+\w+/) && !checkLine.match(/^(var|let|const)\s+\w+\s*[=;:]/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Variable declaration missing initialization or semicolon',
                severity: SEVERITY_WARNING,
                source: `${language.toUpperCase()} Syntax Checker`
            });
        }
    }
    
    // Check for unmatched braces, parentheses, and brackets
    if (braceBalance !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched braces: ${braceBalance > 0 ? braceBalance + ' missing closing braces' : Math.abs(braceBalance) + ' extra closing braces'}`,
            severity: SEVERITY_ERROR,
            source: `${language.toUpperCase()} Syntax Checker`
        });
    }
    
    if (parenBalance !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched parentheses: ${parenBalance > 0 ? parenBalance + ' missing closing parentheses' : Math.abs(parenBalance) + ' extra closing parentheses'}`,
            severity: SEVERITY_ERROR,
            source: `${language.toUpperCase()} Syntax Checker`
        });
    }
    
    if (bracketBalance !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched brackets: ${bracketBalance > 0 ? bracketBalance + ' missing closing brackets' : Math.abs(bracketBalance) + ' extra closing brackets'}`,
            severity: SEVERITY_ERROR,
            source: `${language.toUpperCase()} Syntax Checker`
        });
    }
    
    return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
};

const checkPythonSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = code.split('\n');
    let indentStack = [0]; // Stack to track indentation levels
    let inMultilineString = false;
    let multilineStringChar = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmedLine = line.trim();
        
        // Skip empty lines
        if (!trimmedLine) {
            continue;
        }
        
        // Check for multiline strings
        if (trimmedLine.startsWith("'''") || trimmedLine.startsWith('"""')) {
            if (!inMultilineString) {
                inMultilineString = true;
                multilineStringChar = trimmedLine.substring(0, 3);
            } else if (trimmedLine.endsWith(multilineStringChar)) {
                inMultilineString = false;
                multilineStringChar = '';
            }
            continue;
        }
        
        // Skip lines inside multiline strings
        if (inMultilineString) {
            continue;
        }
        
        // Skip comment lines
        if (trimmedLine.startsWith('#')) {
            continue;
        }
        
        // Calculate indentation level
        const indentLevel = line.length - line.replace(/^\s+/, '').length;
        
        // Check for indentation errors
        if (i > 0) {
            const prevLine = lines[i - 1];
            const prevTrimmedLine = prevLine.trim();
            
            // If previous line ends with a colon, next line should be indented
            if (prevTrimmedLine.endsWith(':') && !prevTrimmedLine.startsWith('#')) {
                if (indentLevel <= indentStack[indentStack.length - 1]) {
                    markers.push({
                        startLineNumber: lineNumber,
                        startColumn: 1,
                        endLineNumber: lineNumber,
                        endColumn: line.length + 1,
                        message: 'Expected indented block',
                        severity: SEVERITY_ERROR,
                        source: 'Python Syntax Checker'
                    });
                } else {
                    indentStack.push(indentLevel);
                }
            } else {
                // Check if indentation is consistent
                while (indentStack.length > 1 && indentLevel < indentStack[indentStack.length - 1]) {
                    indentStack.pop();
                }
                
                if (indentLevel > indentStack[indentStack.length - 1] && !prevTrimmedLine.endsWith(':')) {
                    markers.push({
                        startLineNumber: lineNumber,
                        startColumn: 1,
                        endLineNumber: lineNumber,
                        endColumn: line.length + 1,
                        message: 'Unexpected indentation',
                        severity: SEVERITY_ERROR,
                        source: 'Python Syntax Checker'
                    });
                }
            }
        }
        
        // Check for common Python syntax errors
        
        // Missing colon after if, for, while, def, class, try, except, with
        const colonKeywords = ['if', 'elif', 'for', 'while', 'def', 'class', 'try', 'except', 'with', 'finally'];
        for (const keyword of colonKeywords) {
            const regex = new RegExp(`\\b${keyword}\\s+[^:]+(?!:)\\s*$`);
            if (regex.test(trimmedLine) && !trimmedLine.endsWith(':')) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: line.length + 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 2,
                    message: `Missing colon after '${keyword}'`,
                    severity: SEVERITY_ERROR,
                    source: 'Python Syntax Checker'
                });
            }
        }
        
        // Check for invalid function definitions
        if (trimmedLine.startsWith('def ') && !trimmedLine.match(/def\s+\w+\s*\(/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Invalid function definition',
                severity: SEVERITY_ERROR,
                source: 'Python Syntax Checker'
            });
        }
        
        // Check for invalid class definitions
        if (trimmedLine.startsWith('class ') && !trimmedLine.match(/class\s+\w+\s*(\(.*\))?:/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Invalid class definition',
                severity: SEVERITY_ERROR,
                source: 'Python Syntax Checker'
            });
        }
        
        // Check for unmatched parentheses
        const openParens = (line.match(/\(/g) || []).length;
        const closeParens = (line.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Unmatched parentheses',
                severity: SEVERITY_ERROR,
                source: 'Python Syntax Checker'
            });
        }
        
        // Check for unmatched brackets
        const openBrackets = (line.match(/\[/g) || []).length;
        const closeBrackets = (line.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Unmatched brackets',
                severity: SEVERITY_ERROR,
                source: 'Python Syntax Checker'
            });
        }
    }
    
    return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
};

const checkJavaSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = code.split('\n');
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let inClass = false;
    let inMethod = false;
    let currentIndentation = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
            continue;
        }
        
        // Count braces, parentheses, and brackets
        braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
        bracketCount += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        
        // Check for class declaration
        if (trimmedLine.startsWith('class ')) {
            inClass = true;
            if (!trimmedLine.includes('{')) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: 'Expected \'{\' after class declaration',
                    severity: SEVERITY_ERROR,
                    source: 'Java Syntax Checker'
                });
            }
            if (!trimmedLine.match(/class\s+\w+/)) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: 'Invalid class declaration',
                    severity: SEVERITY_ERROR,
                    source: 'Java Syntax Checker'
                });
            }
        }
        
        // Check for method declaration
        if (trimmedLine.match(/^(public|private|protected|static)?\s*(\w+\s+)?\w+\s*\([^)]*\)\s*(throws\s+[^{]+)?/)) {
            inMethod = true;
            if (!trimmedLine.includes('{')) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: 'Expected \'{\' after method declaration',
                    severity: SEVERITY_ERROR,
                    source: 'Java Syntax Checker'
                });
            }
        }
        
        // Check for missing semicolons (basic check)
        if (trimmedLine && 
            !trimmedLine.endsWith('{') && 
            !trimmedLine.endsWith('}') && 
            !trimmedLine.endsWith(';') && 
            !trimmedLine.endsWith(',') &&
            !trimmedLine.startsWith('if ') &&
            !trimmedLine.startsWith('else ') &&
            !trimmedLine.startsWith('for ') &&
            !trimmedLine.startsWith('while ') &&
            !trimmedLine.startsWith('class ') &&
            !trimmedLine.startsWith('interface ') &&
            !trimmedLine.startsWith('enum ') &&
            !trimmedLine.startsWith('@') &&
            !trimmedLine.includes('return ') &&
            !trimmedLine.includes('break') &&
            !trimmedLine.includes('continue') &&
            !trimmedLine.includes('throw ') &&
            !trimmedLine.includes('try ') &&
            !trimmedLine.includes('catch ') &&
            !trimmedLine.includes('finally ') &&
            !trimmedLine.includes('switch ') &&
            !trimmedLine.includes('case ') &&
            !trimmedLine.includes('default ') &&
            !trimmedLine.includes('synchronized ') &&
            !trimmedLine.includes('import ') &&
            !trimmedLine.includes('package ')) {
            
            // Check if it's a variable declaration or statement that needs a semicolon
            if (trimmedLine.match(/^(\w+\s+)+\w+\s*=/) || 
                trimmedLine.match(/^(\w+\s+)+\w+\s*;/) ||
                trimmedLine.match(/^\w+\./) ||
                trimmedLine.includes('new ') ||
                trimmedLine.includes('System.')) {
                
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: line.length + 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 2,
                    message: 'Missing semicolon',
                    severity: SEVERITY_ERROR,
                    source: 'Java Syntax Checker'
                });
            }
        }
        
        // Check for invalid variable declarations
        if (trimmedLine.match(/^(int|double|float|long|short|byte|char|boolean|String)\s+\w+/) && 
            !trimmedLine.match(/^(int|double|float|long|short|byte|char|boolean|String)\s+\w+\s*[=;]/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Variable declaration missing initialization or semicolon',
                severity: SEVERITY_ERROR,
                source: 'Java Syntax Checker'
            });
        }
        
        // Check for invalid if/for/while statements
        ['if', 'for', 'while'].forEach(keyword => {
            if (trimmedLine.startsWith(keyword + ' ') && !trimmedLine.match(/\(.*\)/)) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: `Invalid ${keyword} statement - missing parentheses`,
                    severity: SEVERITY_ERROR,
                    source: 'Java Syntax Checker'
                });
            }
        });
        
        // Check for unmatched parentheses on this line
        const lineOpenParens = (line.match(/\(/g) || []).length;
        const lineCloseParens = (line.match(/\)/g) || []).length;
        if (lineOpenParens !== lineCloseParens) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Unmatched parentheses on this line',
                severity: SEVERITY_ERROR,
                source: 'Java Syntax Checker'
            });
        }
    }
    
    // Check for unmatched braces, parentheses, and brackets
    if (braceCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched braces: ${braceCount > 0 ? braceCount + ' missing closing braces' : Math.abs(braceCount) + ' extra closing braces'}`,
            severity: SEVERITY_ERROR,
            source: 'Java Syntax Checker'
        });
    }
    
    if (parenCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched parentheses: ${parenCount > 0 ? parenCount + ' missing closing parentheses' : Math.abs(parenCount) + ' extra closing parentheses'}`,
            severity: SEVERITY_ERROR,
            source: 'Java Syntax Checker'
        });
    }
    
    if (bracketCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched brackets: ${bracketCount > 0 ? bracketCount + ' missing closing brackets' : Math.abs(bracketCount) + ' extra closing brackets'}`,
            severity: SEVERITY_ERROR,
            source: 'Java Syntax Checker'
        });
    }
    
    return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
};

const checkCppSyntax = async (code: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = code.split('\n');
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let inFunction = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*') || trimmedLine.startsWith('#')) {
            continue;
        }
        
        // Count braces, parentheses, and brackets
        braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
        bracketCount += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        
        // Check for function definition
        if (trimmedLine.match(/^(\w+\s+)*\w+\s*\([^)]*\)\s*(const)?\s*(->\s*[^{]+)?/)) {
            inFunction = true;
            if (!trimmedLine.includes('{')) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: 'Expected \'{\' after function definition',
                    severity: SEVERITY_ERROR,
                    source: 'C++ Syntax Checker'
                });
            }
        }
        
        // Check for missing semicolons (basic check)
        if (trimmedLine && 
            !trimmedLine.endsWith('{') && 
            !trimmedLine.endsWith('}') && 
            !trimmedLine.endsWith(';') && 
            !trimmedLine.endsWith(',') &&
            !trimmedLine.startsWith('if ') &&
            !trimmedLine.startsWith('else ') &&
            !trimmedLine.startsWith('for ') &&
            !trimmedLine.startsWith('while ') &&
            !trimmedLine.startsWith('struct ') &&
            !trimmedLine.startsWith('class ') &&
            !trimmedLine.startsWith('enum ') &&
            !trimmedLine.startsWith('union ') &&
            !trimmedLine.startsWith('namespace ') &&
            !trimmedLine.startsWith('template ') &&
            !trimmedLine.startsWith('typedef ') &&
            !trimmedLine.includes('return ') &&
            !trimmedLine.includes('break') &&
            !trimmedLine.includes('continue') &&
            !trimmedLine.includes('goto ') &&
            !trimmedLine.includes('try ') &&
            !trimmedLine.includes('catch ') &&
            !trimmedLine.includes('switch ') &&
            !trimmedLine.includes('case ') &&
            !trimmedLine.includes('default ') &&
            !trimmedLine.includes('public:') &&
            !trimmedLine.includes('private:') &&
            !trimmedLine.includes('protected:')) {
            
            // Check if it's a variable declaration or statement that needs a semicolon
            if (trimmedLine.match(/^(\w+\s+)+\w+\s*=/) || 
                trimmedLine.match(/^(\w+\s+)+\w+\s*;/) ||
                trimmedLine.match(/^\w+\s*\(.*\)/) ||
                trimmedLine.includes('new ') ||
                trimmedLine.includes('delete ') ||
                trimmedLine.includes('cout') ||
                trimmedLine.includes('cerr') ||
                trimmedLine.includes('cin')) {
                
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: line.length + 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 2,
                    message: 'Missing semicolon',
                    severity: SEVERITY_ERROR,
                    source: 'C++ Syntax Checker'
                });
            }
        }
        
        // Check for invalid variable declarations
        if (trimmedLine.match(/^(int|double|float|long|short|byte|char|bool|string|auto|const|static)\s+\w+/) && 
            !trimmedLine.match(/^(int|double|float|long|short|byte|char|bool|string|auto|const|static)\s+\w+\s*[=;]/)) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Variable declaration missing initialization or semicolon',
                severity: SEVERITY_ERROR,
                source: 'C++ Syntax Checker'
            });
        }
        
        // Check for invalid if/for/while statements
        ['if', 'for', 'while'].forEach(keyword => {
            if (trimmedLine.startsWith(keyword + ' ') && !trimmedLine.match(/\(.*\)/)) {
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: line.length + 1,
                    message: `Invalid ${keyword} statement - missing parentheses`,
                    severity: SEVERITY_ERROR,
                    source: 'C++ Syntax Checker'
                });
            }
        });
        
        // Check for unmatched parentheses on this line
        const lineOpenParens = (line.match(/\(/g) || []).length;
        const lineCloseParens = (line.match(/\)/g) || []).length;
        if (lineOpenParens !== lineCloseParens) {
            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Unmatched parentheses on this line',
                severity: SEVERITY_ERROR,
                source: 'C++ Syntax Checker'
            });
        }
    }
    
    // Check for unmatched braces, parentheses, and brackets
    if (braceCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched braces: ${braceCount > 0 ? braceCount + ' missing closing braces' : Math.abs(braceCount) + ' extra closing braces'}`,
            severity: SEVERITY_ERROR,
            source: 'C++ Syntax Checker'
        });
    }
    
    if (parenCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched parentheses: ${parenCount > 0 ? parenCount + ' missing closing parentheses' : Math.abs(parenCount) + ' extra closing parentheses'}`,
            severity: SEVERITY_ERROR,
            source: 'C++ Syntax Checker'
        });
    }
    
    if (bracketCount !== 0) {
        markers.push({
            startLineNumber: lines.length,
            startColumn: 1,
            endLineNumber: lines.length,
            endColumn: 100,
            message: `Unmatched brackets: ${bracketCount > 0 ? bracketCount + ' missing closing brackets' : Math.abs(bracketCount) + ' extra closing brackets'}`,
            severity: SEVERITY_ERROR,
            source: 'C++ Syntax Checker'
        });
    }
    
    return { markers, output: '', isError: markers.some(m => m.severity === SEVERITY_ERROR) };
};

const checkBasicSyntax = async (code: string, language: string): Promise<DiagnosticResult> => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = code.split('\n');
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
    }
    
    if (braceCount !== 0) {
        markers.push({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 100,
            message: `Unmatched braces: ${braceCount > 0 ? 'missing closing braces' : 'extra closing braces'}`,
            severity: SEVERITY_ERROR,
            source: `${language} Parser`
        });
    }
    
    return { markers, output: '', isError: markers.length > 0 };
};

// Parse Java errors
const parseJavaErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = stderr.split('\n');
    
    // Debug: Log the actual stderr output
    console.log('Java stderr output:', stderr);
    console.log('Java stderr lines:', lines);
    
    // Java error patterns - handle multiple formats
    const patterns = [
        // Pattern 1: "filename.java:line: error: message"
        /"?([^"]+\.java)"?:?(\d+):(?:\d+:)?\s*error:\s*(.+)/i,
        // Pattern 2: "filename.java:line:column: error: message"
        /"?([^"]+\.java)"?:?(\d+):(\d+):\s*error:\s*(.+)/i,
        // Pattern 3: "error: message (at line: column)"
        /error:\s*(.+?)\s+\(at line:\s*(\d+)\s*(?:column:\s*(\d+))?\)/i,
        // Pattern 4: "filename.java:line: message"
        /"?([^"]+\.java)"?:?(\d+):\s*(.+)/i,
        // Pattern 5: "[ERROR] filename.java:line - message"
        /\[ERROR\]\s*"?([^"]+\.java)"?:?(\d+)\s*-\s*(.+)/i,
        // Pattern 6: Just "error: message" without file info
        /error:\s*(.+)/i,
        // Pattern 7: "Main.java:line" format
        /Main\.java:(\d+):\s*(.+)/i,
        // Pattern 8: "at line" format
        /at line\s*(\d+)\s*(.*)/i
    ];
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        console.log('Processing line:', trimmedLine);
        
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = trimmedLine.match(pattern);
            if (match) {
                console.log('Matched pattern', i + 1, ':', match);
                
                let lineNumber = 1;
                let columnNumber = 1;
                let message = '';
                
                // Extract based on pattern
                if (match.length >= 4 && pattern.source.includes('error:')) {
                    // Patterns with filename, line, column, message
                    lineNumber = parseInt(match[2], 10);
                    columnNumber = match[3] && !isNaN(parseInt(match[3])) ? parseInt(match[3], 10) : 1;
                    message = match[match.length - 1].trim();
                } else if (match.length >= 3) {
                    // Patterns with filename, line, message
                    lineNumber = parseInt(match[2], 10);
                    message = match[match.length - 1].trim();
                } else if (match.length === 2) {
                    // Pattern with just line and message or just message
                    if (!isNaN(parseInt(match[1]))) {
                        lineNumber = parseInt(match[1], 10);
                        message = match[2] || 'Syntax error';
                    } else {
                        message = match[1].trim();
                    }
                } else if (match.length === 1) {
                    message = match[0].trim();
                }
                
                // Clean up the message
                message = message.replace(/^error:\s*/i, '').replace(/^\[ERROR\]\s*/i, '').trim();
                
                // Skip if line number is invalid
                if (isNaN(lineNumber) || lineNumber < 1) {
                    lineNumber = 1; // Default to line 1
                }
                
                console.log('Creating marker:', { lineNumber, columnNumber, message });
                
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: columnNumber,
                    endLineNumber: lineNumber,
                    endColumn: columnNumber + 50, // Reasonable end column
                    message: message,
                    severity: SEVERITY_ERROR,
                    source: 'Java Compiler'
                });
                
                // Move to next line after finding a match
                break;
            }
        }
    }
    
    // If no specific markers found but there's stderr content, add a generic marker
    if (markers.length === 0 && stderr.trim()) {
        console.log('No specific markers found, creating generic marker');
        
        // Try to extract line number from any pattern
        const lineMatch = stderr.match(/line\s*(\d+)/i);
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 1;
        
        markers.push({
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1000,
            message: 'Compilation error: ' + stderr.split('\n')[0].trim(),
            severity: SEVERITY_ERROR,
            source: 'Java Compiler'
        });
    }
    
    console.log('Final Java markers:', markers);
    return markers;
};

// Parse C++ errors
const parseCppErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const lines = stderr.split('\n');
    
    // C++ error pattern: "filename:line:column: error: message"
    const regex = /"([^"]+)":(\d+):(\d+): error: (.+)/;
    
    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const lineNumber = parseInt(match[2], 10);
            const columnNumber = parseInt(match[3], 10);
            markers.push({
                startLineNumber: lineNumber,
                startColumn: columnNumber,
                endLineNumber: lineNumber,
                endColumn: columnNumber + 10,
                message: match[4].trim(),
                severity: SEVERITY_ERROR,
                source: 'C++ Compiler'
            });
        }
    }
    
    return markers;
};
