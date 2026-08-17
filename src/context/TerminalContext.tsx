/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';
import { getSettings } from '../settings/settingsStore';

export interface ExecutionData {
    executionTime: number;
    stdout: string;
    stderr: string;
    exitCode: number;
    timestamp: number;
}

export interface TerminalSession {
    id: string;
    title: string;
    cwd?: string;
    lastExecution?: ExecutionData;
    directoryHistory?: string[];
    historyIndex?: number;
}

interface TerminalContextType {
    terminals: TerminalSession[];
    activeTerminalId: string | null;
    createTerminal: (cwd?: string) => void;
    removeTerminal: (id: string) => void;
    setActiveTerminalId: (id: string) => void;

    // Commands dispatched to ShellTerminal
    runCode: (code: string, language: string, filename?: string, cwd?: string, stdinInput?: string) => Promise<void>;
    clearTerminal: (id: string) => void;
    stopProcess: (id: string) => void;
    writeToTerminal: (id: string, text: string) => void;

    // UI State
    isRunning: boolean;
    setIsRunning: (running: boolean) => void; // Allow ShellTerminal to update this

    // Execution data for performance analysis
    lastExecutionData: ExecutionData | null;
    setLastExecutionData: (data: ExecutionData | null) => void;

    // Directory management
    updateTerminalCwd: (terminalId: string, newCwd: string) => void;
    syncTerminalToFileExplorer: (terminalId: string) => void;

    // Event bus for cross-component signaling
    terminalEventEmitter: EventTarget;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);
