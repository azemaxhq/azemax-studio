import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
    FilePlus, FolderPlus, ChevronsDownUp, ChevronsUpDown,
    RefreshCw, Search, Sparkles
} from 'lucide-react';
import { FileExplorer } from './FileExplorer';
import { useProjectFile, useProjectUI, useProjectActions } from '../../context/ProjectContext';
import type { FileNode } from '../../utils/mockFileSystem';

// Count all files and folders recursively
const countNodes = (nodes: FileNode[]): { files: number; folders: number } => {
    let files = 0;
    let folders = 0;
    for (const node of nodes) {
        if (node.type === 'folder') {
            folders++;
            if (node.children) {
                const sub = countNodes(node.children);
                files += sub.files;
                folders += sub.folders;
            }
        } else {
            files++;
        }
    }
    return { files, folders };
};

// Check if any folder is open
const hasOpenFolder = (nodes: FileNode[]): boolean => {
    for (const node of nodes) {
        if (node.type === 'folder' && node.isOpen) return true;
        if (node.children && hasOpenFolder(node.children)) return true;
    }
    return false;
};

// Tooltip component — uses fixed positioning to escape overflow-hidden containers
const ActionTooltip = ({ text, shortcut, show, anchorRect }: { text: string; shortcut?: string; show: boolean; anchorRect: DOMRect | null }) => {
    if (!show || !anchorRect) return null;

    const top = anchorRect.bottom + 8;
    const left = anchorRect.left + anchorRect.width / 2;

    return ReactDOM.createPortal(
        <div
            className="fixed z-[9999] pointer-events-none whitespace-nowrap"
            style={{ top, left, transform: 'translateX(-50%)' }}
        >
            <div className="px-2.5 py-1.5 rounded-lg bg-[#1a1f28]/95 backdrop-blur-xl border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.5)] text-[11px] font-medium text-white/80 flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                <span>{text}</span>
                {shortcut && (
                    <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/40 font-mono border border-white/[0.06]">{shortcut}</kbd>
                )}
            </div>
        </div>,
        document.body
    );
};

// Header action button
const HeaderActionBtn = ({
    onClick,
    icon: Icon,
    iconSize = 14,
    tooltip,
    shortcut,
    isActive = false,
    danger = false,
    className
}: {
    onClick: () => void;
    icon: React.ElementType;
    iconSize?: number;
    tooltip: string;
    shortcut?: string;
    isActive?: boolean;
    danger?: boolean;
    className?: string;
}) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const btnRef = useRef<HTMLButtonElement>(null);

    const handleMouseEnter = () => {
        timerRef.current = setTimeout(() => {
            if (btnRef.current) {
                setAnchorRect(btnRef.current.getBoundingClientRect());
            }
            setShowTooltip(true);
        }, 500);
    };
    const handleMouseLeave = () => {
        clearTimeout(timerRef.current);
        setShowTooltip(false);
        setAnchorRect(null);
    };

    useEffect(() => () => clearTimeout(timerRef.current), []);

    return (
        <div className={`relative ${className || ''}`}>
            <button
                ref={btnRef}
                onClick={() => { onClick(); setShowTooltip(false); }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={`
                    relative p-1.5 rounded-md transition-all duration-200 group/abtn
                    ${isActive
                        ? 'text-blue-400 bg-blue-500/15 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
                        : danger
                            ? 'text-white/30 hover:text-red-400 hover:bg-red-500/10'
                            : 'text-white/30 hover:text-white/80 hover:bg-white/[0.06] active:scale-90'
                    }
                `}
            >
                <Icon size={iconSize} className="relative z-10 transition-transform duration-150 group-hover/abtn:scale-110" />
                {isActive && (
                    <div className="absolute inset-0 rounded-md bg-blue-500/5 animate-pulse" />
                )}
            </button>
            <ActionTooltip text={tooltip} shortcut={shortcut} show={showTooltip} anchorRect={anchorRect} />
        </div>
    );
};

