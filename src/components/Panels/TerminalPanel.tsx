import React, { useState, useEffect } from 'react';
import { Terminal, Plus, X, Play, Square, Eraser, Clipboard, Trash, Copy, Keyboard } from 'lucide-react';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { ShellTerminal } from './ShellTerminal';
import { motion } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';

export const TerminalPanel: React.FC = () => {
    const { selectedFolder, activeFileMeta } = useProjectUI();
    const { getActiveFile } = useProjectActions();
    const {
        terminals,
        activeTerminalId,
        setActiveTerminalId,
        createTerminal,
        removeTerminal,
        runCode,
        clearTerminal,
        isRunning,
        stopProcess,
        terminalEventEmitter
    } = useTerminal();

    const [showStdin, setShowStdin] = useState(false);
    const [stdinContent, setStdinContent] = useState('');

    const handleRun = () => {
        const activeFile = getActiveFile();
        if (!activeFile) return;
        
        // Dispatch event to switch to terminal tab (though we're already here)
        window.dispatchEvent(new CustomEvent('run-button-clicked'));
        
        const content = activeFile.content || '';
        const name = activeFile.name || 'script.js';
        const ext = name.split('.').pop()?.toLowerCase() || 'js';

        // Normalized language ids expected by the backend
        const extensionToLanguage: Record<string, string> = {
            js: 'javascript',
            jsx: 'javascript',
            ts: 'typescript',
            tsx: 'typescript',
            py: 'python',
            python: 'python',
            c: 'c',
            cpp: 'cpp',
            cc: 'cpp',
            cxx: 'cpp',
            rs: 'rust',
            go: 'go',
            java: 'java',
            rb: 'ruby',
            php: 'php',
            pl: 'perl',
            swift: 'swift',
            kt: 'kotlin',
            scala: 'scala',
            r: 'r',
            lua: 'lua',
            cs: 'csharp',
            sh: 'bash',
            bash: 'bash',
        };

        const lang = extensionToLanguage[ext] || 'javascript';
        runCode(content, lang, name, undefined, stdinContent);
    };

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleContextAction = (action: 'clean' | 'copy' | 'copy-selection' | 'paste' | 'kill') => {
        if (!activeTerminalId) return;
        switch (action) {
            case 'clean':
                clearTerminal(activeTerminalId);
                break;
            case 'copy':
                terminalEventEmitter.dispatchEvent(new CustomEvent('copyAll', { detail: { id: activeTerminalId } }));
                break;
            case 'copy-selection':
                terminalEventEmitter.dispatchEvent(new CustomEvent('copySelection', { detail: { id: activeTerminalId } }));
                break;
            case 'paste':
                terminalEventEmitter.dispatchEvent(new CustomEvent('paste', { detail: { id: activeTerminalId } }));
                break;
            case 'kill':
                removeTerminal(activeTerminalId);
                break;
        }
        setContextMenu(null);
    };

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
        <div className="h-full flex flex-col bg-[#0a0d14]/90 relative overflow-hidden group border-t border-white/[0.02]">
            {/* Ambient Glow */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent opacity-50" />
            <div className="absolute top-0 left-1/4 right-1/4 h-32 bg-blue-500/5 blur-[80px] pointer-events-none" />

            {/* Header Bar */}
            <div className="h-[42px] flex items-center justify-between px-3 bg-[#0a0d14] border-b border-white/[0.04] shrink-0 z-10 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.5)]">

                {/* Tabs Area */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar mask-gradient-right flex-1 min-w-0">
                    {terminals.map((term) => (
                        <div
                            key={term.id}
                            onClick={() => setActiveTerminalId(term.id)}
                            className={`
                                relative group/tab flex items-center gap-2 px-3.5 py-1.5 rounded-md cursor-pointer select-none transition-all duration-300 border min-w-[120px] max-w-[200px] text-[12px]
                                ${activeTerminalId === term.id
                                    ? 'bg-blue-500/10 text-blue-100 border-blue-500/20 shadow-[0_0_15px_-3px_rgba(59,130,246,0.15)]'
                                    : 'text-white/40 border-transparent hover:text-white/80 hover:bg-white/[0.03]'}
                            `}
                        >
                            {/* Status Icon */}
                            {activeTerminalId === term.id && isRunning ? (
                                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
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
                    ))}

                    <button
                        onClick={() => createTerminal(selectedFolder || 'root')}
                        className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors ml-1"
                        title="New Terminal"
                    >
                        <Plus size={14} />
                    </button>
                </div>

                {/* Right Actions Toolbar */}
                <div className="flex items-center gap-2 pl-4 border-l border-white/5 shrink-0">

                    {/* Clear */}
                    <button
                        onClick={() => activeTerminalId && clearTerminal(activeTerminalId)}
                        className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
                        title="Clear Output"
                    >
                        <Eraser size={14} />
                    </button>

                    {/* Stdin Toggle */}
                    <button
                        onClick={() => setShowStdin(!showStdin)}
                        className={`p-1.5 rounded-lg transition-all ${showStdin ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                        title="Provide Input (stdin)"
                    >
                        <Keyboard size={14} />
                    </button>

                    <div className="w-px h-4 bg-white/10" />

                    {/* Run/Stop Button */}
                    <button
                        onClick={isRunning ? () => activeTerminalId && stopProcess(activeTerminalId) : handleRun}
                        disabled={!isRunning && !activeFileMeta}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all
                            ${isRunning
                                ? 'bg-gradient-to-r from-red-500/80 to-rose-600/80 hover:from-red-500 hover:to-rose-600 text-white shadow-[0_0_20px_-5px_rgba(244,63,94,0.4)] border border-red-500/30 hover:scale-105 active:scale-95'
                                : 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20 hover:shadow-green-500/40 hover:scale-105 active:scale-95'}
                            disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed
                        `}
                    >
                        {isRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                        <span>{isRunning ? 'Stop Running' : 'Run Context'}</span>
                    </button>
                </div>
            </div>

            {/* Stdin Input Panel */}
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${showStdin ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                    <div className="border-b border-white/[0.04] bg-[#0a0d14]/50 p-2 shrink-0">
                        <div className="flex flex-col gap-1">
                            <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider px-1">
                                Standard Input (stdin)
                            </div>
                            <textarea
                                value={stdinContent}
                                onChange={(e) => setStdinContent(e.target.value)}
                                placeholder="Type input here before running..."
                                className="bg-black/20 border border-white/5 rounded-md px-3 py-2 text-xs text-white/80 font-mono focus:outline-none focus:border-blue-500/30 min-h-[60px] max-h-[150px] resize-y placeholder:text-white/20"
                            />
                        </div>
                    </div>
                </div>
            </div>
            {/* Content Body */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Main Log View */}
                <div
                    className="flex-1 relative min-w-0"
                    onContextMenu={(e) => handleContextMenu(e)}
                >
                    {terminals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/20 gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                                <Terminal size={32} />
                            </div>
                            <p className="font-mono text-sm">No active sessions</p>
                            <button
                                onClick={() => createTerminal(selectedFolder || 'root')}
                                className="text-xs bg-white/5 border border-white/10 text-white px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                Start New Session
                            </button>
                        </div>
                    ) : (
                        terminals.map((term) => (
                            <ShellTerminal
                                key={term.id}
                                terminalId={term.id}
                                visible={activeTerminalId === term.id}
                                cwd={term.cwd || 'root'}
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
                        items={[
                            { label: 'Copy Selection', icon: <Clipboard size={14} />, onClick: () => handleContextAction('copy-selection') },
                            { label: 'Copy All Output', icon: <Copy size={14} />, onClick: () => handleContextAction('copy'), shortcut: 'Cmd+Shift+C' },
                            { label: 'Paste', icon: <Clipboard size={14} />, onClick: () => handleContextAction('paste'), shortcut: 'Cmd+V' },
                            { label: 'Clear Terminal', icon: <Eraser size={14} />, onClick: () => handleContextAction('clean'), shortcut: 'Cmd+K' },
                            { type: 'separator' },
                            { label: 'Kill Terminal', icon: <Trash size={14} />, onClick: () => handleContextAction('kill'), danger: true }
                        ]}
                    />
                )}
            </div>
        </div >
    );
};
