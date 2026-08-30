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
    sortTree,
    pathOf,
} from '../../utils/safeTree';
import {
    Folder, FolderOpen, ChevronRight,
    Search, X, Settings, FileCode,
    Trash2, Hash
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';
import { useSettingsSelector } from '../../context/SettingsContext';
import { getSettings } from '../../settings/settingsStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// Programming language icons
import {
    SiTypescript, SiJavascript, SiPython, SiCplusplus, SiC,
    SiGo, SiRust, SiRuby, SiPhp, SiSwift, SiKotlin, SiHtml5,
    SiCss3, SiSass, SiMarkdown, SiGnubash, SiDocker, SiGit,
    SiReact, SiVuedotjs, SiSvelte, SiNodedotjs, SiGraphql
} from 'react-icons/si';
import { FaJava, FaDatabase, FaImage, FaLock } from 'react-icons/fa';
import { VscJson } from 'react-icons/vsc';

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
    onCommit: (name: string) => void;
    onCancel: () => void;
}

const InputNode = ({ type, depth, initialValue = '', indentStep, indentBase, onCommit, onCancel }: InputNodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(initialValue);
    const [isFocused, setIsFocused] = useState(false);
    const isSubmitting = useRef(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                if (initialValue) {
                    const lastDotIndex = initialValue.lastIndexOf('.');
                    if (lastDotIndex > 0) {
                        inputRef.current.setSelectionRange(0, lastDotIndex);
                    } else {
                        inputRef.current.select();
                    }
                }
            }
        }, 10);
        return () => clearTimeout(timer);
    }, [initialValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (isSubmitting.current) return;
            isSubmitting.current = true;
            if (value.trim()) onCommit(value.trim());
            else onCancel();
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
        isSubmitting.current = true;
        if (value.trim()) {
            onCommit(value.trim());
        } else {
            onCancel();
        }
    };

    const isFolder = type === 'folder';

    return (
        <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ paddingLeft: `${depth * indentStep + indentBase}px` }}
            className={cn(
                "flex items-center gap-2 py-1.5 px-2.5 mx-1.5 mt-1.5 rounded-lg border",
                "bg-[var(--az-surface-3)] border-[var(--az-border)]"
            )}
        >
            {/* Chevron placeholder */}
            <span className="opacity-70 shrink-0 w-4 flex justify-center">
                {isFolder ? <ChevronRight size={14} className="invisible" /> : <span className="w-3" />}
            </span>

            {/* Animated icon */}
            <div className="shrink-0 animate-creation-icon-bounce">
                {isFolder
                    ? <Folder size={16} className="text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.5)]" />
                    : <FileCode size={16} className="text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
                }
            </div>

            {/* Input field with glow */}
            <div className="flex-1 flex items-center relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    onFocus={() => setIsFocused(true)}
                    className={cn(
                        "text-sm w-full px-2.5 py-1 rounded-md font-medium transition-colors duration-150 antialiased",
                        "placeholder:text-white/25 focus:outline-none border",
                        isFocused
                            ? "bg-[var(--az-surface-3)] border-[var(--az-border-strong)] text-white ring-1 ring-[var(--az-border-strong)]"
                            : "bg-white/[0.03] border-white/[0.06] text-white"
                    )}
                    placeholder={isFolder ? "Folder name..." : "File name..."}
                />

                {/* Typing indicator dot */}
                {isFocused && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn(
                            "absolute right-2 w-1.5 h-1.5 rounded-full",
                            isFolder ? "bg-purple-400" : "bg-cyan-400"
                        )}
                    />
                )}
            </div>

            {/* Hint badge */}
            <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.2 }}
                className="text-[9px] text-white/30 font-mono shrink-0 select-none"
            >
                ↵
            </motion.span>
        </motion.div>
    )
}

// Neutral folder color — subtle, single muted tone (quiet confidence)
const getFolderColor = (_name: string): string => {
    return 'text-[#8B90A0]';
};

