import React from 'react';
import { FilePlus, FolderPlus, ChevronDown, RefreshCw } from 'lucide-react';
import { FileExplorer } from './FileExplorer';
import { useProject } from '../../context/ProjectContext';

export const Sidebar: React.FC = () => {
    const { startCreating, selectedFolder, collapseAll } = useProject();

    const handleCreateFile = () => {
        // Use selected folder as parent, default to root
        const parentId = selectedFolder || 'root';
        startCreating('file', parentId);
    };

    const handleCreateFolder = () => {
        // Use selected folder as parent, default to root
        const parentId = selectedFolder || 'root';
        startCreating('folder', parentId);
    };

    const handleRefresh = () => {
        window.location.reload();
    };

    return (
        <div className="h-full flex flex-col bg-transparent relative overflow-hidden group/sidebar">
            {/* Gradient glow effect for sidebar */}
            <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

            {/* Header */}
            <div className="h-12 px-3 border-b border-white/5 flex items-center justify-between shrink-0 backdrop-blur-sm relative z-10">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300/80 drop-shadow-sm">
                    <span className="bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px]">EXP</span>
                    <span>Explorer</span>
                </div>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={handleCreateFile}
                        className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-blue-300 transition-all active:scale-95"
                        title="New File (⌘N)"
                    >
                        <FilePlus size={14} />
                    </button>
                    <button
                        onClick={handleCreateFolder}
                        className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-blue-300 transition-all active:scale-95"
                        title="New Folder (⌘⇧N)"
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={collapseAll}
                        className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-blue-300 transition-all active:scale-95"
                        title="Collapse All"
                    >
                        <ChevronDown size={14} />
                    </button>
                    <button
                        onClick={handleRefresh}
                        className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-blue-300 transition-all active:scale-95"
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* File Explorer */}
            <div className="flex-1 overflow-hidden">
                <FileExplorer />
            </div>
        </div>
    );
};
