import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { useProjectFile, useProjectUI, useProjectActions } from '../../context/ProjectContext';
import {
    flattenTree as flattenTreeSafe,
    filterTree,
    findNodeById,
    collectIds,
    collectFiles,
    isDescendantOf,
    childrenOf,
    pathOf,
} from '../../utils/safeTree';
import {
    Folder,
    ChevronRight,
    Search, X, Settings,
    Trash2
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';
import { useDialog } from '../UI/DialogProvider';
import { useSettingsSelector } from '../../context/SettingsContext';
import { getSettings } from '../../settings/settingsStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { loadSortState, sortTreeWithState, type ExplorerSortState } from '../../utils/explorerSort';
import { fuzzyMatch, fuzzyHighlight } from '../../utils/fuzzySearch';

import { ExplorerFileIcon, ExplorerFolderIcon } from './ExplorerIcons';

// Render recursion is bounded so a pathologically deep (but still valid) tree
// can never render an unbounded component chain. Beyond this depth the node is
// shown without descending into children.
const MAX_RENDER_DEPTH = 128;

interface InputNodeProps {
    type: 'file' | 'folder';
    depth: number;
    initialValue?: string;
    indentStep: number;
    indentBase: number;
    parentId?: string | null;
    excludeId?: string | null;
    onCommit: (name: string) => void;
    onCancel: () => void;
}

const InputNode = ({ type, depth, initialValue = '', indentStep, indentBase, parentId = null, excludeId = null, onCommit, onCancel }: InputNodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState<string | null>(null);
    const isSubmitting = useRef(false);
    const { fileTree } = useProjectFile();

    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                // Smart selection: select filename without extension
                if (initialValue) {
                    const lastDotIndex = initialValue.lastIndexOf('.');
                    // Don't select extension, keep it visible but unselected
                    if (lastDotIndex > 0 && lastDotIndex < initialValue.length - 1) {
                        inputRef.current.setSelectionRange(0, lastDotIndex);
                    } else {
                        inputRef.current.select();
                    }
                }
            }
        }, 16);
        return () => clearTimeout(timer);
    }, [initialValue]);

    const validate = useCallback((name: string): string | null => {
        const trimmed = name.trim();
        if (!trimmed) return null; // empty handled as cancel, not error
        if (trimmed.length > 255) return 'Name too long';
        if (trimmed === '.' || trimmed === '..') return 'Invalid name';
        if (/[\/\\]/.test(trimmed)) return 'Name cannot contain / or \\';
        if (/[*?"<>|:;\x00-\x1F]/.test(trimmed)) return 'Invalid character';
        if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return 'Name cannot end with space or dot';
        // Duplicate check — scoped to parent folder when known
        if (parentId !== null && parentId !== undefined) {
            const parentNode = findNodeById(fileTree, parentId);
            const siblings = parentNode?.children ?? (parentId === ROOT_NODE_ID ? fileTree.filter(n => n.parentId === ROOT_NODE_ID) : []);
            const toCheck = siblings.length ? siblings : (parentNode?.children ?? []);
            // Fallback: for root, check top-level
            const effective = parentId === ROOT_NODE_ID ? fileTree.filter(n => n.parentId === ROOT_NODE_ID || n.id === ROOT_NODE_ID) : toCheck;
            const list = effective.length ? effective : siblings;
            const dup = list.some(c => c.id !== excludeId && c.name.toLowerCase() === trimmed.toLowerCase());
            if (dup) return type === 'folder' ? 'A folder with this name already exists' : 'A file with this name already exists';
        } else if (parentId === null) {
            // Root creation without explicit parentId — check top-level
            const dup = fileTree.some(c => c.id !== excludeId && c.name.toLowerCase() === trimmed.toLowerCase() && c.parentId === ROOT_NODE_ID);
            if (dup) return type === 'folder' ? 'A folder with this name already exists' : 'A file with this name already exists';
        }
        return null;
    }, [fileTree, parentId, excludeId, type]);

    const handleCommit = useCallback(() => {
        if (isSubmitting.current) return;
        const trimmed = value.trim();
        if (!trimmed) { isSubmitting.current = true; onCancel(); return; }
        const err = validate(trimmed);
        if (err) { setError(err); return; }
        isSubmitting.current = true;
        setError(null);
        onCommit(trimmed);
    }, [value, validate, onCommit, onCancel]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            handleCommit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (isSubmitting.current) return;
            isSubmitting.current = true;
            onCancel();
        }
    };

    const handleBlur = () => {
        if (isSubmitting.current) return;
        // Allow click on error to not immediately commit — slight delay
        setTimeout(() => {
            if (isSubmitting.current) return;
            const trimmed = value.trim();
            if (!trimmed) { isSubmitting.current = true; onCancel(); return; }
            const err = validate(trimmed);
            if (err) { setError(err); return; }
            isSubmitting.current = true;
            onCommit(trimmed);
        }, 120);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
        if (error) {
            const nextErr = validate(e.target.value.trim());
            // Clear error as user types, or update message for still-invalid
            if (!nextErr || nextErr !== error) setError(null);
            if (nextErr && e.target.value.trim().length > 0) setError(nextErr);
            else if (!nextErr) setError(null);
        }
    };

    const isFolder = type === 'folder';

    return (
        <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="mx-1.5 relative"
        >
            <div
                style={{ paddingLeft: `${depth * indentStep + indentBase}px` }}
                className={cn(
                    "flex items-center gap-2 py-0 pr-3 min-h-[34px] h-[34px] rounded-[6px] border text-[13px] leading-none select-none transition-colors duration-150",
                    "bg-[var(--az-surface-2)] border-[var(--az-border)] focus-within:bg-[var(--az-surface-3)] focus-within:border-[var(--az-border-strong)] focus-within:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                )}
            >
                {/* Chevron placeholder — fixed 16px slot, preserves tree geometry */}
                <span className="shrink-0 w-4 h-4 flex items-center justify-center opacity-0 select-none" aria-hidden>
                    <ChevronRight size={12} strokeWidth={1.75} className="invisible" />
                </span>
                {/* Icon — fixed 16px container, 14px visual, vertically centered */}
                <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 leading-none">
                    {isFolder
                        ? <ExplorerFolderIcon isOpen={false} />
                        : <ExplorerFileIcon name={value.trim() || 'file.txt'} />
                    }
                </span>
                {/* Inline input — flex-1, full width, comfortable padding, Azemax-native focus */}
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    aria-label={isFolder ? 'Folder name' : 'File name'}
                    aria-invalid={!!error}
                    aria-describedby={error ? 'explorer-input-error' : undefined}
                    placeholder={isFolder ? "Folder name..." : "File name..."}
                    className={cn(
                        "flex-1 min-w-0 w-full bg-transparent border-0 px-1 py-1 m-0 h-7 leading-none truncate",
                        "text-[13px] font-[450] antialiased tracking-[-0.01em]",
                        "placeholder:text-white/25 placeholder:font-normal placeholder:text-[12px] text-[var(--az-text)] selection:bg-white/[0.12] caret-[var(--az-text)]",
                        "outline-none !outline-none focus:outline-none focus-visible:outline-none focus:!outline-none focus-visible:!outline-none focus:ring-0 focus-visible:ring-0 focus:!ring-0 focus-visible:!ring-0 focus:shadow-none focus-visible:shadow-none focus:!shadow-none focus-visible:!shadow-none"
                    )}
                />
            </div>
            {error && (
                <div
                    id="explorer-input-error"
                    className="mt-1 px-2 py-1 rounded-[4px] border text-[11px] leading-snug"
                    style={{ marginLeft: `${depth * indentStep + indentBase + 24}px`, marginRight: '8px', background: 'var(--az-error-soft)', borderColor: 'var(--az-error-border)', color: 'var(--az-error)' } as React.CSSProperties}
                    role="alert"
                >
                    {error}
                </div>
            )}
        </motion.div>
    )
}

// Premium icon system now centralized in ExplorerIcons.tsx — consistent 18px optical box

interface FileTreeNodeProps {
    node: FileNode;
    depth: number;
    indentStep: number;
    indentBase: number;
    renamingNodeId: string | null;
    focusedNodeId: string | null;
    searchQuery: string;
    activeFileId: string | null;
    selectedNodeId: string | null;
    creationState: { type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean };
    expandedFolderIds: ReadonlySet<string>;
    onSetActiveFile: (node: FileNode) => void;
    onToggleFolder: (id: string) => void;
    onSetSelectedFolder: (id: string) => void;
    onSetSelectedNode: (id: string) => void;
    onStartCreating?: (type: 'file' | 'folder') => void;
    onCommitCreation: (name: string) => void;
    onCancelCreation: () => void;
    onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
    onRenameCommit: (name: string) => void;
    onRenameCancel: () => void;
    onDelete: (id: string) => void;
    onFocus: (id: string) => void;
    onDragStart: (e: React.DragEvent, node: FileNode) => void;
    onDragOver: (e: React.DragEvent, node: FileNode) => void;
    onDrop: (e: React.DragEvent, node: FileNode) => void;
    onDragEnd: () => void;
    dragOverNodeId: string | null;
    onDownload?: (nodeId: string) => void;
    onBookmark?: (nodeId: string) => void;
    isBookmarked?: boolean;
    newlyCreatedNodes?: Set<string>;
    isDirty?: boolean;
    gitStatus?: 'M' | 'A' | 'U' | null;
    hasError?: boolean;
    hasWarning?: boolean;
}

// Highlight matching text — uses fuzzy subsequence indices for premium search feel
const HighlightText = ({ text, query }: { text: string; query: string }) => {
    if (!query || !query.trim()) return <span>{text}</span>;
    const { matched, indices } = fuzzyMatch(text, query);
    if (!matched) return <span>{text}</span>;
    const parts = fuzzyHighlight(text, indices);
    return (
        <span>
            {parts.map((p, i) =>
                p.highlight
                    ? <mark key={i} className="bg-amber-500/20 text-amber-200 rounded-[2px] px-[1px] py-0 ring-1 ring-amber-500/25 font-medium">{p.text}</mark>
                    : <span key={i}>{p.text}</span>
            )}
        </span>
    );
};

const FileTreeNode: React.FC<FileTreeNodeProps> = memo(({
    node,
    depth,
    indentStep,
    indentBase,
    renamingNodeId,
    focusedNodeId,
    searchQuery,
    onContextMenu,
    onRenameCommit,
    onRenameCancel,
    onDelete,
    onFocus,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    dragOverNodeId,
    onDownload,
    onBookmark,
    isBookmarked = false,
    newlyCreatedNodes,
    activeFileId,
    selectedNodeId,
    creationState,
    expandedFolderIds,
    onSetActiveFile,
    onToggleFolder,
    onSetSelectedFolder,
    onSetSelectedNode,
    onStartCreating,
    onCommitCreation,
    onCancelCreation,
    isDirty = false,
    gitStatus = null,
    hasError = false,
    hasWarning = false,
}) => {
    const isFolder = node.type === 'folder';
    // A folder is open when the UI expansion set includes it, or when search
    // mode force-opened it on the filtered clone (node.isOpen === true).
    const isOpen = isFolder && (expandedFolderIds.has(node.id) || node.isOpen === true);
    const isActive = activeFileId === node.id;
    const isFocused = focusedNodeId === node.id;
    const isSelected = selectedNodeId === node.id;
    const isRenaming = renamingNodeId === node.id;
    const isDragOver = dragOverNodeId === node.id && isFolder;
    const isNewlyCreated = newlyCreatedNodes?.has(node.id) ?? false;
    // Dirty state kept for future use; yellow modification dots removed per design (Image 1)
    void isDirty;
    void hasWarning;
    const { modifiedFiles: _dirtySet } = useProjectFile();
    void _dirtySet;

    const isCreatingHere = creationState.isActive && (
        creationState.parentId === node.id ||
        (creationState.parentId === 'root' && node.id === 'root')
    );

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Ignore the second click of a double-click — dblclick handles folder toggle once
        if (isFolder && e.detail > 1) {
            onFocus(node.id);
            onSetSelectedNode(node.id);
            onSetSelectedFolder(node.id);
            return;
        }
        onFocus(node.id);
        onSetSelectedNode(node.id);
        if (isFolder) {
            onToggleFolder(node.id);
            onSetSelectedFolder(node.id);
        } else {
            onSetActiveFile(node);
            onSetSelectedFolder(node.parentId ?? ROOT_NODE_ID);
        }
    };

    const handleChevronClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!isFolder) return;
        // Chevron toggles without changing selection — premium IDE behavior
        onToggleFolder(node.id);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Folders are toggled on single click; double-click would otherwise
        // cause a second toggle and appear not to open. Keep dblclick no-op for folders.
        if (isFolder) return;
        onSetActiveFile(node);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(node.id);
    };

    const handleDownloadClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDownload) {
            onDownload(node.id);
        }
    };

    const handleDragStart = (e: React.DragEvent) => {
        onDragStart(e, node);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (isFolder) {
            onDragOver(e, node);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isFolder) {
            onDrop(e, node);
        }
    };

    if (isRenaming) {
        return (
            <InputNode
                type={node.type}
                depth={depth}
                indentStep={indentStep}
                indentBase={indentBase}
                parentId={node.parentId ?? ROOT_NODE_ID}
                excludeId={node.id}
                initialValue={node.name}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
            />
        );
    }

    return (
        <div className={isNewlyCreated ? 'animate-creation-success rounded-[6px]' : ''}>
            <div
                data-testid="file-tree-item"
                data-file-name={node.name}
                role="treeitem"
                aria-expanded={isFolder ? isOpen : undefined}
                aria-selected={isActive || isSelected}
                aria-label={`${isFolder ? 'Folder' : 'File'} ${node.name}${isActive ? ' active' : ''}`}
                tabIndex={isFocused ? 0 : -1}
                className={cn(
                    "flex items-center gap-1.5 py-0 pr-2 cursor-pointer transition-colors duration-100 text-[13px] leading-none select-none group relative rounded-[6px] mx-1.5 border min-h-[28px] h-[28px] antialiased outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)]",
                    isActive
                        ? "bg-[rgba(91,140,255,0.09)] text-[#E7ECF3] border-transparent font-[500] after:absolute after:left-0 after:top-[5px] after:bottom-[5px] after:w-[2px] after:rounded-full after:bg-[var(--az-accent)]"
                        : isFocused
                            ? "bg-[var(--az-surface-2)] text-[var(--az-text)] border-[var(--az-border)] font-[450]"
                            : isSelected
                                ? "bg-[var(--az-surface-2)] text-[var(--az-text)] border-[var(--az-border)] font-[450]"
                                : "text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-[rgba(255,255,255,0.035)] border-transparent font-[400] hover:border-white/[0.03]",
                    isDragOver && "bg-[var(--az-accent-soft)] border-[var(--az-accent-border)] shadow-[0_0_0_1px_var(--az-accent-border)]",
                )}
                style={{ paddingLeft: `${depth * indentStep + indentBase}px` }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={(e) => onContextMenu(e, node)}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={onDragEnd}
                data-node-id={node.id}
            >
                {/* Chevron — 20px hit area, 12px glyph, fixed slot for reliable toggle */}
                <button
                    aria-label={isFolder ? (isOpen ? 'Collapse folder' : 'Expand folder') : undefined}
                    tabIndex={-1}
                    onClick={handleChevronClick}
                    className={cn(
                        "shrink-0 w-5 h-5 flex items-center justify-center rounded-[4px] transition-[transform,background,opacity,color] duration-150 ease-out focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--az-accent-ring)]",
                        isFolder ? "opacity-45 hover:opacity-100 hover:bg-white/[0.06] text-[var(--az-text-muted)] hover:text-[var(--az-text)] cursor-pointer" : "opacity-0 pointer-events-none",
                        isOpen && isFolder && "rotate-90 opacity-60"
                    )}
                >
                    {isFolder ? <ChevronRight size={12} strokeWidth={1.75} /> : <span className="w-2.5" />}
                </button>

                {/* File/Folder Icon — fixed 16px container, 14px visual */}
                <div className="shrink-0 flex items-center justify-center w-4 h-4">
                    {isFolder ? <ExplorerFolderIcon isOpen={!!isOpen} /> : <ExplorerFileIcon name={node.name} />}
                </div>

                {/* File/Folder Name — 13px, truncates, same column for all file types */}
                <span className={cn("truncate flex-1 min-w-0 tracking-[-0.01em] leading-none text-[13px]", isActive ? "font-[500]" : isFolder ? "font-[450]" : "font-[400]")} title={node.name} style={{ fontWeight: isActive ? 500 : isFolder ? 450 : 400 }}>
                    <HighlightText text={node.name} query={searchQuery} />
                </span>

                {/* Status — kept for errors only; yellow modification dots removed per design */}
                {hasError && !isFolder && (
                    <span className="shrink-0 ml-2 w-2 h-2 flex items-center justify-center" aria-hidden>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF647C]" title="Error" />
                    </span>
                )}
                {gitStatus && !isFolder && (
                    <span className="text-[9px] font-bold tracking-widest shrink-0 w-3 text-center leading-none ml-1" style={{ color: gitStatus === 'M' ? '#F5B94C' : gitStatus === 'A' ? '#35D399' : '#727D8E' }} title={gitStatus === 'M' ? 'Modified' : gitStatus === 'A' ? 'Added' : 'Untracked'}>{gitStatus}</span>
                )}

                {/* File Count Badge for Folders */}
                {isFolder && Array.isArray(node.children) && node.children.length > 0 && !isOpen && (
                    <span className="ml-1 text-[10px] px-1 py-0 rounded-full bg-white/[0.06] text-white/45 font-medium tabular-nums border border-white/[0.04] leading-none shrink-0">
                        {node.children.length}
                    </span>
                )}

                {/* Bookmark — subtle, 14px hit */}
                {!isFolder && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onBookmark) {
                                onBookmark(node.id);
                            }
                        }}
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded-[4px] transition-colors duration-100 ${isBookmarked
                                ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                                : 'text-white/30 hover:text-amber-400 hover:bg-white/[0.06]'
                            }`}
                        title={isBookmarked ? 'Remove from Favorites' : 'Add to Favorites'}
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                        </svg>
                    </button>
                )}

                {/* Download — subtle */}
                {onDownload && (
                    <button
                        onClick={handleDownloadClick}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-white/70 hover:bg-white/[0.06] rounded-[4px] transition-colors duration-100"
                        title={isFolder ? "Download Folder" : "Download File"}
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                )}

                {/* Delete — subtle */}
                <button
                    onClick={handleDeleteClick}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 hover:bg-red-500/10 rounded-[4px] transition-colors duration-100"
                    title="Delete"
                >
                    <Trash2 size={11} strokeWidth={1.75} />
                </button>
            </div>

            <AnimatePresence initial={false}>
                {isFolder && isOpen && depth < MAX_RENDER_DEPTH && Array.isArray(node.children) && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden relative"
                    >
                        {/* Indent Guide — ultra premium: 1px hairline, soft fade, always above selection */}
                        {depth >= 0 && (
                            <div
                                className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
                                style={{
                                    left: `${(depth * indentStep) + indentBase + 8}px`,
                                    background: "linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.085) 10px, rgba(255,255,255,0.085) calc(100% - 10px), transparent 100%)",
                                    width: "1px",
                                    transform: "translateZ(0)",
                                } as React.CSSProperties}
                            />
                        )}

                        {node.children.length > 0 ? (
                            node.children.filter((c): c is FileNode => Boolean(c)).map((child, i) => (
                                <FileTreeNode
                                    key={child.id ?? `child-${depth}-${i}`}
                                    node={child}
                                    depth={depth + 1}
                                    indentStep={indentStep}
                                    indentBase={indentBase}
                                    renamingNodeId={renamingNodeId}
                                    focusedNodeId={focusedNodeId}
                                    searchQuery={searchQuery}
                                    activeFileId={activeFileId}
                                    selectedNodeId={selectedNodeId}
                                    creationState={creationState}
                                    expandedFolderIds={expandedFolderIds}
                                    onSetActiveFile={onSetActiveFile}
                                    onToggleFolder={onToggleFolder}
                                    onSetSelectedFolder={onSetSelectedFolder}
                                    onSetSelectedNode={onSetSelectedNode}
                                    onStartCreating={onStartCreating}
                                    onCommitCreation={onCommitCreation}
                                    onCancelCreation={onCancelCreation}
                                    onContextMenu={onContextMenu}
                                    onRenameCommit={onRenameCommit}
                                    onRenameCancel={onRenameCancel}
                                    onDelete={onDelete}
                                    onFocus={onFocus}
                                    onDragStart={onDragStart}
                                    onDragOver={onDragOver}
                                    onDrop={onDrop}
                                    onDragEnd={onDragEnd}
                                    dragOverNodeId={dragOverNodeId}
                                    onDownload={onDownload}
                                    newlyCreatedNodes={newlyCreatedNodes}
                                />
                            ))
                        ) : !isCreatingHere && (
                            node.id === ROOT_NODE_ID && !searchQuery ? (
                                <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center mb-3 border border-white/[0.06]">
                                        <Folder size={20} className="text-white/20" />
                                    </div>
                                    <p className="text-white/50 text-sm font-medium mb-1">Empty workspace</p>
                                    <p className="text-white/25 text-xs mb-3">Create a new file or folder to get started</p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onStartCreating?.('file'); }}
                                            className="text-xs bg-blue-500/10 border border-blue-500/20 text-[var(--az-text)] px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors"
                                        >
                                            New File
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onStartCreating?.('folder'); }}
                                            className="text-xs bg-white/10 border border-white/20 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors"
                                        >
                                            New Folder
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    style={{ paddingLeft: `${(depth + 1) * indentStep + 24}px` }}
                                    className="py-1.5 text-[11px] text-white/25 italic select-none flex items-center gap-1.5 min-h-[28px]"
                                >
                                    <span className="w-1 h-1 rounded-full bg-white/20"></span>
                                    Empty folder
                                </div>
                            )
                        )}
                        <AnimatePresence>
                            {isCreatingHere && (
                                <InputNode
                                    type={creationState.type!}
                                    depth={depth + 1}
                                    indentStep={indentStep}
                                    indentBase={indentBase}
                                    parentId={node.id}
                                    onCommit={onCommitCreation}
                                    onCancel={onCancelCreation}
                                />
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

// Flatten tree for keyboard navigation — see safeTree.flattenTree (iterative,
// cycle-safe, only descends into open folders).
interface SearchFilters {
    query: string;
    fileType: string;
    dateRange: 'today' | 'week' | 'month' | 'all';
    sizeRange: 'small' | 'medium' | 'large' | 'all';
    showHidden: boolean;
}

// Pure, filter-local predicates (kept outside the component so they never
// capture stale state; the tree filter itself lives in safeTree).
const getDateFilter = (node: FileNode, dateRange: SearchFilters['dateRange'], now: number): boolean => {
    if (dateRange === 'all') return true;
    // Mock timestamp - in real app, track creation/modification time
    const nodeTime = node.id.split('_')[0] ? now : now - Math.random() * 30 * 24 * 60 * 60 * 1000;
    const daysDiff = (now - nodeTime) / (24 * 60 * 60 * 1000);

    switch (dateRange) {
        case 'today': return daysDiff < 1;
        case 'week': return daysDiff < 7;
        case 'month': return daysDiff < 30;
        default: return true;
    }
};

const getSizeFilter = (node: FileNode, sizeRange: SearchFilters['sizeRange']): boolean => {
    if (sizeRange === 'all' || node.type === 'folder') return true;
    const content = node.content || '';
    const sizeKB = content.length / 1024;

    switch (sizeRange) {
        case 'small': return sizeKB < 10;
        case 'medium': return sizeKB >= 10 && sizeKB < 100;
        case 'large': return sizeKB >= 100;
        default: return true;
    }
};

const getFileTypeFilter = (node: FileNode, fileType: string): boolean => {
    if (fileType === 'all') return true;
    if (node.type === 'folder') return fileType === 'folder';

    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const typeMap: Record<string, string[]> = {
        'code': ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt'],
        'web': ['html', 'htm', 'css', 'scss', 'sass', 'vue', 'svelte'],
        'data': ['json', 'xml', 'csv', 'yaml', 'yml', 'toml', 'sql'],
        'docs': ['md', 'mdx', 'txt', 'pdf'],
        'config': ['env', 'gitignore', 'dockerfile', 'package.json', 'tsconfig.json'],
        'media': ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'mp3', 'mp4']
    };

    return typeMap[fileType]?.includes(ext) || false;
};

// Advanced search with fuzzy matching — delegates to cycle-safe filterTree.
const filterTreeAdvanced = (nodes: FileNode[], filters: SearchFilters): FileNode[] => {
    const { query, fileType, dateRange, sizeRange, showHidden } = filters;

    if (!query && fileType === 'all' && dateRange === 'all' && sizeRange === 'all' && showHidden) {
        return nodes;
    }

    const now = Date.now();

    return filterTree(nodes, {
        forceOpen: Boolean(query),
        skip: (node) => !showHidden && node.name.startsWith('.'),
        predicate: (node) => {
            const nameMatches = !query || fuzzyMatch(node.name, query).matched;
            const dateMatches = getDateFilter(node, dateRange, now);
            const sizeMatches = getSizeFilter(node, sizeRange);
            const typeMatches = getFileTypeFilter(node, fileType);
            return nameMatches && dateMatches && sizeMatches && typeMatches;
        },
    });
};

interface FileExplorerProps {
    isSearchOpen: boolean;
    onSearchClose: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ isSearchOpen, onSearchClose }) => {
    const { fileTree, activeFile } = useProjectFile();
    const { selectedNodeId, creationState, expandedFolderIds } = useProjectUI();
    const { renameNode, deleteNode, commitCreation, cancelCreation, startCreating, moveNode, toggleFolder, setActiveFile, setSelectedFolder, setSelectedNode, getFileTree, duplicateNode, expandRecursively, collapseAll, expandAll } = useProjectActions();
    const dialog = useDialog();

    // Refined spacing: 28px rows, 18px indent step, 8px base — breathable but compact
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const indentStep = isDesktop ? 18 : 16;
    const indentBase = isDesktop ? 8 : 6;

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    // Debounce search input → query (150ms) to avoid scanning 1k-file tree on every keystroke
    useEffect(() => {
        const t = setTimeout(() => setSearchQuery(searchInput), 150);
        return () => clearTimeout(t);
    }, [searchInput]);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const [draggedNode, setDraggedNode] = useState<FileNode | null>(null);
    const [newlyCreatedNodes, setNewlyCreatedNodes] = useState<Set<string>>(new Set());
    const prevTreeIdsRef = useRef<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Track newly created nodes for entrance animation. Uses cycle-safe
    // traversal (collectIds), a single O(N) walk per tree change (the previous
    // id set is cached in a ref), and clears its timeout on unmount/change so no
    // state is written after the component is gone.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (prevTreeIdsRef.current.size > 0) {
            const newIds = new Set<string>();
            for (const id of collectIds(fileTree)) {
                if (!prevTreeIdsRef.current.has(id)) newIds.add(id);
            }

            if (newIds.size > 0) {
                setNewlyCreatedNodes(prev => {
                    const merged = new Set(prev);
                    newIds.forEach(id => merged.add(id));
                    return merged;
                });
                // Clear after animation completes
                timer = setTimeout(() => {
                    setNewlyCreatedNodes(prev => {
                        const next = new Set(prev);
                        newIds.forEach(id => next.delete(id));
                        return next;
                    });
                }, 900);
            }
        }
        prevTreeIdsRef.current = new Set(collectIds(fileTree));
        return () => { if (timer) clearTimeout(timer); };
    }, [fileTree]);

    // Advanced search filters state
    const showHiddenFilesSetting = useSettingsSelector(s => s.editor.showHiddenFiles);
    const confirmDeleteSetting = useSettingsSelector(s => s.general.confirmDelete);
    const [searchFilters, setSearchFilters] = useState<SearchFilters>({
        query: '',
        fileType: 'all',
        dateRange: 'all',
        sizeRange: 'all',
        showHidden: getSettings().editor.showHiddenFiles
    });
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Keep the search filter's hidden-file toggle in sync with the global setting
    useEffect(() => {
        setSearchFilters(prev => ({ ...prev, showHidden: showHiddenFilesSetting }));
    }, [showHiddenFilesSetting]);

    // Filter tree based on search. The live `searchQuery` is merged in directly
    // so the filtered tree and the HighlightText render from the SAME query in
    // one render pass (previously a sync effect copied query→filters one render
    // late, causing a double render and a flash of stale matches).
    const filteredTree = useMemo(
        () => filterTreeAdvanced(fileTree, { ...searchFilters, query: searchQuery }),
        [fileTree, searchFilters, searchQuery]
    );

    // Explorer sort — persists via localStorage, controlled from Sidebar's Sort menu
    const [sortState, setSortState] = useState<ExplorerSortState>(() => loadSortState());
    useEffect(() => {
        const onSort = (e: Event) => {
            const detail = (e as CustomEvent<ExplorerSortState>).detail;
            if (detail) setSortState(detail);
        };
        const onStorage = (ev: StorageEvent) => {
            if (ev.key === 'azemax-explorer-sort' && ev.newValue) {
                try { setSortState(JSON.parse(ev.newValue)); } catch { /* ignore */ }
            }
        };
        window.addEventListener('azemax-sort-changed' as any, onSort as any);
        window.addEventListener('storage', onStorage);
        // refresh event — preserve selection/expanded, re-validate tree
        const onRefresh = () => {
            // No-op for in-browser FS; the spinner in Sidebar provides feedback.
            // We simply force a micro-rerender so counts stay live.
            setSortState(s => ({ ...s }));
        };
        window.addEventListener('explorer-refresh' as any, onRefresh as any);
        return () => {
            window.removeEventListener('azemax-sort-changed' as any, onSort as any);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('explorer-refresh' as any, onRefresh as any);
        };
    }, []);

    // Render shape: the canonical model stores the project root as a top-level
    // sibling of the root-level items (parentId === 'root'). For rendering, the
    // root is presented as the container of those items, exactly like the
    // legacy root.children model users saw before. This is a pure projection —
    // the real tree is never mutated. Rows are rendered from a deterministic,
    // user-configurable sorted view derived from the filtered tree.
    const sortedTree = useMemo(() => sortTreeWithState(filteredTree, sortState), [filteredTree, sortState]);

    const treeForRender = useMemo(() => {
        const root = sortedTree.find(n => n.id === ROOT_NODE_ID);
        if (!root) return sortedTree;
        if (sortedTree.length === 1) return sortedTree;
        return [{ ...root, children: sortedTree.filter(n => n.id !== ROOT_NODE_ID) }];
    }, [sortedTree]);

    const isSearching = Boolean(searchQuery);

    // Flatten for keyboard navigation (iterative, cycle-safe). During search the
    // filtered clones are force-opened, so descending is unconstrained; otherwise
    // navigation only enters folders present in the expansion set.
    const flatNodes = useMemo(
        () => flattenTreeSafe(treeForRender, isSearching ? undefined : expandedFolderIds),
        [treeForRender, isSearching, expandedFolderIds]
    );

    // Handle filter changes
    const handleFilterChange = (filterType: keyof SearchFilters, value: any) => {
        setSearchFilters(prev => ({ ...prev, [filterType]: value }));
    };

    // Clear all filters
    const clearFilters = () => {
        setSearchInput('');
        setSearchQuery('');
        setSearchFilters({
            query: '',
            fileType: 'all',
            dateRange: 'all',
            sizeRange: 'all',
            showHidden: showHiddenFilesSetting
        });
        setShowAdvancedFilters(false);
    };

    // File bookmarks/favorites state
    const [bookmarkedFiles, setBookmarkedFiles] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem('azemax-bookmarked-files') || localStorage.getItem('deepcontext-bookmarked-files');
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch {
            return new Set();
        }
    });

    // Save bookmarks to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('azemax-bookmarked-files', JSON.stringify(Array.from(bookmarkedFiles)));
        } catch (e) {
            console.warn('Failed to save bookmarks:', e);
        }
    }, [bookmarkedFiles]);

    // Bookmark ids are path-derived, so rename/move re-id a file and delete
    // removes it. Prune any bookmark that no longer resolves to a live file so
    // the Favorites list never shows a stale/dangling entry.
    useEffect(() => {
        setBookmarkedFiles(prev => {
            if (prev.size === 0) return prev;
            const fileIds = collectFiles(fileTree);
            const valid = new Set(fileIds.map(f => f.id));
            let changed = false;
            const next = new Set<string>();
            for (const id of prev) {
                if (valid.has(id)) next.add(id);
                else changed = true;
            }
            return changed ? next : prev;
        });
    }, [fileTree]);

    // Toggle bookmark
    const toggleBookmark = useCallback((fileId: string) => {
        setBookmarkedFiles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(fileId)) {
                newSet.delete(fileId);
            } else {
                newSet.add(fileId);
            }
            return newSet;
        });
    }, []);

    // Get bookmarked files (cycle-safe walk of the whole tree, regardless of
    // open/closed folder state)
    const getBookmarkedFiles = useCallback(() => {
        return collectFiles(fileTree).filter(file => bookmarkedFiles.has(file.id));
    }, [fileTree, bookmarkedFiles]);
    const getActiveFilterCount = () => {
        let count = 0;
        if (searchFilters.fileType !== 'all') count++;
        if (searchFilters.dateRange !== 'all') count++;
        if (searchFilters.sizeRange !== 'all') count++;
        if (searchFilters.showHidden) count++;
        return count;
    };
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== searchInputRef.current) {
            return;
        }

        // Don't intercept keys when user is typing in an input (creation / rename / search)
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return;
        }

        // Also skip when creation or renaming is active (safety net)
        if (creationState.isActive || renamingNodeId) {
            return;
        }

        const currentIndex = flatNodes.findIndex(n => n.id === focusedNodeId);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < flatNodes.length - 1) {
                    setFocusedNodeId(flatNodes[currentIndex + 1].id);
                } else if (currentIndex === -1 && flatNodes.length > 0) {
                    setFocusedNodeId(flatNodes[0].id);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    setFocusedNodeId(flatNodes[currentIndex - 1].id);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (focusedNodeId) {
                    const node = flatNodes.find(n => n.id === focusedNodeId);
                    if (node?.type === 'folder' && !expandedFolderIds.has(node.id) && node.isOpen !== true) {
                        toggleFolder(node.id);
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (focusedNodeId) {
                    const node = flatNodes.find(n => n.id === focusedNodeId);
                    if (node?.type === 'folder' && (expandedFolderIds.has(node.id) || node.isOpen === true)) {
                        toggleFolder(node.id);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedNodeId) {
                    const node = flatNodes.find(n => n.id === focusedNodeId);
                    if (node) {
                        setSelectedNode(node.id);
                        if (node.type === 'folder') {
                            toggleFolder(node.id);
                        } else {
                            setActiveFile(node);
                            setSelectedFolder(node.parentId ?? ROOT_NODE_ID);
                        }
                    }
                }
                break;
            case 'F2':
                e.preventDefault();
                if (focusedNodeId && focusedNodeId !== 'root') {
                    setRenamingNodeId(focusedNodeId);
                }
                break;
            case 'Delete':
            case 'Backspace':
                if (focusedNodeId && focusedNodeId !== 'root' && !e.metaKey) {
                    e.preventDefault();
                    const targetNode = flatNodes.find(n => n.id === focusedNodeId);
                    if (!targetNode) break;
                    if (!confirmDeleteSetting) {
                        deleteNode(focusedNodeId);
                    } else {
                        void (async () => {
                            const confirmed = await dialog.confirm({
                                title: targetNode.type === 'folder' ? `Delete folder "${targetNode.name}"?` : `Delete "${targetNode.name}"?`,
                                message: targetNode.type === 'folder'
                                    ? `Are you sure you want to delete "${targetNode.name}" and its contents? This will permanently delete the folder and all files inside it.`
                                    : `Are you sure you want to delete "${targetNode.name}"? This action cannot be undone.`,
                                confirmLabel: 'Delete',
                                cancelLabel: 'Cancel',
                                danger: true,
                            });
                            if (confirmed) deleteNode(focusedNodeId);
                        })();
                    }
                }
                break;
            case '/':
            case 'f':
                if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    searchInputRef.current?.focus();
                }
                break;
        }
    }, [flatNodes, focusedNodeId, toggleFolder, deleteNode, setActiveFile, setSelectedFolder, setSelectedNode, creationState.isActive, renamingNodeId, confirmDeleteSetting, expandedFolderIds, dialog]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Enhanced drag and drop with visual feedback
    const handleDragStart = useCallback((e: React.DragEvent, node: FileNode) => {
        setDraggedNode(node);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.id);

        // Add visual feedback
        const dragImage = document.createElement('div');
        dragImage.className = 'bg-blue-500/20 border border-blue-500/40 rounded-lg px-2 py-1 text-sm text-[var(--az-text)]';
        dragImage.textContent = node.name;
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 0, 0);
        setTimeout(() => document.body.removeChild(dragImage), 0);
    }, []);

    const handleDragOver = useCallback((_e: React.DragEvent, node: FileNode) => {
        if (node.type === 'folder' && draggedNode && draggedNode.id !== node.id) {
            setDragOverNodeId(node.id);
            // Auto-expand folder on hover (600ms) — premium IDE behavior
            if (dragExpandTimerRef.current) clearTimeout(dragExpandTimerRef.current);
            dragExpandTimerRef.current = setTimeout(() => {
                if (!expandedFolderIds.has(node.id)) toggleFolder(node.id);
            }, 600);
        }
    }, [draggedNode, expandedFolderIds, toggleFolder]);

    const handleDrop = useCallback((_e: React.DragEvent, targetNode: FileNode) => {
        if (draggedNode && targetNode.type === 'folder' && draggedNode.id !== targetNode.id) {
            // Prevent dropping a folder into its own children (cycle-safe).
            // getFileTree() reads the latest tree without a state dependency,
            // so this callback stays referentially stable.
            if (!isDescendantOf(getFileTree(), draggedNode.id, targetNode.id)) {
                moveNode(draggedNode.id, targetNode.id);
            }
        }
        setDraggedNode(null);
        setDragOverNodeId(null);
    }, [draggedNode, moveNode, getFileTree]);

    const handleDragEnd = useCallback(() => {
        if (dragExpandTimerRef.current) { clearTimeout(dragExpandTimerRef.current); dragExpandTimerRef.current = null; }
        setDraggedNode(null);
        setDragOverNodeId(null);
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
    }, []);

    const handleContainerContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: 'root' });
    };

    const handleCloseContextMenu = () => {
        setContextMenu(null);
    };

    const handleRenameStart = () => {
        if (contextMenu && contextMenu.nodeId !== 'root') {
            setRenamingNodeId(contextMenu.nodeId);
            setContextMenu(null);
        }
    };

    const handleDelete = useCallback((id?: string) => {
        const targetId = id || contextMenu?.nodeId;
        setContextMenu(null);
        if (!targetId || targetId === 'root') return;
        const node = findNodeById(fileTree, targetId);
        const name = node?.name ?? 'this item';
        const type = (node?.type as 'file' | 'folder') ?? 'file';
        if (!confirmDeleteSetting) {
            setTimeout(() => deleteNode(targetId), 50);
            return;
        }
        void (async () => {
            const confirmed = await dialog.confirm({
                title: type === 'folder' ? `Delete folder "${name}"?` : `Delete "${name}"?`,
                message: type === 'folder'
                    ? `Are you sure you want to delete "${name}" and its contents? This will permanently delete the folder and all files inside it.`
                    : `Are you sure you want to delete "${name}"? This action cannot be undone.`,
                confirmLabel: 'Delete',
                cancelLabel: 'Cancel',
                danger: true,
            });
            if (confirmed) setTimeout(() => deleteNode(targetId), 50);
        })();
    }, [contextMenu, deleteNode, confirmDeleteSetting, fileTree, dialog]);

    const handleRenameCommit = useCallback((newName: string) => {
        if (!renamingNodeId) return;
        const trimmed = newName.trim();
        // Premium validation — prevent path separators, empty, or duplicate sibling names
        if (!trimmed || trimmed === '.' || trimmed === '..' || /[\/\\]/.test(trimmed) || /[*?"<>|:]/.test(trimmed)) {
            // Keep rename open so user can correct — briefly flash feedback
            return;
        }
        const node = findNodeById(fileTree, renamingNodeId);
        if (node) {
            const parentChildren = node.parentId ? (findNodeById(fileTree, node.parentId)?.children ?? []) : fileTree;
            const duplicate = parentChildren.some(c => c.id !== renamingNodeId && c.name.toLowerCase() === trimmed.toLowerCase());
            if (duplicate) return;
        }
        const res = renameNode(renamingNodeId, trimmed);
        // Only close if successful — allows user to fix duplicate/invalid names
        if (!res.error) setRenamingNodeId(null);
    }, [renamingNodeId, renameNode, fileTree]);

    const handleRenameCancel = useCallback(() => {
        setRenamingNodeId(null);
    }, []);

    // Stable onDownload for memoized FileTreeNode. The ref keeps the identity
    // constant while always dispatching to the latest tree/logic, so memoized
    // rows never re-render for download purposes yet never act on stale data.
    const downloadHandlerRef = useRef<(nodeId: string) => void>(() => { });
    downloadHandlerRef.current = (nodeId: string) => {
        const targetNode = findNodeById(fileTree, nodeId);
        if (targetNode?.type === 'folder') {
            downloadFolder(nodeId);
        } else {
            downloadFile(nodeId);
        }
    };
    const handleDownload = useCallback((nodeId: string) => {
        downloadHandlerRef.current(nodeId);
    }, []);

    // Download file functionality
    const downloadFile = async (nodeId: string) => {
        const node = findNodeById(fileTree, nodeId);
        if (!node || node.type === 'folder') return;

        try {
            // Get file content from the node itself
            const fileContent = node.content || '';

            // Create blob with appropriate MIME type
            const mimeType = getMimeType(node.name);
            const blob = new Blob([fileContent], { type: mimeType });

            // Create download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = node.name;

            // Trigger download
            document.body.appendChild(link);
            link.click();

            // Cleanup
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download file:', error);
        }
    };

    // Download folder as ZIP
    const downloadFolder = async (nodeId: string) => {
        const node = findNodeById(fileTree, nodeId);
        if (!node || node.type !== 'folder') return;

        try {
            // Collect all files in the folder
            const files = collectFilesInFolder(node);

            if (files.length === 0) {
                console.log('No files to download in this folder');
                return;
            }

            if (files.length === 1) {
                // If only one file, download it directly
                await downloadFile(files[0].id);
                return;
            }

            // Create ZIP file with all files
            await createAndDownloadZip(files, node.name);
        } catch (error) {
            console.error('Failed to download folder:', error);
        }
    };

    // Create ZIP file and download it
    const createAndDownloadZip = async (files: FileNode[], folderName: string) => {
        try {
            // Import JSZip dynamically
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            // Add all files to the ZIP with proper folder structure
            for (const file of files) {
                // Get relative path from the folder being downloaded
                const relativePath = pathOf(fileTree, file.id) || file.name;

                zip.file(relativePath, file.content || '');
            }

            // Generate the ZIP file
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });

            // Create download link
            const url = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${folderName}.zip`;

            // Trigger download
            document.body.appendChild(link);
            link.click();

            // Cleanup
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to create ZIP file:', error);

            // Fallback to text file if JSZip fails
            let content = `Files in folder "${folderName}":\n\n`;

            for (const file of files) {
                const relativePath = pathOf(fileTree, file.id) || file.name;

                content += `\n=== ${relativePath} ===\n`;
                content += file.content || '';
                content += '\n';
            }

            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${folderName}_files.txt`;

            document.body.appendChild(link);
            link.click();

            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    // Helper function to get MIME type based on file extension
    const getMimeType = (fileName: string): string => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
            'txt': 'text/plain',
            'json': 'application/json',
            'js': 'text/javascript',
            'ts': 'text/typescript',
            'jsx': 'text/jsx',
            'tsx': 'text/tsx',
            'html': 'text/html',
            'htm': 'text/html',
            'css': 'text/css',
            'scss': 'text/scss',
            'sass': 'text/sass',
            'xml': 'text/xml',
            'csv': 'text/csv',
            'md': 'text/markdown',
            'py': 'text/x-python',
            'java': 'text/x-java-source',
            'c': 'text/x-c',
            'cpp': 'text/x-c++',
            'cc': 'text/x-c++',
            'cxx': 'text/x-c++',
            'hpp': 'text/x-c++',
            'h': 'text/x-c',
            'go': 'text/x-go',
            'rs': 'text/x-rust',
            'rb': 'text/x-ruby',
            'php': 'text/x-php',
            'swift': 'text/x-swift',
            'kt': 'text/x-kotlin',
            'sh': 'text/x-shellscript',
            'bash': 'text/x-shellscript',
            'zsh': 'text/x-shellscript',
            'sql': 'text/x-sql',
            'yaml': 'text/x-yaml',
            'yml': 'text/x-yaml',
            'toml': 'text/x-toml',
            'ini': 'text/x-ini',
            'conf': 'text/x-ini',
            'log': 'text/x-log',
            'dockerfile': 'text/x-dockerfile',
            'gitignore': 'text/plain',
            'env': 'text/plain',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
            'ico': 'image/x-icon',
            'pdf': 'application/pdf',
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'mp3': 'audio/mpeg',
            'mp4': 'video/mp4',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'wmv': 'video/x-ms-wmv',
            'flv': 'video/x-flv',
            'webm': 'video/webm'
        };
        return mimeTypes[ext || ''] || 'text/plain';
    };

    // Helper function to collect all files in a folder (cycle-safe)
    const collectFilesInFolder = (folder: FileNode): FileNode[] => {
        return collectFiles(childrenOf(folder));
    };

    const isCreatingAtRoot = creationState.isActive &&
        (creationState.parentId === 'root' || !creationState.parentId) &&
        !fileTree.some(node => node.id === creationState.parentId);

    const getMenuItems = () => {
        const isRoot = contextMenu?.nodeId === 'root';
        const node = contextMenu?.nodeId ? findNodeById(fileTree, contextMenu.nodeId) : null;
        const isFolder = node?.type === 'folder';
        const isBookmarked = node ? bookmarkedFiles.has(node.id) : false;
        const isExpanded = node ? expandedFolderIds.has(node.id) : false;

        if (isRoot) {
            return [
                { label: 'New File…', onClick: () => startCreating('file', 'root') },
                { label: 'New Folder…', onClick: () => startCreating('folder', 'root') },
                { type: 'separator' as const },
                { label: 'Refresh Explorer', onClick: () => window.dispatchEvent(new CustomEvent('explorer-refresh')) },
                { type: 'separator' as const },
                { label: 'Expand All', onClick: () => expandAll() },
                { label: 'Collapse All', onClick: () => collapseAll() },
                { type: 'separator' as const },
                { label: 'Sort By…', onClick: () => window.dispatchEvent(new CustomEvent('azemax-open-sort')) },
            ];
        }
        if (isFolder) {
            return [
                { label: 'New File…', onClick: () => startCreating('file', contextMenu!.nodeId) },
                { label: 'New Folder…', onClick: () => startCreating('folder', contextMenu!.nodeId) },
                { type: 'separator' as const },
                { label: 'Open', onClick: () => toggleFolder(contextMenu!.nodeId) },
                { label: isExpanded ? 'Collapse' : 'Expand', onClick: () => toggleFolder(contextMenu!.nodeId), shortcut: isExpanded ? '←' : '→' },
                { label: 'Expand Recursively', onClick: () => expandRecursively(contextMenu!.nodeId) },
                { type: 'separator' as const },
                { label: 'Copy', onClick: () => { const p = pathOf(fileTree, contextMenu!.nodeId); navigator.clipboard.writeText(p ? `/${p}` : '/'); } },
                { label: 'Copy Path', onClick: () => { const p = pathOf(fileTree, contextMenu!.nodeId); navigator.clipboard.writeText(p ? `/${p}` : '/'); }, shortcut: '⌥⌘C' },
                { label: 'Copy Relative Path', onClick: () => { navigator.clipboard.writeText(pathOf(fileTree, contextMenu!.nodeId)); } },
                { type: 'separator' as const },
                { label: 'Rename…', onClick: handleRenameStart, shortcut: 'F2' },
                { label: 'Duplicate', onClick: () => duplicateNode(contextMenu!.nodeId) },
                { type: 'separator' as const },
                { label: 'Delete', onClick: () => handleDelete(), danger: true, shortcut: '⌫' },
            ];
        }
        // File
        return [
            { label: 'Open', onClick: () => { const n = findNodeById(fileTree, contextMenu!.nodeId); if (n) setActiveFile(n); }, shortcut: '↵' },
            { label: 'Open to the Side', onClick: () => { const n = findNodeById(fileTree, contextMenu!.nodeId); if (n) setActiveFile(n); } },
            { type: 'separator' as const },
            { label: 'Rename…', onClick: handleRenameStart, shortcut: 'F2' },
            { label: 'Duplicate', onClick: () => duplicateNode(contextMenu!.nodeId) },
            { type: 'separator' as const },
            { label: isBookmarked ? 'Remove from Favorites' : 'Add to Favorites', onClick: () => toggleBookmark(contextMenu!.nodeId), shortcut: '☆' },
            { label: 'Download', onClick: () => downloadFile(contextMenu!.nodeId) },
            { type: 'separator' as const },
            { label: 'Copy', onClick: () => { const n = findNodeById(fileTree, contextMenu!.nodeId); if (n?.content) navigator.clipboard.writeText(n.content); } },
            { label: 'Copy Path', onClick: () => { const p = pathOf(fileTree, contextMenu!.nodeId); navigator.clipboard.writeText(p ? `/${p}` : '/'); }, shortcut: '⌥⌘C' },
            { label: 'Copy Relative Path', onClick: () => { navigator.clipboard.writeText(pathOf(fileTree, contextMenu!.nodeId)); } },
            { type: 'separator' as const },
            { label: 'Reveal in Explorer', onClick: () => { setFocusedNodeId(contextMenu!.nodeId); containerRef.current?.focus(); } },
            { type: 'separator' as const },
            { label: 'Delete', onClick: () => handleDelete(), danger: true, shortcut: '⌫' },
        ];
    };

    // Auto-focus search when opened, Escape to close
    useEffect(() => {
        if (isSearchOpen) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        } else {
            setSearchInput('');
            setSearchQuery('');
        }
    }, [isSearchOpen]);
    // Escape handling for search is also in the input's onKeyDown, plus global handler above
    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setSearchInput('');
            setSearchQuery('');
            onSearchClose();
            containerRef.current?.focus();
        }
    };

    return (
        <div data-testid="file-tree" className="h-full flex flex-col" ref={containerRef} tabIndex={0} onKeyDown={(e) => {
            if (e.key === 'Escape' && isSearchOpen && document.activeElement === searchInputRef.current) return; // let input handler deal with it
            if (e.key === 'Escape' && isSearchOpen) { e.preventDefault(); onSearchClose(); }
        }}>

            {/* Search — compact, integrated into explorer header flow */}
            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSearchOpen ? 'grid-rows-[1fr] opacity-100 mb-1' : 'grid-rows-[0fr] opacity-0 mb-0'}`}>
                <div className="overflow-hidden">
                    <div className="px-2 pt-2 pb-1">
                        <div className="relative group">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25 group-focus-within:text-white/40 transition-colors" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                placeholder="Search files…"
                                aria-label="Search files"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full pl-7 pr-16 h-7 text-[12.5px] leading-none bg-white/[0.04] border border-white/[0.06] rounded-[6px] text-white placeholder:text-white/30 placeholder:text-[12px] focus:outline-none focus:border-[var(--az-border-strong)] focus:bg-white/[0.05] transition-colors duration-100 antialiased"
                            />
                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {getActiveFilterCount() > 0 && (
                                    <span className="text-[10px] px-1 py-0.5 rounded-full bg-white/[0.08] text-white/60 font-medium leading-none">
                                        {getActiveFilterCount()}
                                    </span>
                                )}
                                <button
                                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                    className={`w-5 h-5 flex items-center justify-center rounded-[4px] transition-colors duration-100 ${showAdvancedFilters
                                            ? 'bg-[var(--az-surface-3)] text-[var(--az-text)] border border-[var(--az-border)]'
                                            : 'text-white/35 hover:text-white/70 hover:bg-white/[0.06]'
                                        }`}
                                    title="Advanced Filters"
                                >
                                    <Settings size={11} strokeWidth={1.75} />
                                </button>
                                {(searchInput || searchQuery) && (
                                    <button
                                        onClick={() => {
                                            setSearchInput('');
                                            setSearchQuery('');
                                            onSearchClose();
                                        }}
                                        aria-label="Clear search"
                                        className="w-5 h-5 flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/[0.06] rounded-[4px] transition-colors duration-100"
                                    >
                                        <X size={11} strokeWidth={1.75} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Advanced Filters Panel */}
                        <AnimatePresence>
                            {showAdvancedFilters && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    className="overflow-hidden"
                                >
                                    <div className="pt-2 pb-1 space-y-2">
                                        {/* File Type Filter */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-white/40 w-12">Type:</label>
                                            <select
                                                value={searchFilters.fileType}
                                                onChange={(e) => handleFilterChange('fileType', e.target.value)}
                                                className="flex-1 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:outline-none focus:border-blue-500/40"
                                            >
                                                <option value="all">All Files</option>
                                                <option value="folder">Folders</option>
                                                <option value="code">Code Files</option>
                                                <option value="web">Web Files</option>
                                                <option value="data">Data Files</option>
                                                <option value="docs">Documents</option>
                                                <option value="config">Config Files</option>
                                                <option value="media">Media Files</option>
                                            </select>
                                        </div>

                                        {/* Date Range Filter */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-white/40 w-12">Date:</label>
                                            <select
                                                value={searchFilters.dateRange}
                                                onChange={(e) => handleFilterChange('dateRange', e.target.value)}
                                                className="flex-1 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:outline-none focus:border-blue-500/40"
                                            >
                                                <option value="all">Any Time</option>
                                                <option value="today">Today</option>
                                                <option value="week">This Week</option>
                                                <option value="month">This Month</option>
                                            </select>
                                        </div>

                                        {/* Size Range Filter */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-white/40 w-12">Size:</label>
                                            <select
                                                value={searchFilters.sizeRange}
                                                onChange={(e) => handleFilterChange('sizeRange', e.target.value)}
                                                className="flex-1 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:outline-none focus:border-blue-500/40"
                                            >
                                                <option value="all">Any Size</option>
                                                <option value="small">Small (&lt;10KB)</option>
                                                <option value="medium">Medium (10-100KB)</option>
                                                <option value="large">Large (&gt;100KB)</option>
                                            </select>
                                        </div>

                                        {/* Show Hidden Files */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-white/40 w-12">Show:</label>
                                            <label className="flex items-center gap-1 text-[11px] text-white/60 cursor-pointer hover:text-white/80">
                                                <input
                                                    type="checkbox"
                                                    checked={searchFilters.showHidden}
                                                    onChange={(e) => handleFilterChange('showHidden', e.target.checked)}
                                                    className="w-3 h-3 rounded border-white/[0.2] bg-white/[0.1] text-blue-500 focus:ring-blue-500/40"
                                                />
                                                Hidden files
                                            </label>
                                        </div>

                                        {/* Clear Filters Button */}
                                        <div className="flex items-center justify-between pt-1">
                                            <span className="text-[10px] text-white/30">
                                                {filteredTree.length} results
                                            </span>
                                            <button
                                                onClick={clearFilters}
                                                className="text-[10px] px-2 py-1 rounded bg-white/[0.06] text-white/40 hover:text-white hover:bg-white/[0.10] transition-all"
                                            >
                                                Clear Filters
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Favorites Section */}
            {bookmarkedFiles.size > 0 && (
                <div className="border-b border-white/[0.04] bg-gradient-to-b from-amber-500/[0.04] to-transparent">
                    <div className="px-2.5 py-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400/80">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                            </svg>
                            <span className="text-[10px] font-[600] tracking-[0.04em] uppercase text-amber-300/80">Favorites · {bookmarkedFiles.size}</span>
                        </div>
                        <button
                            onClick={() => {
                                setBookmarkedFiles(new Set());
                            }}
                            className="text-[9px] text-white/30 hover:text-white/50 px-1 py-0.5 rounded-[4px] hover:bg-white/[0.06] transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="px-1.5 pb-1.5 space-y-0">
                        {getBookmarkedFiles().map((file) => (
                            <div
                                key={file.id}
                                onClick={() => setActiveFile(file)}
                                className="flex items-center gap-1.5 pl-1 pr-1 py-1 rounded-[6px] text-[12px] text-white/60 hover:text-white hover:bg-white/[0.04] cursor-pointer transition-colors group h-[28px] mx-1.5"
                            >
                                <span className="shrink-0 flex items-center justify-center w-4 h-4"><ExplorerFileIcon name={file.name} /></span>
                                <span className="truncate flex-1 min-w-0 text-[13px] font-[400] tracking-[-0.01em]">{file.name}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleBookmark(file.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-amber-400/70 hover:text-amber-300 hover:bg-white/[0.06] rounded-[3px] transition-colors"
                                >
                                    <X size={9} strokeWidth={1.75} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* File Tree — VS Code density, 26px rows, thin scrollbar */}
            <div
                role="tree"
                aria-label="File Explorer"
                aria-multiselectable={false}
                className="flex-1 overflow-y-auto overflow-x-hidden py-1 explorer-scrollbar"
                onContextMenu={handleContainerContextMenu}
                onDragOver={(e) => { e.preventDefault(); setDragOverNodeId('root'); }}
                onDrop={() => { if (draggedNode) { moveNode(draggedNode.id, 'root'); } handleDragEnd(); }}
            >
                {filteredTree.length === 0 && searchQuery ? (
                    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center mb-4 border border-white/[0.06]">
                            <Search size={24} className="text-white/20" />
                        </div>
                        <p className="text-white/50 text-sm font-medium mb-1">No results found</p>
                        <p className="text-white/25 text-xs">No files matching "{searchQuery}"</p>
                    </div>
                ) : filteredTree.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center mb-4 border border-white/[0.06]">
                            <Folder size={24} className="text-white/20" />
                        </div>
                        <p className="text-white/50 text-sm font-medium mb-1">No files yet</p>
                        <p className="text-white/25 text-xs mb-3">Create a new file or folder to get started</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => startCreating('file', 'root')}
                                className="text-xs bg-blue-500/10 border border-blue-500/20 text-[var(--az-text)] px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors"
                            >
                                New File
                            </button>
                            <button
                                onClick={() => startCreating('folder', 'root')}
                                className="text-xs bg-white/10 border border-white/20 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors"
                            >
                                New Folder
                            </button>
                        </div>
                    </div>
                ) : (
                    treeForRender.map((node) => (
                        <FileTreeNode
                            key={node.id}
                            node={node}
                            depth={0}
                            indentStep={indentStep}
                            indentBase={indentBase}
                            renamingNodeId={renamingNodeId}
                            focusedNodeId={focusedNodeId}
                            searchQuery={searchQuery}
                            activeFileId={activeFile?.id ?? null}
                            selectedNodeId={selectedNodeId}
                            creationState={creationState}
                            expandedFolderIds={expandedFolderIds}
                            onSetActiveFile={setActiveFile}
                            onToggleFolder={toggleFolder}
                            onSetSelectedFolder={setSelectedFolder}
                            onSetSelectedNode={setSelectedNode}
                            onStartCreating={(type) => startCreating(type, ROOT_NODE_ID)}
                            onCommitCreation={commitCreation}
                            onCancelCreation={cancelCreation}
                            onContextMenu={handleContextMenu}
                            onRenameCommit={handleRenameCommit}
                            onRenameCancel={handleRenameCancel}
                            onDelete={handleDelete}
                            onFocus={setFocusedNodeId}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                            dragOverNodeId={dragOverNodeId}
                            onDownload={handleDownload}
                            onBookmark={toggleBookmark}
                            isBookmarked={bookmarkedFiles.has(node.id)}
                            newlyCreatedNodes={newlyCreatedNodes}
                        />
                    ))
                )}

                <AnimatePresence>
                    {isCreatingAtRoot && (
                        <InputNode
                            type={creationState.type!}
                            depth={0}
                            indentStep={indentStep}
                            indentBase={indentBase}
                            parentId={creationState.parentId ?? ROOT_NODE_ID}
                            onCommit={commitCreation}
                            onCancel={cancelCreation}
                        />
                    )}
                </AnimatePresence>

                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={handleCloseContextMenu}
                        items={getMenuItems()}
                    />
                )}
            </div>

            {/* Keyboard hint bar — quiet, tiny, IDE-native */}
            <div className="mt-auto shrink-0 px-2 py-1.5 border-t flex items-center justify-center gap-2 flex-wrap" style={{ borderColor: 'var(--az-border)', background: 'var(--az-surface-2)', minHeight: '26px' }}>
                {creationState.isActive ? (
                    <>
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">↵</kbd> Create
                        </span>
                        <span className="w-px h-3 bg-white/[0.06] shrink-0" aria-hidden />
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">Esc</kbd> Cancel
                        </span>
                    </>
                ) : renamingNodeId ? (
                    <>
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">↵</kbd> Save
                        </span>
                        <span className="w-px h-3 bg-white/[0.06] shrink-0" aria-hidden />
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">Esc</kbd> Cancel
                        </span>
                    </>
                ) : (
                    <>
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">↑↓</kbd> Navigate
                        </span>
                        <span className="w-px h-3 bg-white/[0.06] shrink-0 hidden sm:block" aria-hidden />
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">↵</kbd> Open
                        </span>
                        <span className="w-px h-3 bg-white/[0.06] shrink-0 hidden sm:block" aria-hidden />
                        <span className="flex items-center gap-1 text-[10px] leading-none" style={{ color: 'var(--az-text-faint)' }}>
                            <kbd className="px-1 py-0.5 rounded-[3px] bg-white/[0.06] border border-white/[0.05] text-[9px] font-mono leading-none text-white/50">F2</kbd> Rename
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};
