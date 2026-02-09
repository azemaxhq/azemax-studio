

export type FileType = 'file' | 'folder';

export interface FileNode {
    id: string;
    name: string;
    type: FileType;
    children?: FileNode[];
    content?: string; // Mock content for files
    isOpen?: boolean; // For folders
}

export const initialFileTree: FileNode[] = [
    {
        id: 'root',
        name: 'deep-context-ide',
        type: 'folder',
        isOpen: true,
        children: []
    }
];