const TERMINALS_STORAGE_KEY = 'deepcontext-terminals-v3'; // Bumped version to clear old state

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = memo(({ children }) => {
    const [terminals, setTerminals] = useState<TerminalSession[]>(() => {
        try {
            const saved = localStorage.getItem(TERMINALS_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to load terminals from storage', e);
        }
        return [{ id: '1', title: 'Terminal 1' }];
    });

    const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => {
        return localStorage.getItem('deepcontext-active-terminal-id') || '1';
    });

    const [isRunning, setIsRunning] = useState(false);
    const [lastExecutionData, setLastExecutionData] = useState<ExecutionData | null>(null);

    // Event bus to send commands directly to ShellTerminal instances
    const [terminalEventEmitter] = useState(() => new EventTarget());

    // Terminal instances whose ShellTerminal listener is currently registered (mounted)
    const mountedTerminalsRef = useRef<Set<string>>(new Set());

    // Buffer the latest run until its target terminal is mounted & listening.
    // This eliminates the race where runData is dispatched before the target
    // ShellTerminal has registered its listener (run silently lost, no output).
    const pendingRunRef = useRef<{
        termId: string;
        payload: { id: string; language: string; code: string; fileName?: string; stdinInput?: string; cwd?: string };
    } | null>(null);

    const deliverPendingRun = useCallback(() => {
        const pending = pendingRunRef.current;
        if (!pending) return;
        pendingRunRef.current = null;
        terminalEventEmitter.dispatchEvent(new CustomEvent('runData', { detail: pending.payload }));
    }, [terminalEventEmitter]);

    useEffect(() => {
        const onTerminalReady = (e: Event) => {
            const id = (e as CustomEvent).detail?.id;
            if (!id) return;
            mountedTerminalsRef.current.add(id);
            if (pendingRunRef.current?.termId === id) {
                deliverPendingRun();
            }
        };
        const onTerminalUnmounted = (e: Event) => {
            const id = (e as CustomEvent).detail?.id;
            if (id) mountedTerminalsRef.current.delete(id);
        };
        terminalEventEmitter.addEventListener('terminalReady', onTerminalReady);
        terminalEventEmitter.addEventListener('terminalUnmounted', onTerminalUnmounted);
        return () => {
            terminalEventEmitter.removeEventListener('terminalReady', onTerminalReady);
            terminalEventEmitter.removeEventListener('terminalUnmounted', onTerminalUnmounted);
        };
    }, [deliverPendingRun, terminalEventEmitter]);

    useEffect(() => {
        try {
            debouncedLocalStorageSet(TERMINALS_STORAGE_KEY, JSON.stringify(terminals));
        } catch {
            // Ignore localStorage errors
        }
    }, [terminals]);

    useEffect(() => {
        if (activeTerminalId) {
            localStorage.setItem('deepcontext-active-terminal-id', activeTerminalId);
        }
    }, [activeTerminalId]);

    // Ensure there's always an active terminal focused if possible
    useEffect(() => {
        if (terminals.length > 0 && (!activeTerminalId || !terminals.find(t => t.id === activeTerminalId))) {
            const newActiveId = terminals[terminals.length - 1].id;
            setActiveTerminalId(newActiveId);
        }
    }, [terminals, activeTerminalId]);

    const createTerminal = useCallback((cwd?: string) => {
        const id = Math.random().toString(36).substring(2, 9);
        const initialCwd = cwd || 'root';
        setTerminals(prev => [...prev, { 
            id, 
            title: `Terminal ${prev.length + 1}`, 
            cwd: initialCwd,
            directoryHistory: [initialCwd],
            historyIndex: 0
        }]);
        setActiveTerminalId(id);
    }, []);

    const removeTerminal = useCallback((id: string) => {
        // Dispatch kill event so the specific ShellTerminal can clean up its connection
        terminalEventEmitter.dispatchEvent(new CustomEvent('kill', { detail: { id } }));

        setTerminals(prev => {
            const newTerminals = prev.filter(t => t.id !== id);
            if (activeTerminalId === id && newTerminals.length > 0) {
                setActiveTerminalId(newTerminals[newTerminals.length - 1].id);
            } else if (newTerminals.length === 0) {
                setActiveTerminalId(null);
            }
            return newTerminals;
        });

        // Reset running state if we killed the active one
        if (activeTerminalId === id) setIsRunning(false);
    }, [activeTerminalId, terminalEventEmitter]);

    const clearTerminal = useCallback((id: string) => {
        terminalEventEmitter.dispatchEvent(new CustomEvent('clear', { detail: { id } }));
    }, [terminalEventEmitter]);

    const stopProcess = useCallback((id: string) => {
        if (getSettings().terminal.confirmBeforeKill && isRunning) {
            if (!window.confirm('Stop the running process in this terminal?')) return;
        }
        // Dispatch stop intent; the owning ShellTerminal maps it to its session
        // controller (signal/kill -> backend process termination -> exit frame).
        // isRunning is cleared authoritatively by the session EXITED/FAILED state.
        terminalEventEmitter.dispatchEvent(new CustomEvent('stop', { detail: { id } }));
    }, [terminalEventEmitter, isRunning]);

    const writeToTerminal = useCallback((id: string, text: string) => {
        terminalEventEmitter.dispatchEvent(new CustomEvent('writeText', { detail: { id, text } }));
    }, [terminalEventEmitter]);

    const runCode = useCallback(async (code: string, language: string, filename?: string, cwd?: string, stdinInput?: string) => {
        let termId = activeTerminalId;

        // Auto-create terminal if none exists
        if (!termId || !terminals.find(t => t.id === termId)) {
            if (!getSettings().terminal.autoOpenTerminal) {
                return Promise.resolve();
            }
            termId = Math.random().toString(36).substring(2, 9);
            setTerminals(prev => [...prev, { id: termId as string, title: `Run: ${filename || 'script'}`, cwd }]);
            setActiveTerminalId(termId);

            // Allow React to render the new ShellTerminal before sending the run event
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Set running state immediately to trigger tab switching
        setIsRunning(true);

        const safeLang = language || 'plaintext';
        let runLang = safeLang.toLowerCase();

        if (runLang === 'js' || runLang === 'node') runLang = 'javascript';
        if (runLang === 'ts' || runLang === 'tsx') runLang = 'typescript';
        if (runLang === 'py') runLang = 'python';
        if (runLang === 'c++') runLang = 'cpp';
        if (runLang === 'sh') runLang = 'bash';
        if (runLang === 'rs') runLang = 'rust';
        if (runLang === 'cs' || runLang === 'c#') runLang = 'csharp';
        if (runLang === 'rb') runLang = 'ruby';

        const payload = { id: termId, code, language: runLang, filename, stdinInput, cwd };
        pendingRunRef.current = { termId, payload };

        // Deliver immediately if the target terminal is already mounted & listening;
        // otherwise flush when that terminal mounts (via terminalReady).
        // NOTE: an existing terminal's ShellTerminal registers its runData listener on
        // mount, even if this provider missed the terminalReady frame (child effects run
        // before the provider's listener is attached on reload). So if the tab already
        // exists we can dispatch now; only auto-created tabs need the terminalReady flush.
        const tabExists = Boolean(termId && terminals.find(t => t.id === termId));
        if (tabExists || mountedTerminalsRef.current.has(termId)) {
            deliverPendingRun();
        }

        return Promise.resolve();
    }, [activeTerminalId, terminals, terminalEventEmitter, deliverPendingRun]);

    const updateTerminalCwd = useCallback((terminalId: string, newCwd: string) => {
        setTerminals(prev => prev.map(terminal => {
            if (terminal.id === terminalId) {
                const currentHistory = terminal.directoryHistory || [];
                const newHistory = currentHistory[currentHistory.length - 1] !== newCwd 
                    ? [...currentHistory, newCwd]
                    : currentHistory;
                
                return {
                    ...terminal,
                    cwd: newCwd,
                    directoryHistory: newHistory,
                    historyIndex: newHistory.length - 1
                };
            }
            return terminal;
        }));
    }, []);

    const syncTerminalToFileExplorer = useCallback((terminalId: string) => {
        const terminal = terminals.find(t => t.id === terminalId);
        if (terminal?.cwd) {
            // Emit event to sync with file explorer
            const event = new CustomEvent('sync-cwd-to-explorer', { 
                detail: { cwd: terminal.cwd } 
            });
            window.dispatchEvent(event);
        }
    }, [terminals]);

    const value = useMemo(() => ({
        terminals,
        activeTerminalId,
        createTerminal,
        removeTerminal,
        setActiveTerminalId,
        runCode,
        clearTerminal,
        stopProcess,
        writeToTerminal,
        isRunning,
        setIsRunning,
        lastExecutionData,
        setLastExecutionData,
        updateTerminalCwd,
        syncTerminalToFileExplorer,
        terminalEventEmitter,
    }), [terminals, activeTerminalId, createTerminal, removeTerminal, setActiveTerminalId, runCode, clearTerminal, stopProcess, writeToTerminal, isRunning, setIsRunning, lastExecutionData, setLastExecutionData, updateTerminalCwd, syncTerminalToFileExplorer, terminalEventEmitter]);

    return (
        <TerminalContext.Provider value={value}>
            {children}
        </TerminalContext.Provider>
    );
});

export const useTerminal = () => {
    const context = useContext(TerminalContext);
    if (!context) throw new Error('useTerminal must be used within a TerminalProvider');
    return context;
};
