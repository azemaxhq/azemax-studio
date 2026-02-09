import { executeCode, getLanguageFromExtension } from './codeExecutionService';
import type * as Monaco from 'monaco-editor';

// Marker severity map
const SEVERITY_ERROR = 8; // Monaco.MarkerSeverity.Error

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
            // lines[i + 1] used to be assigned to message but was unused

            // Try to find the actual error message in subsequent lines (e.g., "SyntaxError: invalid syntax")
            let errorMessage = "Error occurred";
            for (let j = i; j < lines.length; j++) {
                if (lines[j].includes('Error:')) {
                    errorMessage = lines[j];
                    break;
                }
            }

            markers.push({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: 1000,
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
    // /piston/jobs/.../main.js:1
    // or SyntaxError: ...

    const lines = stderr.split('\n');
    const regex = /:(\d+)(?::(\d+))?/; // Matches :line:column or :line

    for (const line of lines) {
        if (line.includes('Error') || line.includes('Exception')) {
            // Look for line number reference in stack trace
            // Node stack trace format: /path/to/file.js:10
            const match = line.match(regex) || stderr.match(/:(\d+)/);
            if (match) {
                const lineNumber = parseInt(match[1], 10);
                markers.push({
                    startLineNumber: lineNumber,
                    startColumn: 1,
                    endLineNumber: lineNumber,
                    endColumn: 1000,
                    message: line,
                    severity: SEVERITY_ERROR,
                    source: 'Piston Runtime'
                });
            }
        }
    }
    return markers;
};

// Generic parser for simple line number detection
const parseGenericErrors = (stderr: string): Monaco.editor.IMarkerData[] => {
    const markers: Monaco.editor.IMarkerData[] = [];
    const regex = /line (\d+)/i;
    const match = stderr.match(regex);

    if (match) {
        const lineNumber = parseInt(match[1], 10);
        markers.push({
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1000,
            message: stderr,
            severity: SEVERITY_ERROR,
            source: 'Piston Runtime'
        });
    } else if (stderr.trim()) {
        // If stderr exists but no line number found, mark line 1
        markers.push({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1000,
            message: stderr,
            severity: SEVERITY_ERROR,
            source: 'Piston Execution Error'
        });
    }
    return markers;
};

export const checkCodeErrors = async (
    code: string,
    fileName: string
): Promise<DiagnosticResult> => {
    const language = getLanguageFromExtension(fileName);

    try {
        const result = await executeCode(code, language);

        let markers: Monaco.editor.IMarkerData[] = [];
        let output = result.run.output;
        let isError = false;

        // Check for compile error (e.g. C++, Java)
        if (result.compile && result.compile.code !== 0) {
            isError = true;
            output = result.compile.stderr;
            // Add parser for C++/Java here if needed, or use generic
            markers = parseGenericErrors(output);
        }
        // Check for runtime error
        else if (result.run.code !== 0) {
            isError = true;
            output = result.run.stderr || result.run.output;

            if (language === 'python') {
                markers = parsePythonErrors(output);
            } else if (language === 'javascript' || language === 'typescript') {
                markers = parseJavascriptErrors(output);
            } else {
                markers = parseGenericErrors(output);
            }
        }

        return { markers, output, isError };

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
