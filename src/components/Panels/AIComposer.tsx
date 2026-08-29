import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Paperclip, AtSign, Sparkles, ArrowUp, Square, X, FileCode, Hash, Zap } from 'lucide-react';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { getActiveEditorContext } from '../../core/editor/activeEditorStore';

interface ContextChip {
    id: string;
    label: string;
    detail?: string;
    icon?: React.ReactNode;
    removable?: boolean;
}

interface AIComposerProps {
    input: string;
    setInput: (v: string) => void;
    onSend: () => void;
    onStop: () => void;
    isLoading: boolean;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    disabled?: boolean;
}

const SLASH_COMMANDS = [
    { cmd: '/explain', desc: 'Explain this code', icon: FileCode },
    { cmd: '/fix', desc: 'Fix errors', icon: Zap },
    { cmd: '/refactor', desc: 'Refactor code', icon: Hash },
    { cmd: '/test', desc: 'Add tests', icon: Sparkles },
    { cmd: '/review', desc: 'Review code', icon: FileCode },
    { cmd: '/optimize', desc: 'Optimize performance', icon: Zap },
];

export const AIComposer: React.FC<AIComposerProps> = ({ input, setInput, onSend, onStop, isLoading, inputRef, disabled }) => {
    const { getFileTree } = useProjectActions();
    const { activeFileMeta } = useProjectUI();
    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [showSlash, setShowSlash] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);
    const [attachedChips, setAttachedChips] = useState<ContextChip[]>([]);
    const mentionAnchorRef = useRef<number | null>(null);

    // Auto chips: current file + selection (not cluttered, max 2 auto)
    const autoChips = useMemo(() => {
        const chips: ContextChip[] = [];
        if (activeFileMeta) {
            chips.push({ id: `file-${activeFileMeta.name}`, label: activeFileMeta.name, icon: <FileCode size={12} />, removable: false });
        }
        const ctx = getActiveEditorContext();
        if (ctx?.selectionText && ctx.selection) {
            chips.push({ id: 'selection', label: `Selection · Lines ${ctx.selection.startLine}–${ctx.selection.endLine}`, icon: <Hash size={12} />, removable: true });
        }
        return chips;
    }, [activeFileMeta]);

    const allChips = useMemo(() => {
        // Merge auto + attached, dedupe
        const map = new Map<string, ContextChip>();
        [...autoChips, ...attachedChips].forEach(c => map.set(c.id, c));
        return Array.from(map.values()).slice(0, 4);
    }, [autoChips, attachedChips]);

    const fileList = useMemo(() => {
        if (!showMentions) return [];
        const tree = getFileTree();
        const files: string[] = [];
        const walk = (nodes: typeof tree, prefix = '') => {
            for (const n of nodes) {
                if (n.id === 'root') { if (n.children) walk(n.children, ''); continue; }
                const path = prefix ? `${prefix}/${n.name}` : n.name;
                if (n.type === 'file') files.push(path);
                if (n.children) walk(n.children, path);
            }
        };
        walk(tree);
        return files;
    }, [getFileTree, showMentions]);

    const filteredFiles = useMemo(() => {
        if (!mentionQuery) return fileList.slice(0, 8);
        const q = mentionQuery.toLowerCase();
        return fileList.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
    }, [fileList, mentionQuery]);

    const filteredSlash = useMemo(() => {
        if (!input.startsWith('/')) return [];
        const q = input.slice(1).toLowerCase();
        if (!q) return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
    }, [input]);

    // Detect @ trigger
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);
        const cursor = e.target.selectionStart;
        const before = val.slice(0, cursor);
        const atMatch = before.match(/@([^\s@]*)$/);
        if (atMatch) {
            setMentionQuery(atMatch[1]);
            setShowMentions(true);
            setMentionIndex(0);
            mentionAnchorRef.current = cursor - atMatch[0].length;
        } else {
            setShowMentions(false);
        }
        // Slash at start
        if (val.startsWith('/') && !val.includes(' ') && !before.includes('\n')) {
            setShowSlash(true);
            setSlashIndex(0);
        } else {
            setShowSlash(false);
        }
        // Auto-resize
        e.target.style.height = '44px';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
    }, [setInput]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (showMentions && filteredFiles.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % filteredFiles.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + filteredFiles.length) % filteredFiles.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (!e.shiftKey) {
                    e.preventDefault();
                    const file = filteredFiles[mentionIndex];
                    if (file && inputRef.current && mentionAnchorRef.current !== null) {
                        const ta = inputRef.current;
                        const cursor = ta.selectionStart;
                        const before = input.slice(0, mentionAnchorRef.current);
                        const after = input.slice(cursor);
                        const next = `${before}@${file} ${after}`;
                        setInput(next);
                        setShowMentions(false);
                        // Add chip
                        setAttachedChips(prev => [...prev, { id: `at-${file}`, label: file, icon: <FileCode size={12} />, removable: true }]);
                        requestAnimationFrame(() => {
                            ta.focus();
                            const pos = before.length + file.length + 2;
                            ta.setSelectionRange(pos, pos);
                        });
                    }
                    return;
                }
            }
            if (e.key === 'Escape') { setShowMentions(false); return; }
        }
        if (showSlash && filteredSlash.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % filteredSlash.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + filteredSlash.length) % filteredSlash.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const cmd = filteredSlash[slashIndex];
                if (cmd) {
                    setInput(cmd.cmd + ' ');
                    setShowSlash(false);
                    inputRef.current?.focus();
                }
                return;
            }
            if (e.key === 'Escape') { setShowSlash(false); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!disabled && input.trim() && !isLoading) onSend();
        }
        if (e.key === 'Escape' && showMentions) { setShowMentions(false); return; }
        if (e.key === 'Escape' && showSlash) { setShowSlash(false); return; }
        if (e.key === 'Escape' && isLoading) { onStop(); }
    }, [showMentions, filteredFiles, mentionIndex, input, inputRef, setInput, showSlash, filteredSlash, slashIndex, disabled, isLoading, onSend, onStop]);

    const removeChip = (id: string) => setAttachedChips(prev => prev.filter(c => c.id !== id));

    return (
        <div className="relative w-full">
            {/* Mentions popup */}
            {showMentions && filteredFiles.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 right-0 mx-0 bg-[#1c1c1f] border border-white/[0.08] rounded-xl shadow-xl shadow-black/30 overflow-hidden z-50 animate-fade-in" style={{ contain: 'layout paint' }}>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar py-1">
                        {filteredFiles.map((file, idx) => (
                            <button
                                key={file}
                                onClick={() => {
                                    if (inputRef.current && mentionAnchorRef.current !== null) {
                                        const ta = inputRef.current;
                                        const cursor = ta.selectionStart;
                                        const before = input.slice(0, mentionAnchorRef.current);
                                        const after = input.slice(cursor);
                                        const next = `${before}@${file} ${after}`;
                                        setInput(next);
                                        setShowMentions(false);
                                        setAttachedChips(prev => [...prev, { id: `at-${file}`, label: file, icon: <FileCode size={12} />, removable: true }]);
                                    }
                                }}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-[13px] transition-colors ${idx === mentionIndex ? 'bg-white/[0.06] text-white' : 'text-white/70 hover:bg-white/[0.04] hover:text-white'}`}
                            >
                                <FileCode size={14} className="text-white/40 shrink-0" />
                                <span className="truncate">{file}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {/* Slash popup */}
            {showSlash && filteredSlash.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-[#1c1c1f] border border-white/[0.08] rounded-xl shadow-xl shadow-black/30 overflow-hidden z-50 animate-fade-in">
                    <div className="py-1">
                        {filteredSlash.map((item, idx) => (
                            <button
                                key={item.cmd}
                                onClick={() => { setInput(item.cmd + ' '); setShowSlash(false); inputRef.current?.focus(); }}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${idx === slashIndex ? 'bg-white/[0.06] text-white' : 'text-white/70 hover:bg-white/[0.04]'}`}
                            >
                                <item.icon size={14} className="text-white/40" />
                                <span className="text-[13px] font-medium">{item.cmd}</span>
                                <span className="text-[12px] text-white/40 truncate">{item.desc}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Composer container */}
            <div className="relative bg-[#1a1a1e] border border-white/[0.07] rounded-[20px] shadow-sm shadow-black/20 overflow-hidden transition-all duration-200 focus-within:border-white/[0.12] focus-within:shadow-md focus-within:shadow-black/20">
                {/* Context chips */}
                {allChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-1">
                        {allChips.map(chip => (
                            <span key={chip.id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-white/[0.06] border border-white/[0.06] text-[11px] text-white/70 leading-none">
                                <span className="text-white/40">{chip.icon}</span>
                                <span className="truncate max-w-[140px]">{chip.label}</span>
                                {chip.detail && <span className="text-white/30">{chip.detail}</span>}
                                {chip.removable && (
                                    <button onClick={() => removeChip(chip.id)} className="ml-1 p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors">
                                        <X size={10} />
                                    </button>
                                )}
                            </span>
                        ))}
                    </div>
                )}

                {/* Textarea */}
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask AI about your code..."
                    rows={1}
                    className="w-full bg-transparent text-white placeholder-white/30 text-[14px] leading-[1.5] px-4 pt-3 pb-2 min-h-[44px] max-h-[160px] resize-none focus:outline-none"
                    style={{ height: '44px' }}
                />

                {/* Bottom bar */}
                <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
                    <div className="flex items-center gap-1">
                        <button
                            title="Attach context"
                            onClick={() => {
                                // Quick attach current file
                                if (activeFileMeta && !attachedChips.find(c => c.id === `file-${activeFileMeta.name}`)) {
                                    setAttachedChips(prev => [...prev, { id: `file-${activeFileMeta.name}`, label: activeFileMeta.name, icon: <FileCode size={12} />, removable: true }]);
                                }
                            }}
                            className="p-1.5 rounded-full hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors"
                        >
                            <Paperclip size={14} />
                        </button>
                        <button
                            onClick={() => {
                                const ta = inputRef.current;
                                if (!ta) return;
                                const start = ta.selectionStart;
                                const before = input.slice(0, start);
                                const after = input.slice(start);
                                setInput(`${before}@${after}`);
                                ta.focus();
                                setShowMentions(true);
                                setMentionQuery('');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full hover:bg-white/[0.06] text-white/40 hover:text-white/70 text-[12px] transition-colors"
                            title="Mention file @"
                        >
                            <AtSign size={12} />
                            <span className="hidden sm:inline text-[11px]">File</span>
                        </button>
                        <span className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/50">
                            <Sparkles size={11} className="text-violet-300/60" /> Agent
                        </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <span className="hidden xl:block text-[11px] text-white/20 whitespace-nowrap">
                            {isLoading ? 'Esc to stop' : 'Enter · Shift+Enter newline'}
                        </span>
                        {isLoading ? (
                            <button
                                onClick={onStop}
                                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-colors"
                                title="Stop (Esc)"
                            >
                                <Square size={12} fill="currentColor" />
                            </button>
                        ) : (
                            <button
                                onClick={onSend}
                                disabled={disabled || !input.trim()}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${input.trim() && !disabled ? 'bg-white text-black hover:bg-white/90 active:scale-95' : 'bg-white/[0.06] text-white/20 cursor-not-allowed'}`}
                                title="Send (Enter)"
                            >
                                <ArrowUp size={14} strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Helper text for narrow */}
            <div className="hidden">
                <span>Fix this, explain, make it faster, @file, /commands</span>
            </div>
        </div>
    );
};
