// Local execution API endpoint (replaces Piston)
// Handled by server/index.cjs local execution
const PISTON_API_URL = 'http://localhost:3001/api';

export interface ExecutionResult {
    language: string;
    version: string;
    run: {
        stdout: string;
        stderr: string;
        code: number;
        signal: string | null;
        output: string;
    };
    compile?: {
        stdout: string;
        stderr: string;
        code: number;
        signal: string | null;
        output: string;
    };
}

export interface Language {
    language: string;
    version: string;
    aliases: string[];
}

// Map file extensions to Piston language identifiers
const extensionToLanguage: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'python': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'r': 'r',
    'lua': 'lua',
    'perl': 'perl',
    'bash': 'bash',
    'sh': 'bash',
};

export const getLanguageFromExtension = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return extensionToLanguage[ext] || 'javascript';
};

// Get available runtimes
export const getRuntimes = async (): Promise<Language[]> => {
    try {
        const response = await fetch(`${PISTON_API_URL}/runtimes`);
        if (!response.ok) {
            throw new Error(`Failed to fetch runtimes: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching runtimes:', error);
        return [];
    }
};

// Execute code
export const executeCode = async (
    code: string,
    language: string,
    stdin: string = ''
): Promise<ExecutionResult> => {
    try {
        // First get available runtimes to find the correct version
        const runtimes = await getRuntimes();
        const runtime = runtimes.find(r =>
            r.language === language ||
            r.aliases.includes(language)
        );

        if (!runtime) {
            throw new Error(`Language "${language}" not supported. Available languages: ${runtimes.map(r => r.language).join(', ')}`);
        }

        const response = await fetch(`${PISTON_API_URL}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                language: runtime.language,
                version: runtime.version,
                files: [
                    {
                        name: `main.${language === 'python' ? 'py' : language === 'javascript' ? 'js' : language}`,
                        content: code,
                    },
                ],
                stdin,
            }),
        });

        if (!response.ok) {
            throw new Error(`Execution failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error executing code:', error);
        throw error;
    }
};
