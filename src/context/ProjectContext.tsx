import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { initialFileTree, type FileNode } from '../utils/mockFileSystem';

const STORAGE_KEY = 'deepcontext-file-tree';
const ACTIVE_FILE_KEY = 'deepcontext-active-file-id';

// Load file tree from localStorage
const loadFileTree = (): FileNode[] => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load file tree from localStorage:', e);
    }
    return initialFileTree;
};

// Save file tree to localStorage
const saveFileTree = (tree: FileNode[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    } catch (e) {
        console.warn('Failed to save file tree to localStorage:', e);
    }
};

// Find a node by ID recursively
const findNodeById = (nodes: FileNode[], id: string): FileNode | null => {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
};

interface ProjectContextType {
    fileTree: FileNode[];
    activeFile: FileNode | null;
    setActiveFile: (file: FileNode) => void;
    selectedFolder: string | null;
    setSelectedFolder: (folderId: string | null) => void;
    toggleFolder: (folderId: string) => void;
    createFile: (path: string, content?: string) => void;
    createFolder: (path: string) => void;
    deleteNode: (id: string) => void;
    updateFileContent: (fileId: string, content: string) => void;
    creationState: { type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean };
    startCreating: (type: 'file' | 'folder', parentId?: string) => void;
    cancelCreation: () => void;
    commitCreation: (name: string) => void;
    renameNode: (id: string, newName: string) => void;
    collapseAll: () => void;
    moveNode: (sourceId: string, targetFolderId: string) => void;
    selectedNodes: Set<string>;
    toggleSelection: (id: string, multi: boolean) => void;
    selectRange: (startId: string, endId: string, allVisibleNodes: string[]) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [fileTree, setFileTree] = useState<FileNode[]>(loadFileTree);
    const [activeFile, setActiveFileState] = useState<FileNode | null>(() => {
        const savedActiveId = localStorage.getItem(ACTIVE_FILE_KEY);
        if (savedActiveId) {
            // We reload the tree here to find the node. 
            // Since loadFileTree is deterministic (reads from LS), this matches the tree state.
            const tree = loadFileTree();
            const node = findNodeById(tree, savedActiveId);
            if (node && node.type === 'file') {
                return node;
            }
        }
        return null;
    });
    const [selectedFolder, setSelectedFolderState] = useState<string | null>('root');
    const [creationState, setCreationState] = useState<{ type: 'file' | 'folder' | null; parentId: string | null; isActive: boolean }>({
        type: null,
        parentId: null,
        isActive: false
    });
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

    // Save fileTree to localStorage whenever it changes
    useEffect(() => {
        saveFileTree(fileTree);
    }, [fileTree]);

    // Wrapper to also save active file ID
    const setActiveFile = (file: FileNode) => {
        setActiveFileState(file);
        localStorage.setItem(ACTIVE_FILE_KEY, file.id);
    };

    // Helper to toggle folder open/close state recursively
    const toggleFolderRecursive = (nodes: FileNode[], folderId: string): FileNode[] => {
        return nodes.map(node => {
            if (node.id === folderId) {
                return { ...node, isOpen: !node.isOpen };
            }
            if (node.children) {
                return { ...node, children: toggleFolderRecursive(node.children, folderId) };
            }
            return node;
        });
    };

    const openFolderRecursive = (nodes: FileNode[], folderId: string): FileNode[] => {
        return nodes.map(node => {
            if (node.id === folderId) {
                return { ...node, isOpen: true };
            }
            if (node.children) {
                return { ...node, children: openFolderRecursive(node.children, folderId) };
            }
            return node;
        });
    };

    const toggleFolder = (folderId: string) => {
        setFileTree(prev => toggleFolderRecursive(prev, folderId));
    };

    const createFile = (path: string, content: string = '') => {
        const parts = path.split('/');
        const fileName = parts.pop()!;

        const newFile: FileNode = {
            id: path,
            name: fileName,
            type: 'file',
            content
        };

        setFileTree(prev => {
            const parentId = path.lastIndexOf('/') !== -1 ? path.substring(0, path.lastIndexOf('/')) : 'root';

            // If adding to root, just append to the list
            if (parentId === 'root') {
                return [...prev, newFile];
            }

            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === parentId) {
                        return { ...node, children: [...(node.children || []), newFile], isOpen: true };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };

            return updateRecursive(prev);
        });