export const Sidebar: React.FC = () => {
    const { fileTree } = useProjectFile();
    const { selectedFolder } = useProjectUI();
    const { startCreating, collapseAll, expandAll } = useProjectActions();
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const { files, folders } = useMemo(() => countNodes(fileTree), [fileTree]);
    const anyFolderOpen = useMemo(() => hasOpenFolder(fileTree), [fileTree]);

    const handleCreateFile = useCallback(() => {
        const parentId = selectedFolder || 'root';
        startCreating('file', parentId);
    }, [selectedFolder, startCreating]);

    const handleCreateFolder = useCallback(() => {
        const parentId = selectedFolder || 'root';
        startCreating('folder', parentId);
    }, [selectedFolder, startCreating]);

    const handleRefresh = useCallback(() => {
        setIsRefreshing(true);
        // Simulate refresh with a brief delay for visual feedback
        setTimeout(() => {
            setIsRefreshing(false);
        }, 600);
    }, []);

    const toggleSearch = useCallback(() => {
        setIsSearchOpen(prev => !prev);
    }, []);

    const handleToggleFolders = useCallback(() => {
        if (anyFolderOpen) {
            collapseAll();
        } else {
            expandAll();
        }
    }, [anyFolderOpen, collapseAll, expandAll]);

    // ⌘F keyboard shortcut to toggle search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                setIsSearchOpen(prev => !prev);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    return (
        <div className="h-full flex flex-col bg-transparent relative overflow-hidden group/sidebar">
            {/* Ambient gradient glow */}
            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-blue-500/[0.05] via-purple-500/[0.02] to-transparent pointer-events-none" />

            {/* ── Premium Header ── */}
            <div className="shrink-0 relative z-10">
                {/* Gradient accent line at very top */}
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/25 to-transparent z-20" />

                {/* Top bar: title + action buttons */}
                <div className="h-11 px-2 flex items-center justify-between flex-nowrap overflow-hidden relative">
                    {/* Title */}
                    <div className="flex items-center min-w-0 flex-1 mr-2 px-1">
                        <span className="text-[11px] font-medium tracking-wider text-white/50 uppercase truncate select-none">
                            Explorer
                        </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end flex-nowrap gap-[2px] overflow-hidden shrink min-w-0">
                        <HeaderActionBtn
                            onClick={toggleSearch}
                            icon={Search}
                            iconSize={13}
                            tooltip="Search Files"
                            shortcut="⌘F"
                            isActive={isSearchOpen}
                            className="shrink-0"
                        />

                        <div className="w-px h-3 bg-white/[0.06] mx-[3px] shrink-0" />

                        <HeaderActionBtn
                            onClick={handleCreateFile}
                            icon={FilePlus}
                            tooltip="New File"
                            shortcut="⌘N"
                        />
                        <HeaderActionBtn
                            onClick={handleCreateFolder}
                            icon={FolderPlus}
                            tooltip="New Folder"
                            shortcut="⌘⇧N"
                            className="shrink-0"
                        />

                        <div className="w-px h-3 bg-white/[0.06] mx-[3px] shrink-0" />

                        <HeaderActionBtn
                            onClick={handleToggleFolders}
                            icon={anyFolderOpen ? ChevronsDownUp : ChevronsUpDown}
                            iconSize={14}
                            tooltip={anyFolderOpen ? 'Collapse All Folders' : 'Expand All Folders'}
                        />
                        <div className="relative">
                            <HeaderActionBtn
                                onClick={handleRefresh}
                                icon={RefreshCw}
                                iconSize={12}
                                tooltip="Refresh Explorer"
                            />
                            {isRefreshing && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <RefreshCw size={12} className="text-blue-400 animate-spin" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Project stats bar */}
                <div className="h-7 px-3 flex items-center gap-2 border-t border-white/[0.03] border-b border-b-white/[0.03] bg-gradient-to-r from-white/[0.01] to-transparent overflow-hidden">
                    {/* File count */}
                    <div className="flex items-center gap-1.5 shrink min-w-0">
                        <div className="w-[4px] h-[4px] shrink-0 rounded-full bg-gradient-to-r from-blue-400 to-cyan-400 shadow-[0_0_4px_rgba(59,130,246,0.4)]" />
                        <span className="text-[10px] font-medium text-white/35 tabular-nums truncate">
                            <span className="text-white/50 font-semibold">{files}</span> file{files !== 1 ? 's' : ''}
                        </span>
                    </div>

                    <span className="text-white/[0.06] text-[10px] shrink-0">·</span>

                    {/* Folder count */}
                    <div className="flex items-center gap-1.5 shrink min-w-0">
                        <div className="w-[4px] h-[4px] shrink-0 rounded-full bg-gradient-to-r from-purple-400 to-pink-400 shadow-[0_0_4px_rgba(168,85,247,0.3)]" />
                        <span className="text-[10px] font-medium text-white/35 tabular-nums truncate">
                            <span className="text-white/50 font-semibold">{folders}</span> folder{folders !== 1 ? 's' : ''}
                        </span>
                    </div>

                    <div className="flex-1" />

                    {/* Active badge */}
                    <div className="flex items-center gap-1 px-1.5 py-[1px] rounded bg-emerald-500/[0.06] border border-emerald-500/[0.08] shrink-0 ml-1 overflow-hidden max-w-[60px]">
                        <Sparkles size={7} className="text-emerald-400/50 shrink-0" />
                        <span className="text-[7px] font-bold text-emerald-400/40 uppercase tracking-[0.15em] truncate">Active</span>
                    </div>
                </div>
            </div>

            {/* File Explorer */}
            <div className="flex-1 overflow-hidden">
                <FileExplorer isSearchOpen={isSearchOpen} onSearchClose={() => setIsSearchOpen(false)} />
            </div>
        </div>
    );
};
