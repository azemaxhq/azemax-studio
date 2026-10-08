import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
    Search, X, Play, Square, CheckCircle2, AlignLeft, WrapText, Map as MapIcon,
    Zap, Terminal, AlertTriangle, FileOutput, Sparkles, Layers, Settings as SettingsIcon,
    ChevronRight,
} from 'lucide-react';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { useSettings } from '../../context/SettingsContext';
import { collectFiles, pathOf } from '../../utils/safeTree';
import { ExplorerFileIcon } from '../Sidebar/ExplorerIcons';
import { getLanguageFromFilename } from '../../utils/language';

interface MobileSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'files' | 'commands';
}

interface CommandAction {
    id: string;
    label: string;
    hint: string;
    icon: React.ReactNode;
    run: () => void;
}

/**
 * Mobile quick-open + command palette. Files tab searches the existing file
 * tree; Commands tab exposes ONLY actions that already exist in Azemax
 * (same events / settings / panels as desktop) in large touch rows.
 */
export const MobileSearchModal: React.FC<MobileSearchModalProps> = ({ isOpen, onClose, initialTab = 'files' }) => {
    const { fileTree, activeFile } = useProjectFile();
    const { setActiveFile } = useProjectActions();
    const { runCode, stopProcess, isRunning, activeTerminalId } = useTerminal();
    const { settings, updateSettings } = useSettings();
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState<'files' | 'commands'>(initialTab);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const allFiles = useMemo(() => {
        return collectFiles(fileTree);
    }, [fileTree]);

    const commands: CommandAction[] = useMemo(() => {
        const language = activeFile ? getLanguageFromFilename(activeFile.name) : 'plaintext';
        return [
            {
                id: 'run',
                label: isRunning ? 'Stop Execution' : 'Run Active File',
                hint: activeFile ? activeFile.name : 'no file',
                icon: isRunning ? <Square size={16} className="fill-current" /> : <Play size={16} className="fill-current" />,
                run: () => {
                    if (isRunning) {
                        if (activeTerminalId) stopProcess(activeTerminalId);
                    } else if (activeFile) {
                        window.dispatchEvent(new CustomEvent('run-button-clicked'));
                        runCode(activeFile.content || '', language, activeFile.name);
                    }
                },
            },
            {
                id: 'check',
                label: 'Check Code for Errors',
                hint: 'AI + syntax',
                icon: <CheckCircle2 size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('azemax-mobile-check')),
            },
            {
                id: 'format',
                label: 'Format Document',
                hint: '⇧⌥F',
                icon: <AlignLeft size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('azemax-mobile-format')),
            },
            {
                id: 'wrap',
                label: `Word Wrap: ${settings.editor.wordWrap ? 'On' : 'Off'}`,
                hint: 'editor',
                icon: <WrapText size={16} />,
                run: () => updateSettings('editor', { wordWrap: !settings.editor.wordWrap }),
            },
            {
                id: 'map',
                label: `Minimap: ${settings.editor.showMinimap ? 'On' : 'Off'}`,
                hint: 'editor',
                icon: <MapIcon size={16} />,
                run: () => updateSettings('editor', { showMinimap: !settings.editor.showMinimap }),
            },
            {
                id: 'ai-suggest',
                label: `AI Suggestions: ${settings.ai.inlineSuggestions ? 'On' : 'Off'}`,
                hint: 'editor',
                icon: <Zap size={16} />,
                run: () => updateSettings('ai', { inlineSuggestions: !settings.ai.inlineSuggestions }),
            },
            {
                id: 'terminal',
                label: 'Open Terminal',
                hint: 'panel',
                icon: <Terminal size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('mobile-open-terminal', { detail: { tab: 'terminal' } })),
            },
            {
                id: 'problems',
                label: 'Open Problems',
                hint: 'panel',
                icon: <AlertTriangle size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('mobile-open-terminal', { detail: { tab: 'problems' } })),
            },
            {
                id: 'output',
                label: 'Open Output',
                hint: 'panel',
                icon: <FileOutput size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('mobile-open-terminal', { detail: { tab: 'output' } })),
            },
            {
                id: 'ai',
                label: 'Open AI Assistant',
                hint: '⌘L',
                icon: <Sparkles size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('ai-panel-open')),
            },
            {
                id: 'explorer',
                label: 'Open Explorer',
                hint: '⌘B',
                icon: <Layers size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('mobile-open-explorer')),
            },
            {
                id: 'settings',
                label: 'Open Settings',
                hint: 'app',
                icon: <SettingsIcon size={16} />,
                run: () => window.dispatchEvent(new CustomEvent('mobile-open-settings')),
            },
        ];
    }, [activeFile, isRunning, activeTerminalId, settings.editor.wordWrap, settings.editor.showMinimap, settings.ai.inlineSuggestions, runCode, stopProcess, updateSettings]);

    const filteredFiles = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allFiles.slice(0, 30);
        return allFiles
            .filter(f => f.name.toLowerCase().includes(q) || (f.parentId && f.parentId.toLowerCase().includes(q)))
            .slice(0, 30);
    }, [allFiles, query]);

    const filteredCommands = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return commands;
        return commands.filter(c => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
    }, [commands, query]);

    const resultCount = tab === 'files' ? filteredFiles.length : filteredCommands.length;

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setTab(initialTab);
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, initialTab]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query, tab]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, resultCount - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (tab === 'files') {
                    const selected = filteredFiles[selectedIndex];
                    if (selected) {
                        setActiveFile(selected);
                        onClose();
                    }
                } else {
                    const selected = filteredCommands[selectedIndex];
                    if (selected) {
                        selected.run();
                        onClose();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredFiles, filteredCommands, selectedIndex, resultCount, tab, setActiveFile, onClose]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[100] flex flex-col justify-start bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg mx-auto px-3 flex flex-col max-h-[85dvh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="flex flex-col rounded-xl overflow-hidden shadow-2xl border"
                    style={{
                        background: 'var(--az-surface-2)',
                        borderColor: 'var(--az-border-strong)',
                    }}
                >
                    {/* Search Input Bar */}
                    <div
                        className="flex items-center gap-2 px-3.5 h-12 border-b shrink-0"
                        style={{
                            background: 'var(--az-surface-3)',
                            borderColor: 'var(--az-border)',
                        }}
                    >
                        <Search size={16} className="text-[var(--az-text-muted)] shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setSelectedIndex(0);
                            }}
                            placeholder={tab === 'files' ? 'Search files by name...' : 'Type a command...'}
                            aria-label={tab === 'files' ? 'Search files' : 'Search commands'}
                            className="mobile-no-zoom flex-1 bg-transparent border-0 outline-none text-[14px] text-[var(--az-text)] placeholder:text-[var(--az-text-muted)] min-w-0"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                className="p-1 rounded-md text-[var(--az-text-muted)] hover:text-[var(--az-text)]"
                                aria-label="Clear query"
                            >
                                <X size={14} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-2 py-1 text-xs rounded-md font-medium text-[var(--az-text-secondary)] hover:bg-white/10 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>

                    {/* Files / Commands segmented tabs */}
                    <div
                        className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0"
                        style={{ borderColor: 'var(--az-border)', background: 'var(--az-surface-2)' }}
                        role="tablist"
                        aria-label="Search mode"
                    >
                        {(['files', 'commands'] as const).map((t) => (
                            <button
                                key={t}
                                role="tab"
                                aria-selected={tab === t}
                                onClick={() => setTab(t)}
                                className={`flex-1 h-9 rounded-lg text-[12.5px] font-medium transition-colors capitalize
                                    ${tab === t
                                        ? 'bg-[var(--az-surface-hover)] text-[var(--az-text)] border border-[var(--az-border-strong)]'
                                        : 'text-[var(--az-text-muted)] border border-transparent'
                                    }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {/* Results List */}
                    <div className="overflow-y-auto max-h-[60dvh] p-1.5 space-y-0.5 custom-scrollbar">
                        {tab === 'files' ? (
                            filteredFiles.length === 0 ? (
                                <div className="py-8 text-center text-xs text-[var(--az-text-muted)]">
                                    No files found matching "{query}"
                                </div>
                            ) : (
                                filteredFiles.map((file, idx) => {
                                    const isSelected = idx === selectedIndex;
                                    const filePath = pathOf(fileTree, file.id) || file.name;

                                    return (
                                        <div
                                            key={file.id}
                                            onClick={() => {
                                                setActiveFile(file);
                                                onClose();
                                            }}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors min-h-[48px]
                                                ${isSelected
                                                    ? 'bg-[var(--az-surface-hover)] text-[var(--az-text)]'
                                                    : 'text-[var(--az-text-secondary)] hover:bg-white/[0.04]'
                                                }
                                            `}
                                        >
                                            <div className="shrink-0 flex items-center justify-center w-5 h-5">
                                                <ExplorerFileIcon name={file.name} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] font-medium truncate leading-tight text-[var(--az-text)]">
                                                    {file.name}
                                                </div>
                                                <div className="text-[11px] truncate text-[var(--az-text-muted)] leading-tight mt-0.5">
                                                    {filePath}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )
                        ) : (
                            filteredCommands.length === 0 ? (
                                <div className="py-8 text-center text-xs text-[var(--az-text-muted)]">
                                    No commands matching "{query}"
                                </div>
                            ) : (
                                filteredCommands.map((cmd, idx) => {
                                    const isSelected = idx === selectedIndex;
                                    return (
                                        <div
                                            key={cmd.id}
                                            onClick={() => {
                                                cmd.run();
                                                onClose();
                                            }}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors min-h-[48px]
                                                ${isSelected
                                                    ? 'bg-[var(--az-surface-hover)] text-[var(--az-text)]'
                                                    : 'text-[var(--az-text-secondary)] hover:bg-white/[0.04]'
                                                }
                                            `}
                                        >
                                            <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--az-border)] bg-[var(--az-surface-3)] text-[var(--az-icon)]">
                                                {cmd.icon}
                                            </span>
                                            <span className="flex-1 min-w-0 text-[13px] font-medium truncate text-[var(--az-text)]">
                                                {cmd.label}
                                            </span>
                                            <span className="text-[10px] font-mono text-[var(--az-text-faint)] shrink-0">
                                                {cmd.hint}
                                            </span>
                                            <ChevronRight size={14} className="text-[var(--az-text-faint)] shrink-0" />
                                        </div>
                                    );
                                })
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
