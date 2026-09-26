/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';
import { getSettings } from '../settings/settingsStore';
import { dialogConfirm } from '../components/UI/dialogService';

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

    // UI State — per-terminal (vscode ITerminalInstance ProcessState pattern)
    isRunning: boolean; // derived: running for activeTerminalId (kept for backward compat)
    setIsRunning: (running: boolean) => void; // sets for active terminal only
    runningTerminalIds: Set<string>;
    isTerminalRunning: (id: string) => boolean;
    setTerminalRunning: (id: string, running: boolean) => void;

    // Execution data for performance analysis — per-terminal
    lastExecutionData: ExecutionData | null; // derived for active terminal
    setLastExecutionData: (data: ExecutionData | null) => void; // sets for active terminal
    executionDataMap: Map<string, ExecutionData>;
    getExecutionData: (id: string) => ExecutionData | null;
    setExecutionData: (id: string, data: ExecutionData | null) => void;

    // Directory management
    updateTerminalCwd: (terminalId: string, newCwd: string) => void;
    syncTerminalToFileExplorer: (terminalId: string) => void;

    // Event bus for cross-component signaling
    terminalEventEmitter: EventTarget;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);
const TERMINALS_STORAGE_KEY = 'azemax-terminals-v3';
const LEGACY_TERMINALS_STORAGE_KEY = 'deepcontext-terminals-v3';
const ACTIVE_TERMINAL_KEY = 'azemax-active-terminal-id';
const LEGACY_ACTIVE_TERMINAL_KEY = 'deepcontext-active-terminal-id';

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = memo(({ children }) => {
    const [terminals, setTerminals] = useState<TerminalSession[]>(() => {
        try {
            const saved = localStorage.getItem(TERMINALS_STORAGE_KEY) || localStorage.getItem(LEGACY_TERMINALS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Defensive: stored terminals are untrusted. VS Code validates via
                // terminalStorageKeys + isString/isNumber guards for every field.
                if (Array.isArray(parsed)) {
                    const valid = parsed.filter((t: unknown): t is TerminalSession => {
                        if (!t || typeof t !== 'object') return false;
                        const c = t as Record<string, unknown>;
                        if (typeof c.id !== 'string' || !c.id) return false;
                        if (c.title !== undefined && typeof c.title !== 'string') return false;
                        if (c.cwd !== undefined && typeof c.cwd !== 'string') return false;
                        if (c.directoryHistory !== undefined && !Array.isArray(c.directoryHistory)) return false;
                        // Clamp history length to prevent unbounded growth on corrupt payload
                        if (Array.isArray(c.directoryHistory) && c.directoryHistory.length > 200) {
                            c.directoryHistory = (c.directoryHistory as string[]).slice(-200);
                        }
                        return true;
                    }).map(t => {
                        const c = t as TerminalSession;
                        // Normalize missing title (old payloads)
                        if (!c.title) c.title = `Terminal ${c.id}`;
                        return c;
                    });
                    if (valid.length > 0) return valid;
                }
            }
        } catch (e) {
            console.warn('Failed to load terminals from storage', e);
        }
        return [{ id: '1', title: 'Terminal 1' }];
    });

    const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => {
        const saved = localStorage.getItem(ACTIVE_TERMINAL_KEY) || localStorage.getItem(LEGACY_ACTIVE_TERMINAL_KEY) || '1';
        // Validate existence will be handled by the effect below; return raw for now
        return saved;
    });

    // vscode-aligned: per-terminal running state (ProcessState.Running per instance) + per-terminal execution data
    // Global isRunning/lastExecutionData are derived for the active terminal to keep existing consumers working.
    const [runningTerminalIds, setRunningTerminalIds] = useState<Set<string>>(() => new Set());
    const [executionDataMap, setExecutionDataMap] = useState<Map<string, ExecutionData>>(() => new Map());

    const isRunning = useMemo(() => activeTerminalId ? runningTerminalIds.has(activeTerminalId) : false, [activeTerminalId, runningTerminalIds]);
    const lastExecutionData = useMemo(() => activeTerminalId ? (executionDataMap.get(activeTerminalId) ?? null) : null, [activeTerminalId, executionDataMap]);

    const isTerminalRunning = useCallback((id: string) => runningTerminalIds.has(id), [runningTerminalIds]);
    const setTerminalRunning = useCallback((id: string, running: boolean) => {
        setRunningTerminalIds(prev => {
            const next = new Set(prev);
            if (running) next.add(id); else next.delete(id);
            // Avoid re-render if no change
            if (next.size === prev.size && [...next].every(v => prev.has(v))) return prev;
            return next;
        });
    }, []);
    // Legacy global setter: operates on active terminal only (mirrors vscode's instance-specific state)
    const setIsRunning = useCallback((running: boolean) => {
        if (!activeTerminalId) return;
        setTerminalRunning(activeTerminalId, running);
    }, [activeTerminalId, setTerminalRunning]);

    const getExecutionData = useCallback((id: string) => executionDataMap.get(id) ?? null, [executionDataMap]);
    const setExecutionData = useCallback((id: string, data: ExecutionData | null) => {
        setExecutionDataMap(prev => {
            const next = new Map(prev);
            if (data) next.set(id, data); else next.delete(id);
            return next;
        });
    }, []);
    const setLastExecutionData = useCallback((data: ExecutionData | null) => {
        if (!activeTerminalId) return;
        setExecutionData(activeTerminalId, data);
    }, [activeTerminalId, setExecutionData]);

    // Event bus to send commands directly to ShellTerminal instances
    const [terminalEventEmitter] = useState(() => new EventTarget());

    // Terminal instances whose ShellTerminal listener is currently registered (mounted)
    const mountedTerminalsRef = useRef<Set<string>>(new Set());

    // Buffer pending runs per-terminal (vs single pendingRunRef which drops concurrent runs on different terminals)
    const pendingRunsRef = useRef<Map<string, { id: string; language: string; code: string; fileName?: string; stdinInput?: string; cwd?: string }>>(new Map());

    const deliverPendingRun = useCallback((termId: string) => {
        const payload = pendingRunsRef.current.get(termId);
        if (!payload) return;
        pendingRunsRef.current.delete(termId);
        terminalEventEmitter.dispatchEvent(new CustomEvent('runData', { detail: payload }));
    }, [terminalEventEmitter]);

    // Helper: vscode-like instanceId generation (crypto-backed, collision-free)
    const generateTerminalId = useCallback(() => {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID().slice(0, 8);
            }
        } catch { /* fallback */ }
        return Math.random().toString(36).substring(2, 9);
    }, []);

    const nextTerminalTitle = useCallback((prev: TerminalSession[]) => {
        // vscode: sequence-based, not length-based (avoids duplicate after deletions)
        const nums = prev.map(t => {
            const m = t.title.match(/Terminal\s+(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        });
        const max = nums.length ? Math.max(...nums) : 0;
        return `Terminal ${max + 1}`;
    }, []);

    useEffect(() => {
        const onTerminalReady = (e: Event) => {
            const id = (e as CustomEvent).detail?.id;
            if (!id) return;
            mountedTerminalsRef.current.add(id);
            if (pendingRunsRef.current.has(id)) {
                deliverPendingRun(id);
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
            localStorage.setItem(ACTIVE_TERMINAL_KEY, activeTerminalId);
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
        const id = generateTerminalId();
        const initialCwd = cwd || 'root';
        setTerminals(prev => [...prev, { 
            id, 
            title: nextTerminalTitle(prev), 
            cwd: initialCwd,
            directoryHistory: [initialCwd],
            historyIndex: 0
        }]);
        setActiveTerminalId(id);
    }, [generateTerminalId, nextTerminalTitle]);

    const removeTerminal = useCallback((id: string) => {
        // Dispatch kill event so the specific ShellTerminal can clean up its connection
        terminalEventEmitter.dispatchEvent(new CustomEvent('kill', { detail: { id } }));

        setTerminals(prev => {
            const newTerminals = prev.filter(t => t.id !== id);
            // Derive new active id synchronously from the snapshot to avoid stale closure
            const shouldSwitch = activeTerminalId === id;
            if (shouldSwitch) {
                const nextActive = newTerminals.length > 0 ? newTerminals[newTerminals.length - 1].id : null;
                // Defer setActiveTerminalId to avoid setState during render of setTerminals updater
                queueMicrotask(() => setActiveTerminalId(nextActive));
            }
            return newTerminals;
        });

        // Per-terminal: clear running state for the removed terminal only (vs global clear that killed other terminals' indicator)
        setTerminalRunning(id, false);
        setExecutionData(id, null);
        pendingRunsRef.current.delete(id);
        mountedTerminalsRef.current.delete(id);
    }, [activeTerminalId, terminalEventEmitter, setTerminalRunning, setExecutionData]);

    const clearTerminal = useCallback((id: string) => {
        terminalEventEmitter.dispatchEvent(new CustomEvent('clear', { detail: { id } }));
    }, [terminalEventEmitter]);

    const stopProcess = useCallback(async (id: string) => {
        const targetRunning = runningTerminalIds.has(id);
        if (getSettings().terminal.confirmBeforeKill && targetRunning) {
            const confirmed = await dialogConfirm({
                title: 'Stop process?',
                message: 'A process is still running in this terminal. Are you sure you want to stop it?',
                confirmLabel: 'Stop',
                cancelLabel: 'Cancel',
                danger: true,
            });
            if (!confirmed) return;
        }
        // Dispatch stop intent; the owning ShellTerminal maps it to its session
        // controller (signal/kill -> backend process termination -> exit frame).
        // isRunning is cleared authoritatively by the session EXITED/FAILED state.
        terminalEventEmitter.dispatchEvent(new CustomEvent('stop', { detail: { id } }));
    }, [terminalEventEmitter, runningTerminalIds]);

    const writeToTerminal = useCallback((id: string, text: string) => {
        terminalEventEmitter.dispatchEvent(new CustomEvent('writeText', { detail: { id, text } }));
    }, [terminalEventEmitter]);

    // Terminal existence check via ref to avoid stale closure on terminals array (vscode uses instance registry)
    const terminalsRef = useRef(terminals);
    useEffect(() => { terminalsRef.current = terminals; }, [terminals]);

    const runCode = useCallback(async (code: string, language: string, filename?: string, cwd?: string, stdinInput?: string) => {
        let termId = activeTerminalId;

        // Auto-create terminal if none exists
        if (!termId || !terminalsRef.current.find(t => t.id === termId)) {
            if (!getSettings().terminal.autoOpenTerminal) {
                return Promise.resolve();
            }
            termId = generateTerminalId();
            const capturedId = termId;
            const capturedTitle = `Run: ${filename || 'script'}`;
            setTerminals(prev => {
                // Guard: if another run already created this id, don't duplicate
                if (prev.find(t => t.id === capturedId)) return prev;
                return [...prev, { id: capturedId, title: capturedTitle, cwd }];
            });
            setActiveTerminalId(termId);

            // Immediate — no delay for faster AI terminal feedback
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Per-terminal running state (vs global) — mirrors vscode ProcessState.Running
        setTerminalRunning(termId as string, true);

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

        const payload = { id: termId as string, code, language: runLang, filename, stdinInput, cwd };
        pendingRunsRef.current.set(termId as string, payload);

        // Deliver immediately if the target terminal is already mounted & listening;
        // otherwise flush when that terminal mounts (via terminalReady).
        const tabExists = Boolean(termId && terminalsRef.current.find(t => t.id === termId));
        if (tabExists || mountedTerminalsRef.current.has(termId as string)) {
            deliverPendingRun(termId as string);
        }

        return Promise.resolve();
    }, [activeTerminalId, terminalEventEmitter, deliverPendingRun, generateTerminalId, setTerminalRunning]);

    const updateTerminalCwd = useCallback((terminalId: string, newCwd: string) => {
        setTerminals(prev => prev.map(terminal => {
            if (terminal.id === terminalId) {
                const currentHistory = terminal.directoryHistory || [];
                const newHistory = currentHistory[currentHistory.length - 1] !== newCwd 
                    ? [...currentHistory, newCwd].slice(-200)
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
        const terminal = terminalsRef.current.find(t => t.id === terminalId);
        if (terminal?.cwd) {
            // Emit event to sync with file explorer (mirrors VS Code's workspace folder sync)
            const event = new CustomEvent('sync-cwd-to-explorer', { 
                detail: { cwd: terminal.cwd } 
            });
            window.dispatchEvent(event);
        }
    }, []);

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
        runningTerminalIds,
        isTerminalRunning,
        setTerminalRunning,
        lastExecutionData,
        setLastExecutionData,
        executionDataMap,
        getExecutionData,
        setExecutionData,
        updateTerminalCwd,
        syncTerminalToFileExplorer,
        terminalEventEmitter,
    }), [terminals, activeTerminalId, createTerminal, removeTerminal, setActiveTerminalId, runCode, clearTerminal, stopProcess, writeToTerminal, isRunning, setIsRunning, runningTerminalIds, isTerminalRunning, setTerminalRunning, lastExecutionData, setLastExecutionData, executionDataMap, getExecutionData, setExecutionData, updateTerminalCwd, syncTerminalToFileExplorer, terminalEventEmitter]);

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