const FileIcon = ({ name, isOpen, isFolder }: { name: string; isOpen?: boolean; isFolder?: boolean }) => {
    if (isFolder) {
        const color = getFolderColor(name);
        return isOpen
            ? <FolderOpen size={16} className={cn(color, "drop-shadow-sm")} />
            : <Folder size={16} className={cn(color, "drop-shadow-sm")} />;
    }

    // React/Vue/Svelte components
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) return <SiReact size={14} className="text-cyan-400 drop-shadow-sm" />;
    if (name.endsWith('.ts')) return <SiTypescript size={14} className="text-blue-400 drop-shadow-sm" />;
    if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return <SiJavascript size={14} className="text-yellow-400 drop-shadow-sm" />;
    if (name.endsWith('.vue')) return <SiVuedotjs size={14} className="text-emerald-400 drop-shadow-sm" />;
    if (name.endsWith('.svelte')) return <SiSvelte size={14} className="text-orange-500 drop-shadow-sm" />;

    // Config files
    if (name === 'package.json' || name === 'package-lock.json') return <SiNodedotjs size={14} className="text-green-500 drop-shadow-sm" />;
    if (name === 'tsconfig.json' || name.startsWith('tsconfig')) return <SiTypescript size={14} className="text-blue-400 drop-shadow-sm" />;
    if (name.endsWith('.json')) return <VscJson size={15} className="text-yellow-500 drop-shadow-sm" />;
    if (name === 'Dockerfile' || name.startsWith('docker')) return <SiDocker size={14} className="text-blue-500 drop-shadow-sm" />;
    if (name === '.gitignore' || name === '.gitattributes') return <SiGit size={14} className="text-orange-500 drop-shadow-sm" />;
    if (name.startsWith('.env')) return <FaLock size={13} className="text-yellow-600 drop-shadow-sm" />;
    if (name.endsWith('.graphql') || name.endsWith('.gql')) return <SiGraphql size={14} className="text-pink-500 drop-shadow-sm" />;

    // Languages
    if (name.endsWith('.py')) return <SiPython size={14} className="text-green-400 drop-shadow-sm" />;
    if (name.endsWith('.java')) return <FaJava size={14} className="text-orange-500 drop-shadow-sm" />;
    if (name.endsWith('.cs')) return <Hash size={14} className="text-[#178600] drop-shadow-sm" />;
    if (name.endsWith('.c') || name.endsWith('.h')) return <SiC size={14} className="text-blue-500 drop-shadow-sm" />;
    if (name.endsWith('.cpp') || name.endsWith('.cc') || name.endsWith('.hpp')) return <SiCplusplus size={14} className="text-blue-600 drop-shadow-sm" />;
    if (name.endsWith('.go')) return <SiGo size={14} className="text-cyan-400 drop-shadow-sm" />;
    if (name.endsWith('.rs')) return <SiRust size={14} className="text-orange-400 drop-shadow-sm" />;
    if (name.endsWith('.rb')) return <SiRuby size={14} className="text-red-400 drop-shadow-sm" />;
    if (name.endsWith('.php')) return <SiPhp size={14} className="text-purple-400 drop-shadow-sm" />;
    if (name.endsWith('.swift')) return <SiSwift size={14} className="text-orange-500 drop-shadow-sm" />;
    if (name.endsWith('.kt') || name.endsWith('.kts')) return <SiKotlin size={14} className="text-purple-500 drop-shadow-sm" />;

    // Styles
    if (name.endsWith('.css')) return <SiCss3 size={14} className="text-blue-400 drop-shadow-sm" />;
    if (name.endsWith('.scss') || name.endsWith('.sass')) return <SiSass size={14} className="text-pink-400 drop-shadow-sm" />;

    // Markup & docs
    if (name.endsWith('.md') || name.endsWith('.mdx')) return <SiMarkdown size={14} className="text-white/60 drop-shadow-sm" />;
    if (name.endsWith('.html') || name.endsWith('.htm')) return <SiHtml5 size={14} className="text-orange-500 drop-shadow-sm" />;

    // Shell & scripts
    if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return <SiGnubash size={14} className="text-green-500 drop-shadow-sm" />;

    // Data
    if (name.endsWith('.sql')) return <FaDatabase size={13} className="text-[var(--az-text)] drop-shadow-sm" />;
    if (name.endsWith('.yml') || name.endsWith('.yaml')) return <Settings size={14} className="text-red-300 drop-shadow-sm" />;

    // Images
    if (name.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i)) return <FaImage size={13} className="text-purple-400 drop-shadow-sm" />;

    // Default
    return <FileCode size={15} className="text-gray-400 drop-shadow-sm" />;
};

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
}