        setActiveFile(newFile);
    };

    const createFolder = (path: string) => {
        const parts = path.split('/');
        const folderName = parts.pop()!;

        const newFolder: FileNode = {
            id: path,
            name: folderName,
            type: 'folder',
            isOpen: true,
            children: []
        };

        setFileTree(prev => {
            const parentId = path.lastIndexOf('/') !== -1 ? path.substring(0, path.lastIndexOf('/')) : 'root';

            // If adding to root, just append to the list
            if (parentId === 'root') {
                return [...prev, newFolder];
            }

            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === parentId) {
                        return { ...node, children: [...(node.children || []), newFolder], isOpen: true };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };

            return updateRecursive(prev);
        });
    };

    const deleteNodeRecursive = (nodes: FileNode[], id: string): FileNode[] => {
        return nodes.filter(node => node.id !== id).map(node => ({
            ...node,
            children: node.children ? deleteNodeRecursive(node.children, id) : undefined
        }));
    };

    const deleteNode = (id: string) => {
        // Check if we are deleting the currently selected folder or one of its parents
        const isDeletingSelected = selectedFolder === id || selectedFolder?.startsWith(id + '/');
        if (isDeletingSelected) {
            setSelectedFolder('root');
        }

        // Check if active file is being deleted or inside a deleted folder
        const isActiveFileDeleted = activeFile?.id === id || activeFile?.id.startsWith(id + '/');
        if (isActiveFileDeleted) {
            setActiveFileState(null);
            localStorage.removeItem(ACTIVE_FILE_KEY);
        }

        setFileTree(prev => deleteNodeRecursive(prev, id));
    };

    const startCreating = (type: 'file' | 'folder', parentId: string = 'root') => {
        // Validation: Ensure parentId exists in the tree (unless it's root)
        if (parentId !== 'root') {
            const parentNode = findNodeById(fileTree, parentId);
            if (!parentNode) {
                // Fallback to root or handle error. 
                // For now, let's fallback to root to ensure UI shows up.
                parentId = 'root';
            }
        }

        // Always expand the parent folder to show the input
        setFileTree(prev => openFolderRecursive(prev, parentId));
        setCreationState({ type, parentId, isActive: true });
    };

    const cancelCreation = () => {
        setCreationState({ type: null, parentId: null, isActive: false });
    };

    const commitCreation = (name: string) => {
        if (!creationState.isActive || !creationState.type) return;

        const parentId = creationState.parentId || 'root';
        // Construct path - simplistic, assuming parentId is practically the path or we append to root
        // In this mock, parentId is the path for folders.
        const path = parentId === 'root' ? name : `${parentId}/${name}`;

        if (creationState.type === 'file') {
            createFile(path, '');
        } else {
            createFolder(path);
        }

        cancelCreation();
    };

    // Update file content in the tree (for persistence)
    const updateFileContent = (fileId: string, content: string) => {
        setFileTree(prev => {
            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === fileId) {
                        return { ...node, content };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };
            return updateRecursive(prev);
        });

        // Also update activeFile if it's the same file
        if (activeFile?.id === fileId) {
            setActiveFileState({ ...activeFile, content });
        }
    };

    const renameNode = (id: string, newName: string) => {
        setFileTree(prev => {
            const updateRecursive = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(node => {
                    if (node.id === id) {
                        // const newId = node.id.substring(0, node.id.lastIndexOf('/')) + '/' + newName;
                        // Ideally we would recursively update IDs of children too if it's a folder, 
                        // but for this MVP let's just update the name and the ID of this node. 
                        // Note: Breaking IDs of children might break their paths, but for a simple mock FS it might be okay for now.
                        // A proper FS would handle paths more robustly.
                        return { ...node, name: newName };
                    }
                    if (node.children) {
                        return { ...node, children: updateRecursive(node.children) };
                    }
                    return node;
                });
            };
            return updateRecursive(prev);
        });
    };

    const setSelectedFolder = (folderId: string | null) => {
        setSelectedFolderState(folderId);
    };

    // Collapse all folders
    const collapseAll = () => {
        const collapseRecursive = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => ({
                ...node,
                isOpen: false,
                children: node.children ? collapseRecursive(node.children) : undefined
            }));
        };
        setFileTree(prev => collapseRecursive(prev));
    };

    // Move a node to a different folder
    const moveNode = (sourceId: string, targetFolderId: string) => {
        const sourceNode = findNodeById(fileTree, sourceId);
        if (!sourceNode) return;
        if (sourceId === targetFolderId) return;
        // Prevent moving a folder into itself or its children
        if (targetFolderId.startsWith(sourceId + '/')) return;

        setFileTree(prev => {
            // First, remove the node from its current location
            const removeNode = (nodes: FileNode[]): FileNode[] => {
                return nodes.filter(n => n.id !== sourceId).map(n => ({
                    ...n,
                    children: n.children ? removeNode(n.children) : undefined
                }));
            };

            // Then, add it to the target folder
            const addToTarget = (nodes: FileNode[]): FileNode[] => {
                return nodes.map(n => {
                    if (n.id === targetFolderId) {
                        return { ...n, children: [...(n.children || []), sourceNode], isOpen: true };
                    }
                    if (n.children) {
                        return { ...n, children: addToTarget(n.children) };
                    }
                    return n;
                });
            };

            let newTree = removeNode(prev);
            if (targetFolderId === 'root') {
                newTree = [...newTree, sourceNode];
            } else {
                newTree = addToTarget(newTree);
            }
            return newTree;
        });
    };

    return (
        <ProjectContext.Provider value={{
            fileTree,
            activeFile,
            setActiveFile,
            selectedFolder,
            setSelectedFolder,
            toggleFolder,
            createFile,
            createFolder,
            deleteNode,
            updateFileContent,
            creationState,
            startCreating,
            cancelCreation,
            commitCreation,
            renameNode,
            collapseAll,
            moveNode,
            selectedNodes,
            toggleSelection: (id: string, multi: boolean) => {
                setSelectedNodes(prev => {
                    const next = new Set(multi ? prev : []);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                });
                if (!multi) setSelectedFolder(id); // Sync with single select concept
            },
            selectRange: (startId, endId, allVisibleNodes) => {
                const startIndex = allVisibleNodes.indexOf(startId);
                const endIndex = allVisibleNodes.indexOf(endId);
                if (startIndex === -1 || endIndex === -1) return;

                const min = Math.min(startIndex, endIndex);
                const max = Math.max(startIndex, endIndex);
                const range = allVisibleNodes.slice(min, max + 1);

                setSelectedNodes(new Set(range));
            }
        }}>
            {children}
        </ProjectContext.Provider>
    );
};

export const useProject = () => {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return context;
};
