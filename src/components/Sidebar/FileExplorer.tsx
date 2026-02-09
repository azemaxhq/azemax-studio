import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { FileNode } from '../../utils/mockFileSystem';
import { useProject } from '../../context/ProjectContext';
import {
    ChevronRight, Folder, FolderOpen, Trash2,
    Search, X, Settings, FileCode
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from '../UI/ContextMenu';

// Programming language icons
import {
    SiTypescript, SiJavascript, SiPython, SiCplusplus, SiC,
    SiGo, SiRust, SiRuby, SiPhp, SiSwift, SiKotlin, SiHtml5,
    SiCss3, SiSass, SiMarkdown, SiGnubash, SiDocker, SiGit,
    SiReact, SiVuedotjs, SiSvelte, SiNodedotjs, SiGraphql
} from 'react-icons/si';
import { FaJava, FaDatabase, FaImage, FaLock } from 'react-icons/fa';
import { VscJson } from 'react-icons/vsc';

interface InputNodeProps {
    type: 'file' | 'folder';
    depth: number;
    initialValue?: string;
    onCommit: (name: string) => void;
    onCancel: () => void;
}

const InputNode = ({ type, depth, initialValue = '', onCommit, onCancel }: InputNodeProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(initialValue);
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

    return (
        <div
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
            className="flex items-center gap-2 py-2 px-2.5 mx-2 rounded-xl animate-in fade-in zoom-in-95 duration-200 bg-gradient-to-r from-blue-500/10 to-blue-500/5 border border-blue-500/30 shadow-[0_0_25px_rgba(59,130,246,0.12)] backdrop-blur-sm"
        >
            <span className="opacity-70 shrink-0 w-4 flex justify-center">
                {type === 'folder' ? <ChevronRight size={14} className="invisible" /> : <span className="w-3" />}
            </span>
            <div className="shrink-0">
                {type === 'folder'
                    ? <Folder size={16} className="text-blue-400 drop-shadow-sm" />
                    : <FileCode size={16} className="text-blue-300 drop-shadow-sm" />
                }
            </div>
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="bg-transparent text-white text-sm w-full px-2 py-0.5 focus:outline-none placeholder:text-white/30 font-medium rounded-md"
                placeholder="Enter name..."
            />
        </div>
    )
}

// Get folder color based on name
const getFolderColor = (name: string): string => {
    const lowerName = name.toLowerCase();
    if (lowerName === 'src' || lowerName === 'source') return 'text-blue-400';
    if (lowerName === 'components' || lowerName === 'component') return 'text-purple-400';
    if (lowerName === 'pages' || lowerName === 'views') return 'text-green-400';
    if (lowerName === 'utils' || lowerName === 'helpers' || lowerName === 'lib') return 'text-yellow-400';
    if (lowerName === 'hooks') return 'text-cyan-400';
    if (lowerName === 'styles' || lowerName === 'css') return 'text-pink-400';
    if (lowerName === 'assets' || lowerName === 'images' || lowerName === 'public') return 'text-amber-400';
    if (lowerName === 'api' || lowerName === 'services') return 'text-emerald-400';
    if (lowerName === 'context' || lowerName === 'store' || lowerName === 'redux') return 'text-rose-400';
    if (lowerName === 'types' || lowerName === 'interfaces') return 'text-sky-400';
    if (lowerName === 'tests' || lowerName === '__tests__' || lowerName === 'test') return 'text-orange-400';
    if (lowerName === 'node_modules' || lowerName === 'vendor') return 'text-gray-500';
    if (lowerName === 'config' || lowerName === 'configs') return 'text-slate-400';
    if (lowerName === 'dist' || lowerName === 'build' || lowerName === 'out') return 'text-zinc-500';
    return 'text-blue-300';
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
    if (name.endsWith('.sql')) return <FaDatabase size={13} className="text-blue-300 drop-shadow-sm" />;
    if (name.endsWith('.yml') || name.endsWith('.yaml')) return <Settings size={14} className="text-red-300 drop-shadow-sm" />;

    // Images
    if (name.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i)) return <FaImage size={13} className="text-purple-400 drop-shadow-sm" />;

    // Default
    return <FileCode size={15} className="text-gray-400 drop-shadow-sm" />;
};

