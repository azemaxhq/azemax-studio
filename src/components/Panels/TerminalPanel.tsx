import React, { useState, useEffect } from 'react';
import { Terminal, Plus, X, Play, Square, Eraser, Keyboard, Clipboard, Trash, Copy } from 'lucide-react';
import { useProject } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { TerminalLog } from './TerminalLog';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';

export const TerminalPanel: React.FC = () => {
    const { activeFile } = useProject();
    const {
        terminals,
        activeTerminalId,
        setActiveTerminalId,
        createTerminal,
        removeTerminal,
        runCode,
        clearTerminal,
        isRunning,
        setTerminalStdin
    } = useTerminal();

    // Persisted Input State
    const [isInputOpen, setIsInputOpen] = useState(() => {
        const saved = localStorage.getItem('terminal_isInputOpen');
        return saved !== null ? saved === 'true' : true;
    });

    useEffect(() => {
        localStorage.setItem('terminal_isInputOpen', String(isInputOpen));
    }, [isInputOpen]);

    const activeTerminal = terminals.find(t => t.id === activeTerminalId);

    const handleRun = () => {
        // Detailed Logging for Debugging
        console.log('[TerminalPanel] Run initiated');
        console.log('[TerminalPanel] ActiveFile Object:', activeFile);

        if (!activeFile) {
            console.warn('[TerminalPanel] No active file selected.');
            return;
        }

        if (typeof activeFile.content !== 'string') {
            console.error('[TerminalPanel] Active file content is not a string:', activeFile.content);
            // Attempt to safeguard
            if (activeFile.content === undefined || activeFile.content === null) {
                console.warn('[Terminal] Content is null/undefined. Using empty string.');
            }
        }

        const content = activeFile.content || '';
        if (!content && content !== '') {
            console.warn('[TerminalPanel] Content is falsy but not empty string?');
        }

        console.log(`[TerminalPanel] Content length: ${content.length}`);

        // Basic language detection
        const name = activeFile.name || 'script.js';
        const ext = name.split('.').pop()?.toLowerCase() || 'js';

        let lang = 'javascript';
        if (ext === 'py') lang = 'python';
        else if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
        else if (ext === 'c') lang = 'c';
        else if (ext === 'cpp') lang = 'cpp';
        else if (ext === 'rs') lang = 'rust';
        else if (ext === 'go') lang = 'go';
        else if (ext === 'java') lang = 'java';
        else if (ext === 'sh') lang = 'bash';

        console.log('[TerminalPanel] Detected language:', lang, 'Extension:', ext);

        runCode(content, lang, activeFile.name);
    };

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'terminal' | 'input' } | null>(null);

    const handleContextMenu = (e: React.MouseEvent, type: 'terminal' | 'input') => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, type });
    };

    const handleContextAction = async (action: 'clean' | 'copy' | 'copy-selection' | 'paste' | 'kill' | 'clear-input') => {
        if (!activeTerminalId) return;
        const term = terminals.find(t => t.id === activeTerminalId);

        switch (action) {
            case 'clean':
                clearTerminal(activeTerminalId);
                break;
            case 'copy':
                if (term) {
                    const content = term.logs.map(l => l.content).join('\n');
                    navigator.clipboard.writeText(content);
                }
                break;
            case 'copy-selection':
                const selection = window.getSelection()?.toString();
                if (selection) {
                    navigator.clipboard.writeText(selection);
                }
                break;
            case 'paste':
                try {
                    const text = await navigator.clipboard.readText();
                    if (term && text) {
                        setTerminalStdin(activeTerminalId, (term.stdin || '') + text);
                    }
                } catch (e) {
                    console.error('Failed to read clipboard', e);
                }
                break;
            case 'clear-input':
                setTerminalStdin(activeTerminalId, '');
                break;
            case 'kill':
                removeTerminal(activeTerminalId);
                break;
        }
        setContextMenu(null);
    };

    // const runCodeHandler = () => handleRun(); // Alias to avoid conflict if any

    const getTerminalStatus = (term: any) => {
        if (activeTerminalId === term.id && isRunning) return 'running';

        // Check if logs exist and analyze outcome
        if (term.logs.length > 0) {
            // Check for explicit error log types
            if (term.logs.some((l: any) => l.type === 'stderr')) return 'error';

            // If strictly just "Exited" system message, it might technically be success, 
            // but usually we want to confirm valuable output or at least lack of stderr.
            // For now, simplicity: if not running and not error, it's success.
            return 'success';
        }

        return 'idle';
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!activeTerminalId) return;

            // Cmd+K to Clear
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                handleContextAction('clean');
            }
            // Cmd+Shift+C to Copy All
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
                e.preventDefault();
                handleContextAction('copy');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTerminalId]);

    return (
        <div className="h-full flex flex-col bg-[#0d1117]/95 backdrop-blur-xl relative overflow-hidden group">
            {/* Ambient Glow */}
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* Header Bar */}
            <div className="h-10 flex items-center justify-between px-2 bg-[#0d1117] border-b border-white/5 shrink-0 z-10">

                {/* Tabs Area */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar mask-gradient-right flex-1 min-w-0">
                    {terminals.map((term) => {
                        const status = getTerminalStatus(term);
                        return (
                            <div
                                key={term.id}
                                onClick={() => setActiveTerminalId(term.id)}
                                className={`
                                    relative group/tab flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer select-none transition-all duration-200 border border-transparent min-w-[120px] max-w-[200px]
                                    ${activeTerminalId === term.id
                                        ? 'bg-white/10 text-white border-white/10 shadow-lg shadow-black/20'
                                        : 'text-white/40 hover:text-white/80 hover:bg-white/5'}
                                `}
                            >
                                {/* Status Icon */}
                                {status === 'running' ? (
                                    <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
                                ) : status === 'error' ? (
                                    <div className="w-2 h-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                                ) : status === 'success' ? (
                                    <div className="w-2 h-2 rounded-full bg-green-500/80 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                ) : (
                                    <Terminal size={13} className={activeTerminalId === term.id ? "text-primary" : ""} />
                                )}

                                <span className="text-[11px] font-medium truncate flex-1">{term.title}</span>

                                {/* Close Button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeTerminal(term.id);
                                    }}
                                    className={`
                                        p-0.5 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-white/20 transition-all
                                        ${activeTerminalId === term.id ? 'opacity-0 group-hover/tab:opacity-100' : ''}
                                    `}
                                >
                                    <X size={10} />
                                </button>

                                {/* Active Indicator */}
                                {activeTerminalId === term.id && (
                                    <motion.div
                                        layoutId="activeTabIndicator"
                                        className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full"
                                    />
                                )}
                            </div>
                        );
                    })}

                    <button
                        onClick={createTerminal}
                        className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors ml-1"
                        title="New Terminal"
                    >
                        <Plus size={14} />
                    </button>
                </div>

                {/* Right Actions Toolbar */}
                <div className="flex items-center gap-2 pl-4 border-l border-white/5 shrink-0">

                    {/* Input Toggle */}
                    <button
                        onClick={() => setIsInputOpen(!isInputOpen)}
                        className={`p-1.5 rounded-lg transition-all ${isInputOpen ? 'text-primary bg-primary/10' : 'text-white/40 hover:text-white'}`}
                        title="Toggle Input Panel"
                    >
                        <Keyboard size={14} />
                    </button>

                    {/* Clear */}
                    <button
                        onClick={() => activeTerminalId && clearTerminal(activeTerminalId)}
                        className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
                        title="Clear Output"
                    >
                        <Eraser size={14} />
                    </button>

                    <div className="w-px h-4 bg-white/10" />

                    {/* Run Button */}
                    <button
                        onClick={handleRun}
                        disabled={isRunning || !activeFile}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all
                            ${isRunning
                                ? 'bg-white/5 text-white/30 cursor-not-allowed'
                                : 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20 hover:shadow-green-500/40 hover:scale-105 active:scale-95'}
                        `}
                    >
                        {isRunning ? <Square size={10} className="animate-pulse" /> : <Play size={10} fill="currentColor" />}
                        <span>{isRunning ? 'Running' : 'Run Context'}</span>
                    </button>
                </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Main Log View */}
                <div
                    className="flex-1 relative min-w-0"
                    onContextMenu={(e) => handleContextMenu(e, 'terminal')}
                >
                    {terminals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/20 gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                                <Terminal size={32} />
                            </div>
                            <p className="font-mono text-sm">No active sessions</p>
                            <button
                                onClick={createTerminal}
                                className="text-xs bg-white/5 border border-white/10 text-white px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                Start New Session
                            </button>
                        </div>
                    ) : (
                        terminals.map((term) => (
                            <TerminalLog
                                key={term.id}
                                id={term.id}
                                visible={activeTerminalId === term.id}
                            />
                        ))
                    )}
                </div>

                {/* Context Menu */}
                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        items={contextMenu.type === 'terminal' ? [
                            { label: 'Copy Selection', icon: <Clipboard size={14} />, onClick: () => handleContextAction('copy-selection') },
                            { label: 'Copy All Output', icon: <Copy size={14} />, onClick: () => handleContextAction('copy'), shortcut: 'Cmd+Shift+C' },
                            { label: 'Clear Terminal', icon: <Eraser size={14} />, onClick: () => handleContextAction('clean'), shortcut: 'Cmd+K' },
                            { type: 'separator' },
                            { label: 'Kill Terminal', icon: <Trash size={14} />, onClick: () => handleContextAction('kill'), danger: true }
                        ] : [
                            { label: 'Paste', icon: <Clipboard size={14} />, onClick: () => handleContextAction('paste'), shortcut: 'Cmd+V' },
                            { label: 'Clear Input', icon: <Eraser size={14} />, onClick: () => handleContextAction('clear-input') }
                        ]}
                    />
                )}

                {/* Resizable Input Sider (Fixed width for MVP, but collapsible) */}
                <AnimatePresence>
                    {isInputOpen && activeTerminalId && (
                        <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 180, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'circOut' }}
                            className="border-l border-white/5 bg-[#0d1117]/50 backdrop-blur-sm flex flex-col"
                        >
                            <div className="h-8 flex items-center justify-between px-3 border-b border-white/5 bg-white/[0.02]">
                                <span className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Stdin Buffer</span>
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                            </div>
                            <textarea
                                className="flex-1 bg-transparent text-white/70 text-xs font-mono p-3 resize-none focus:outline-none focus:bg-white/[0.02] placeholder:text-white/10"
                                placeholder="Type input here..."
                                value={activeTerminal?.stdin || ''}
                                onChange={(e) => setTerminalStdin(activeTerminalId, e.target.value)}
                                onContextMenu={(e) => handleContextMenu(e, 'input')}
                                spellCheck={false}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
