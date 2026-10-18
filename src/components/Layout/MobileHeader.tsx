import React, { useState, useRef, useEffect } from 'react';
import {
    Play, Square, Search, MoreVertical,
    WrapText, Zap, Map as MapIcon, CheckCircle2, AlignLeft,
    Terminal, AlertTriangle, FileOutput, Command, Settings as SettingsIcon,
    LogIn, LogOut,
} from 'lucide-react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { useProjectFile } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { navigate } from '../../utils/appRouter';
import { ExplorerFileIcon } from '../Sidebar/ExplorerIcons';
import { getLanguageFromFilename } from '../../utils/language';

interface MobileHeaderProps {
    onOpenSearch: (tab?: 'files' | 'commands') => void;
    onToggleTerminal: () => void;
    isTerminalOpen?: boolean;
    onOpenSettings?: () => void;
}

/**
 * Compact mobile IDE header (~56px + safe-area).
 *
 *   A  welcome.java     ▶  ⌕   ⋮
 *
 * Single primary Run action (becomes Stop while running).
 * No terminal icon here — terminal lives in the bottom sheet
 * (grabber bar / More menu), keeping the header to one row.
 */
export const MobileHeader: React.FC<MobileHeaderProps> = ({
    onOpenSearch,
    onToggleTerminal,
    isTerminalOpen = false,
    onOpenSettings,
}) => {
    const { activeFile } = useProjectFile();
    const { runCode, stopProcess, isRunning, activeTerminalId } = useTerminal();
    const { settings, updateSettings } = useSettings();
    const { user, isAnonymous, logout } = useAuth();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const language = activeFile ? getLanguageFromFilename(activeFile.name) : 'plaintext';

    useEffect(() => {
        if (!showMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowMenu(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showMenu]);

    const handleRunOrStop = () => {
        if (isRunning) {
            if (activeTerminalId) stopProcess(activeTerminalId);
            return;
        }
        if (!activeFile) return;
        window.dispatchEvent(new CustomEvent('run-button-clicked'));
        runCode(activeFile.content || '', language, activeFile.name);
    };

    const closeAnd = (fn: () => void) => () => {
        setShowMenu(false);
        fn();
    };

    const openTerminalTab = (tab: 'terminal' | 'problems' | 'output') => {
        window.dispatchEvent(new CustomEvent('mobile-open-terminal', { detail: { tab } }));
    };

    return (
        <header
            className="border-b shrink-0 z-30 select-none"
            style={{
                background: 'var(--az-bg)',
                borderColor: 'var(--az-border)',
                paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)',
                minHeight: '56px',
                height: '56px',
            }}
        >
            <div className="h-14 px-1 flex items-center gap-0.5 w-full max-w-full">
                {/* LEFT: Azemax logo only (non-interactive, compact,
                    same 36px box as the action controls for exact
                    vertical centering) */}
                <div className="flex items-center shrink-0 w-7 h-9 justify-center" title="Azemax">
                    <AzemaxLogo size={18} />
                </div>

                {/* CENTER: current file / project context. Borderless and
                    surface-transparent so it reads as IDE chrome, not a form
                    input — still a full-width tap target that truncates. */}
                <button
                    onClick={() => onOpenSearch('files')}
                    className="flex items-center gap-1 px-1.5 h-9 rounded-md text-[12px] font-mono truncate flex-1 min-w-0 transition-colors border border-transparent text-left active:bg-white/[0.05]"
                    style={{
                        background: 'transparent',
                        borderColor: 'transparent',
                        color: activeFile ? 'var(--az-text)' : 'var(--az-text-muted)',
                    }}
                    title={activeFile ? `Current file: ${activeFile.name} (tap to switch)` : 'Select or search files'}
                    aria-label="Current file — tap to switch"
                >
                    {activeFile ? (
                        <>
                            <span className="shrink-0 flex items-center justify-center">
                                <ExplorerFileIcon name={activeFile.name} />
                            </span>
                            <span className="truncate">{activeFile.name}</span>
                        </>
                    ) : (
                        <span className="truncate">No file open</span>
                    )}
                </button>

                {/* RIGHT: single Run/Stop · Search · More (never pushed off-screen) */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={handleRunOrStop}
                        disabled={!isRunning && !activeFile}
                        aria-label={isRunning ? 'Stop execution' : 'Run code'}
                        className={`h-9 min-w-9 px-2 rounded-md font-semibold text-[12px] flex items-center justify-center gap-1.5 transition-all active:scale-95 border
                            ${isRunning
                                ? 'bg-[rgba(255,125,139,0.15)] text-[var(--az-error)] border-[rgba(255,125,139,0.3)]'
                                : !activeFile
                                    ? 'bg-white/[0.04] text-white/30 border-white/[0.06]'
                                    : 'bg-[var(--az-accent)] text-white border-[var(--az-accent-bright)]'
                            }
                        `}
                    >
                        {isRunning ? (
                            <>
                                <Square size={12} className="fill-current shrink-0" />
                                {/* Icon-only below 360px so actions never overflow */}
                                <span className="hidden min-[360px]:inline">Stop</span>
                            </>
                        ) : (
                            <>
                                <Play size={12} className="fill-current shrink-0" />
                                <span className="hidden min-[360px]:inline">Run</span>
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => onOpenSearch('files')}
                        aria-label="Search files"
                        className="w-9 h-9 rounded-md flex items-center justify-center text-[var(--az-icon)] active:scale-95 border border-transparent"
                    >
                        <Search size={16} />
                    </button>

                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowMenu(prev => !prev)}
                            aria-label="More actions"
                            aria-expanded={showMenu}
                            className="w-9 h-9 rounded-md flex items-center justify-center text-[var(--az-icon)] active:scale-95 border border-transparent"
                        >
                            <MoreVertical size={16} />
                        </button>

                        {showMenu && (
                            <div
                                role="menu"
                                className="absolute right-0 top-full mt-1 w-56 rounded-xl shadow-2xl border py-1.5 z-50 text-[13px] max-h-[70dvh] overflow-y-auto custom-scrollbar"
                                style={{
                                    background: 'var(--az-overlay)',
                                    borderColor: 'var(--az-border-strong)',
                                }}
                            >
                                <MenuItem
                                    icon={<CheckCircle2 size={15} className="text-[var(--az-icon)]" />}
                                    label="Check code"
                                    hint="⌃."
                                    onClick={closeAnd(() => window.dispatchEvent(new CustomEvent('azemax-mobile-check')))}
                                />
                                <MenuItem
                                    icon={<AlignLeft size={15} className="text-[var(--az-icon)]" />}
                                    label="Format document"
                                    onClick={closeAnd(() => window.dispatchEvent(new CustomEvent('azemax-mobile-format')))}
                                />
                                <MenuItem
                                    icon={<WrapText size={15} className="text-[var(--az-icon)]" />}
                                    label="Word Wrap"
                                    right={<TogglePill on={settings.editor.wordWrap} />}
                                    onClick={closeAnd(() => updateSettings('editor', { wordWrap: !settings.editor.wordWrap }))}
                                />
                                <MenuItem
                                    icon={<MapIcon size={15} className="text-[var(--az-icon)]" />}
                                    label="Minimap"
                                    right={<TogglePill on={settings.editor.showMinimap} />}
                                    onClick={closeAnd(() => updateSettings('editor', { showMinimap: !settings.editor.showMinimap }))}
                                />
                                <MenuItem
                                    icon={<Zap size={15} className="text-[var(--az-icon)]" />}
                                    label="AI Suggestions"
                                    right={<TogglePill on={settings.ai.inlineSuggestions} />}
                                    onClick={closeAnd(() => updateSettings('ai', { inlineSuggestions: !settings.ai.inlineSuggestions }))}
                                />

                                <div className="h-px bg-white/[0.06] my-1.5 mx-2" />

                                <MenuItem
                                    icon={<Terminal size={15} className="text-[var(--az-icon)]" />}
                                    label={isTerminalOpen ? 'Hide Terminal' : 'Open Terminal'}
                                    onClick={closeAnd(() => {
                                        if (isTerminalOpen) onToggleTerminal();
                                        else openTerminalTab('terminal');
                                    })}
                                />
                                <MenuItem
                                    icon={<AlertTriangle size={15} className="text-[var(--az-icon)]" />}
                                    label="Problems"
                                    onClick={closeAnd(() => openTerminalTab('problems'))}
                                />
                                <MenuItem
                                    icon={<FileOutput size={15} className="text-[var(--az-icon)]" />}
                                    label="Output"
                                    onClick={closeAnd(() => openTerminalTab('output'))}
                                />
                                <MenuItem
                                    icon={<Command size={15} className="text-[var(--az-icon)]" />}
                                    label="Commands…"
                                    onClick={closeAnd(() => onOpenSearch('commands'))}
                                />

                                {onOpenSettings && (
                                    <>
                                        <div className="h-px bg-white/[0.06] my-1.5 mx-2" />
                                        <MenuItem
                                            icon={<SettingsIcon size={15} className="text-[var(--az-icon)]" />}
                                            label="Settings"
                                            onClick={closeAnd(() => onOpenSettings())}
                                        />
                                    </>
                                )}

                                <div className="h-px bg-white/[0.06] my-1.5 mx-2" />
                                {user && !isAnonymous ? (
                                    <MenuItem
                                        icon={<LogOut size={15} className="text-[var(--az-icon)]" />}
                                        label="Sign out"
                                        hint={user.displayName || user.email.split('@')[0]}
                                        onClick={closeAnd(() => logout())}
                                    />
                                ) : (
                                    <MenuItem
                                        icon={<LogIn size={15} className="text-[var(--az-accent)]" />}
                                        label="Sign in"
                                        onClick={closeAnd(() => navigate('/login?redirect=/app'))}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {isRunning && (
                <div className="h-px w-full overflow-hidden" style={{ background: 'var(--az-border)' }} aria-hidden>
                    <div className="h-full w-1/3 rounded-full animate-pulse" style={{ background: 'var(--az-accent)' }} />
                </div>
            )}
        </header>
    );
};

const MenuItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    hint?: string;
    right?: React.ReactNode;
    onClick: () => void;
}> = ({ icon, label, hint, right, onClick }) => (
    <button
        role="menuitem"
        onClick={onClick}
        className="w-full px-3 min-h-[44px] py-2 text-left flex items-center gap-2.5 text-[var(--az-text)] transition-colors"
    >
        <span className="shrink-0 w-5 flex justify-center">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {hint && <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.07] text-white/40">{hint}</kbd>}
        {right}
    </button>
);

const TogglePill: React.FC<{ on: boolean }> = ({ on }) => (
    <span
        className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${on
            ? 'text-[var(--az-accent-bright)] border-[var(--az-accent-border)] bg-[var(--az-accent-soft)]'
            : 'text-[var(--az-text-muted)] border-[var(--az-border)] bg-white/[0.04]'
            }`}
    >
        {on ? 'ON' : 'OFF'}
    </span>
);

// Re-exported so other mobile surfaces can trigger the same editor actions.
export const MOBILE_CHECK_EVENT = 'azemax-mobile-check';
export const MOBILE_FORMAT_EVENT = 'azemax-mobile-format';
export const MOBILE_OPEN_TERMINAL_EVENT = 'mobile-open-terminal';