interface FileTreeNodeProps {
    node: FileNode;
    depth: number;
    renamingNodeId: string | null;
    focusedNodeId: string | null;
    searchQuery: string;
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
}

// Highlight matching text in search
const HighlightText = ({ text, query }: { text: string; query: string }) => {
    if (!query) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
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

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
    node,
    depth,
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
    dragOverNodeId
}) => {
    const { activeFile, setActiveFile, toggleFolder, creationState, commitCreation, cancelCreation, selectedFolder, setSelectedFolder } = useProject();
    const isFolder = node.type === 'folder';
    const isActive = activeFile?.id === node.id;
    const isFocused = focusedNodeId === node.id;
    const isFolderSelected = isFolder && selectedFolder === node.id;
    const isRenaming = renamingNodeId === node.id;
    const isDragOver = dragOverNodeId === node.id && isFolder;

    const isCreatingHere = creationState.isActive && (
        creationState.parentId === node.id ||
        (creationState.parentId === 'root' && node.id === 'root')
    );

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onFocus(node.id);
        if (isFolder) {
            toggleFolder(node.id);
            setSelectedFolder(node.id);
        } else {
            setActiveFile(node);
            const lastSlash = node.id.lastIndexOf('/');
            setSelectedFolder(lastSlash !== -1 ? node.id.substring(0, lastSlash) : 'root');
        }
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(node.id);
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
                initialValue={node.name}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
            />
        );
    }

    return (
        <div>
            <div
                className={cn(
                    "flex items-center gap-2 py-[7px] px-2 cursor-pointer transition-all duration-150 text-[13px] select-none group relative rounded-lg mx-2 border",
                    isActive
                        ? "bg-gradient-to-r from-blue-500/15 to-blue-500/5 text-blue-100 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.08)]"
                        : isFocused
                            ? "bg-white/8 text-white border-white/15 ring-1 ring-blue-500/40 shadow-sm"
                            : isFolderSelected
                                ? "bg-white/[0.04] text-white/90 border-white/[0.06]"
                                : "text-zinc-400 hover:text-white hover:bg-white/[0.06] border-transparent hover:translate-x-0.5",
                    isDragOver && "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                )}
                style={{ paddingLeft: `${depth * 16 + 12}px` }}
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
                        node.isOpen && "rotate-90"
                    )}
                >
                    {isFolder ? (
                        <ChevronRight size={12} strokeWidth={2.5} />
                    ) : (
                        <span className="w-3" />
                    )}
                </span>

                {/* File/Folder Icon */}
                <div className="shrink-0 transition-transform duration-200 group-hover:scale-110">
                    <FileIcon name={node.name} isOpen={node.isOpen} isFolder={isFolder} />
                </div>

                {/* File/Folder Name */}
                <span className="truncate flex-1 font-medium">
                    <HighlightText text={node.name} query={searchQuery} />
                </span>

                {/* File Count Badge for Folders */}
                {isFolder && node.children && node.children.length > 0 && !node.isOpen && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/50 font-semibold tabular-nums border border-white/[0.05]">
                        {node.children.length}
                    </span>
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
                {isFolder && node.isOpen && node.children && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden relative"
                    >
                        {/* Indent Guide Line */}
                        {depth >= 0 && (
                            <div
                                className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-white/[0.03] via-white/[0.06] to-white/[0.03] group-hover:via-white/10 transition-colors"
                                style={{ left: `${(depth * 16) + 18}px` }}
                            />
                        )}

                        {node.children && node.children.length > 0 ? (
                            node.children.map((child) => (
                                <FileTreeNode
                                    key={child.id}
                                    node={child}
                                    depth={depth + 1}
                                    renamingNodeId={renamingNodeId}
                                    focusedNodeId={focusedNodeId}
                                    searchQuery={searchQuery}
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
                                />
                            ))
                        ) : !isCreatingHere && (
                            <div
                                style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
                                className="py-2 text-[11px] text-white/25 italic select-none flex items-center gap-1.5"
                            >
                                <span className="w-1 h-1 rounded-full bg-white/20"></span>
                                Empty folder
                            </div>
                        )}
                        {isCreatingHere && (
                            <InputNode
                                type={creationState.type!}
                                depth={depth + 1}
                                onCommit={commitCreation}
                                onCancel={cancelCreation}
                            />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Flatten tree for keyboard navigation
const flattenTree = (nodes: FileNode[]): FileNode[] => {
    const result: FileNode[] = [];
    const traverse = (nodeList: FileNode[]) => {
        for (const node of nodeList) {
            result.push(node);
            if (node.type === 'folder' && node.isOpen && node.children) {
                traverse(node.children);
            }
        }
    };
    traverse(nodes);
    return result;
};

// Filter tree based on search query
const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes;
    const lowerQuery = query.toLowerCase();

    const filterRecursive = (nodeList: FileNode[]): FileNode[] => {
        return nodeList.reduce<FileNode[]>((acc, node) => {
            const nameMatches = node.name.toLowerCase().includes(lowerQuery);
            const filteredChildren = node.children ? filterRecursive(node.children) : [];

            if (nameMatches || filteredChildren.length > 0) {
                acc.push({
                    ...node,
                    isOpen: query ? true : node.isOpen, // Auto-expand when searching
                    children: node.children ? filteredChildren : undefined
                });
            }
            return acc;
        }, []);
    };

    return filterRecursive(nodes);
};

export const FileExplorer: React.FC = () => {
    const { fileTree, renameNode, deleteNode, creationState, commitCreation, cancelCreation, startCreating, moveNode, toggleFolder, setActiveFile, setSelectedFolder } = useProject();
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
    const [draggedNode, setDraggedNode] = useState<FileNode | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Filter tree based on search
    const filteredTree = useMemo(() => filterTree(fileTree, searchQuery), [fileTree, searchQuery]);

    // Flatten for keyboard navigation
    const flatNodes = useMemo(() => flattenTree(filteredTree), [filteredTree]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== searchInputRef.current) {
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
                    if (node?.type === 'folder' && !node.isOpen) {
                        toggleFolder(node.id);
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (focusedNodeId) {
                    const node = flatNodes.find(n => n.id === focusedNodeId);
                    if (node?.type === 'folder' && node.isOpen) {
                        toggleFolder(node.id);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedNodeId) {
                    const node = flatNodes.find(n => n.id === focusedNodeId);
                    if (node) {
                        if (node.type === 'folder') {
                            toggleFolder(node.id);
                        } else {
                            setActiveFile(node);
                            const lastSlash = node.id.lastIndexOf('/');
                            setSelectedFolder(lastSlash !== -1 ? node.id.substring(0, lastSlash) : 'root');
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
                    // Direct delete for keyboard handler
                    deleteNode(focusedNodeId);
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
    }, [flatNodes, focusedNodeId, toggleFolder, deleteNode, setActiveFile, setSelectedFolder]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Drag and drop handlers
    const handleDragStart = (e: React.DragEvent, node: FileNode) => {
        setDraggedNode(node);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.id);
    };

    const handleDragOver = (_e: React.DragEvent, node: FileNode) => {
        if (node.type === 'folder' && draggedNode && draggedNode.id !== node.id) {
            setDragOverNodeId(node.id);
        }
    };

    const handleDrop = (_e: React.DragEvent, targetNode: FileNode) => {
        if (draggedNode && targetNode.type === 'folder' && draggedNode.id !== targetNode.id) {
            moveNode(draggedNode.id, targetNode.id);
        }
        setDraggedNode(null);
        setDragOverNodeId(null);
    };

    const handleDragEnd = () => {
        setDraggedNode(null);
        setDragOverNodeId(null);
    };

    const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
    };

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

    const handleDelete = (id?: string) => {
        const targetId = id || contextMenu?.nodeId;
        setContextMenu(null);
        if (targetId && targetId !== 'root') {
            setTimeout(() => {
                deleteNode(targetId);
            }, 50);
        }
    };

    const handleRenameCommit = (newName: string) => {
        if (renamingNodeId) {
            renameNode(renamingNodeId, newName);
            setRenamingNodeId(null);
        }
    };

    const handleRenameCancel = () => {
        setRenamingNodeId(null);
    };

    const isCreatingAtRoot = creationState.isActive &&
        (creationState.parentId === 'root' || !creationState.parentId) &&
        !fileTree.some(node => node.id === creationState.parentId);

    const getMenuItems = () => {
        const isRoot = contextMenu?.nodeId === 'root';
        const baseItems = [
            { label: 'New File...', onClick: () => startCreating('file', contextMenu?.nodeId !== 'root' ? contextMenu?.nodeId : undefined) },
            { label: 'New Folder...', onClick: () => startCreating('folder', contextMenu?.nodeId !== 'root' ? contextMenu?.nodeId : undefined) },
            { type: 'separator' as const },
            { label: 'Reveal in Finder', onClick: () => console.log('Reveal:', contextMenu?.nodeId), shortcut: '⌥⌘R' },
            { label: 'Open in Terminal', onClick: () => console.log('Terminal:', contextMenu?.nodeId) },
            { type: 'separator' as const },
        ];

        if (isRoot) {
            return [
                { label: 'New File...', onClick: () => startCreating('file', 'root') },
                { label: 'New Folder...', onClick: () => startCreating('folder', 'root') },
                { type: 'separator' as const },
            ];
        }

        return [
            ...baseItems,
            { label: 'Copy Path', onClick: () => navigator.clipboard.writeText(contextMenu?.nodeId || ''), shortcut: '⌥⌘C' },
            { label: 'Copy Relative Path', onClick: () => { const rel = contextMenu?.nodeId.replace(/^\/?root\/?/, '') || ''; navigator.clipboard.writeText(rel); }, shortcut: '⇧⌥⌘C' },
            { type: 'separator' as const },
            { label: 'Rename', onClick: handleRenameStart, shortcut: 'F2' },
            { label: 'Delete', onClick: () => handleDelete(), danger: true, shortcut: '⌫' }
        ];
    };

    return (
        <div className="h-full flex flex-col" ref={containerRef} tabIndex={0}>

            {/* Premium Search Bar */}
            <div className="px-2.5 py-2.5">
                <div className="relative group">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-blue-400/70 transition-colors" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search files... (⌘F)"
                        className="w-full pl-9 pr-8 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 focus:outline-none focus:border-blue-500/40 focus:bg-white/[0.06] focus:shadow-[0_0_20px_rgba(59,130,246,0.1)] transition-all duration-200"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

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
                        <p className="text-white/25 text-xs">Create a new file or folder to get started</p>
                    </div>
                ) : (
                    filteredTree.map((node) => (
                        <FileTreeNode
                            key={node.id}
                            node={node}
                            depth={0}
                            renamingNodeId={renamingNodeId}
                            focusedNodeId={focusedNodeId}
                            searchQuery={searchQuery}
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
                        />
                    ))
                )}

                {isCreatingAtRoot && (
                    <div className="animate-in fade-in duration-200">
                        <InputNode
                            type={creationState.type!}
                            depth={0}
                            onCommit={commitCreation}
                            onCancel={cancelCreation}
                        />
                    </div>
                )}

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
            <div className="px-3 py-2.5 border-t border-white/[0.04] text-[10px] text-white/30 flex items-center justify-center gap-3 bg-gradient-to-t from-white/[0.01] to-transparent">
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">↑↓</kbd> Navigate</span>
                <span className="text-white/10">•</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">↵</kbd> Open</span>
                <span className="text-white/10">•</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono">F2</kbd> Rename</span>
            </div>
        </div>
    );
};
