import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
    FilePlus, FolderPlus, ChevronsDownUp, ChevronsUpDown,
    RefreshCw, Search, MoreHorizontal,
    ArrowUpDown, ArrowUp, ArrowDown, Folder,
    FileType, Clock, HardDrive, X,
} from 'lucide-react';
import { FileExplorer } from './FileExplorer';
import { useProjectFile, useProjectUI, useProjectActions } from '../../context/ProjectContext';
import { requestExplorerRefresh } from '../../core/filesystem/fileChangeService';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ErrorBoundary } from '../UI/ErrorBoundary';
import { countTree } from '../../utils/safeTree';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { loadSortState, saveSortState, type ExplorerSortState, type SortBy } from '../../utils/explorerSort';

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
            <div className="px-2.5 py-1.5 rounded-[7px] bg-[var(--az-overlay)] border border-[var(--az-border)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] text-[11px] font-medium text-[var(--az-text-secondary)] flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                <span>{text}</span>
                {shortcut && (
                    <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/40 font-mono border border-white/[0.06]">{shortcut}</kbd>
                )}
            </div>
        </div>,
        document.body
    );
};

// Header action button — 14px visual, 28px hit area, subtle hover (4-6px radius), no scale
const HeaderActionBtn = ({
    onClick,
    icon: Icon,
    iconSize = 16,
    tooltip,
    shortcut,
    isActive = false,
    danger = false,
    className,
    'aria-label': ariaLabel,
    isBusy = false,
}: {
    onClick: () => void;
    icon: React.ElementType;
    iconSize?: number;
    tooltip: string;
    shortcut?: string;
    isActive?: boolean;
    danger?: boolean;
    className?: string;
    'aria-label'?: string;
    isBusy?: boolean;
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
        }, 420);
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
                aria-label={ariaLabel || tooltip}
                aria-pressed={isActive}
                onClick={() => { onClick(); setShowTooltip(false); }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onFocus={() => {
                    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
                    setShowTooltip(true);
                }}
                onBlur={() => { setShowTooltip(false); setAnchorRect(null); }}
                className={`
                    relative w-7 h-7 flex items-center justify-center rounded-[6px] transition-colors duration-150 ease-out group/abtn shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] focus-visible:ring-offset-0 border active:bg-[var(--az-surface-active)]
                    ${isActive
                        ? 'text-[var(--az-text)] bg-[var(--az-surface-3)] border-[var(--az-border)]'
                        : danger
                            ? 'text-[var(--az-icon)] hover:text-[var(--az-error)] hover:bg-[var(--az-error-soft)] border-transparent hover:border-[var(--az-error-border)]'
                            : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-white/[0.06] border-transparent'
                    }
                `}
            >
                <Icon size={iconSize} strokeWidth={1.75} className={`relative z-10 shrink-0 ${isBusy ? 'animate-spin' : ''}`} />
            </button>
            <ActionTooltip text={tooltip} shortcut={shortcut} show={showTooltip} anchorRect={anchorRect} />
        </div>
    );
};

