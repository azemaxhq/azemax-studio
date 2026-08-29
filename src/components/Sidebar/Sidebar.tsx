import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
    FilePlus, FolderPlus, ChevronsDownUp, ChevronsUpDown,
    RefreshCw, Search
} from 'lucide-react';
import { FileExplorer } from './FileExplorer';
import { useProjectFile, useProjectUI, useProjectActions } from '../../context/ProjectContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ErrorBoundary } from '../UI/ErrorBoundary';
import { countTree } from '../../utils/safeTree';

// The file tree is sanitized at its entry point (ProjectContext.loadFileTree),
// and countTree is iterative + cycle-safe, so this render path can never
// overflow the stack ("too much recursion") on corrupt data. Folder expansion
// is UI state (expandedFolderIds), never part of the filesystem tree.

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
                    relative p-1.5 rounded-md transition-all duration-150 group/abtn
                    ${isActive
                        ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border border-[var(--az-border)]'
                        : danger
                            ? 'text-[var(--az-text-muted)] hover:text-[var(--az-error)] hover:bg-[var(--az-error-soft)]'
                            : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] active:scale-[0.97]'
                    }
                `}
            >
                <Icon size={iconSize} className="relative z-10 transition-transform duration-150 group-hover/abtn:scale-110" />
                {isActive && (
                    <div className="absolute inset-0 rounded-md bg-blue-500/5" />
                )}
            </button>
            <ActionTooltip text={tooltip} shortcut={shortcut} show={showTooltip} anchorRect={anchorRect} />
        </div>
    );
};

export const Sidebar: React.FC = () => {
    const { fileTree } = useProjectFile();
    const { selectedFolder, expandedFolderIds } = useProjectUI();
    const { startCreating, collapseAll, expandAll } = useProjectActions();
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    // Below 1024px the header action cluster becomes fluid: buttons compress,
    // gap/divider spacing tightens, and the cluster may wrap to a second row
    // instead of ever clipping. Desktop rendering is completely unchanged.
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    }, []);

    const { files, folders } = useMemo(() => countTree(fileTree), [fileTree]);
    // The canonical root is a container, not a user-facing folder — never count it.
    const folderCount = Math.max(0, folders - 1);
    // The root is always in the expansion set; any extra id means a folder is open.
    const anyFolderOpenFlag = expandedFolderIds.size > 1;

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
        refreshTimerRef.current = setTimeout(() => {
            setIsRefreshing(false);
        }, 600);
    }, []);

    const toggleSearch = useCallback(() => {
        setIsSearchOpen(prev => !prev);
    }, []);

    const handleToggleFolders = useCallback(() => {
        if (anyFolderOpenFlag) {
            collapseAll();
        } else {
            expandAll();
        }
    }, [anyFolderOpenFlag, collapseAll, expandAll]);

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
        <div className="h-full flex flex-col relative overflow-hidden group/sidebar" style={{ background: 'var(--az-surface)' }}>
            <div className="shrink-0 relative z-10">
                <div className={`${isDesktop ? 'h-10 flex-nowrap overflow-hidden' : 'min-h-10 flex-wrap'} flex items-center justify-between px-2 relative`} style={{ borderBottom: '1px solid var(--az-border)' }}>
                    <div className="flex items-center min-w-0 flex-1 mr-2 px-1">
                        <span className="text-[11px] font-medium tracking-wider uppercase truncate select-none" style={{ color: 'var(--az-text-muted)' }}>
                            Explorer
                        </span>
                    </div>

                    {/* Action buttons */}
                    <div className={`flex items-center justify-end ${isDesktop ? 'flex-nowrap gap-[2px] overflow-hidden' : 'flex-wrap gap-x-1 gap-y-0.5'} shrink min-w-0`}>
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
                            icon={anyFolderOpenFlag ? ChevronsDownUp : ChevronsUpDown}
                            iconSize={14}
                            tooltip={anyFolderOpenFlag ? 'Collapse All Folders' : 'Expand All Folders'}
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

                <div className="h-7 px-3 flex items-center gap-2 overflow-hidden" style={{ borderBottom: '1px solid var(--az-border)', background: 'var(--az-surface-2)' }}>
                    <span className="text-[10px] tabular-nums truncate" style={{ color: 'var(--az-text-muted)' }}>
                        <span style={{ color: 'var(--az-text-secondary)', fontWeight: 600 }}>{files}</span> file{files !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--az-border-strong)' }}>·</span>
                    <span className="text-[10px] tabular-nums truncate" style={{ color: 'var(--az-text-muted)' }}>
                        <span style={{ color: 'var(--az-text-secondary)', fontWeight: 600 }}>{folderCount}</span> folder{folderCount !== 1 ? 's' : ''}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[10px] font-medium truncate" style={{ color: 'var(--az-text-faint)' }}>{anyFolderOpenFlag ? 'Expanded' : 'Collapsed'}</span>
                </div>
            </div>

            {/* File Explorer */}
            <div className="flex-1 overflow-hidden">
                <ErrorBoundary>
                    <FileExplorer isSearchOpen={isSearchOpen} onSearchClose={() => setIsSearchOpen(false)} />
                </ErrorBoundary>
            </div>
        </div>
    );
};
