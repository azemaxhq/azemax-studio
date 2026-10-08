import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader2, Search, Terminal, MoreVertical, WrapText, Zap, Settings as SettingsIcon } from 'lucide-react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { useProjectFile } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { useSettings } from '../../context/SettingsContext';
import { ExplorerFileIcon } from '../Sidebar/ExplorerIcons';
import { getLanguageFromFilename } from '../../utils/language';

interface MobileHeaderProps {
    onOpenSearch: () => void;
    onToggleTerminal: () => void;
    isTerminalOpen?: boolean;
    onOpenSettings?: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
    onOpenSearch,
    onToggleTerminal,
    isTerminalOpen = false,
    onOpenSettings,
}) => {
    const { activeFile } = useProjectFile();
    const { runCode, isRunning } = useTerminal();
    const { settings, updateSettings } = useSettings();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Language detection
    const language = activeFile ? getLanguageFromFilename(activeFile.name) : 'plaintext';

    // Close menu on click outside
    useEffect(() => {
        if (!showMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    const handleRun = () => {
        if (!activeFile) return;
        window.dispatchEvent(new CustomEvent('run-button-clicked'));
        runCode(activeFile.content || '', language, activeFile.name);
    };

    return (
        <header
            className="flex flex-col border-b shrink-0 z-30 select-none"
            style={{
                background: 'var(--az-bg)',
                borderColor: 'var(--az-border)',
                paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)',
            }}
        >
            <div className="h-11 px-2.5 flex items-center justify-between gap-1.5 w-full">
                {/* Left: Brand + Active File Context */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 shrink-0" title="Azemax">
                        <AzemaxLogo size={18} />
                        <span className="text-[12px] font-bold tracking-tight text-[var(--az-text)] hidden xs:inline">
                            Azemax
                        </span>
                    </div>

                    {/* Active File Context Badge (tappable to search) */}
                    <button
                        onClick={onOpenSearch}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono truncate max-w-[150px] transition-colors border"
                        style={{
                            background: 'var(--az-surface-2)',
                            borderColor: 'var(--az-border)',
                            color: activeFile ? 'var(--az-text)' : 'var(--az-text-muted)',
                        }}
                        title={activeFile ? `Current file: ${activeFile.name} (Tap to switch)` : 'Select or search files'}
                        aria-label="Switch file"
                    >
                        {activeFile ? (
                            <>
                                <div className="shrink-0 flex items-center justify-center">
                                    <ExplorerFileIcon name={activeFile.name} />
                                </div>
                                <span className="truncate">{activeFile.name}</span>
                            </>
                        ) : (
                            <span className="truncate text-[var(--az-text-muted)]">No file open</span>
                        )}
                    </button>
                </div>

                {/* Right: Primary Actions (Run, Search, Terminal, Overflow) */}
                <div className="flex items-center gap-1 shrink-0">
                    {/* Primary Action 1: RUN BUTTON (Prominent & Accessible) */}
                    <button
                        onClick={handleRun}
                        disabled={isRunning || !activeFile}
                        aria-label={isRunning ? 'Running code' : 'Run code'}
                        className={`h-8 px-2.5 rounded-md font-semibold text-[11px] flex items-center gap-1.5 transition-all shadow-sm active:scale-95
                            ${isRunning
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : !activeFile
                                    ? 'bg-white/[0.04] text-white/30 border border-white/[0.06] cursor-not-allowed'
                                    : 'bg-[var(--az-accent)] hover:bg-[var(--az-accent-hover)] text-white border border-[var(--az-accent-bright)]'
                            }
                        `}
                    >
                        {isRunning ? (
                            <>
                                <Loader2 size={12} className="animate-spin shrink-0" />
                                <span>Running</span>
                            </>
                        ) : (
                            <>
                                <Play size={11} className="fill-current shrink-0" />
                                <span>Run</span>
                            </>
                        )}
                    </button>

                    {/* Primary Action 2: SEARCH BUTTON */}
                    <button
                        onClick={onOpenSearch}
                        aria-label="Search files"
                        className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--az-icon)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] transition-colors active:scale-95 border border-transparent"
                    >
                        <Search size={15} />
                    </button>

                    {/* Primary Action 3: TERMINAL TOGGLE */}
                    <button
                        onClick={onToggleTerminal}
                        aria-label="Toggle terminal"
                        aria-pressed={isTerminalOpen}
                        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors active:scale-95 border
                            ${isTerminalOpen
                                ? 'bg-[var(--az-surface-3)] text-[var(--az-accent)] border-[var(--az-border-strong)]'
                                : 'text-[var(--az-icon)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border-transparent'
                            }
                        `}
                    >
                        <Terminal size={15} />
                    </button>

                    {/* Overflow Menu */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowMenu(prev => !prev)}
                            aria-label="More actions"
                            aria-expanded={showMenu}
                            className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--az-icon)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] transition-colors active:scale-95 border border-transparent"
                        >
                            <MoreVertical size={15} />
                        </button>

                        {showMenu && (
                            <div
                                className="absolute right-0 top-full mt-1.5 w-48 rounded-xl shadow-2xl border py-1.5 z-50 text-[12px] animate-in fade-in zoom-in-95 duration-100"
                                style={{
                                    background: 'var(--az-overlay)',
                                    borderColor: 'var(--az-border-strong)',
                                }}
                            >
                                <button
                                    onClick={() => {
                                        setShowMenu(false);
                                        updateSettings('editor', { wordWrap: !settings.editor.wordWrap });
                                    }}
                                    className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/[0.06] text-[var(--az-text)] transition-colors min-h-[36px]"
                                >
                                    <span className="flex items-center gap-2">
                                        <WrapText size={14} className="text-[var(--az-icon)]" />
                                        Word Wrap
                                    </span>
                                    <span className="text-[10px] font-mono px-1 rounded bg-white/10">
                                        {settings.editor.wordWrap ? 'ON' : 'OFF'}
                                    </span>
                                </button>

                                <button
                                    onClick={() => {
                                        setShowMenu(false);
                                        updateSettings('ai', { inlineSuggestions: !settings.ai.inlineSuggestions });
                                    }}
                                    className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/[0.06] text-[var(--az-text)] transition-colors min-h-[36px]"
                                >
                                    <span className="flex items-center gap-2">
                                        <Zap size={14} className="text-[var(--az-icon)]" />
                                        AI Suggestions
                                    </span>
                                    <span className="text-[10px] font-mono px-1 rounded bg-white/10">
                                        {settings.ai.inlineSuggestions ? 'ON' : 'OFF'}
                                    </span>
                                </button>

                                <div className="h-px bg-white/[0.06] my-1" />

                                {onOpenSettings && (
                                    <button
                                        onClick={() => {
                                            setShowMenu(false);
                                            onOpenSettings();
                                        }}
                                        className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-white/[0.06] text-[var(--az-text)] transition-colors min-h-[36px]"
                                    >
                                        <SettingsIcon size={14} className="text-[var(--az-icon)]" />
                                        Open Settings
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};
