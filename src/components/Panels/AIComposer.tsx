import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Paperclip, Sparkles, ArrowUp, Square, X, FileCode, Hash, Zap, MessageCircle, Code2, ChevronDown, Upload, FolderSearch } from 'lucide-react';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { getActiveEditorContext, subscribeActiveEditor } from '../../core/editor/activeEditorStore';

interface ContextChip {
    id: string;
    label: string;
    detail?: string;
    icon?: React.ReactNode;
    removable?: boolean;
}

type ComposerMode = 'Agent' | 'Ask' | 'Edit';

interface AIComposerProps {
    input: string;
    setInput: (v: string) => void;
    onSend: () => void;
    onStop: () => void;
    isLoading: boolean;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    disabled?: boolean;
    mode?: ComposerMode;
    onModeChange?: (m: ComposerMode) => void;
}

const SLASH_COMMANDS = [
    { cmd: '/explain', desc: 'Explain this code', icon: FileCode },
    { cmd: '/fix', desc: 'Fix errors', icon: Zap },
    { cmd: '/refactor', desc: 'Refactor code', icon: Hash },
    { cmd: '/test', desc: 'Add tests', icon: Sparkles },
    { cmd: '/review', desc: 'Review code', icon: FileCode },
    { cmd: '/optimize', desc: 'Optimize performance', icon: Zap },
];

const MODE_CONFIG: Record<ComposerMode, { label: string; short: string; desc: string; icon: React.ReactNode; placeholder: string }> = {
    Agent: { label: 'Agent', short: 'Agent', desc: 'Can read & edit files', icon: <Zap size={12} />, placeholder: 'Ask Azemax…' },
    Ask: { label: 'Ask', short: 'Ask', desc: 'Answers only, no edits', icon: <MessageCircle size={12} />, placeholder: 'Ask about your code…' },
    Edit: { label: 'Edit', short: 'Edit', desc: 'Fast inline edits', icon: <Code2 size={12} />, placeholder: 'Describe edit to make…' },
};

