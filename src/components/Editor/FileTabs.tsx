import React, { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { ExplorerFileIcon } from '../Sidebar/ExplorerIcons';
import type { FileNode } from '../../utils/mockFileSystem';

interface FileTabsProps {
    className?: string;
    isMobile?: boolean;
}

export const FileTabs: React.FC<FileTabsProps> = ({ className = '', isMobile = false }) => {
    const { openFiles, activeFile, modifiedFiles } = useProjectFile();
    const { setActiveFile, closeFile } = useProjectActions();
    const activeTabRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Scroll active tab into view smoothly
    useEffect(() => {
        if (activeTabRef.current) {
            activeTabRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
            });
        }
    }, [activeFile?.id]);

    if (!openFiles || openFiles.length === 0) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            role="tablist"
            aria-label="Editor file tabs"
            className={`flex items-center overflow-x-auto no-scrollbar border-b shrink-0 select-none ${className}`}
            style={{
                background: 'var(--az-surface)',
                borderColor: 'var(--az-border)',
                height: isMobile ? '38px' : '34px',
                minHeight: isMobile ? '38px' : '34px',
            }}
        >
            {openFiles.map((file: FileNode) => {
                const isActive = activeFile?.id === file.id;
                const isDirty = modifiedFiles.has(file.id);

                return (
                    <div
                        key={file.id}
                        ref={isActive ? activeTabRef : null}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={0}
                        onClick={() => setActiveFile(file)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveFile(file);
                            } else if (e.key === 'w' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                closeFile(file.id);
                            }
                        }}
                        className={`group relative flex items-center gap-2 border-r transition-colors duration-150 cursor-pointer shrink-0
                            ${isMobile ? 'px-3 h-[38px] text-[12.5px]' : 'px-3 h-[34px] text-[12px]'}
                            ${isActive
                                ? 'bg-[var(--az-surface-2)] text-[var(--az-text)] font-medium'
                                : 'text-[var(--az-text-secondary)] hover:text-[var(--az-text)] hover:bg-white/[0.03]'
                            }`}
                        style={{
                            borderColor: 'var(--az-border)',
                            maxWidth: isMobile ? '200px' : '220px',
                            minWidth: isMobile ? '100px' : '110px',
                        }}
                        title={file.name}
                    >
                        {/* Active indicator bar at top or bottom */}
                        {isActive && (
                            <div
                                className="absolute bottom-0 left-0 right-0 h-[2px]"
                                style={{ background: 'var(--az-accent)' }}
                            />
                        )}

                        {/* File Icon */}
                        <div className="shrink-0 flex items-center justify-center">
                            <ExplorerFileIcon name={file.name} />
                        </div>

                        {/* File Name */}
                        <span className="truncate flex-1 min-w-0 font-sans tracking-tight">
                            {file.name}
                        </span>

                        {/* Dirty Dot or Close Button */}
                        <div className="flex items-center shrink-0 ml-1">
                            {isDirty && !isMobile && (
                                <span
                                    className="w-1.5 h-1.5 rounded-full mr-1 group-hover:hidden"
                                    style={{ background: 'var(--az-accent)' }}
                                    title="Unsaved changes"
                                />
                            )}
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeFile(file.id);
                                }}
                                aria-label={`Close ${file.name}`}
                                className={`w-4 h-4 rounded flex items-center justify-center transition-colors text-[var(--az-text-muted)] hover:text-[var(--az-text)] hover:bg-white/10
                                    ${isDirty && !isMobile ? 'hidden group-hover:flex' : 'opacity-70 group-hover:opacity-100'}
                                `}
                            >
                                <X size={isMobile ? 12 : 11} strokeWidth={2} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
