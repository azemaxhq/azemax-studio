import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Search, X } from 'lucide-react';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { collectFiles, pathOf } from '../../utils/safeTree';
import { ExplorerFileIcon } from '../Sidebar/ExplorerIcons';

interface MobileSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const MobileSearchModal: React.FC<MobileSearchModalProps> = ({ isOpen, onClose }) => {
    const { fileTree } = useProjectFile();
    const { setActiveFile } = useProjectActions();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const allFiles = useMemo(() => {
        return collectFiles(fileTree);
    }, [fileTree]);

    const filteredFiles = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allFiles.slice(0, 30);
        return allFiles
            .filter(f => f.name.toLowerCase().includes(q) || (f.parentId && f.parentId.toLowerCase().includes(q)))
            .slice(0, 30);
    }, [allFiles, query]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, filteredFiles.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const selected = filteredFiles[selectedIndex];
                if (selected) {
                    setActiveFile(selected);
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredFiles, selectedIndex, setActiveFile, onClose]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[100] flex flex-col justify-start bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg mx-auto px-3 flex flex-col max-h-[85dvh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="flex flex-col rounded-xl overflow-hidden shadow-2xl border"
                    style={{
                        background: 'var(--az-surface-2)',
                        borderColor: 'var(--az-border-strong)',
                    }}
                >
                    {/* Search Input Bar */}
                    <div
                        className="flex items-center gap-2 px-3.5 h-12 border-b shrink-0"
                        style={{
                            background: 'var(--az-surface-3)',
                            borderColor: 'var(--az-border)',
                        }}
                    >
                        <Search size={16} className="text-[var(--az-text-muted)] shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setSelectedIndex(0);
                            }}
                            placeholder="Search files by name..."
                            aria-label="Search files"
                            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-[var(--az-text)] placeholder:text-[var(--az-text-muted)] min-w-0"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                className="p-1 rounded-md text-[var(--az-text-muted)] hover:text-[var(--az-text)]"
                                aria-label="Clear query"
                            >
                                <X size={14} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-2 py-1 text-xs rounded-md font-medium text-[var(--az-text-secondary)] hover:bg-white/10 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>

                    {/* Results List */}
                    <div className="overflow-y-auto max-h-[60dvh] p-1.5 space-y-0.5 custom-scrollbar">
                        {filteredFiles.length === 0 ? (
                            <div className="py-8 text-center text-xs text-[var(--az-text-muted)]">
                                No files found matching "{query}"
                            </div>
                        ) : (
                            filteredFiles.map((file, idx) => {
                                const isSelected = idx === selectedIndex;
                                const filePath = pathOf(fileTree, file.id) || file.name;

                                return (
                                    <div
                                        key={file.id}
                                        onClick={() => {
                                            setActiveFile(file);
                                            onClose();
                                        }}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors min-h-[44px]
                                            ${isSelected
                                                ? 'bg-[var(--az-surface-hover)] text-[var(--az-text)]'
                                                : 'text-[var(--az-text-secondary)] hover:bg-white/[0.04]'
                                            }
                                        `}
                                    >
                                        <div className="shrink-0 flex items-center justify-center w-5 h-5">
                                            <ExplorerFileIcon name={file.name} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-medium truncate leading-tight text-[var(--az-text)]">
                                                {file.name}
                                            </div>
                                            <div className="text-[11px] truncate text-[var(--az-text-muted)] leading-tight mt-0.5">
                                                {filePath}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