// Highlight matching text in search
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HighlightText = ({ text, query }: { text: string; query: string }) => {
    if (!query || !query.trim()) return <span>{text}</span>;
    // The query is a literal search string; escape it so special characters
    // (e.g. `[`, `(`, `.`) never crash the regex or match unintended text.
    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return (
        <span>
            {parts.map((part, i) =>
                part.toLowerCase() === query.toLowerCase()
                    ? <mark key={i} className="bg-amber-500/25 text-amber-200 rounded-sm px-0.5 py-0 ring-1 ring-amber-500/30">{part}</mark>
                    : part
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
    onCancelCreation
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

    const isCreatingHere = creationState.isActive && (
        creationState.parentId === node.id ||
        (creationState.parentId === 'root' && node.id === 'root')
    );

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
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
                initialValue={node.name}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
            />
        );
    }

    return (
        <div className={isNewlyCreated ? 'animate-creation-success rounded-lg' : ''}>
            <div
                className={cn(
                    "flex items-center gap-1.5 py-0 px-2 cursor-pointer transition-colors duration-120 text-[13px] leading-none select-none group relative rounded-md mx-1 border min-h-[28px] h-7 antialiased",
                    isActive
                        ? "bg-[var(--az-surface-3)] text-[var(--az-text)] border-[var(--az-border)]"
                        : isFocused
                            ? "bg-[var(--az-surface-3)] text-[var(--az-text)] border-[var(--az-border-strong)]"
                            : isSelected
                                ? "bg-[var(--az-surface-2)] text-[var(--az-text-secondary)] border-[var(--az-border)]"
                                : "text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] border-transparent",
                    isDragOver && "bg-[var(--az-accent-soft)] border-[var(--az-accent-border)]"
                )}
                style={{ paddingLeft: `${depth * indentStep + indentBase}px` }}
                onClick={handleClick}
                onContextMenu={(e) => onContextMenu(e, node)}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={onDragEnd}
                data-node-id={node.id}
            >
                {/* Chevron for folders */}
                <span
                    className={cn(
                        "opacity-60 shrink-0 w-4 flex justify-center transition-transform duration-150",
                        isOpen && "rotate-90"
                    )}
                >
                    {isFolder ? (
                        <ChevronRight size={12} strokeWidth={2.5} />
                    ) : (
                        <span className="w-3" />
                    )}
                </span>

                {/* File/Folder Icon */}
                <div className="shrink-0 flex items-center justify-center w-4 h-4">
                    <FileIcon name={node.name} isOpen={isOpen} isFolder={isFolder} />
                </div>

                {/* File/Folder Name */}
                <span className="truncate flex-1 font-medium">
                    <HighlightText text={node.name} query={searchQuery} />
                </span>

                {/* File Count Badge for Folders */}
                {isFolder && Array.isArray(node.children) && node.children.length > 0 && !isOpen && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/50 font-semibold tabular-nums border border-white/[0.05]">
                        {node.children.length}
                    </span>
                )}

                {/* Bookmark Button (Visible on Hover for Files) */}
                {!isFolder && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onBookmark) {
                                onBookmark(node.id);
                            }
                        }}
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded-md transition-all duration-150 ${isBookmarked
                                ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/25'
                                : 'text-white/40 hover:text-yellow-400 hover:bg-yellow-500/15'
                            }`}
                        title={isBookmarked ? 'Remove from Favorites' : 'Add to Favorites'}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                        </svg>
                    </button>
                )}

                {/* Download Button (Visible on Hover) */}
                {onDownload && (
                    <button
                        onClick={handleDownloadClick}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-green-400 hover:bg-green-500/15 rounded-md transition-all duration-150"
                        title={isFolder ? "Download Folder" : "Download File"}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                )}

                {/* Delete Button (Visible on Hover) */}
                <button
                    onClick={handleDeleteClick}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 hover:bg-red-500/15 rounded-md transition-all duration-150"
                    title="Delete"
                >
                    <Trash2 size={12} />
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
                        {/* Indent Guide Line — crisp 1px, no subpixel */}
                        {depth >= 0 && (
                            <div
                                className="absolute top-0 bottom-0 w-px"
                                style={{ background: "var(--az-border)", left: `${(depth * indentStep) + indentBase + 7}px`, transform: 'translateZ(0)' } as React.CSSProperties}
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
                                    style={{ paddingLeft: `${(depth + 1) * indentStep + 28}px` }}
                                    className="py-2 text-[11px] text-white/25 italic select-none flex items-center gap-1.5"
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

// Advanced search with multiple criteria — delegates to the cycle-safe filterTree.
const filterTreeAdvanced = (nodes: FileNode[], filters: SearchFilters): FileNode[] => {
    const { query, fileType, dateRange, sizeRange, showHidden } = filters;

    if (!query && fileType === 'all' && dateRange === 'all' && sizeRange === 'all' && showHidden) {
        return nodes;
    }

    const lowerQuery = query.toLowerCase();
    const now = Date.now();

    return filterTree(nodes, {
        forceOpen: Boolean(query),
        skip: (node) => !showHidden && node.name.startsWith('.'),
        predicate: (node) => {
            const nameMatches = !query || node.name.toLowerCase().includes(lowerQuery);
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
    const { renameNode, deleteNode, commitCreation, cancelCreation, startCreating, moveNode, toggleFolder, setActiveFile, setSelectedFolder, setSelectedNode, getFileTree } = useProjectActions();

    // Below 1024px the tree indentation tightens so deep nesting can never push
    // filenames/actions past the drawer edge. Desktop indentation is unchanged.
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const indentStep = isDesktop ? 16 : 10;
    const indentBase = isDesktop ? 12 : 8;

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const [draggedNode, setDraggedNode] = useState<FileNode | null>(null);
    const [newlyCreatedNodes, setNewlyCreatedNodes] = useState<Set<string>>(new Set());
    const prevTreeIdsRef = useRef<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

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

    // Render shape: the canonical model stores the project root as a top-level
    // sibling of the root-level items (parentId === 'root'). For rendering, the
    // root is presented as the container of those items, exactly like the
    // legacy root.children model users saw before. This is a pure projection —
    // the real tree is never mutated. Rows are rendered from an IDE-sorted
    // (folders-first, natural-alpha) view derived from the filtered tree.
    const sortedTree = useMemo(() => sortTree(filteredTree), [filteredTree]);

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
                    if (!confirmDeleteSetting || window.confirm(`Delete "${targetNode?.name ?? 'this item'}"?`)) {
                        deleteNode(focusedNodeId);
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
    }, [flatNodes, focusedNodeId, toggleFolder, deleteNode, setActiveFile, setSelectedFolder, setSelectedNode, creationState.isActive, renamingNodeId, confirmDeleteSetting, expandedFolderIds]);

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
        }
    }, [draggedNode]);

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
        if (targetId && targetId !== 'root') {
            if (!confirmDeleteSetting || window.confirm('Delete this item?')) {
                setTimeout(() => {
                    deleteNode(targetId);
                }, 50);
            }
        }
    }, [contextMenu, deleteNode, confirmDeleteSetting]);

    const handleRenameCommit = useCallback((newName: string) => {
        if (renamingNodeId) {
            renameNode(renamingNodeId, newName);
            setRenamingNodeId(null);
        }
    }, [renamingNodeId, renameNode]);

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

        const baseItems = [
            { label: 'New File...', onClick: () => startCreating('file', contextMenu?.nodeId !== 'root' ? contextMenu?.nodeId : undefined) },
            { label: 'New Folder...', onClick: () => startCreating('folder', contextMenu?.nodeId !== 'root' ? contextMenu?.nodeId : undefined) },
            { type: 'separator' as const },
        ];

        if (isRoot) {
            return [
                { label: 'New File...', onClick: () => startCreating('file', 'root') },
                { label: 'New Folder...', onClick: () => startCreating('folder', 'root') },
                { type: 'separator' as const },
            ];
        }

        const bookmarkItem = !isFolder ? {
            label: isBookmarked ? 'Remove from Favorites' : 'Add to Favorites',
            onClick: () => toggleBookmark(contextMenu?.nodeId || ''),
            shortcut: '⌘B',
            icon: isBookmarked ? '⭐' : '☆'
        } : null;

        const downloadItems = isFolder
            ? [{ label: 'Download Folder...', onClick: () => downloadFolder(contextMenu?.nodeId || '') }]
            : [{ label: 'Download File', onClick: () => downloadFile(contextMenu?.nodeId || '') }];

        return [
            ...baseItems,
            ...(bookmarkItem ? [bookmarkItem] : []),
            ...downloadItems,
            { type: 'separator' as const },
            { label: 'Reveal in Finder', onClick: () => console.log('Reveal:', contextMenu?.nodeId), shortcut: '⌥⌘R' },
            { label: 'Open in Terminal', onClick: () => console.log('Terminal:', contextMenu?.nodeId) },
            { type: 'separator' as const },
            { label: 'Copy Path', onClick: () => { const p = pathOf(fileTree, contextMenu?.nodeId ?? ''); navigator.clipboard.writeText(p ? `/${p}` : '/'); }, shortcut: '⌥⌘C' },
            { label: 'Copy Relative Path', onClick: () => { navigator.clipboard.writeText(pathOf(fileTree, contextMenu?.nodeId ?? '')); }, shortcut: '⇧⌥⌘C' },
            { type: 'separator' as const },
            { label: 'Rename', onClick: handleRenameStart, shortcut: 'F2' },
            { label: 'Delete', onClick: () => handleDelete(), danger: true, shortcut: '⌫' }
        ];
    };

    return (
        <div className="h-full flex flex-col" ref={containerRef} tabIndex={0}>

            {/* Premium Search Bar with Advanced Filters */}
            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSearchOpen ? 'grid-rows-[1fr] opacity-100 mb-1' : 'grid-rows-[0fr] opacity-0 mb-0'}`}>
                <div className="overflow-hidden">
                    <div className="px-2.5 pt-2.5 pb-1">
                        <div className="relative group">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-blue-400/70 transition-colors" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search files... (⌘F)"
                                className="w-full pl-9 pr-20 py-2 h-8 text-[13px] leading-none bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder:text-white/30 placeholder:text-[12px] focus:outline-none focus:border-[var(--az-accent-border)] focus:bg-white/[0.06] focus:shadow-[var(--az-focus-ring)] transition-colors duration-150 antialiased"
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {getActiveFilterCount() > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-[var(--az-text)] font-semibold">
                                        {getActiveFilterCount()}
                                    </span>
                                )}
                                <button
                                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                    className={`p-1 rounded-md transition-all ${showAdvancedFilters
                                            ? 'bg-[var(--az-surface-3)] text-[var(--az-text)] border border-[var(--az-border)]'
                                            : 'text-white/40 hover:text-white hover:bg-white/10'
                                        }`}
                                    title="Advanced Filters"
                                >
                                    <Settings size={12} />
                                </button>
                                {searchQuery && (
                                    <button
                                        onClick={() => {
                                            setSearchQuery('');
                                            onSearchClose();
                                        }}
                                        className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all"
                                    >
                                        <X size={12} />
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
                <div className="border-b border-white/[0.04] bg-gradient-to-b from-amber-500/5 to-transparent">
                    <div className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                            </svg>
                            <span className="text-[11px] font-semibold text-amber-300">Favorites ({bookmarkedFiles.size})</span>
                        </div>
                        <button
                            onClick={() => {
                                setBookmarkedFiles(new Set());
                            }}
                            className="text-[9px] text-white/40 hover:text-white/60 px-1.5 py-0.5 rounded hover:bg-white/10 transition-all"
                        >
                            Clear All
                        </button>
                    </div>
                    <div className="px-2 pb-2 space-y-0.5">
                        {getBookmarkedFiles().map((file) => (
                            <div
                                key={file.id}
                                onClick={() => setActiveFile(file)}
                                className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-[11px] text-white/70 hover:text-white hover:bg-white/[0.06] cursor-pointer transition-all group"
                            >
                                <FileIcon name={file.name} isFolder={false} />
                                <span className="truncate flex-1">{file.name}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleBookmark(file.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 rounded transition-all"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* File Tree */}
            <div
                className="flex-1 overflow-y-auto py-1 custom-scrollbar"
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

            {/* Keyboard Shortcuts Help */}
            <div className="px-3 py-2.5 border-t border-white/[0.04] text-[10px] text-white/30 flex items-center justify-center gap-3 flex-wrap bg-gradient-to-t from-white/[0.01] to-transparent">
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">↑↓</kbd> Navigate</span>
                <span className="text-white/10">•</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">↵</kbd> Open</span>
                <span className="text-white/10">•</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">F2</kbd> Rename</span>
            </div>
        </div>
    );
};