interface SidebarProps {
    onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
    const { fileTree } = useProjectFile();
    const { selectedFolder, expandedFolderIds, creationState } = useProjectUI();
    const { startCreating, collapseAll, expandAll } = useProjectActions();
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const _isDesktop = useMediaQuery('(min-width: 1024px)');
    void _isDesktop;
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showOverflow, setShowOverflow] = useState(false);
    const [showSortMenu, setShowSortMenu] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [sortState, setSortState] = useState<ExplorerSortState>(() => loadSortState());

    useEffect(() => {
        saveSortState(sortState);
        // Notify FileExplorer via storage event + custom event for same-tab sync
        window.dispatchEvent(new CustomEvent('azemax-sort-changed', { detail: sortState }));
    }, [sortState]);

    // Open the sort menu on request (Explorer context menu "Sort By…").
    useEffect(() => {
        const openSortMenu = () => setShowSortMenu(true);
        window.addEventListener('azemax-open-sort', openSortMenu);
        return () => window.removeEventListener('azemax-open-sort', openSortMenu);
    }, []);

    useEffect(() => () => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    }, []);
    useEffect(() => {
        if (!showOverflow && !showSortMenu) return;
        const onDown = (e: MouseEvent) => {
            if (showOverflow && overflowRef.current && !overflowRef.current.contains(e.target as Node)) setShowOverflow(false);
            if (showSortMenu && sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSortMenu(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowOverflow(false); setShowSortMenu(false); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [showOverflow, showSortMenu]);

    const { files, folders } = useMemo(() => countTree(fileTree), [fileTree]);
    // The canonical root is a container, not a project folder — exclude it
    // from the count only when it is actually present (rootless workspaces
    // created from the empty state have no root node at all).
    const folderCount = Math.max(0, folders - (fileTree.some((n) => n.id === ROOT_NODE_ID) ? 1 : 0));
    const anyFolderOpenFlag = expandedFolderIds.size > 1;

    const handleCreateFile = useCallback(() => {
        if (creationState.isActive) {
            requestAnimationFrame(() => {
                const el = document.querySelector<HTMLInputElement>('[aria-label="File name"], [aria-label="Folder name"]');
                el?.focus();
            });
            return;
        }
        const parentId = selectedFolder || 'root';
        startCreating('file', parentId);
    }, [selectedFolder, startCreating, creationState.isActive]);

    const handleCreateFolder = useCallback(() => {
        if (creationState.isActive) {
            requestAnimationFrame(() => {
                const el = document.querySelector<HTMLInputElement>('[aria-label="File name"], [aria-label="Folder name"]');
                el?.focus();
            });
            return;
        }
        const parentId = selectedFolder || 'root';
        startCreating('folder', parentId);
    }, [selectedFolder, startCreating, creationState.isActive]);

    const handleRefresh = useCallback(() => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        requestExplorerRefresh('manual');
        refreshTimerRef.current = setTimeout(() => {
            setIsRefreshing(false);
        }, 700);
    }, [isRefreshing]);

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

    const setSortBy = useCallback((by: SortBy) => {
        setSortState(prev => ({ ...prev, by }));
    }, []);
    const toggleDirection = useCallback(() => {
        setSortState(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }));
    }, []);
    const toggleFoldersFirst = useCallback(() => {
        setSortState(prev => ({ ...prev, foldersFirst: !prev.foldersFirst }));
    }, []);

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
                <div className="flex items-center justify-between pl-3 pr-1.5 gap-2 relative shrink-0" style={{ height: 'var(--az-topbar-height)', minHeight: 'var(--az-topbar-height)', borderBottom: '1px solid var(--az-border)', background: 'var(--az-surface)' }}>
                    <div className="flex items-center min-w-0 flex-1">
                        <span className="text-[11px] font-[600] tracking-[0.08em] uppercase truncate select-none leading-none antialiased" style={{ color: 'var(--az-text)', letterSpacing: '0.08em' }}>
                            Explorer
                        </span>
                    </div>

                    {/* Header actions — compact IDE toolbar: Search / New File / New Folder / Sort / Refresh / More */}
                    <div className="flex items-center gap-1 shrink-0">
                        <HeaderActionBtn
                            onClick={toggleSearch}
                            icon={Search}
                            iconSize={16}
                            tooltip="Search Explorer"
                            shortcut="⌘F"
                            isActive={isSearchOpen}
                            aria-label="Search Explorer"
                        />
                        <span className="w-px h-3 bg-white/[0.06] mx-1 shrink-0" aria-hidden />
                        <HeaderActionBtn
                            onClick={handleCreateFile}
                            icon={FilePlus}
                            iconSize={16}
                            tooltip="New File"
                            shortcut="⌘N"
                            aria-label="New File"
                        />
                        <HeaderActionBtn
                            onClick={handleCreateFolder}
                            icon={FolderPlus}
                            iconSize={16}
                            tooltip="New Folder"
                            shortcut="⌘⇧N"
                            aria-label="New Folder"
                        />
                        <span className="w-px h-3 bg-white/[0.06] mx-1 shrink-0" aria-hidden />
                        {/* Sort / Arrange */}
                        <div className="relative" ref={sortRef}>
                            <button
                                onClick={() => setShowSortMenu(v => !v)}
                                aria-label="Sort Explorer"
                                aria-expanded={showSortMenu}
                                title="Sort Explorer"
                                className={`w-7 h-7 flex items-center justify-center rounded-[6px] border transition-colors duration-150 shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] active:bg-[var(--az-surface-active)] ${showSortMenu ? 'bg-[var(--az-surface-3)] text-[var(--az-text)] border-[var(--az-border)]' : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-white/[0.06] border-transparent'}`}
                            >
                                <ArrowUpDown size={16} strokeWidth={1.75} className="shrink-0" />
                            </button>
                            {showSortMenu && (
                                <div className="absolute right-0 top-[36px] min-w-[214px] py-1.5 rounded-xl border shadow-xl z-50 overflow-hidden" style={{ background: 'var(--az-overlay)', borderColor: 'var(--az-border)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
                                    <div className="px-3 pb-1.5 pt-1 text-[10px] tracking-[0.08em] uppercase font-semibold" style={{ color: 'var(--az-text-faint)' }}>Sort by</div>
                                    {([
                                        { id: 'name' as SortBy, label: 'Name', icon: ArrowUpDown },
                                        { id: 'type' as SortBy, label: 'Type', icon: FileType },
                                        { id: 'modified' as SortBy, label: 'Modified', icon: Clock },
                                        { id: 'size' as SortBy, label: 'Size', icon: HardDrive },
                                    ] as const).map(o => (
                                        <button
                                            key={o.id}
                                            onClick={() => setSortBy(o.id)}
                                            className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 transition-colors mx-1 rounded-[6px] ${sortState.by === o.id ? 'bg-[var(--az-surface-3)] text-[var(--az-text)]' : 'text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)]'}`}
                                            style={{ width: 'calc(100% - 8px)' }}
                                        >
                                            <o.icon size={14} className="shrink-0 opacity-70" />
                                            <span className="flex-1">{o.label}</span>
                                            {sortState.by === o.id && <span className="w-1.5 h-1.5 rounded-full bg-[var(--az-accent)] shrink-0" />}
                                        </button>
                                    ))}
                                    <div className="h-px bg-white/[0.06] my-1.5 mx-2" />
                                    <button onClick={toggleFoldersFirst} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        <Folder size={14} className="shrink-0 opacity-70" />
                                        <span className="flex-1">Folders First</span>
                                        <span className={`w-[14px] h-[14px] rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${sortState.foldersFirst ? 'bg-[var(--az-accent)] border-[var(--az-accent)] text-white' : 'border-[var(--az-border)] bg-transparent'}`}>
                                            {sortState.foldersFirst && <span className="text-[9px] leading-none">✓</span>}
                                        </span>
                                    </button>
                                    <button onClick={toggleDirection} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        {sortState.direction === 'asc' ? <ArrowUp size={14} className="shrink-0 opacity-70" /> : <ArrowDown size={14} className="shrink-0 opacity-70" />}
                                        <span className="flex-1">{sortState.direction === 'asc' ? 'Ascending' : 'Descending'}</span>
                                        <span className="text-[10px] tracking-widest font-semibold opacity-50">{sortState.direction === 'asc' ? 'A → Z' : 'Z → A'}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                        <HeaderActionBtn
                            onClick={handleRefresh}
                            icon={RefreshCw}
                            iconSize={16}
                            tooltip="Refresh Explorer"
                            aria-label="Refresh Explorer"
                            isBusy={isRefreshing}
                        />
                        <div className="relative" ref={overflowRef}>
                            <button
                                onClick={() => setShowOverflow(v => !v)}
                                aria-label="More actions"
                                aria-expanded={showOverflow}
                                className={`w-7 h-7 flex items-center justify-center rounded-[6px] border transition-colors duration-150 shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)] active:bg-[var(--az-surface-active)] ${showOverflow ? 'bg-[var(--az-surface-3)] text-[var(--az-text)] border-[var(--az-border)]' : 'text-[var(--az-icon)] hover:text-[var(--az-icon-hover)] hover:bg-white/[0.06] border-transparent'}`}
                            >
                                <MoreHorizontal size={16} strokeWidth={1.75} className="shrink-0" />
                            </button>
                            {showOverflow && (
                                <div className="absolute right-0 top-[36px] min-w-[200px] py-1.5 rounded-xl border shadow-xl z-50 overflow-hidden" style={{ background: 'var(--az-overlay)', borderColor: 'var(--az-border)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
                                    <button onClick={() => { setShowOverflow(false); handleRefresh(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        <RefreshCw size={14} className={`shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh Explorer
                                    </button>
                                    <div className="h-px bg-white/[0.06] my-1.5 mx-2" />
                                    <div className="px-3 py-1 text-[10px] tracking-[0.08em] uppercase font-semibold" style={{ color: 'var(--az-text-faint)' }}>View</div>
                                    <button onClick={() => { setShowOverflow(false); handleToggleFolders(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        {anyFolderOpenFlag ? <ChevronsDownUp size={14} className="shrink-0" /> : <ChevronsUpDown size={14} className="shrink-0" />}
                                        {anyFolderOpenFlag ? 'Collapse All' : 'Expand All'}
                                    </button>
                                    <div className="h-px bg-white/[0.06] my-1.5 mx-2" />
                                    <div className="px-3 py-1 text-[10px] tracking-[0.08em] uppercase font-semibold" style={{ color: 'var(--az-text-faint)' }}>New</div>
                                    <button onClick={() => { setShowOverflow(false); handleCreateFile(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        <FilePlus size={14} className="shrink-0" /> New File <span className="ml-auto text-[10px] text-white/30 font-mono">⌘N</span>
                                    </button>
                                    <button onClick={() => { setShowOverflow(false); handleCreateFolder(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2.5 text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-3)] transition-colors mx-1 rounded-[6px]" style={{ width: 'calc(100% - 8px)' }}>
                                        <FolderPlus size={14} className="shrink-0" /> New Folder <span className="ml-auto text-[10px] text-white/30 font-mono">⇧⌘N</span>
                                    </button>
                                </div>
                            )}
                        </div>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="w-7 h-7 flex items-center justify-center rounded-[6px] border border-transparent hover:bg-white/[0.08] hover:border-[var(--az-border)] text-[var(--az-icon)] hover:text-[var(--az-text)] transition-colors ml-1 shrink-0"
                                aria-label="Close Explorer"
                                title="Close Explorer"
                            >
                                <X size={15} strokeWidth={1.75} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="h-[24px] min-h-[24px] px-3 flex items-center gap-2 overflow-hidden shrink-0" style={{ borderBottom: '1px solid var(--az-border)', background: 'var(--az-surface-2)' }}>
                    <span className="text-[11px] tabular-nums truncate leading-none antialiased font-normal flex items-center gap-1" style={{ color: 'var(--az-text-faint)' }}>
                        <span style={{ color: 'var(--az-text-muted)', fontWeight: 550 }}>{files}</span> <span className="text-[10px] tracking-wide">files</span>
                    </span>
                    <span className="w-px h-3 bg-white/[0.06] shrink-0 mx-0.5" aria-hidden />
                    <span className="text-[11px] tabular-nums truncate leading-none antialiased font-normal flex items-center gap-1" style={{ color: 'var(--az-text-faint)' }}>
                        <span style={{ color: 'var(--az-text-muted)', fontWeight: 550 }}>{folderCount}</span> <span className="text-[10px] tracking-wide">folders</span>
                    </span>
                    <span className="flex-1" />
                    {/* Collapse/Expand-all control — hides when narrow via container query */}
                    <button
                        onClick={handleToggleFolders}
                        aria-label={anyFolderOpenFlag ? 'Collapse all folders' : 'Expand all folders'}
                        title={anyFolderOpenFlag ? 'Collapse All' : 'Expand All'}
                        className="hidden @container:inline-flex items-center gap-1 pl-1.5 pr-1 pr-2 py-1 rounded-[6px] text-[11px] font-medium leading-none transition-colors shrink-0 border border-transparent hover:border-[var(--az-border)] hover:bg-[var(--az-surface-3)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)]"
                        style={{ color: 'var(--az-text-muted)' }}
                    >
                        {anyFolderOpenFlag ? <ChevronsDownUp size={12} className="shrink-0" /> : <ChevronsUpDown size={12} className="shrink-0" />}
                        <span className="hidden lg:inline text-[10.5px]">{anyFolderOpenFlag ? 'Collapse' : 'Expand'}</span>
                    </button>
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
