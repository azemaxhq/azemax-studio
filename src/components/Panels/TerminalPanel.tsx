import React, { useState, useEffect } from 'react';
import { Terminal, Plus, X, Play, Square, Eraser, Clipboard, Trash, Copy, Keyboard } from 'lucide-react';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { ShellTerminal } from './ShellTerminal';
import { motion } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';
import { languageFromExtension } from '../../core/terminal/terminalProfiles';

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
        isTerminalRunning,
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

        // VS Code: language via ITerminalProfileService / getLanguageFromFilename — centralized, not duplicated
        const lang = languageFromExtension(ext);
        runCode(content, lang, name, undefined, stdinContent);
    };

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    // VS Code gates terminal keybindings via context keys (terminalFocus). Use stable
    // callback + ref to avoid stale activeTerminalId closure (mirrors DisposableStore pattern).
    const activeTerminalIdRef = React.useRef(activeTerminalId);
    React.useEffect(() => { activeTerminalIdRef.current = activeTerminalId; }, [activeTerminalId]);
    const handleContextAction = React.useCallback((action: 'clean' | 'copy' | 'copy-selection' | 'paste' | 'kill') => {
        const target = activeTerminalIdRef.current;
        if (!target) return;
        switch (action) {
            case 'clean':
                clearTerminal(target);
                break;
            case 'copy':
                terminalEventEmitter.dispatchEvent(new CustomEvent('copyAll', { detail: { id: target } }));
                break;
            case 'copy-selection':
                terminalEventEmitter.dispatchEvent(new CustomEvent('copySelection', { detail: { id: target } }));
                break;
            case 'paste':
                terminalEventEmitter.dispatchEvent(new CustomEvent('paste', { detail: { id: target } }));
                break;
            case 'kill':
                removeTerminal(target);
                break;
        }
        setContextMenu(null);
    }, [clearTerminal, removeTerminal, terminalEventEmitter]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!activeTerminalIdRef.current) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                handleContextAction('clean');
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
                e.preventDefault();
                handleContextAction('copy');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleContextAction]);

    return (
        <div className="h-full flex flex-col relative overflow-hidden group" style={{ background: "var(--az-surface-2)"}}>


            {/* Header Bar — 36px stable */}
            <div className="h-9 min-h-9 flex items-center justify-between px-3 shrink-0 z-10 overflow-hidden" style={{ background: "var(--az-surface-2)", borderBottom: "1px solid var(--az-border)"}}>

                {/* Tabs Area — stable height, no wrap */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar mask-gradient-right flex-1 min-w-0 h-full py-1">
                    {terminals.map((term) => (
                        <div
                            key={term.id}
                            onClick={() => setActiveTerminalId(term.id)}
                            className={`
                                relative group/tab flex items-center gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-[6px] cursor-pointer select-none transition-colors duration-150 border min-w-[96px] sm:min-w-[120px] max-w-[200px] text-[12px]
                                ${activeTerminalId === term.id
                                    ? 'bg-[rgba(255,255,255,.04)] text-[#E7ECF3] border-[var(--az-border)]'
                                    : 'text-[#778291] border-transparent hover:text-[var(--az-icon-hover)] hover:bg-[rgba(255,255,255,0.035)]'}
                            `}
                        >
                            {/* Status Icon — per-terminal (vscode ITerminalStatus) */}
                            {isTerminalRunning(term.id) ? (
                                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--az-warning)"}} title="Running" />
                            ) : (
                                <Terminal size={13} style={{ color: activeTerminalId === term.id ? "#E7ECF3" : "var(--az-icon)"}} />
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

                            {/* Active Indicator — compact 2px Azemax blue */}
                            {activeTerminalId === term.id && (
                                <motion.div
                                    layoutId="activeTabIndicator"
                                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full" style={{ background: "var(--az-accent)"}}
                                />
                            )}
                        </div>
                    ))}

                    <button
                        onClick={() => createTerminal(selectedFolder || 'root')}
                        className="p-1 rounded-[6px] transition-colors duration-150 ml-1 hover:bg-[rgba(255,255,255,0.06)]" style={{ color: "var(--az-icon)"}}
                        title="New Terminal"
                    >
                        <Plus size={14} />
                    </button>
                </div>

                {/* Right Actions Toolbar */}
                <div className="flex items-center gap-2 pl-3 shrink-0" style={{ borderLeft: "1px solid var(--az-border)"}}>

                    {/* Clear */}
                    <button
                        onClick={() => activeTerminalId && clearTerminal(activeTerminalId)}
                        className="p-1.5 rounded-[6px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.06)]" style={{ color: "var(--az-icon)"}}
                        title="Clear Output"
                    >
                        <Eraser size={14} />
                    </button>

                    {/* Stdin Toggle */}
                    <button
                        onClick={() => setShowStdin(!showStdin)}
                        className={`p-1.5 rounded-[6px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.06)] ${showStdin ? 'bg-[var(--az-surface-3)] text-[var(--az-text)] border border-[var(--az-border-strong)]' : ''}`} style={showStdin ? {} : { color: 'var(--az-icon)'}}
                        title="Provide Input (stdin)"
                    >
                        <Keyboard size={14} />
                    </button>

                    <div className="w-px h-4" style={{ background: "var(--az-border)"}} />

                    {/* Run/Stop Button */}
                    <button
                        onClick={isRunning ? () => activeTerminalId && stopProcess(activeTerminalId) : handleRun}
                        disabled={!isRunning && !activeFileMeta}
                        className={`
                            flex items-center gap-1.5 px-3 h-7 rounded-[7px] text-[11px] font-semibold tracking-wide transition-colors duration-150
                            ${isRunning
                                ? 'bg-[var(--az-error)] text-white border border-[var(--az-error-border)] hover:brightness-105'
                                : 'bg-[var(--az-accent)] text-white border border-[var(--az-accent)] hover:bg-[var(--az-accent-hover)]'}
                            disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                    >
                        {isRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                        <span className="hidden sm:inline">{isRunning ? 'Stop Running' : 'Run Context'}</span>
                    </button>
                </div>
            </div>

            {/* Stdin Input Panel */}
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${showStdin ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                    <div className="p-2 shrink-0" style={{ background: "var(--az-surface-2)", borderBottom: "1px solid var(--az-border)"}}>
                        <div className="flex flex-col gap-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: "var(--az-text-muted)"}}>
                                Standard Input (stdin)
                            </div>
                            <textarea
                                value={stdinContent}
                                onChange={(e) => setStdinContent(e.target.value)}
                                placeholder="Type input here before running..."
                                className="rounded-md px-3 py-2 text-xs font-mono focus:outline-none min-h-[60px] max-h-[150px] resize-y" style={{ background: "var(--az-surface-3)", border: "1px solid var(--az-border)", color: "var(--az-text)"}}
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
                        <div className="az-empty h-full">
                            <div className="az-empty-icon">
                                <Terminal size={16} />
                            </div>
                            <div className="az-empty-title">No terminal sessions</div>
                            <div className="az-empty-desc">Run your code or start a shell to see output here.</div>
                            <button
                                onClick={() => createTerminal(selectedFolder || 'root')}
                                className="mt-1 text-[12px] font-medium px-3.5 py-1.5 rounded-[7px] transition-colors duration-150 hover:bg-[var(--az-surface-hover)]" style={{ background: "var(--az-surface-3)", border: "1px solid var(--az-border)", color: "var(--az-text)"}}
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