export const AIComposer: React.FC<AIComposerProps> = ({ input, setInput, onSend, onStop, isLoading, inputRef, disabled, mode: externalMode, onModeChange }) => {
    const { getFileTree } = useProjectActions();
    const { activeFileMeta } = useProjectUI();
    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionIndex, setMentionIndex] = useState(-1);
    const [showSlash, setShowSlash] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);
    const CHIPS_KEY = 'azemax:composer:chips';
    const [attachedChips, setAttachedChips] = useState<ContextChip[]>(() => {
        try {
            const raw = localStorage.getItem(CHIPS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw) as Array<{ id: string; label: string; detail?: string }>;
            return parsed.map(p => ({
                id: p.id,
                label: p.label,
                detail: p.detail,
                icon: p.id.startsWith('upload-') ? <Upload size={11} /> : <FileCode size={11} />,
                removable: true,
            }));
        } catch { return []; }
    });
    const mentionAnchorRef = useRef<number | null>(null);

    // Composer mode — controlled if parent provides, otherwise internal
    const [internalMode, setInternalMode] = useState<ComposerMode>('Agent');
    const composerMode: ComposerMode = externalMode ?? internalMode;
    const setComposerMode = (m: ComposerMode) => {
        if (onModeChange) onModeChange(m);
        if (!externalMode) setInternalMode(m);
    };
    const [showAgentMenu, setShowAgentMenu] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const DISMISSED_KEY = 'azemax:composer:dismissed';
    const [dismissedAutoFile, setDismissedAutoFile] = useState<string | null>(() => {
        try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; }
    });
    const agentBtnRef = useRef<HTMLDivElement>(null);
    const attachBtnRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // drag over state for prompt visual
    const [isDragOver, setIsDragOver] = useState(false);

    // Live editor context subscription — ensures Explorer/Editor/Chat agree even when switches are fast
    const [liveCtxTick, setLiveCtxTick] = useState(0);
    useEffect(() => {
        const unsub = subscribeActiveEditor(() => setLiveCtxTick(t => t + 1));
        const iv = window.setInterval(() => setLiveCtxTick(t => t + 1), 700);
        return () => { unsub(); clearInterval(iv); };
    }, []);

    // Persist attached chips across refresh
    useEffect(() => {
        try {
            if (attachedChips.length === 0) localStorage.removeItem(CHIPS_KEY);
            else {
                const serializable = attachedChips.map(c => ({ id: c.id, label: c.label, detail: c.detail }));
                localStorage.setItem(CHIPS_KEY, JSON.stringify(serializable));
            }
        } catch { /* ignore */ }
    }, [attachedChips]);

    // Rehydrate chips from draft text if chips storage was cleared but draft still has @ tokens (e.g. after code update)
    useEffect(() => {
        if (!input || attachedChips.length > 0) return;
        const tokens = [...input.matchAll(/@([^\s@,;]+)/g)].map(m => m[1].trim()).filter(Boolean).slice(0, 3);
        if (tokens.length === 0) return;
        const toAdd: ContextChip[] = tokens
            .filter(t => !attachedChips.some(c => c.label === t))
            .map(t => ({ id: `at-${t}`, label: t, icon: <FileCode size={11} />, removable: true }));
        if (toAdd.length) setAttachedChips(prev => [...prev, ...toAdd]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Restore textarea height after draft restore
    useEffect(() => {
        if (input && inputRef.current) {
            const ta = inputRef.current;
            ta.style.height = '40px';
            ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
        }
    }, []);

    // Clear chips when AIAssistant finishes a send (via event from parent)
    useEffect(() => {
        const onClear = () => {
            setAttachedChips([]);
            try { localStorage.removeItem(CHIPS_KEY); } catch { /* ignore */ }
        };
        window.addEventListener('azemax:clear-chips', onClear as EventListener);
        return () => window.removeEventListener('azemax:clear-chips', onClear as EventListener);
    }, []);

    // Close popovers on outside click
    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (showAgentMenu && agentBtnRef.current && !agentBtnRef.current.contains(t)) setShowAgentMenu(false);
            if (showAttachMenu && attachBtnRef.current && !attachBtnRef.current.contains(t)) setShowAttachMenu(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [showAgentMenu, showAttachMenu]);

    // Persist dismissed state so refresh doesn't resurrect a file chip the user closed
    useEffect(() => {
        try {
            if (dismissedAutoFile) localStorage.setItem(DISMISSED_KEY, dismissedAutoFile);
            else localStorage.removeItem(DISMISSED_KEY);
        } catch { /* ignore */ }
    }, [dismissedAutoFile]);

    // Reset dismissed when file actually changes (not on every refresh)
    const currentFileId = getActiveEditorContext()?.fileId ?? activeFileMeta?.name ?? null;
    const prevFileIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (prevFileIdRef.current === null) {
            prevFileIdRef.current = currentFileId;
            return;
        }
        if (prevFileIdRef.current !== currentFileId) {
            prevFileIdRef.current = currentFileId;
            setDismissedAutoFile(null);
            try { localStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
        }
    }, [currentFileId]);

    // Auto chips: only selection creates a pill — typing must NOT auto-select current file (Factorial.java)
    // Previous logic showed file pill when hasDraft, causing "ddddsdf" -> Factorial.java bug
    const autoChips = useMemo(() => {
        void liveCtxTick;
        const chips: ContextChip[] = [];
        const ctx = getActiveEditorContext();
        const hasSelection = !!(ctx?.selectionText && ctx.selection);
        if (hasSelection && ctx!.selection) {
            chips.push({ id: 'selection', label: `Selection · Lines ${ctx!.selection!.startLine}–${ctx!.selection!.endLine}`, icon: <Hash size={11} />, removable: true });
        }
        return chips;
    }, [liveCtxTick]);

    const allChips = useMemo(() => {
        // Dedupe by label (filename) so auto file + explicitly attached same file don't show twice after refresh
        const attachedLabels = new Set(attachedChips.map(c => c.label));
        const filteredAuto = autoChips.filter(c => !attachedLabels.has(c.label));
        const map = new Map<string, ContextChip>();
        [...filteredAuto, ...attachedChips].forEach(c => map.set(c.id, c));
        return Array.from(map.values()).slice(0, 4);
    }, [autoChips, attachedChips]);

    const fileList = useMemo(() => {
        const needsList = showMentions || showAttachMenu;
        if (!needsList) return [];
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
    }, [getFileTree, showMentions, showAttachMenu]);

    const filteredFiles = useMemo(() => {
        // Exclude files already visible as pills (attached + auto) so @ doesn't re-offer Factorial.java that's already a chip
        const visibleSet = new Set<string>();
        for (const c of attachedChips) visibleSet.add(c.label);
        // auto chips are derived from current file/selection — include them even though not in attachedChips
        for (const c of autoChips) visibleSet.add(c.label);
        // also exclude by basename to catch "Folder/Factorial.java" vs "Factorial.java" label mismatch
        const visibleBasenames = new Set<string>(Array.from(visibleSet).map(s => s.split('/').pop()!.toLowerCase()));
        const allFiltered = !mentionQuery
            ? fileList.slice(0, 8)
            : fileList.filter(f => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8);
        return allFiltered.filter(f => {
            if (visibleSet.has(f)) return false;
            if (visibleBasenames.has(f.split('/').pop()!.toLowerCase())) return false;
            return true;
        });
    }, [fileList, mentionQuery, attachedChips, autoChips]);

    const filteredSlash = useMemo(() => {
        if (!input.startsWith('/')) return [];
        const q = input.slice(1).toLowerCase();
        if (!q) return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
    }, [input]);

    // Helpers — chip is source of truth, @ text is removed after selection to avoid duplicate "@Hello.java" + pill
    // Full context: allow multiple at-file pills (up to 4), deduped — AI now sees full workspace dynamically
    const insertMention = useCallback((file: string) => {
        const ta = inputRef.current;
        setAttachedChips(prev => {
            if (prev.some(c => c.label === file)) return prev;
            const next = [...prev, { id: `at-${file}`, label: file, icon: <FileCode size={11} />, removable: true }];
            return next.slice(0, 4);
        });
        setShowMentions(false);
        // Remove the "@query" trigger text, keep only surrounding prompt — no duplicate "@file " left in input
        if (ta && mentionAnchorRef.current !== null) {
            const cursor = ta.selectionStart;
            const before = input.slice(0, mentionAnchorRef.current);
            const after = input.slice(cursor);
            const next = `${before}${after}`.replace(/\s{2,}/g, ' ');
            // Preserve leading space handling — trim only if we removed everything
            const cleaned = next.startsWith(' ') && before === '' ? next.trimStart() : next;
            setInput(cleaned);
            requestAnimationFrame(() => {
                ta.focus();
                const pos = before.length;
                ta.setSelectionRange(pos, pos);
                ta.style.height = '40px';
                ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
            });
        } else if (ta) {
            // fallback: strip any "@<partial>" at cursor
            const cursor = ta.selectionStart;
            const before = input.slice(0, cursor).replace(/@([^\s@]*)$/, '');
            const after = input.slice(cursor);
            setInput(`${before}${after}`.replace(/\s{2,}/g, ' '));
        }
        mentionAnchorRef.current = null;
    }, [input, setInput]);

    const attachFileAsChipAndMention = useCallback((filePath: string) => {
        setAttachedChips(prev => {
            if (prev.some(c => c.label === filePath)) return prev;
            const next = [...prev, { id: `at-${filePath}`, label: filePath, icon: <FileCode size={11} />, removable: true }];
            return next.slice(0, 4);
        });
        setShowAttachMenu(false);
        inputRef.current?.focus();
    }, []);

    const handleLocalUpload = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = () => {
            const content = typeof reader.result === 'string' ? reader.result : '';
            const id = `upload-${file.name}-${Date.now()}`;
            setAttachedChips(prev => {
                const next = [...prev, { id, label: file.name, detail: `${(file.size / 1024).toFixed(1)} KB · local`, icon: <Upload size={11} />, removable: true }];
                return next.slice(0, 4);
            });
            void content;
        };
        reader.readAsText(file);
        // reset input so same file can be re-chosen
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [setInput]);

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
            setMentionIndex(-1);
            mentionAnchorRef.current = cursor - atMatch[0].length;
        } else {
            setShowMentions(false);
        }
        if (val.startsWith('/') && !val.includes(' ') && !before.includes('\n')) {
            setShowSlash(true);
            setSlashIndex(0);
        } else {
            setShowSlash(false);
        }
        e.target.style.height = '40px';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
    }, [setInput]);

    const handleSendWrapper = useCallback(() => {
        if (disabled || !input.trim() || isLoading) return;
        onSend();
        // Composer draft was sent — clear attached chips (input is cleared by parent)
        setAttachedChips([]);
        try { localStorage.removeItem(CHIPS_KEY); } catch { /* ignore */ }
    }, [disabled, input, isLoading, onSend]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (showMentions && filteredFiles.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex(i => (i === -1 ? 0 : (i + 1) % filteredFiles.length));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(i => (i === -1 ? filteredFiles.length - 1 : (i - 1 + filteredFiles.length) % filteredFiles.length));
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (!e.shiftKey) {
                    // Only auto-insert when user has actually highlighted a file — typing "@" alone + Enter sends message
                    if (mentionIndex >= 0) {
                        e.preventDefault();
                        const file = filteredFiles[mentionIndex];
                        if (file) insertMention(file);
                        return;
                    }
                    // No selection — keep dropdown open, let Enter fall through to send (with Tab, do nothing)
                    if (e.key === 'Tab' && mentionIndex === -1) {
                        // Allow Tab to focus next without inserting
                        setShowMentions(false);
                        return;
                    }
                    // For Enter with no selection, close mention and let it be handled as send below
                    setShowMentions(false);
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
            handleSendWrapper();
        }
        if (e.key === 'Escape' && showMentions) { setShowMentions(false); return; }
        if (e.key === 'Escape' && showSlash) { setShowSlash(false); return; }
        if (e.key === 'Escape' && showAgentMenu) { setShowAgentMenu(false); return; }
        if (e.key === 'Escape' && showAttachMenu) { setShowAttachMenu(false); return; }
        if (e.key === 'Escape' && isLoading) { onStop(); }
    }, [showMentions, filteredFiles, mentionIndex, insertMention, showSlash, filteredSlash, slashIndex, input, inputRef, setInput, handleSendWrapper, onStop, showAgentMenu, showAttachMenu]);

    const removeChip = (id: string) => {
        // Remove chip and its @ token from input if it was an attached file
        const chip = [...autoChips, ...attachedChips].find(c => c.id === id);
        if (id === 'selection') {
            // selection chip is contextual — just hide visually by not showing? keep removable by no-op (selection still exists)
            // We simply do not re-add it by setting a flag? For now hide until next tick change - treat as dismissed one cycle
            // Instead just remove from displayed: autoChips will reappear next tick; we hide selection by ignoring key?
            // Simplest: show a temporary dismissal — but selection is live, so we hide it by adding to dismissed? Keep simple: do nothing, user can ignore.
            // To make X work, we store dismissed selection tick
            setDismissedAutoFile('__selection_dismissed__');
            setTimeout(()=> setDismissedAutoFile(null), 800);
            return;
        }
        if (id.startsWith('auto-file-')) {
            const ctx = getActiveEditorContext();
            setDismissedAutoFile(ctx?.fileId ?? chip?.label ?? id.replace('auto-file-',''));
            return;
        }
        setAttachedChips(prev => prev.filter(c => c.id !== id));
        // Strip @file token
        if (chip) {
            const tokenEsc = chip.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`@${tokenEsc}\\s?`, 'g');
            setInput(input.replace(re, '').replace(/\s{2,}/g, ' ').trimStart());
        }
    };

    const currentModeCfg = MODE_CONFIG[composerMode];

    return (
        <div className="relative w-full">
            {/* Mentions popup */}
            {showMentions && filteredFiles.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 right-0 mx-0 rounded-lg overflow-hidden z-50 animate-fade-in max-w-full" style={{ background: "var(--az-overlay)", border: "1px solid var(--az-border)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)", contain: 'layout paint' } as React.CSSProperties}>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar py-1">
                        {filteredFiles.map((file, idx) => (
                            <button
                                key={file}
                                onClick={() => insertMention(file)}
                                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12.5px] transition-colors ${idx === mentionIndex ? 'bg-[var(--az-surface-3)] text-[var(--az-text)]' : 'text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text)]'}`}
                            >
                                <FileCode size={14} className="shrink-0" style={{ color: "var(--az-text-muted)"}} />
                                <span className="truncate">{file}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {/* Slash popup */}
            {showSlash && filteredSlash.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 right-0 rounded-lg overflow-hidden z-50 animate-fade-in" style={{ background: "var(--az-overlay)", border: "1px solid var(--az-border)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)"}}>
                    <div className="py-1">
                        {filteredSlash.map((item, idx) => (
                            <button
                                key={item.cmd}
                                onClick={() => { setInput(item.cmd + ' '); setShowSlash(false); inputRef.current?.focus(); }}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${idx === slashIndex ? 'bg-[var(--az-surface-3)] text-[var(--az-text)]' : 'text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-hover)]'}`}
                            >
                                <item.icon size={14} style={{ color: "var(--az-text-muted)"}} />
                                <span className="text-[13px] font-medium">{item.cmd}</span>
                                <span className="text-[12px] truncate" style={{ color: 'var(--az-text-muted)'}}>{item.desc}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Attach menu */}
            {showAttachMenu && (
                <div className="absolute bottom-full mb-2 left-0 w-[288px] max-w-[min(288px,calc(100vw-32px))] rounded-[10px] overflow-hidden z-50 animate-fade-in" style={{ background: "var(--az-overlay)", border: "1px solid var(--az-border)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)"}}>
                    <div className="py-1.5">
                        <button
                            onClick={() => {
                                const ctx = getActiveEditorContext();
                                const name = ctx?.fileName ?? activeFileMeta?.name;
                                const path = ctx?.filePath ?? name;
                                if (name && path) attachFileAsChipAndMention(path);
                                else setShowAttachMenu(false);
                            }}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--az-surface-hover)] transition-colors"
                        >
                            <span className="w-6 h-6 rounded-[6px] bg-white/[0.06] border border-white/[0.06] flex items-center justify-center shrink-0"><FileCode size={12} /></span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-[12.5px] font-medium leading-none" style={{ color: 'var(--az-text)'}}>{(getActiveEditorContext()?.fileName ?? activeFileMeta?.name) ? `Attach ${(getActiveEditorContext()?.fileName ?? activeFileMeta?.name)}` : 'No active file'}</span>
                                <span className="block text-[11px] leading-none mt-1 truncate" style={{ color: 'var(--az-text-muted)'}}>Add current file as context</span>
                            </span>
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--az-surface-hover)] transition-colors"
                        >
                            <span className="w-6 h-6 rounded-[6px] bg-white/[0.06] border border-white/[0.06] flex items-center justify-center shrink-0"><Upload size={12} /></span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-[12.5px] font-medium leading-none" style={{ color: 'var(--az-text)'}}>Upload file</span>
                                <span className="block text-[11px] leading-none mt-1" style={{ color: 'var(--az-text-muted)'}}>Attach local file as reference</span>
                            </span>
                        </button>
                        {fileList.length > 0 && (
                            <>
                                <div className="h-px my-1 mx-2" style={{ background: 'rgba(255,255,255,0.06)' }} />
                                <div className="px-3 pt-1 pb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-widest" style={{ color: 'var(--az-text-faint)'}}><FolderSearch size={10} /> Workspace files</div>
                                <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                    {fileList.slice(0,6).map(fp => (
                                        <button key={fp} onClick={() => attachFileAsChipAndMention(fp)} className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12.5px] text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text)] transition-colors">
                                            <FileCode size={13} style={{ color: 'var(--az-text-muted)'}} className="shrink-0" />
                                            <span className="truncate">{fp}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Agent mode menu */}
            {showAgentMenu && (
                <div className="absolute bottom-full mb-2 left-[88px] w-[232px] rounded-[10px] overflow-hidden z-50 animate-fade-in" style={{ background: "var(--az-overlay)", border: "1px solid var(--az-border)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)"}}>
                    <div className="py-1">
                        {(Object.keys(MODE_CONFIG) as ComposerMode[]).map(m => {
                            const cfg = MODE_CONFIG[m];
                            const active = m === composerMode;
                            return (
                                <button
                                    key={m}
                                    onClick={() => { setComposerMode(m); setShowAgentMenu(false); inputRef.current?.focus(); }}
                                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${active ? 'bg-[var(--az-surface-3)] text-[var(--az-text)]' : 'text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text)]'}`}
                                >
                                    <span className={`w-6 h-6 rounded-[6px] flex items-center justify-center shrink-0 border ${active ? 'bg-white text-black border-white' : 'bg-white/[0.06] border-white/[0.06]'}`}>{cfg.icon}</span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[12.5px] font-medium leading-none">{cfg.label}</span>
                                        <span className="block text-[11px] leading-none mt-1" style={{ color: active ? 'var(--az-text-secondary)' : 'var(--az-text-muted)'}}>{cfg.desc}</span>
                                    </span>
                                    {active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Composer container */}
            <div
                className={`az-composer relative overflow-hidden transition-colors ${isDragOver ? '!border-white/20 !bg-[#1E232E]' : ''}`}
                onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => {
                    e.preventDefault(); setIsDragOver(false);
                    const files = e.dataTransfer.files;
                    if (files && files.length) handleLocalUpload(files);
                }}
            >
                {isDragOver && (
                    <div className="absolute inset-0 z-10 rounded-[10px] flex items-center justify-center pointer-events-none" style={{ background: 'rgba(91,140,255,0.06)', border: '1px dashed rgba(91,140,255,0.35)'}}>
                        <span className="text-[12px] font-medium" style={{ color: 'var(--az-text)'}}>Drop file to attach</span>
                    </div>
                )}
                {/* Hidden file input for upload */}
                <input ref={fileInputRef} type="file" className="hidden" onChange={e => handleLocalUpload(e.target.files)} />

                {/* Context chips */}
                {allChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-0.5">
                        {allChips.map(chip => (
                            <span key={chip.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-[3px] rounded-full text-[11px] leading-none" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--az-text-secondary)"}}>
                                <span className="shrink-0" style={{ color: "var(--az-text-muted)"}}>{chip.icon}</span>
                                <span className="truncate max-w-[160px] tracking-tight" style={{ color: "var(--az-text-secondary)"}}>{chip.label}</span>
                                {chip.detail && <span className="text-white/25 truncate max-w-[110px] hidden sm:inline">· {chip.detail}</span>}
                                {chip.removable && (
                                    <button onClick={() => removeChip(chip.id)} aria-label={`Remove ${chip.label}`} className="ml-0.5 p-0.5 rounded-full transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 hover:bg-white/10" style={{ color: "var(--az-text-muted)"}}>
                                        <X size={10} strokeWidth={2} />
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
                    placeholder={currentModeCfg.placeholder}
                    rows={1}
                    className="w-full bg-transparent text-[13.5px] leading-[1.5] px-3 pt-2.5 pb-1.5 min-h-[40px] max-h-[140px] resize-none focus:outline-none focus-visible:outline-none antialiased placeholder:text-[#677283]"
                    style={{ color: "#DCE3EC", height: '40px', outline: 'none', boxShadow: 'none', border: 'none' } as React.CSSProperties}
                    spellCheck={false}
                    autoComplete="off"
                />

                {/* Bottom bar */}
                <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-0.5">
                    <div className="flex items-center gap-0.5">
                        <div ref={attachBtnRef} className="relative">
                            <button
                                title="Attach context"
                                aria-label="Attach context"
                                aria-expanded={showAttachMenu}
                                aria-haspopup="menu"
                                onClick={() => setShowAttachMenu(v => !v)}
                                className={`w-[26px] h-[26px] inline-flex items-center justify-center rounded-[6px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${showAttachMenu ? '!bg-white/[0.08] !text-[var(--az-text)]' : ''}`}
                                style={{ color: showAttachMenu ? "var(--az-text)" as string : "var(--az-text-muted)" as string, background: showAttachMenu ? "rgba(255,255,255,0.08)" : "transparent"}}
                                onMouseEnter={e=>{ if(!showAttachMenu){e.currentTarget.style.background="rgba(255,255,255,0.06)"; e.currentTarget.style.color="var(--az-text)"}}}
                                onMouseLeave={e=>{ if(!showAttachMenu){e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--az-text-muted)"}}}
                            >
                                <Paperclip size={13} strokeWidth={1.75} />
                            </button>
                        </div>
                        <div ref={agentBtnRef} className="relative">
                            <button
                                onClick={() => setShowAgentMenu(v => !v)}
                                aria-expanded={showAgentMenu}
                                aria-haspopup="menu"
                                title={`Mode: ${composerMode} — ${currentModeCfg.desc}`}
                                aria-label="Select agent mode"
                                className={`hidden sm:inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-[6px] text-[11px] font-medium leading-none select-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${showAgentMenu ? '!bg-white/[0.08] !text-[var(--az-text)]' : ''}`}
                                style={{ background: showAgentMenu ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", color: showAgentMenu ? "var(--az-text)" as string : "var(--az-text-secondary)" as string}}
                            >
                                <span className="opacity-60">{currentModeCfg.icon}</span>
                                {composerMode}
                                <ChevronDown size={10} strokeWidth={2} className={`transition-transform ${showAgentMenu ? 'rotate-180' : ''}`} style={{ opacity: 0.5 }} />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {isLoading ? (
                            <button
                                onClick={onStop}
                                className="az-send-btn focus:outline-none" style={{ background: "rgba(255,255,255,0.06)", color: "var(--az-text)", border: "1px solid rgba(255,255,255,0.07)"}}
                                title="Stop (Esc)"
                                aria-label="Stop generation"
                            >
                                <Square size={11} fill="currentColor" className="shrink-0" />
                            </button>
                        ) : (
                            <button
                                onClick={handleSendWrapper}
                                disabled={disabled || !input.trim()}
                                className={`az-send-btn focus:outline-none ${input.trim() && !disabled ? '' : 'cursor-not-allowed'}`}
                                style={input.trim() && !disabled
                                    ? { background: 'var(--az-accent)', color: '#FFFFFF', border: '1px solid var(--az-accent)', boxShadow: '0 1px 4px rgba(0,0,0,0.12)'}
                                    : { background: 'rgba(255,255,255,0.06)', color: 'var(--az-text-disabled)', border: '1px solid rgba(255,255,255,0.05)'}}
                                title="Send (Enter)"
                                aria-label="Send message"
                            >
                                <ArrowUp size={14} strokeWidth={2.5} className="shrink-0" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* collapsed agent mode on mobile — second row if needed */}
            <div className="sm:hidden mt-1.5 flex items-center gap-1.5">
                <button onClick={() => setShowAgentMenu(v=>!v)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text-muted)'}}>
                    {currentModeCfg.icon} {composerMode} <ChevronDown size={10} className={showAgentMenu?'rotate-180':''} />
                </button>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.22)'}}>· {currentModeCfg.desc}</span>
            </div>
        </div>
    );
};
