import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface LogEntry {
    id: string;
    type: 'stdout' | 'stderr' | 'system';
    content: string;
    timestamp: number;
}

export interface TerminalSession {
    id: string;
    title: string;
    logs: LogEntry[];
    stdin: string;
    isProcessing?: boolean;
}

interface TerminalContextType {
    terminals: TerminalSession[];
    activeTerminalId: string | null;
    createTerminal: () => void;
    removeTerminal: (id: string) => void;
    setActiveTerminalId: (id: string) => void;
    runCode: (code: string, language: string, filename?: string) => Promise<void>;
    clearTerminal: (id: string) => void;
    appendLog: (id: string, type: 'stdout' | 'stderr' | 'system', content: string) => void;
    setTerminalStdin: (id: string, value: string) => void;
    isRunning: boolean;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

const TERMINALS_STORAGE_KEY = 'deepcontext-terminals-v1';

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [terminals, setTerminals] = useState<TerminalSession[]>(() => {
        try {
            const saved = localStorage.getItem(TERMINALS_STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load terminals from storage', e);
        }
        return [{
            id: '1',
            title: 'Output',
            logs: [{ id: 'init', type: 'system', content: 'Ready to run code.', timestamp: Date.now() }],
            stdin: ''
        }];
    });
    const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => {
        const saved = localStorage.getItem('deepcontext-active-terminal-id');
        return saved || '1';
    });
    const [isRunning, setIsRunning] = useState(false);

    // Persist terminals
    useEffect(() => {
        try {
            localStorage.setItem(TERMINALS_STORAGE_KEY, JSON.stringify(terminals));
        } catch (e) {
            console.error('Failed to save terminals to storage', e);
        }
    }, [terminals]);

    // Persist active terminal ID
    useEffect(() => {
        if (activeTerminalId) {
            localStorage.setItem('deepcontext-active-terminal-id', activeTerminalId);
        }
    }, [activeTerminalId]);

    // Ensure active ID is valid on mount/update
    useEffect(() => {
        if (terminals.length > 0) {
            const exists = terminals.find(t => t.id === activeTerminalId);
            if (!exists) {
                // Determine best fallback (last used or first)
                setActiveTerminalId(terminals[terminals.length - 1].id);
            }
        }
    }, [terminals]);

    const createTerminal = useCallback(() => {
        const id = Math.random().toString(36).substring(2, 9);
        setTerminals(prev => [...prev, {
            id,
            title: `Output ${prev.length + 1}`,
            logs: [{ id: 'init', type: 'system', content: 'Ready to run code.', timestamp: Date.now() }],
            stdin: ''
        }]);
        setActiveTerminalId(id);
    }, []);

    const removeTerminal = useCallback((id: string) => {
        setTerminals(prev => {
            const newTerminals = prev.filter(t => t.id !== id);
            if (activeTerminalId === id && newTerminals.length > 0) {
                setActiveTerminalId(newTerminals[newTerminals.length - 1].id);
            } else if (newTerminals.length === 0) {
                setActiveTerminalId(null);
            }
            return newTerminals;
        });
    }, [activeTerminalId]);

    const appendLog = useCallback((id: string, type: 'stdout' | 'stderr' | 'system', content: string) => {
        const entry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            type,
            content,
            timestamp: Date.now()
        };

        setTerminals(prev => prev.map(t =>
            t.id === id ? { ...t, logs: [...t.logs, entry] } : t
        ));
    }, []);

    const clearTerminal = useCallback((id: string) => {
        setTerminals(prev => prev.map(t =>
            t.id === id ? { ...t, logs: [] } : t
        ));
    }, []);

    const setTerminalStdin = useCallback((id: string, value: string) => {
        setTerminals(prev => prev.map(t =>
            t.id === id ? { ...t, stdin: value } : t
        ));
    }, []);

    const runCode = useCallback(async (code: string, language: string, filename?: string) => {
        let termId = activeTerminalId;

        // Auto-create terminal if none exists
        if (!termId) {
            termId = Math.random().toString(36).substring(2, 9);
            const newTerm: TerminalSession = {
                id: termId,
                title: 'Output',
                logs: [],
                stdin: ''
            };

            setTerminals(prev => {
                // Check if it already exists to be safe (though random ID makes it unlikely)
                if (prev.find(t => t.id === termId)) return prev;
                // If we are auto-creating, maybe name it Output N+1? 
                // We'll just stick to "Output" or handle naming in the prev map if we really cared, 
                // but "Output" is fine for a single auto-created one.
                return [...prev, { ...newTerm, title: `Output ${prev.length + 1}` }];
            });
            setActiveTerminalId(termId);
        }

        setIsRunning(true);
        // Force BottomPanel to show terminal
        window.dispatchEvent(new Event('open-terminal-tab'));

        // Note: 'termId' is now guaranteed to be a string ID. 
        // However, 'terminals' (closure) might not have it yet. 
        // We handle this by using defaults if 'term' lookup fails.

        const term = terminals.find(t => t.id === termId);
        const stdin = term?.stdin || '';

        // Guard language
        const safeLang = language || 'plaintext';
        const displayFile = filename ? ` ${filename}` : '';

        // Add start marker
        appendLog(termId, 'system', `--- Running${displayFile} (${safeLang}) ---`);

        // Map language names to Piston properties
        // Map language names to Piston properties
        let runLang = safeLang.toLowerCase();

        // Piston expects 'javascript', not 'node' for the language name usually
        if (runLang === 'js' || runLang === 'node') runLang = 'javascript';
        if (runLang === 'ts' || runLang === 'tsx') runLang = 'typescript';
        if (runLang === 'py') runLang = 'python';
        if (runLang === 'c++') runLang = 'cpp';
        if (runLang === 'sh') runLang = 'bash';
        if (runLang === 'rs') runLang = 'rust';
        // Go, Java, C, Rust usually match match their name or need simple lowercase

        try {
            const response = await fetch('http://127.0.0.1:3001/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: runLang,
                    version: '*',
                    files: [{ content: code }],
                    stdin: stdin
                })
            });

            const data = await response.json();
            console.log('[TerminalContext] Raw API Response:', data);

            if (data.run) {
                // Handle stdout
                if (data.run.stdout) {
                    appendLog(termId, 'stdout', data.run.stdout);
                }
                // Handle stderr
                if (data.run.stderr) {
                    appendLog(termId, 'stderr', data.run.stderr);
                }
                // Handle empty output
                if (!data.run.stdout && !data.run.stderr) {
                    appendLog(termId, 'system', 'Program finished with no output.');
                }

                // Show exit code if non-zero
                if (data.run.code !== 0 && data.run.code !== null && data.run.code !== undefined) {
                    appendLog(termId, 'system', `Process exited with code ${data.run.code}`);
                }

            } else if (data.message) {
                appendLog(termId, 'stderr', `Error: ${data.message}`);
            } else {
                appendLog(termId, 'stderr', 'Unknown error occurred or invalid response.');
            }

        } catch (error: any) {
            appendLog(termId, 'stderr', `Execution failed: ${error.message}`);
        } finally {
            setIsRunning(false);
            appendLog(termId, 'system', '--- Exited ---');
        }

    }, [activeTerminalId, appendLog, terminals]);

    return (
        <TerminalContext.Provider value={{
            terminals,
            activeTerminalId,
            createTerminal,
            removeTerminal,
            setActiveTerminalId,
            runCode,
            clearTerminal,
            appendLog,
            setTerminalStdin,
            isRunning
        }}>
            {children}
        </TerminalContext.Provider>
    );
};

export const useTerminal = () => {
    const context = useContext(TerminalContext);
    if (context === undefined) {
        throw new Error('useTerminal must be used within a TerminalProvider');
    }
    return context;
};
