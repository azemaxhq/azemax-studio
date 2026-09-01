import React, { useState, useRef, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import {
    Check, Edit3, RefreshCw, Zap, Bug, MessageCircle, Code2, Copy,
    Plus, MessageSquare, Trash2, X, History, ChevronUp,
    ThumbsUp, ThumbsDown, FileCode, Lightbulb, ChevronDown, ChevronRight, Eye
} from 'lucide-react';

import { loadPrism, tryHighlight } from '../../utils/prismLoader';
import { MarkdownRenderer } from './MarkdownRenderer';
import { getActiveEditorContext } from '../../core/editor/activeEditorStore';
import { buildWorkspaceSnapshot } from '../../core/workspace/workspaceContext';
import { useAILoading } from '../../hooks/useAILoading';
import { AILoadingIndicator } from '../AI/AILoadingIndicator';
import { SmoothStreamingBubble } from '../AI/SmoothStreamingBubble';
import { AIComposer } from './AIComposer';
import '../AI/ai-loading.css';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useDialog } from '../UI/DialogProvider';
import {
    saveSessions,
    loadSessions,
    createSession,
    saveCurrentSessionId,
    loadCurrentSessionId,
    type ChatSession,
    type Message
} from '../../utils/chatStorage';
import { streamChat } from '../../core/ai/AIClient';
import { cleanResponse } from '../../core/ai/AIResponseParser';
import type { ChatMessage } from '../../core/ai/types';
import { parseArtifacts } from './ai/artifactParser';
import { AI_ERROR_CODES } from '../../core/ai/AIError';
import { AIRequestStore } from '../../core/ai/aiRequestStore';
import type { AgentActivity } from '../../core/ai/agentController';

import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BRAND } from '../../core/branding';

// Quick action prompts for empty state
// Quick action prompts for empty state
const QUICK_ACTIONS = [
    { icon: Code2, label: 'Explain Code', prompt: 'Explain the selected code in detail', description: 'Understand logic & flow' },
    { icon: Bug, label: 'Find Bugs', prompt: 'Analyze this code for bugs and potential issues', description: 'Detect errors early' },
    { icon: Zap, label: 'Optimize', prompt: 'Suggest performance optimizations for this code', description: 'Improve efficiency' },
    { icon: MessageCircle, label: 'Add Comments', prompt: 'Add comprehensive comments to this code', description: 'Improve readability' },
];

// Inline markdown (bold, italic, code, links)

// Artifact Block Component - Claude-like artifact rendering
interface ArtifactProps {
    title: string;
    type: 'code' | 'example' | 'explanation' | 'diagram' | string;
    language?: string;
    content: string;
    onCopy?: (text: string, id: string) => void;
    copiedId?: string | null;
    id?: string;
}

const ArtifactBlock: React.FC<ArtifactProps> = ({ title, type, language, content, onCopy, copiedId, id = '' }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const isCode = type === 'code' && !!language;
    const lineCount = content.split('\n').length;
    const displayContent = isCode && lineCount > 12 && !isExpanded ? content.split('\n').slice(0, 12).join('\n') : content;
    const highlightedCode = isCode && language ? tryHighlight(displayContent, language) : null;

    const getIcon = () => {
        switch (type) {
            case 'code': return <FileCode size={14} className="text-[var(--az-text-muted)]" />;
            case 'example': return <Lightbulb size={14} className="text-[var(--az-text-muted)]" />;
            case 'explanation': return <MessageCircle size={14} className="text-[var(--az-text-muted)]" />;
            default: return <Code2 size={14} className="text-[var(--az-text-muted)]" />;
        }
    };

    // Premium artifact / document card — Azemax workspace resource
    const preview = content.slice(0, 120).replace(/\s+/g, ' ').trim();
    return (
        <div className="my-3 rounded-[10px] border border-white/[0.06] bg-[#151A24] overflow-hidden shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] hover:border-white/[0.08] transition-colors">
            <div
                className="flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] cursor-pointer transition-colors gap-3"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="w-7 h-7 rounded-[7px] bg-[rgba(59,130,246,0.07)] border border-[rgba(59,130,246,0.12)] flex items-center justify-center shrink-0">
                        {getIcon()}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[12.5px] font-medium tracking-tight leading-none truncate" style={{ color: 'var(--az-text)' }}>{title}</span>
                            <span className="hidden sm:inline text-[11px] font-mono tracking-tight shrink-0" style={{ color: 'var(--az-text-faint)' }}>· {isCode ? `${lineCount} lines` : type}</span>
                        </div>
                        <div className="text-[11px] leading-[1.4] truncate mt-0.5" style={{ color: 'var(--az-text-muted)' }}>
                            {isCode && language ? `${language} · ${preview.slice(0, 48)}` : preview}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); onCopy?.(content, id); }}
                        className="px-2 py-1 rounded-[6px] text-[11px] font-medium text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                    >
                        {copiedId === id ? 'Copied' : 'Copy'}
                    </button>
                    <span className={`w-6 h-6 rounded-[6px] bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[var(--az-text-muted)] transition-colors ${isExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDown size={13} strokeWidth={1.75} />
                    </span>
                </div>
            </div>
            {isExpanded && (
                <div className="border-t border-white/[0.06] bg-[#0F1115]">
                    <pre className="p-3.5 text-[12.5px] font-mono overflow-x-auto ai-chat-scroll text-[var(--az-text-secondary)] leading-[1.65] max-h-[320px] overflow-y-auto">
                        {highlightedCode
                            ? <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                            : <code>{content}</code>}
                    </pre>
                </div>
            )}
            {!isExpanded && isCode && lineCount > 12 && (
                <div className="px-3 pb-2 pt-0.5">
                    <button onClick={() => setIsExpanded(true)} className="text-[11px] font-medium tracking-tight text-[var(--az-text-faint)] hover:text-[var(--az-text-muted)] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/10 rounded px-1 -ml-1">Show {lineCount - 12} more lines</button>
                </div>
            )}
        </div>
    );
};

// parseArtifacts moved to ./ai/artifactParser for single responsibility


// Memoized Message Item to prevent re-renders
const MessageItem = React.memo(({
    msg,
    index,
    isEditing,
    editText,
    setEditText,
    onSaveEdit,
    onCancelEdit,
    onEditStart,
    onCopy,
    onRegenerate,
    onApplyCode,
    copiedId,
    reaction,
    onReaction,
    prismReady,
    isStreaming
}: {
    msg: Message | { text: string; role: 'ai' | 'user'; id: string; timestamp: number };
    index: number | string;
    isEditing: boolean;
    editText: string;
    setEditText: (text: string) => void;
    onSaveEdit: (id: string) => void;
    onCancelEdit: () => void;
    onEditStart: (msg: Message) => void;
    onCopy: (text: string, id: string) => void;
    onRegenerate?: (index: number) => void;
    onApplyCode?: (code: string) => void;
    copiedId: string | null;
    reaction?: 'up' | 'down' | null;
    onReaction?: (msgId: string, type: 'up' | 'down') => void;
    prismReady: boolean;
    isStreaming?: boolean;
}) => {
    // Enhanced markdown renderer using react-markdown
    const components = {
        code({ inline, className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : 'text';
            const code = String(children).replace(/\n$/, '');
            const codeId = `${msg.id}-${index}-${language}-${code.slice(0, 10)}`;
            const isLongBlock = !inline && !!match && code.split('\n').length > 24;
            const [expanded, setExpanded] = React.useState(!isLongBlock);
            const [applyState, setApplyState] = React.useState<'idle'|'applying'|'applied'|'failed'>('idle');
            if (!inline && match) {
                // Syntax Highlighting — skip during streaming (heavy, causes jank)
                const highlightedCode = prismReady && !isStreaming ? tryHighlight(code, language) : null;
                const displayCode = !expanded ? code.split('\n').slice(0, 20).join('\n') : code;

                return (
                    <div className="my-3 rounded-[10px] overflow-hidden border border-white/[0.06] bg-[var(--az-surface-2)]">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-[#15181E] border-b border-white/[0.06]">
                            <span className="text-[11px] text-[var(--az-text-muted)] font-mono tracking-tight">{language}</span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => onCopy(displayCode, codeId)}
                                    className="px-2 py-1 rounded-[6px] text-[11px] font-medium text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                >
                                    {copiedId === codeId ? 'Copied' : 'Copy'}
                                </button>
                                {msg.role === 'ai' && onApplyCode && (
                                    <button
                                        onClick={async () => {
                                            if (applyState === 'applying') return;
                                            setApplyState('applying');
                                            try {
                                                // onApplyCode may return success boolean; treat undefined as success if no exception
                                                const res: any = await onApplyCode(code);
                                                const ok = res === false ? false : true;
                                                setApplyState(ok ? 'applied' : 'failed');
                                                if (ok) setTimeout(() => setApplyState('idle'), 2500);
                                                else setTimeout(() => setApplyState('idle'), 3000);
                                            } catch {
                                                setApplyState('failed');
                                                setTimeout(() => setApplyState('idle'), 3000);
                                            }
                                        }}
                                        disabled={applyState === 'applying'}
                                        className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${applyState === 'applied' ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300' : applyState === 'failed' ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-[var(--az-accent)] text-white hover:bg-[var(--az-accent-hover)] border-[var(--az-accent)]'} ${applyState === 'applying' ? 'opacity-70 cursor-wait' : ''}`}
                                        title={applyState === 'failed' ? 'Apply failed — retry' : applyState === 'applied' ? 'Applied' : 'Apply to editor'}
                                    >
                                        {applyState === 'idle' && 'Apply'}
                                        {applyState === 'applying' && 'Applying…'}
                                        {applyState === 'applied' && 'Applied ✓'}
                                        {applyState === 'failed' && 'Failed — Retry'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="relative">
                            <pre className="p-3.5 text-[12.5px] font-mono overflow-x-auto ai-chat-scroll text-[var(--az-text-secondary)] leading-[1.65] bg-[#0F1115] max-h-[360px] overflow-y-auto">
                                {highlightedCode && expanded
                                    ? <code dangerouslySetInnerHTML={{ __html: isLongBlock && !expanded ? tryHighlight(displayCode, language) || '' : highlightedCode }} />
                                    : <code>{displayCode}</code>}
                            </pre>
                            {isLongBlock && !expanded && (
                                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#0F1115] to-transparent pointer-events-none" />
                            )}
                        </div>
                        {isLongBlock && (
                            <button onClick={() => setExpanded(!expanded)} className="w-full px-3 py-2 text-[11px] font-medium text-[var(--az-text-faint)] hover:text-[var(--az-text-muted)] hover:bg-white/[0.02] border-t border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/10">
                                {expanded ? 'Show less' : `Show ${code.split('\n').length - 20} more lines`}
                            </button>
                        )}
                    </div>
                );
            }
            // Inline code — neutral, editor-native
            return (
                <code
                    className="text-[13.5px] font-mono bg-[var(--az-surface-3)] text-[var(--az-text)] border border-white/[0.06] px-1 py-0.5 rounded-[5px]"
                    {...props}
                >
                    {children}
                </code>
            );
        },
        h1({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h1 className="text-[20px] font-semibold tracking-tight text-[var(--az-text)] mt-6 mb-3 leading-tight" {...props}>{children}</h1>;
        },
        h2({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h2 className="text-[17px] font-semibold tracking-tight text-[var(--az-text)] mt-6 mb-2.5 leading-tight" {...props}>{children}</h2>;
        },
        h3({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h3 className="text-[14.5px] font-semibold tracking-tight text-[var(--az-text)] mt-5 mb-2 leading-snug" {...props}>{children}</h3>;
        },
        p({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
            if (msg.role === 'user') {
                return <p className="leading-[1.5] text-[13px] tracking-tight text-[var(--az-text)] last:mb-0" {...props}>{children}</p>;
            }
            return <p className="leading-[1.70] mb-3.5 text-[14.5px] text-[var(--az-text-secondary)] tracking-[-0.01em] last:mb-0 max-w-[640px]" {...props}>{children}</p>;
        },
        ul({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
            if (msg.role === 'user') {
                return <ul className="list-disc list-outside ml-4 space-y-1 text-[13px] text-[var(--az-text)] leading-[1.5]" {...props}>{children}</ul>;
            }
            return <ul className="list-disc list-outside ml-5 mb-3.5 space-y-1.5 text-[14.5px] text-[var(--az-text-secondary)] leading-[1.65]" {...props}>{children}</ul>;
        },
        ol({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) {
            if (msg.role === 'user') {
                return <ol className="list-decimal list-outside ml-4 space-y-1 text-[13px] text-[var(--az-text)] leading-[1.5]" {...props}>{children}</ol>;
            }
            return <ol className="list-decimal list-outside ml-5 mb-3.5 space-y-1.5 text-[14.5px] text-[var(--az-text-secondary)] leading-[1.65]" {...props}>{children}</ol>;
        },
        li({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) {
            return <li className={`pl-1 ${msg.role === 'user' ? 'leading-[1.5] marker:text-white/15' : 'leading-[1.65] marker:text-white/20'}`} {...props}>{children}</li>;
        },
        blockquote({ children, ...props }: React.QuoteHTMLAttributes<HTMLQuoteElement>) {
            return (
                <blockquote className="border-l-2 border-white/[0.07] pl-4 py-1 my-4 text-[13.5px] text-[var(--az-text-muted)] leading-relaxed max-w-[640px]" {...props}>
                    {children}
                </blockquote>
            );
        },
        strong({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
            return <strong className="font-semibold text-[var(--az-text)]" {...props}>{children}</strong>;
        },
        em({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
            return <em className="italic text-[var(--az-text)]" {...props}>{children}</em>;
        },
        hr({ ...props }: React.HTMLAttributes<HTMLHRElement>) {
            return <hr className="my-6 border-[var(--az-border)]" {...props} />;
        },
        // Links
        a({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
            return (
                <a target="_blank" rel="noopener noreferrer" className="text-[var(--az-accent)] hover:opacity-80 hover:underline transition-colors" {...props}>
                    {children ?? ''}
                </a>
            );
        },
        // Tables
        table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
            return (
                <div className="overflow-x-auto my-6 border border-[var(--az-border)] rounded-lg bg-[var(--az-surface-2)]">
                    <table className="min-w-full divide-y divide-white/10 text-sm" {...props}>
                        {children}
                    </table>
                </div>
            );
        },
        thead({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
            return <thead className="bg-white/5" {...props}>{children}</thead>;
        },
        th({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
            return <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--az-text-secondary)] uppercase tracking-wider" {...props}>{children}</th>;
        },
        td({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
            return <td className="px-4 py-3 whitespace-nowrap text-[var(--az-text-secondary)] border-t border-[var(--az-border)]" {...props}>{children}</td>;
        }
    };


    const isLong = msg.role === 'ai' && msg.text.length > 1400;
    const [showFull, setShowFull] = React.useState(false);
    const displayText = isLong && !showFull ? msg.text.slice(0, 1100) : msg.text;

    return (
        <div className={`ai-message flex w-full ${msg.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
            <div className={`flex flex-col min-w-0 ${msg.role === 'ai' ? 'w-full max-w-full' : 'items-end max-w-[62%] ml-auto'}`}>
                {isEditing ? (
                    <div className="w-full space-y-3 p-3 rounded-[10px] border" style={{ background: '#171A20', borderColor: 'rgba(255,255,255,0.07)' }}>
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-2.5 rounded-[8px] text-[13px] leading-relaxed resize-none focus:outline-none focus-visible:outline-none placeholder:text-white/30"
                            style={{ background: '#101215', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text)', boxShadow: 'none', outline: 'none' }}
                            rows={3}
                        />
                        <div className="flex gap-1.5 justify-end">
                            <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15" style={{ color: 'var(--az-text-muted)' }}>Cancel</button>
                            <button onClick={() => onSaveEdit(msg.id)} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15" style={{ background: 'var(--az-text)', color: '#0B0D10' }}>Save</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className={`group relative break-words ${msg.role === 'ai'
                            ? 'w-full bg-transparent'
                            : 'px-[13px] py-[7px] rounded-[16px] rounded-br-[5px] border max-w-full transition-all duration-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.14),0_4px_12px_rgba(0,0,0,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_6px_rgba(0,0,0,0.16),0_4px_16px_rgba(0,0,0,0.08)]'
                            }`} style={msg.role !== 'ai' ? { background: 'linear-gradient(180deg, #1E2E4A 0%, #1A2233 100%)', borderColor: 'rgba(59,130,246,0.18)', color: 'var(--az-text)' } : undefined} onMouseEnter={msg.role !== 'ai' ? e => { (e.currentTarget as HTMLDivElement).style.background = 'linear-gradient(180deg, #22304D 0%, #1E2A3E 100%)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(59,130,246,0.26)'; } : undefined} onMouseLeave={msg.role !== 'ai' ? e => { (e.currentTarget as HTMLDivElement).style.background = 'linear-gradient(180deg, #1E2E4A 0%, #1A2233 100%)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(59,130,246,0.18)'; } : undefined}>

                            {msg.role === 'ai' && (
                                <div className="flex items-center gap-2 mb-1.5 select-none">
                                    <span className="text-[12.5px] font-medium tracking-tight" style={{ color: 'var(--az-text-faint)', letterSpacing: '0.02em' }}>Azemax</span>
                                </div>
                            )}
                            <div className={`markdown-content relative z-10 max-w-[640px] ${msg.role === 'ai' ? 'text-[14px] leading-[1.68] text-[var(--az-text-secondary)] tracking-[-0.01em]' : 'text-[13px] leading-[1.5] font-[450] tracking-tight'}`}>
                                {msg.role === 'ai' ? (
                                    <>
                                        {parseArtifacts(displayText).segments.map((segment, segIdx) =>
                                            segment.type === 'artifact' && segment.artifact ? (
                                                <ArtifactBlock
                                                    key={`artifact-${msg.id}-${segIdx}`}
                                                    id={`artifact-${msg.id}-${segIdx}`}
                                                    title={segment.artifact.title}
                                                    type={segment.artifact.type}
                                                    language={segment.artifact.language}
                                                    content={segment.artifact.content}
                                                    onCopy={onCopy}
                                                    copiedId={copiedId}
                                                />
                                            ) : (
                                                <MarkdownRenderer
                                                    key={`text-${msg.id}-${segIdx}`}
                                                    components={components}
                                                    isStreaming={!!isStreaming}
                                                >
                                                    {segment.content}
                                                </MarkdownRenderer>
                                            )
                                        )}
                                        {isLong && (
                                            <button onClick={() => setShowFull(!showFull)} className="mt-2 text-[11px] text-[var(--az-text-faint)] hover:text-[var(--az-text-muted)] transition-colors">
                                                {showFull ? 'Show less' : `Show ${msg.text.length - 1100} more characters`}
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <MarkdownRenderer components={components}>
                                        {msg.text}
                                    </MarkdownRenderer>
                                )}
                            </div>

                            {msg.role === 'ai' && (
                                <div className="flex items-center gap-0.5 mt-3 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                                    <button
                                        onClick={() => onCopy(msg.text, `msg-${msg.id}`)}
                                        className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                        style={{ color: 'var(--az-text-muted)' }}
                                        title={copiedId === `msg-${msg.id}` ? 'Copied' : 'Copy'}
                                        aria-label="Copy response"
                                    >
                                        {copiedId === `msg-${msg.id}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} strokeWidth={1.75} />}
                                    </button>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => typeof index === 'number' && onRegenerate(index)}
                                            className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                            style={{ color: 'var(--az-text-muted)' }}
                                            title="Retry"
                                            aria-label="Retry"
                                        >
                                            <RefreshCw size={12} strokeWidth={1.75} />
                                        </button>
                                    )}
                                    {onReaction && (
                                        <>
                                            <div className="w-px h-3.5 mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />
                                            <button
                                                onClick={() => onReaction(msg.id, 'up')}
                                                className={`w-[26px] h-[26px] rounded-[6px] flex items-center justify-center transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${reaction === 'up' ? 'text-emerald-400 bg-white/[0.06]' : ''}`}
                                                style={{ color: reaction === 'up' ? undefined : 'var(--az-text-muted)' }}
                                                title="Like"
                                                aria-label="Like"
                                            >
                                                <ThumbsUp size={12} strokeWidth={1.75} />
                                            </button>
                                            <button
                                                onClick={() => onReaction(msg.id, 'down')}
                                                className={`w-[26px] h-[26px] rounded-[6px] flex items-center justify-center transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${reaction === 'down' ? 'text-red-400 bg-white/[0.06]' : ''}`}
                                                style={{ color: reaction === 'down' ? undefined : 'var(--az-text-muted)' }}
                                                title="Dislike"
                                                aria-label="Dislike"
                                            >
                                                <ThumbsDown size={12} strokeWidth={1.75} />
                                            </button>
                                        </>
                                    )}
                                    {copiedId === `msg-${msg.id}` && <span className="text-[11px] ml-1.5 font-medium tracking-tight" style={{ color: 'var(--az-text-muted)' }}>Copied</span>}
                                </div>
                            )}

                            {msg.role === 'user' && (
                                <div className="absolute -bottom-5 left-0 opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-0.5 p-0.5 rounded-full border shadow-sm translate-y-1 group-hover:translate-y-0" style={{ background: '#15181E', borderColor: 'rgba(255,255,255,0.07)' }}>
                                    <button
                                        onClick={() => onCopy(msg.text, `msg-${msg.id}`)}
                                        className="p-1 rounded-full hover:bg-white/10 text-[var(--az-text-muted)] hover:text-white transition-all duration-200 group/btn"
                                        title="Copy"
                                    >
                                        {copiedId === `msg-${msg.id}` ? (
                                            <Check size={12} className="text-emerald-400" />
                                        ) : (
                                            <Copy size={12} className="group-hover/btn:scale-110 transition-transform" />
                                        )}
                                    </button>
                                    <div className="w-[1px] h-2.5 bg-white/10" />
                                    <button
                                        onClick={() => onEditStart(msg)}
                                        className="p-1 rounded-full hover:bg-white/10 text-[var(--az-text-muted)] hover:text-white transition-all duration-200 group/btn"
                                        title="Edit"
                                    >
                                        <Edit3 size={12} className="group-hover/btn:scale-110 transition-transform" />
                                    </button>
                                </div>
                            )}
                        </div>
                        {msg.timestamp && (
                            <span className={`text-[10.5px] font-[450] mt-1 px-1 transition-opacity duration-200 ${msg.role === 'ai' ? 'opacity-60 group-hover:opacity-80' : 'opacity-50 group-hover:opacity-70 text-right self-end'}`} style={{ color: 'var(--az-text-muted)', letterSpacing: '0.01em' }}>
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()}
                            </span>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // Custom comparison for React.memo - return false to re-render, true to skip
    // Re-render when:
    // 1. Message text changes (important for streaming)
    if (prev.msg.text !== next.msg.text) return false;
    // 2. Editing state changed
    if (prev.isEditing !== next.isEditing) return false;
    // 3. Edit text changed (if currently editing)
    if (prev.isEditing && prev.editText !== next.editText) return false;
    // 4. Copied state changed for THIS message
    if (prev.copiedId !== next.copiedId) {
        const prevRelevant = prev.copiedId?.startsWith(prev.msg.id) || false;
        const nextRelevant = next.copiedId?.startsWith(next.msg.id) || false;
        if (prevRelevant || nextRelevant) return false;
    }
    // 5. Index changed
    if (prev.index !== next.index) return false;
    // 6. Reaction changed for THIS message
    if (prev.reaction !== next.reaction) return false;

    // Otherwise skip re-render
    return true;
});



export const useAutoScroll = (active: boolean = true) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const isStickyRef = useRef(true);
        const tickingRef = useRef(false);
        const rafIdRef = useRef<number | null>(null);
        const scheduledRef = useRef(false);

        const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
            const el = containerRef.current;
            if (!el) return;
            // Cancel any pending scheduled scroll to avoid double work
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
                scheduledRef.current = false;
            }
            el.scrollTo({ top: el.scrollHeight, behavior });
        }, []);

        // Throttled scroll handler — rAF coalesced, avoids handling every pixel
        const handleScroll = useCallback(() => {
            if (tickingRef.current) return;
            tickingRef.current = true;
            requestAnimationFrame(() => {
                tickingRef.current = false;
                const el = containerRef.current;
                if (!el) return;
                const { scrollTop, scrollHeight, clientHeight } = el;
                const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
                // Sticky when near bottom (within 120px). Break sticky when clearly scrolled up (>200px)
                if (distanceFromBottom < 120) {
                    isStickyRef.current = true;
                } else if (distanceFromBottom > 200) {
                    isStickyRef.current = false;
                }
            });
        }, []);

        // Efficient content-change observer: ResizeObserver on inner content + MutationObserver coalesced via single rAF.
        // No polling, no setInterval, no smooth animation during streaming (instant 'auto' avoids queueing).
        useEffect(() => {
            const el = containerRef.current;
            if (!el || !active) return;

            const schedule = () => {
                if (scheduledRef.current) return;
                scheduledRef.current = true;
                rafIdRef.current = requestAnimationFrame(() => {
                    rafIdRef.current = null;
                    scheduledRef.current = false;
                    if (!isStickyRef.current) return;
                    const { scrollTop, scrollHeight, clientHeight } = el;
                    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
                    // Already at bottom — no work
                    if (distanceFromBottom < 2) return;
                    // If sticky but user is still near bottom, keep pinned instantly (no smooth to avoid animation queue)
                    if (distanceFromBottom < 400) {
                        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
                    }
                });
            };

            // ResizeObserver: inner content height is what matters. Observe the container's scrollable content.
            // The container itself has fixed height (flex-1), so observing it alone would miss content growth.
            // Observe first child wrapper if present, otherwise the container. This catches streaming height changes.
            const contentTarget = (el.firstElementChild as Element) || el;
            const ro = new ResizeObserver(schedule);
            ro.observe(contentTarget);
            if (contentTarget !== el) {
                // Also watch container resize (window/viewport changes)
                ro.observe(el);
            }

            // MutationObserver: only for added/removed message nodes. CharacterData is handled by ResizeObserver
            // (height change) to avoid per-character overhead during streaming.
            const mo = new MutationObserver(schedule);
            mo.observe(el, { childList: true, subtree: false });

            return () => {
                if (rafIdRef.current !== null) {
                    cancelAnimationFrame(rafIdRef.current);
                    rafIdRef.current = null;
                }
                scheduledRef.current = false;
                ro.disconnect();
                mo.disconnect();
            };
        }, [active]);

        return { containerRef, scrollToBottom, handleScroll, isStickyRef };
    };

export const AIAssistant: React.FC<{ isVisible?: boolean }> = ({ isVisible = true }) => {
    const { settings } = useSettings();
    const dialog = useDialog();
    // Session State
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // Centralized AI loading lifecycle — single source via AIRequestStore (chat operation)
    // Keep current user-facing operation for contextual status
    const aiLoading = useAILoading('chat');
    const isLoading = aiLoading.isLoading;
    const [currentOperation, setCurrentOperation] = useState<import('../../core/ai/aiRequestStore').AIOperationType>('chat');

    // UI State
    const [input, setInput] = useState('');
    const [showSidebar, setShowSidebar] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [streamingText, setStreamingText] = useState('');
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [reactions, setReactions] = useState<Record<string, 'up' | 'down'>>({}); // msgId -> reaction
    const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
    const [lastDiffs, setLastDiffs] = useState<Array<{ file: string; added: number; removed: number; summary: string }>>([]);

    // Lazy-load Prism so its ~250KB stays out of the initial bundle
    const [prismReady, setPrismReady] = useState(false);
    useEffect(() => {
        let mounted = true;
        loadPrism().then(() => { if (mounted) setPrismReady(true); });
        return () => { mounted = false; };
    }, []);

    // Deferred value for streaming performance (kept for future use; loading now uses streamingText directly for immediate transition)
    const deferredStreamingText = useDeferredValue(streamingText);
    void deferredStreamingText;

    // Time-based greeting
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "☀️ Good morning";
        if (hour < 18) return "🌤️ Good afternoon";
        return "🌙 Good evening";
    };

    const [_greeting, setGreeting] = useState(getGreeting());
    void _greeting;
    useEffect(() => {
        if (!isVisible) return;
        setGreeting(getGreeting());
    }, [isVisible]);

    // Load saved sessions on mount
    useEffect(() => {
        const savedSessions = loadSessions();
        const savedCurrentSessionId = loadCurrentSessionId();

        if (savedSessions.length > 0 && settings.general.restoreSession) {
            setSessions(savedSessions);
            // Restore the current session if it exists, otherwise use the first one
            if (savedCurrentSessionId && savedSessions.some(s => s.id === savedCurrentSessionId)) {
                setCurrentSessionId(savedCurrentSessionId);
            } else {
                setCurrentSessionId(savedSessions[0].id);
            }
        }
    }, [settings.general.restoreSession]);

    // Project Context — single source for file operations via centralized executor
    const { createFile, updateFileContent, createFolder, deleteNode, renameNode, getActiveFile, getFileTree, setActiveFile } = useProjectActions();
    const { activeFileMeta } = useProjectUI();

    // Action Execution (legacy — kept for verification, not used in semantic pipeline)
    const executeAction = async (actionString: string) => {
        try {
            const action = JSON.parse(actionString);
            switch (action.type) {
                case 'create_file':
                    createFile(action.path, action.content || '');
                    return `Created file: ${action.path}`;
                case 'create_folder':
                    createFolder(action.path);
                    return `Created folder: ${action.path}`;
                case 'delete_file':
                    deleteNode(action.path); // Assuming deleteNode takes ID/path
                    return `Deleted: ${action.path}`;
                case 'update_file':
                    // We need to find the file ID for updateFileContent or just use createFile to overwrite?
                    // ProjectContext createFile overwrites if exists (based on implementation)?
                    // Checking ProjectContext: createFile appends or updates? 
                    // It seems createFile just adds to tree, might duplicate if not careful.
                    // But activeFile.id matches path in the mock.
                    // Let's assume createFile or updateFileContent works.
                    // For now, let's use createFile for overwrite/update as it seems to handle it or we can improve context later.
                    createFile(action.path, action.content || '');
                    return `Updated file: ${action.path}`;
                default:
                    return `Unknown action type: ${action.type}`;
            }
        } catch (e) {
            console.error("Failed to execute action", e);
            return `Failed to execute action: ${e}`;
        }
    };
    void executeAction;

    // Refs
    // const messagesContainerRef = useRef<HTMLDivElement>(null); // Replaced by hook
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isSendingRef = useRef(false); // Track internal sending state to prevent duplicates
    const currentRequestIdRef = useRef<string | null>(null); // Track current request to prevent duplicate responses
    const processedRequestsRef = useRef<Set<string>>(new Set()); // Track processed requests
    const handleSendRef = useRef<((arg?: string) => void) | null>(null);
    const pendingStreamFrameRef = useRef<number | null>(null);
    const latestStreamTextRef = useRef('');
    const lastSentRef = useRef<{ text: string; at: number } | null>(null);

    // Derived state: Current Session
    const currentSession = sessions.find(s => s.id === currentSessionId);
    const messages = currentSession?.messages || [];
    const lastUserMessage = useMemo(() => [...messages].reverse().find(m => m.role === 'user')?.text ?? '', [messages]);

    // Use robust auto-scroll hook
    // We pass [messages, streamingText] as dependencies so the observer re-attaches/checks when content structure changes
    const { containerRef: messagesContainerRef, scrollToBottom, handleScroll: hookHandleScroll, isStickyRef } = useAutoScroll(isVisible && settings.ai.autoScroll);

    const handleStop = useCallback(() => {
        aiLoading.cancel();
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setStreamingText('');
            currentRequestIdRef.current = null;
            isSendingRef.current = false;
        } else {
            setStreamingText('');
        }
    }, [aiLoading]);

    // Combine hook scroll handler with button visibility — single rAF, no duplicated layout reads
    const showScrollTickRef = useRef(false);
    const handleScroll = useCallback(() => {
        hookHandleScroll();
        if (showScrollTickRef.current) return;
        showScrollTickRef.current = true;
        requestAnimationFrame(() => {
            showScrollTickRef.current = false;
            const el = messagesContainerRef.current;
            if (!el) return;
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            const shouldShow = distanceFromBottom > 200;
            setShowScrollButton(prev => (prev === shouldShow ? prev : shouldShow));
        });
    }, [hookHandleScroll]);

    // Scroll to bottom for UI button — re-engage sticky, single smooth call (no queue)
    const handleScrollToBottom = useCallback(() => {
        isStickyRef.current = true;
        scrollToBottom('smooth');
    }, [scrollToBottom]);

    // Reaction handler
    const handleReaction = useCallback((msgId: string, type: 'up' | 'down') => {
        setReactions(prev => {
            const current = prev[msgId];
            if (current === type) {
                // Toggle off - remove entry
                const newPrev = { ...prev };
                delete newPrev[msgId];
                return newPrev;
            }
            return { ...prev, [msgId]: type };
        });
    }, []);

    // New-message smooth pin — only when a message node is added, not on every streamingText char.
    // Streaming is handled by ResizeObserver/MutationObserver inside useAutoScroll (instant 'auto', not 'smooth').
    const prevMessagesLengthRef = useRef(messages.length);
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        if (messages.length === prevMessagesLengthRef.current) return;
        // Handle shrink (e.g., /clear) — reset
        if (messages.length < prevMessagesLengthRef.current) {
            prevMessagesLengthRef.current = messages.length;
            return;
        }
        prevMessagesLengthRef.current = messages.length;
        const lastMsg = messages[messages.length - 1];
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const nearBottom = distanceFromBottom < 150;
        // Always pin for user messages; for AI messages only if sticky/near bottom (respects user scroll-up)
        if (lastMsg?.role === 'user' || isStickyRef.current || nearBottom) {
            isStickyRef.current = true;
            // Smooth only for discrete new messages — streaming uses 'auto' in the observer
            requestAnimationFrame(() => scrollToBottom('smooth'));
        }
    }, [messages, scrollToBottom]);

    const handleNewChat = useCallback(() => {
        // Cancel any in-flight request before starting new chat — prevents old response overwriting new chat
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
        if (currentRequestIdRef.current) { AIRequestStore.cancelRequest(currentRequestIdRef.current); currentRequestIdRef.current = null; }
        setStreamingText('');
        if (pendingStreamFrameRef.current !== null) { cancelAnimationFrame(pendingStreamFrameRef.current); pendingStreamFrameRef.current = null; }
        isSendingRef.current = false;
        const newSession = createSession();
        setSessions(prev => {
            const updated = [newSession, ...prev];
            if (settings.privacy.localPersistence && settings.privacy.saveChatHistory) {
                saveSessions(updated);
            }
            return updated;
        });
        setCurrentSessionId(newSession.id);
        setAgentActivities([]);
        setLastDiffs([]);
        if (window.innerWidth < 768) setShowSidebar(false);
    }, [settings.privacy.localPersistence, settings.privacy.saveChatHistory]);

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        const newSessions = sessions.filter(s => s.id !== sessionId);
        setSessions(newSessions);
        if (settings.privacy.localPersistence && settings.privacy.saveChatHistory) {
            saveSessions(newSessions);
        }

        if (currentSessionId === sessionId) {
            setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
            if (newSessions.length === 0) handleNewChat();
        }
    };

    const handleSelectSession = (sessionId: string) => {
        setCurrentSessionId(sessionId);
        if (window.innerWidth < 768) setShowSidebar(false);
    };

    const _handleCopyCode = useCallback((code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1000);
    }, []);
    void _handleCopyCode;

    const handleCopyMessage = useCallback((text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1000);
    }, []);

    const lastApplyRef = useRef<{ code: string; at: number } | null>(null);
    const handleApplyCode = useCallback(async (code: string) => {
        const now = Date.now();
        if (lastApplyRef.current && lastApplyRef.current.code === code && now - lastApplyRef.current.at < 2000) return;
        lastApplyRef.current = { code, at: now };
        const activeFile = getActiveFile();
        const editorCtx = getActiveEditorContext();
        if (!activeFile || !code) return;
        const fileName = editorCtx?.fileName ?? activeFile.name;
        // Single shared executor deps — explicit user action, so full-file apply is allowed
        const { createExecutorDeps } = await import('../../core/editor/workspaceBridge');
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode, renameNode, updateFileContent },
            fileName,
            activeFile.id,
        );
        const freshContent = editorCtx?.code ?? activeFile.content ?? '';
        const snapshot = freshContent ? { filePath: fileName, content: freshContent, lines: freshContent.split('\n'), timestamp: Date.now() } as any : null;
        const snapshotMap = new Map<string, any>();
        if (snapshot) snapshotMap.set(fileName, snapshot);
        const language = editorCtx?.language ?? 'plaintext';
        const action = { action: 'update_file', path: fileName, content: code } as any;
        const { executeActionPlan: depsExecute } = await import('../../core/ai/aiToolExecutor');
        const result = await depsExecute([action], deps as any, { language, snapshot, snapshotMap } as any);
        if (!result.success) {
            console.warn('[Apply] Safe edit rejected (file untouched):', result.message);
            return false;
        }
        return true;
    }, [getActiveFile, getFileTree, createFile, deleteNode, renameNode, updateFileContent]);

    const handleQuickAction = (prompt: string) => {
        if (isSendingRef.current || isLoading) return; // Prevent double submission
        handleSend(prompt);
    };

    const handleEditMessage = useCallback((msg: Message) => {
        setEditingMessageId(msg.id);
        setEditText(msg.text);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingMessageId(null);
        setEditText('');
    }, []);

    const handleSaveEdit = useCallback(async (msgId: string) => {
        if (!editText.trim()) return;

        // Find the message index and resend from there
        const msgIndex = messages.findIndex(m => m.id === msgId);
        if (msgIndex === -1) return;

        // Remove messages from this point onwards
        const newMessages = messages.slice(0, msgIndex);

        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                return { ...s, messages: newMessages, updatedAt: Date.now() };
            }
            return s;
        }));

        const toSend = editText;
        setEditingMessageId(null);
        setInput(toSend);
        setEditText('');

        // Pass the edited text explicitly — handleSend reads `input` state which is async
        handleSendRef.current?.(toSend);
    }, [messages, currentSessionId, editText]);

    const handleRegenerate = useCallback(async (msgIndex: number) => {
        // Find the user message before this AI message
        const userMsgIndex = msgIndex - 1;
        if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') return;

        // Abort any in-flight generation before restarting to avoid stale/duplicate responses
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        currentRequestIdRef.current = null;
        isSendingRef.current = false;

        const userMessage = messages[userMsgIndex].text;

        // Remove the AI message
        const newMessages = messages.slice(0, msgIndex);

        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                return { ...s, messages: newMessages, updatedAt: Date.now() };
            }
            return s;
        }));

        // Resend the user message immediately (no artificial delay)
        setInput(userMessage);
        handleSendRef.current?.(userMessage);
    }, [messages, currentSessionId]);

    const handleSend = useCallback(async (arg?: string | React.MouseEvent | unknown) => {
        const textToSend = typeof arg === 'string' ? arg : input;

        if (!settings.ai.enabled) return;
        if (!textToSend.trim() || isLoading || isSendingRef.current) return;
        isSendingRef.current = true;

        if (!currentSessionId) handleNewChat();

        const userMessageText = textToSend.trim();

        // Slash Commands
        if (userMessageText === '/clear') {
            setSessions(prev =>
                prev.map(s => s.id === currentSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s)
            );
            setInput('');
            setStreamingText('');
            isSendingRef.current = false;
            return;
        }

        setInput('');
        // Debounce rapid duplicate sends (e.g., double-clicked quick-action)
        if (lastSentRef.current && lastSentRef.current.text === userMessageText && Date.now() - lastSentRef.current.at < 1500) {
            isSendingRef.current = false;
            aiLoading.stop();
            return;
        }
        lastSentRef.current = { text: userMessageText, at: Date.now() };
        setAgentActivities([]);
        setLastDiffs([]);

        // Centralized loading: thinking immediately — single requestId for concurrent protection
        const requestId = aiLoading.start('thinking');
        currentRequestIdRef.current = requestId;
        setStreamingText('');

        // Update UI immediately with User Message
        const tempUserMsg: Message = {
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            role: 'user',
            text: userMessageText,
            timestamp: Date.now()
        };

        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                const updatedMessages = [...s.messages, tempUserMsg];
                const newTitle = s.messages.length === 0 ? userMessageText.slice(0, 30) : s.title;
                return { ...s, messages: updatedMessages, title: newTitle, updatedAt: Date.now() };
            }
            return s;
        }));

        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            if (currentRequestIdRef.current === requestId && !abortController.signal.aborted) {
                abortController.abort();
                // Ensure store reaches terminal state even if provider hangs
                const live = AIRequestStore.getActiveRequestForOperation('chat');
                if (live?.id === requestId) AIRequestStore.failRequest(requestId, 'Request timed out after 75s — please retry.');
            }
        }, 75000);

        // Build fresh context at request time (Monaco-first, never cached) — pin as requestContext so late switching doesn't cause mismatch
        const activeFile = getActiveFile();
        const fileTree = getFileTree();
        const editorCtx = getActiveEditorContext();
        const fileContent = editorCtx?.code ?? activeFile?.content ?? '';
        const fileName = editorCtx?.fileName ?? activeFile?.name ?? '';
        const filePathPinned = editorCtx?.filePath ?? fileName;
        const language = editorCtx?.language ?? 'plaintext';
        const requestContext = {
            fileName,
            filePath: filePathPinned,
            fileId: editorCtx?.fileId ?? activeFile?.id ?? null,
            language,
            documentVersionId: editorCtx?.documentVersionId ?? null,
            extension: editorCtx?.extension ?? (fileName.split('.').pop()?.toLowerCase() ?? ''),
            className: editorCtx?.className ?? null,
            moduleName: editorCtx?.moduleName ?? null,
            selectionText: editorCtx?.selectionText ?? null,
            selection: editorCtx?.selection ?? null,
            requestId,
        } as const;
        // Collect @File referenced files (bounded, fresh) for context-aware @File
        const referencedContents: Array<{ path: string; content: string }> = [];
        try {
            const atPaths = [...userMessageText.matchAll(/@([^\s@,;]+)/g)].map(m => m[1].trim()).filter(Boolean).slice(0,3);
            const findByPath = (tree: any[], target: string): any | null => {
                const clean = target.replace(/^\//,'');
                const walk = (nodes: any[], prefix: string): any | null => {
                    for (const n of nodes) {
                        if (n.id === 'root') { if (n.children) { const f = walk(n.children, ''); if (f) return f; } continue; }
                        const full = prefix ? `${prefix}/${n.name}` : n.name;
                        if (full === clean || n.name === clean) return n;
                        if (n.children) { const f = walk(n.children, full); if (f) return f; }
                    }
                    return null;
                };
                return walk(tree, '');
            };
            for (const pth of atPaths) {
                const node = findByPath(fileTree as any, pth);
                if (node && node.type === 'file' && typeof node.content === 'string' && node.content.trim()) {
                    // Prefer live editor content if this is active file
                    const live = editorCtx && editorCtx.fileName === node.name ? editorCtx.code : node.content;
                    referencedContents.push({ path: pth, content: (live ?? node.content).slice(0, 4000) });
                }
            }
        } catch { /* ignore context parse errors */ }

        // Convert chat history to ChatMessage[] for the pipeline
        const historyForPipeline: ChatMessage[] = messages
            .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

        try {
            // Determine operation type via semantic planner first (for loading status)
            const { generateSemanticPlan, semanticPlanToAIOperationType } = await import('../../core/ai/semanticPlanner');
            let operationForStatus: import('../../core/ai/aiRequestStore').AIOperationType = 'chat';
            let wantsModification = false;
            let isExplain = false;
            let plannerResponseMessage = '';

            try {
                const planWithTimeout = (async () => {
                    const timeout = new Promise<null>((_, reject) => {
                        const t = setTimeout(() => reject(new Error('Semantic planner timed out')), 12000);
                        if (abortController.signal) abortController.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('The operation was aborted.', 'AbortError')); }, { once: true });
                    });
                    return await Promise.race([
                        generateSemanticPlan(userMessageText, editorCtx, buildWorkspaceSnapshot(editorCtx, fileTree).fileTreeString, historyForPipeline, abortController.signal),
                        timeout as Promise<null>
                    ]);
                })();
                const semanticPlan = await planWithTimeout as any;
                if (semanticPlan) {
                    operationForStatus = semanticPlanToAIOperationType(semanticPlan);
                    wantsModification = semanticPlan.analysis.wantsModification;
                    isExplain = semanticPlan.analysis.operation === 'explain';
                    plannerResponseMessage = semanticPlan.responseMessage || '';
                    if (import.meta.env.DEV) console.log('[SemanticPlanner] plan:', semanticPlan);
                }
            } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                if (import.meta.env.DEV) console.warn('[SemanticPlanner] failed:', e);
            }

            setCurrentOperation(operationForStatus);

            let responseText = '';

            if (wantsModification) {
                // EDIT PATH — Cursor-style Agent Controller (Intent → Live Context → Tools → Execute → Verify)
                aiLoading.setGenerating();
                setAgentActivities([]);
                const { runAgentController } = await import('../../core/ai/agentController');
                // Verify still-current before applying: pass pinned requestContext so late file switch doesn't corrupt wrong file
                const result = await runAgentController({
                    userMessage: userMessageText,
                    workspace: { getFileTree, createFile, deleteNode, renameNode, updateFileContent, setActiveFile } as unknown as import('../../core/editor/workspaceBridge').WorkspaceBridgeActions & { setActiveFile?: unknown },
                    fileName: requestContext.fileName || null,
                    fileId: requestContext.fileId,
                    history: historyForPipeline,
                    signal: abortController.signal,
                    requestContext: requestContext as unknown as import('../../core/ai/agentController').AgentRequestContext,
                    onActivity: (act) => {
                        if (currentRequestIdRef.current !== requestId) return;
                        setAgentActivities(prev => {
                            const idx = prev.findIndex(a => a.id === act.id);
                            if (idx >= 0) { const next = [...prev]; next[idx] = act; return next; }
                            return [...prev, act].slice(-12);
                        });
                        if (currentRequestIdRef.current !== requestId) return;
                        if (act.tool === 'interpret' && act.status === 'running') aiLoading.setThinking();
                        else if (['read_file', 'search_files', 'list_files', 'get_diagnostics', 'get_editor_context', 'open_file'].includes(act.tool) && act.status === 'running') aiLoading.setGenerating();
                        else if (act.tool === 'apply' && act.status === 'running') aiLoading.setApplying();
                        else if (act.status === 'done' && act.tool !== 'apply') aiLoading.setGenerating();
                    },
                });

                if (import.meta.env.DEV) console.log('[AgentController] result:', result);
                responseText = result.message || (result.success ? 'Changes applied.' : 'No changes were made.');
                // Keep final activities for streaming card display, cleared on next send
                setAgentActivities(result.activities.slice(-4));
                setLastDiffs(result.success && (result as { diffs?: typeof lastDiffs }).diffs ? (result as { diffs: typeof lastDiffs }).diffs : []);

            } else if (isExplain || plannerResponseMessage.trim().length > 20) {
                // EXPLAIN PATH — use planner's response or stream explanation
                aiLoading.setGenerating();
                aiLoading.setStreaming();
                if (plannerResponseMessage.trim().length > 20) {
                    responseText = plannerResponseMessage;
                    scheduleStreamUpdate(requestId, responseText);
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                } else {
                    // Stream explanation via centralized AIClient
                    const explainPrompt = `You are a friendly, concise coding tutor.

File: ${fileName} (${language})
${fileContent ? 'Code:\n```' + language + '\n' + fileContent.slice(0, 12000) + '\n```' : '(no file content)'}
User wants explanation: "${userMessageText}"

Provide a warm, concise explanation. Keep to 2-4 bullets or short paragraphs. Do NOT modify code.`;
                    const messagesForChat: ChatMessage[] = [
                        { role: 'system', content: explainPrompt },
                        ...historyForPipeline.slice(-4),
                        { role: 'user', content: userMessageText },
                    ];
                    let fullResponse = '';
                    let hasSetStreaming = false;
                    for await (const event of streamChat(messagesForChat, { signal: abortController.signal, task: 'explanation', temperature: 0.3, maxTokens: 2048 })) {
                        if (event.type === 'delta' && event.content) {
                            if (!hasSetStreaming) { hasSetStreaming = true; aiLoading.setStreaming(); }
                            fullResponse += event.content;
                            scheduleStreamUpdate(requestId, fullResponse);
                        } else if (event.type === 'error') {
                            throw new Error(event.message || 'Explanation failed');
                        }
                    }
                    responseText = fullResponse;
                }
            } else {
                // CHAT PATH — stream natural response (context-aware, super fast via Groq, fallback to DeepSeek)
                aiLoading.setGenerating();
                const trimmedLower = userMessageText.trim().toLowerCase();
                const isGreetingOnly = /^(hello|hi|hey|hello ai|hi there|hey there|greetings)[\s!?.]*$/i.test(userMessageText.trim()) && trimmedLower.length <= 20;
                const isFileQuery = /what file|which file|current file|active file|file is this|file name/i.test(userMessageText);
                const isFastChat = isGreetingOnly && !isFileQuery;
                const isCodeRelated = /code|function|bug|error|fix|refactor|explain|comment|file|project|hello\.py|javascript|python/i.test(userMessageText);
                const systemPrompt = isFastChat
                    ? `You are ${BRAND.name} AI — a warm, natural coding buddy. Greet briefly and offer help. 1-2 sentences, friendly, no file talk.`
                    : `You are ${BRAND.name} AI — warm and efficient. Be conversational, concise, and genuinely helpful.
Natural: Talk like a friendly teammate, not a formal doc. Use contractions, a little warmth, an emoji when fitting.
Efficient: Get to the point in 2-3 short paragraphs or bullets. No preamble. Code only when needed.`;
                const refBlock = referencedContents.length ? `\nReferenced files:\n${referencedContents.map(r => `@${r.path}:\n\`\`\`\n${r.content}\n\`\`\``).join('\n')}` : '';
                // Use pinned requestContext for file identity so switches mid-stream don't corrupt context
                const pinnedCtxForChat = requestContext;
                const chatFileName = pinnedCtxForChat.fileName || fileName;
                const chatFileContent = pinnedCtxForChat.selectionText != null ? (getActiveEditorContext()?.code ?? fileContent) : fileContent; // fallback
                const chatLanguage = pinnedCtxForChat.language || language;
                // Build tree snapshot from pinned filePath's view (still read current tree structure)
                const treeSnapshot = buildWorkspaceSnapshot(getActiveEditorContext() ?? null, fileTree).fileTreeString.slice(0, 1500);
                const fileContext = isCodeRelated && fileContent && fileContent.length > 10
                    ? `File: ${chatFileName} (${chatLanguage}, ${fileContent.split('\n').length} lines)\nPath: ${pinnedCtxForChat.filePath}\nLanguage: ${chatLanguage}\nCurrent class: ${pinnedCtxForChat.className ?? '(none)'}\n\`\`\`${chatLanguage}\n${fileContent.slice(0, 6000)}\n\`\`\`${refBlock}\nTree: ${treeSnapshot}\n\nQ: "${userMessageText}"`
                    : isCodeRelated && chatFileName
                        ? `File: ${chatFileName} (${chatLanguage}) Path: ${pinnedCtxForChat.filePath} | Q: "${userMessageText}"${refBlock} | Tree: ${treeSnapshot}`
                        : referencedContents.length ? `${userMessageText}${refBlock}` : userMessageText;
                void chatFileContent;

                // Super-fast local handling for file identity queries — instant, no network, fully context-aware
                if (isFileQuery && fileName) {
                    const lineCount = fileContent ? fileContent.split('\n').length : 0;
                    const preview = fileContent ? fileContent.slice(0, 200).trim() : '(empty)';
                    responseText = `The current file is **${fileName}** (${language}, ${lineCount} line${lineCount===1?'':'s'}).` + (fileContent && fileContent.trim() ? `\n\nPreview:\n\`\`\`${language}\n${preview}\n\`\`\`` : ' It is currently empty — ask me to generate code like “write a greeting function” and I’ll create it with DeepSeek.');
                    aiLoading.setStreaming();
                    scheduleStreamUpdate(requestId, responseText);
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                } else {
                    const messagesForChat: ChatMessage[] = [
                        { role: 'system', content: systemPrompt },
                        ...historyForPipeline.slice(-4),
                        { role: 'user', content: fileContext },
                    ];

                    let fullResponse = '';
                    let hasSetStreaming = false;
                    for await (const event of streamChat(messagesForChat, { signal: abortController.signal, task: isFastChat ? 'fast_chat' : 'chat', temperature: isFastChat ? 0.4 : 0.7, maxTokens: isFastChat ? 512 : 2048 })) {
                        if (event.type === 'delta' && event.content) {
                            if (!hasSetStreaming) { hasSetStreaming = true; aiLoading.setStreaming(); }
                            fullResponse += event.content;
                            scheduleStreamUpdate(requestId, fullResponse);
                        } else if (event.type === 'error') {
                            throw new Error(event.message || 'Chat failed');
                        }
                    }
                    responseText = cleanResponse(fullResponse);
                }
                }

            // Cleanup streaming
            const stillCurrent = currentRequestIdRef.current === requestId;
            setStreamingText('');
            abortControllerRef.current = null;
            currentRequestIdRef.current = null;

            // Append AI Response (single write, requestId-guarded)
            if (stillCurrent && responseText && !processedRequestsRef.current.has(requestId)) {
                processedRequestsRef.current.add(requestId);
                if (processedRequestsRef.current.size > 10) {
                    const entries = Array.from(processedRequestsRef.current);
                    processedRequestsRef.current = new Set(entries.slice(-10));
                }

                const aiMsgId = `${requestId}-ai`;
                const aiMsg: Message = {
                    id: aiMsgId,
                    role: 'ai',
                    text: responseText,
                    timestamp: Date.now()
                };

                setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        if (s.messages.some(m => m.id === aiMsgId)) return s;
                        return { ...s, messages: [...s.messages, aiMsg], updatedAt: Date.now() };
                    }
                    return s;
                }));
                if (stillCurrent) aiLoading.setSuccess();
                else aiLoading.stop();
            }

        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error('AI Error:', error);
                // Preserve partial streaming content if stream failed after 60% — do not erase
                const partial = latestStreamTextRef.current?.trim();
                const stillCurrentErr = currentRequestIdRef.current === requestId;
                if (partial && stillCurrentErr && !processedRequestsRef.current.has(requestId) && partial.length > 20) {
                    const partialClean = cleanResponse(partial);
                    if (partialClean) {
                        const partialId = `${requestId}-partial`;
                        if (!processedRequestsRef.current.has(partialId)) {
                            processedRequestsRef.current.add(partialId);
                            const partialMsg: Message = { id: partialId, role: 'ai', text: partialClean + "\n\n*Response interrupted — showing partial output.*", timestamp: Date.now() };
                            setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, partialMsg], updatedAt: Date.now() } : s));
                        }
                    }
                }
                const code = error?.code as string | undefined;
                let friendlyError: string;
                let what = 'AI response failed';
                let why = '';
                if (code === AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR || error?.message?.includes('No AI providers are configured')) {
                    what = 'AI not configured';
                    why = 'No API keys found.';
                    friendlyError = 'No AI providers are configured. Add NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or HF_TOKEN to .env and restart the server. Deterministic tasks like “Remove comments” and “/// hello world” work offline.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR || error?.message?.includes('API key') || error?.message?.includes('auth')) {
                    what = 'Authentication failed';
                    why = 'API key rejected.';
                    friendlyError = 'AI provider authentication failed. Please check your API keys in .env / settings.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED) {
                    what = 'Rate limited';
                    why = 'Too many requests.';
                    friendlyError = 'AI is rate-limited. Please wait a moment and try again.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_TIMEOUT || error?.message?.includes('timed out')) {
                    what = 'Request timed out';
                    why = 'The provider was slow — the request was cancelled after 75s.';
                    friendlyError = 'AI request timed out. The provider was slow — please try again.';
                } else if (code === AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED || error?.message?.includes('unavailable')) {
                    what = 'AI temporarily unavailable';
                    why = 'All providers failed.';
                    friendlyError = 'AI is temporarily unavailable. Please try again in a moment.';
                } else {
                    why = error?.message ? String(error.message).slice(0, 220) : '';
                    friendlyError = why ? `${what}: ${why}` : "I'm sorry, I encountered an error. Please try again.";
                }
                aiLoading.setError(friendlyError);
                const errorMsg: Message = {
                    id: Date.now().toString(),
                    role: 'ai',
                    text: friendlyError,
                    timestamp: Date.now()
                };
                setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, errorMsg], updatedAt: Date.now() } : s));
            } else {
                aiLoading.stop();
            }
        } finally {
            isSendingRef.current = false;
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            // Defensive: query live store, not captured closure status — prevents stuck loading
            const live = AIRequestStore.getActiveRequestForOperation('chat');
            if (live && live.id === requestId && !['success','error','cancelled','idle'].includes(live.status)) {
                AIRequestStore.cancelRequest(requestId);
            }
            setStreamingText('');
            if (pendingStreamFrameRef.current !== null) { cancelAnimationFrame(pendingStreamFrameRef.current); pendingStreamFrameRef.current = null; }
            abortControllerRef.current = null;
            currentRequestIdRef.current = null;
        }
    }, [input, sessions, currentSessionId, aiLoading, handleNewChat, settings, getActiveFile, getFileTree]);

    handleSendRef.current = handleSend;

    // Cleanup on unmount — never leave orphaned stream or pending frame
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
            if (pendingStreamFrameRef.current !== null) { cancelAnimationFrame(pendingStreamFrameRef.current); pendingStreamFrameRef.current = null; }
            // Do not clear store here — request may be shared, but ensure local UI reset
            setStreamingText('');
        };
    }, []);

    // Coalesce streaming updates: at most one rAF pending, always renders the latest text
    const scheduleStreamUpdate = useCallback((requestId: string, text: string) => {
        latestStreamTextRef.current = text;
        if (pendingStreamFrameRef.current !== null) return;
        pendingStreamFrameRef.current = requestAnimationFrame(() => {
            pendingStreamFrameRef.current = null;
            if (currentRequestIdRef.current === requestId) {
                setStreamingText(latestStreamTextRef.current);
            }
        });
    }, []);

    // Persist sessions whenever they change
    useEffect(() => {
        if (sessions.length > 0 && settings.privacy.localPersistence && settings.privacy.saveChatHistory) {
            saveSessions(sessions);
        }
    }, [sessions, settings.privacy.localPersistence, settings.privacy.saveChatHistory]);

    // Persist current session ID
    useEffect(() => {
        if (settings.privacy.localPersistence && settings.privacy.saveChatHistory) {
            saveCurrentSessionId(currentSessionId);
        }
    }, [currentSessionId, settings.privacy.localPersistence, settings.privacy.saveChatHistory]);

    // Powerful EVERYWHERE: Listen for editor context-menu / shortcut prefill
    useEffect(() => {
        const onPrefill = (e: Event) => {
            const ce = e as CustomEvent<{ prompt?: string }>;
            const prompt = ce.detail?.prompt;
            if (prompt) {
                setInput(prompt);
                // Focus the input and allow the user to press Enter, or auto-send for powerful one-click
                // We prefill and also immediately trigger send for a true "one-click" powerful experience
                // Use rAF to ensure input state is set before send
                requestAnimationFrame(() => {
                    handleSendRef.current?.(prompt);
                });
                inputRef.current?.focus();
            }
        };
        window.addEventListener('ai-chat-prefill', onPrefill as EventListener);
        return () => window.removeEventListener('ai-chat-prefill', onPrefill as EventListener);
    }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modKey = isMac ? e.metaKey : e.ctrlKey;

            // Cmd/Ctrl + N: New chat
            if (modKey && e.key === 'n') {
                e.preventDefault();
                handleNewChat();
            }
            // Escape: Stop generation
            if (e.key === 'Escape' && isLoading) {
                e.preventDefault();
                handleStop();
            }
            // Cmd/Ctrl + /: Focus input
            if (modKey && e.key === '/') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handleNewChat, isLoading, handleStop]);







    return (
        <div className="ai-chat-root flex flex-col h-full w-full relative overflow-hidden min-h-0" style={{ background: "#101215" }}>

            {/* Subtle depth — hairline, no gradients, no blue */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.01), transparent 22%), transparent' }} />

            {/* Sidebar (History) — premium minimal */}
            <div
                className={`
                    absolute top-0 left-0 z-30 h-full w-[280px]
                    ${showSidebar
                        ? 'translate-x-0 opacity-100'
                        : '-translate-x-full opacity-0'
                    }
                `}
                style={{
                    transition: 'transform 220ms cubic-bezier(0.2,0,0,1), opacity 180ms ease-out',
                    transformOrigin: 'left center'
                }}
            >
                <div className="flex flex-col h-full border-r shadow-[4px_0_24px_rgba(0,0,0,0.32)]" style={{ background: "#0E1116", borderColor: "rgba(255,255,255,0.06)" }}>
                    {/* Sidebar Header — premium, balanced, neutral */}
                    <div className="h-[48px] shrink-0 flex items-center justify-between px-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <button
                            onClick={() => { handleNewChat(); setShowSidebar(false); }}
                            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-[8px] text-[13px] font-medium tracking-tight transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.08] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                            style={{ color: 'var(--az-text)' }}
                        >
                            <Plus size={14} strokeWidth={2} style={{ color: 'rgba(255,255,255,0.72)' }} />
                            New chat
                        </button>
                        <button
                            onClick={() => setShowSidebar(false)}
                            aria-label="Close history"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-[7px] transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.08]"
                            style={{ color: 'var(--az-text-muted)' }}
                        >
                            <X size={14} strokeWidth={1.75} />
                        </button>
                    </div>

                    {/* Search Bar — premium neutral focus, no blue */}
                    <div className="px-3 pt-3 pb-2">
                        <div className="relative group">
                            <input
                                type="text"
                                placeholder="Search conversations"
                                aria-label="Search conversations"
                                className="w-full h-8 pl-8 pr-3 text-[13px] rounded-[8px] outline-none transition-all duration-150 placeholder:text-white/30 focus:outline-none focus-visible:outline-none"
                                style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    color: 'var(--az-text)',
                                    boxShadow: 'none',
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)';
                                    e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.04)';
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
                                    e.currentTarget.style.boxShadow = 'none';
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                }}
                                onChange={(e) => {
                                    const searchTerm = e.target.value.toLowerCase();
                                    document.querySelectorAll('[data-session-title]').forEach((el) => {
                                        const title = el.getAttribute('data-session-title')?.toLowerCase() || '';
                                        (el as HTMLElement).style.display = title.includes(searchTerm) ? '' : 'none';
                                    });
                                }}
                            />
                            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors" style={{ color: 'rgba(255,255,255,0.32)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Sessions List — compact premium */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-2 py-1">
                        {sessions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
                                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    <MessageSquare size={16} style={{ color: 'rgba(255,255,255,0.28)' }} />
                                </div>
                                <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>No conversations yet</p>
                                <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.30)' }}>Your chats will appear here</p>
                            </div>
                        ) : (() => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const todayMs = today.getTime();
                            const yesterdayMs = todayMs - 86400000;
                            const weekMs = todayMs - 7 * 86400000;
                            const monthMs = todayMs - 30 * 86400000;

                            const groups: { label: string; sessions: typeof sessions }[] = [
                                { label: 'Today', sessions: [] },
                                { label: 'Yesterday', sessions: [] },
                                { label: 'Previous 7 Days', sessions: [] },
                                { label: 'Previous 30 Days', sessions: [] },
                                { label: 'Older', sessions: [] },
                            ];

                            sessions.forEach(session => {
                                const sessionTime = session.updatedAt || session.createdAt;
                                if (sessionTime >= todayMs) {
                                    groups[0].sessions.push(session);
                                } else if (sessionTime >= yesterdayMs) {
                                    groups[1].sessions.push(session);
                                } else if (sessionTime >= weekMs) {
                                    groups[2].sessions.push(session);
                                } else if (sessionTime >= monthMs) {
                                    groups[3].sessions.push(session);
                                } else {
                                    groups[4].sessions.push(session);
                                }
                            });

                            return groups.filter(g => g.sessions.length > 0).map(group => (
                                <div key={group.label} className="mb-5">
                                    {/* Group Label — secondary */}
                                    <div className="px-2.5 pt-2 pb-1.5">
                                        <span className="text-[10px] font-medium uppercase" style={{ color: 'rgba(255,255,255,0.32)', letterSpacing: '0.08em' }}>{group.label}</span>
                                    </div>

                                    {/* Sessions in Group — compact list */}
                                    <div className="space-y-0.5">
                                    {group.sessions.map(session => {
                                        const isActive = currentSessionId === session.id;

                                        return (
                                            <div
                                                key={session.id}
                                                data-session-title={session.title || 'New Chat'}
                                                onClick={() => handleSelectSession(session.id)}
                                                className={`group relative flex items-center gap-2.5 pl-2.5 pr-2 py-2 rounded-[8px] cursor-pointer transition-colors duration-150 ${isActive ? 'is-active' : ''}`}
                                                style={{
                                                    background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                                                    border: isActive ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                                                }}
                                            >
                                                {isActive && (
                                                    <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
                                                )}
                                                <MessageSquare size={14} className="shrink-0 transition-colors duration-150" style={{ color: isActive ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.28)' }} />
                                                <span className="text-[13px] leading-none truncate pr-14 flex-1 min-w-0 transition-colors duration-150" style={{ color: isActive ? '#F1F3F5' : 'rgba(255,255,255,0.62)', fontWeight: isActive ? 500 : 400 }}>
                                                    {session.title || 'New Chat'}
                                                </span>

                                                {/* Hover Actions — reveal on hover/focus */}
                                                <div className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-[6px] p-0.5 transition-all duration-150 ${isActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0'}`} style={{ background: isActive ? 'rgba(19,27,42,0.96)' : 'rgba(20,23,28,0.96)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(6px)' }}>
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            const newTitle = await dialog.prompt({
                                                                title: 'Rename conversation',
                                                                message: 'Enter a new name for this conversation.',
                                                                defaultValue: session.title || 'New Chat',
                                                                placeholder: 'Conversation name',
                                                                confirmLabel: 'Rename',
                                                                validate: v => !v.trim() ? 'Name cannot be empty' : null,
                                                            });
                                                            if (newTitle !== null && newTitle.trim()) {
                                                                setSessions(prev => prev.map(s =>
                                                                    s.id === session.id ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s
                                                                ));
                                                            }
                                                        }}
                                                        aria-label="Rename conversation"
                                                        className="w-6 h-6 inline-flex items-center justify-center rounded-[5px] transition-colors duration-150 hover:bg-white/[0.08]"
                                                        style={{ color: 'rgba(255,255,255,0.55)' }}
                                                        title="Rename"
                                                    >
                                                        <Edit3 size={12} strokeWidth={1.75} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                                        aria-label="Delete conversation"
                                                        className="w-6 h-6 inline-flex items-center justify-center rounded-[5px] transition-colors duration-150 hover:bg-red-500/10"
                                                        style={{ color: 'rgba(255,255,255,0.45)' }}
                                                        onMouseEnter={(e) => (e.currentTarget.style.color = '#F87171')}
                                                        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={12} strokeWidth={1.75} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>

                    {/* Sidebar Footer — pinned, subtle */}
                    <div className="shrink-0 px-3 py-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
                        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</span>
                        <button
                            onClick={async () => {
                                const doClear = () => {
                                    setSessions([]);
                                    saveSessions([]);
                                    handleNewChat();
                                };
                                if (settings.ai.confirmClearConversation) {
                                    const confirmed = await dialog.confirm({
                                        title: 'Clear all conversations?',
                                        message: 'This will permanently delete all conversations. This action cannot be undone.',
                                        confirmLabel: 'Clear all',
                                        cancelLabel: 'Cancel',
                                        danger: true,
                                    });
                                    if (confirmed) doClear();
                                } else {
                                    doClear();
                                }
                            }}
                            className="text-[11px] font-medium transition-colors duration-150 hover:text-white/80"
                            style={{ color: 'rgba(255,255,255,0.38)' }}
                        >
                            Clear all
                        </button>
                    </div>
                </div>
            </div>

            {/* Backdrop with blur */}
            <div
                className={`absolute inset-0 z-20 ${showSidebar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                style={{
                    background: 'linear-gradient(to right, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0.3) 100%)',
                    backdropFilter: showSidebar ? 'blur(6px)' : 'blur(0px)',
                    transition: 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1), backdrop-filter 400ms cubic-bezier(0.4, 0, 0.2, 1)'
                }}
                onClick={() => setShowSidebar(false)}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 w-full relative z-10">
                {/* Header — premium hierarchy: history · AZEMAX · title · + */}
                <div className="h-[44px] shrink-0 flex items-center gap-3 px-4 border-b z-20" style={{ background: '#0F1115', borderColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setShowSidebar(!showSidebar)}
                            className="w-[28px] h-[28px] rounded-[7px] flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                            style={{ color: showSidebar ? 'var(--az-text-secondary)' : 'var(--az-text-muted)', background: showSidebar ? 'rgba(255,255,255,0.06)' : 'transparent', border: showSidebar ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent' }}
                            title="Chat history"
                            aria-label="Toggle history"
                        >
                            <History size={13} strokeWidth={1.75} />
                        </button>
                        <div className="w-px h-[14px] mx-0.5 hidden sm:block" style={{ background: 'rgba(255,255,255,0.08)' }} />
                        <span className="hidden sm:inline text-[11px] font-semibold tracking-[0.09em] uppercase select-none" style={{ color: 'var(--az-text-secondary)', letterSpacing: '0.09em' }}>AZEMAX</span>
                    </div>

                    <button
                        onClick={async () => {
                            if (!currentSessionId) return;
                            const session = sessions.find(s => s.id === currentSessionId);
                            const currentTitle = session?.title || 'New Chat';
                            const newTitle = await dialog.prompt({
                                title: 'Rename chat',
                                message: 'Enter a new name for this conversation.',
                                defaultValue: currentTitle,
                                placeholder: 'Chat name',
                                confirmLabel: 'Rename',
                                validate: v => !v.trim() ? 'Name cannot be empty' : null,
                            });
                            if (newTitle != null && newTitle.trim() !== '') {
                                setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s));
                            }
                        }}
                        className="flex-1 min-w-0 px-2 py-1 rounded-[6px] text-[13px] font-medium truncate text-center tracking-tight transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/10"
                        style={{ color: 'var(--az-text)', letterSpacing: '-0.01em' }}
                        title={`${currentSession?.title || 'New Chat'} — Click to rename`}
                    >
                        <span className="truncate">{currentSession?.title || 'New Chat'}</span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={handleNewChat}
                            className="w-[28px] h-[28px] rounded-[7px] flex items-center justify-center transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 shrink-0"
                            style={{ color: 'var(--az-text-muted)', border: '1px solid transparent' }}
                            title="New chat"
                            aria-label="New chat"
                        >
                            <Plus size={13} strokeWidth={1.75} />
                        </button>
                    </div>
                </div>

                {/* Messages Container */}
                {!settings.ai.enabled && (
                    <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/25 text-[11px] text-yellow-200/80 z-10">
                        AI features are disabled. Enable them in Settings → AI.
                    </div>
                )}
                <div
                    ref={messagesContainerRef}
                    onScroll={handleScroll}
                    className="ai-chat-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full"
                    style={{ overflowAnchor: 'auto' }}
                >
                    <div className="mx-auto w-full max-w-[640px] px-4 pt-4 pb-8 space-y-3">
                    {messages.length === 0 && !streamingText && settings.general.showWelcomeScreen ? (
                        <div className="flex flex-col items-center px-5 pt-8 pb-6 text-center w-full max-w-[340px] mx-auto" style={{ animation: 'fade-in-up 220ms var(--az-ease-out) both' }}>
                            <div className="mb-3 opacity-[0.88]">
                                <AzemaxLogo size={22} />
                            </div>
                            <div className="text-[10px] font-semibold tracking-[0.10em] uppercase" style={{ color: 'rgba(255,255,255,0.32)' }}>Azemax</div>
                            <h3 className="text-[14px] font-semibold tracking-tight leading-tight mt-1" style={{ color: 'var(--az-text)' }}>What are you building?</h3>
                            <p className="text-[12px] leading-[1.5] mt-1.5 max-w-[280px] tracking-tight" style={{ color: 'var(--az-text-muted)' }}>
                                Ask about your code, files, or let Azemax make changes directly.
                            </p>
                            <div className="grid grid-cols-2 gap-1.5 mt-5 w-full">
                                {QUICK_ACTIONS.map((action) => (
                                    <button
                                        key={action.label}
                                        onClick={() => handleQuickAction(action.prompt)}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] text-[11.5px] font-medium tracking-tight leading-none transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--az-text-secondary)' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--az-text)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'var(--az-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                                    >
                                        <action.icon size={12} strokeWidth={1.75} style={{ opacity: 0.58 }} />
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg, index) => {
                                const isError = msg.role === 'ai' && /^(No AI providers|AI is|Verification failed|Edit failed|Could not|Failed to|The file changed)/i.test(msg.text);
                                if (isError) {
                                    return (
                                        <div key={msg.id || index} className="w-full rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2.5 flex items-start gap-2.5 message-appear">
                                            <span className="mt-0.5 text-[var(--az-text-muted)] text-[13px]">⚠</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[13px] leading-[1.5] text-amber-100/80 whitespace-pre-wrap break-words">{msg.text.slice(0, 400)}</div>
                                                <div className="flex gap-2 mt-2">
                                                    <button onClick={() => handleSend(lastUserMessage)} className="px-2.5 py-1 rounded-md bg-white text-black text-[11px] font-medium hover:bg-white/90 transition-colors">Retry</button>
                                                    <button onClick={() => navigator.clipboard.writeText(msg.text)} className="px-2.5 py-1 rounded-md bg-[var(--az-surface-3)] border border-[var(--az-border)] text-[11px] text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] transition-colors">Copy details</button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return (
                                    <MessageItem
                                        key={msg.id || index}
                                        msg={msg}
                                        index={index}
                                        isEditing={editingMessageId === msg.id}
                                        editText={editText}
                                        setEditText={setEditText}
                                        onSaveEdit={handleSaveEdit}
                                        onCancelEdit={handleCancelEdit}
                                        onEditStart={handleEditMessage}
                                        onCopy={handleCopyMessage}
                                        onRegenerate={handleRegenerate}
                                        onApplyCode={handleApplyCode}
                                        copiedId={copiedId}
                                        reaction={reactions[msg.id] || null}
                                        onReaction={handleReaction}
                                        prismReady={prismReady}
                                    />
                                );
                            })}

                            {/* Unified streaming — minimal premium, no logo */}
                            {streamingText && (
                                <div className="ai-response-container w-full" style={{ contain: 'layout paint' }}>
                                    <div className="flex flex-col">
                                        <div className="text-[13px] font-medium mb-2" style={{ color: 'var(--az-text-faint)', letterSpacing: '0.02em' }}>Azemax</div>
                                        <SmoothStreamingBubble
                                            text={streamingText}
                                            isStreaming={aiLoading.status === 'streaming' || aiLoading.status === 'generating'}
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Azemax processing — cohesive inline Azemaxing · · · */}
                    {!streamingText && isLoading && (
                        <div className="flex w-full justify-start" style={{ marginTop: '0px', marginBottom: '0px', contain: 'layout paint' }}>
                            <div className="min-w-0">
                                {agentActivities.length > 0 ? (
                                    <div className="space-y-0">
                                        {agentActivities.slice(-4).map(act => (
                                            <div key={act.id} className="ai-loading-minimal" style={{ minHeight: '20px', padding: '4px 0 2px', gap: '6px' } as React.CSSProperties}>
                                                <span className="ai-loading-minimal-text truncate" style={{ fontSize: '12.5px', maxWidth: '200px' }}>{act.message.replace(/…+$|\.\.\.+$/,'').trim()}</span>
                                                <span className="ai-loading-dots-subtle ai-dots-fixed shrink-0" aria-hidden="true" style={{ display: act.status === 'running' ? 'inline-flex' : 'none', opacity: act.status === 'running' ? 1 : 0 }}>
                                                    <span className="ai-dot-subtle" />
                                                    <span className="ai-dot-subtle" />
                                                    <span className="ai-dot-subtle" />
                                                </span>
                                                <span className={`shrink-0 text-[10px] leading-none ${act.status === 'running' ? 'text-transparent' : act.status === 'done' ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                                                    {act.status === 'running' ? '' : act.status === 'done' ? '✓' : '✕'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <AILoadingIndicator
                                        status={aiLoading.status}
                                        operation={currentOperation}
                                        prompt={lastUserMessage || undefined}
                                        fileName={activeFileMeta?.name || undefined}
                                        activeTool={(() => { const a = agentActivities.find(x => x.status === 'running'); return a ? { name: a.tool, target: a.path, label: a.message } as any : null; })()}
                                        hasSelection={!!getActiveEditorContext()?.selectionText}
                                        variant="chat"
                                    />
                                )}
                            </div>
                        </div>
                    )}
                    {/* Premium change summary — Azemax workspace */}
                    {lastDiffs.length > 0 && (
                        <div className="rounded-[10px] border border-white/[0.06] bg-[#151A24] overflow-hidden shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_4px_12px_rgba(0,0,0,0.14)]">
                            {/* Summary header */}
                            <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-7 h-7 rounded-[7px] bg-[rgba(46,160,67,0.09)] border border-[rgba(46,160,67,0.14)] flex items-center justify-center shrink-0">
                                        <FileCode size={13} strokeWidth={1.75} className="text-emerald-300/80" />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-[12.5px] font-medium tracking-tight leading-none" style={{ color: 'var(--az-text)' }}>
                                            {lastDiffs.length} file{lastDiffs.length !== 1 ? 's' : ''} changed
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[11px] font-mono font-medium tracking-tight text-emerald-400/75">+{lastDiffs.reduce((a, d) => a + d.added, 0)}</span>
                                            <span className="text-[11px] font-mono font-medium tracking-tight text-red-400/65">-{lastDiffs.reduce((a, d) => a + d.removed, 0)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="hidden sm:flex items-center text-[var(--az-text-faint)] opacity-40">
                                        <ChevronRight size={14} strokeWidth={1.75} />
                                    </span>
                                    <button
                                        onClick={() => {
                                            const first = lastDiffs[0];
                                            if (!first) return;
                                            const find = (nodes: ReturnType<typeof getFileTree>, target: string): unknown => {
                                                for (const n of nodes) {
                                                    if (n.name === target) return n;
                                                    // @ts-ignore
                                                    if (n.children) { const f = find(n.children as never, target); if (f) return f; }
                                                }
                                                return null;
                                            };
                                            const node = find(getFileTree(), first.file) as { id: string; name: string } | null;
                                            if (node) {
                                                const fromTree = getFileTree().find(n => n.id === node.id) || node;
                                                // @ts-ignore
                                                setActiveFile(fromTree as never);
                                            }
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[11px] font-medium bg-white/[0.04] border border-white/[0.07] text-[var(--az-text-secondary)] hover:bg-white/[0.07] hover:border-white/[0.10] hover:text-[var(--az-text)] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                    >
                                        <Eye size={11} strokeWidth={1.75} />
                                        Review
                                    </button>
                                </div>
                            </div>
                            {/* Per-file rows — subtle tonal separation */}
                            <div className="border-t border-white/[0.05] bg-[rgba(255,255,255,0.01)]">
                                {lastDiffs.map(d => (
                                    <div key={d.file} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-b-0 border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="w-5 h-5 rounded-[5px] bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                                                <FileCode size={11} strokeWidth={1.75} className="text-[var(--az-text-muted)]" />
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-[12.5px] font-[450] tracking-tight truncate" style={{ color: 'var(--az-text-secondary)' }}>{d.file}</div>
                                                <div className="text-[11px] truncate" style={{ color: 'var(--az-text-faint)' }}>{d.summary}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px]">
                                                <span className="text-emerald-400/70">+{d.added}</span>
                                                {d.removed > 0 && <span className="text-red-400/60">-{d.removed}</span>}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const find = (nodes: ReturnType<typeof getFileTree>, target: string): unknown => {
                                                        for (const n of nodes) {
                                                            if (n.name === target) return n;
                                                            // @ts-ignore
                                                            if (n.children) { const f = find(n.children as never, target); if (f) return f; }
                                                        }
                                                        return null;
                                                    };
                                                    const node = find(getFileTree(), d.file) as { id: string; name: string } | null;
                                                    if (node) {
                                                        const fromTree = getFileTree().find(n => n.id === node.id) || node;
                                                        // @ts-ignore
                                                        setActiveFile(fromTree as never);
                                                    }
                                                }}
                                                className="px-2 py-1 rounded-[5px] text-[11px] font-medium text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                                            >
                                                Open
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Scroll to Bottom Button — sticky above composer */}
                <button
                    onClick={handleScrollToBottom}
                    className={`ai-scroll-btn ${showScrollButton ? 'visible' : ''} group/scroll-btn`}
                    aria-label="Scroll to bottom"
                >
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-black/80 backdrop-blur-sm border border-[var(--az-border)] shadow-md transition-all duration-200 hover:scale-105 hover:bg-black hover:border-white/30">
                        <ChevronUp size={18} className="rotate-180 text-[var(--az-text-secondary)] group-hover/scroll-btn:text-white transition-colors" />
                    </div>
                </button>

                {/* Composer — sticky, anchored, premium floating */}
                {/* Composer — sticky premium command center, soft hairline separation */}
                <div className="shrink-0 px-4 pb-3 pt-2.5 z-10" style={{ background: '#0F1115', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="mx-auto w-full max-w-[640px]">
                        <AIComposer
                            input={input}
                            setInput={setInput}
                            onSend={handleSend}
                            onStop={handleStop}
                            isLoading={isLoading}
                            inputRef={inputRef}
                            disabled={!settings.ai.enabled}
                        />
                    </div>
                </div>

                {/* Apple Intelligence Animations */}
                <style>{`
                /* Fade in animation */
                @keyframes fade-in {
                    from { opacity: 0; transform: scale(0.96); }
                    to { opacity: 1; transform: scale(1); }
                }
                .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }

                /* Fade Up Stagger */
                @keyframes fade-in-up {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-up { animation: fade-in-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
                .delay-100 { animation-delay: 100ms; }
                .delay-200 { animation-delay: 200ms; }
                .delay-300 { animation-delay: 300ms; }
                .pause { animation-play-state: paused; }

                /* Float Animation */
                @keyframes float-slow {
                    0%, 100% { transform: translateY(0px) scale(1); }
                    50% { transform: translateY(-10px) scale(1.02); }
                }
                .animate-float-slow { animation: float-slow 6s ease-in-out infinite; }

                /* Message appear animation */
                @keyframes message-appear {
                    from { 
                        opacity: 0; 
                        transform: translateY(12px); 
                    }
                    to { 
                        opacity: 1; 
                        transform: translateY(0); 
                    }
                }
                .message-appear { animation: message-appear 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

                /* Pulse slow for ambient effects */
                @keyframes pulse-slow {
                    0%, 100% { opacity: 0.4; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.05); }
                }
                .animate-pulse-slow { animation: pulse-slow 4s ease-in-out infinite; }

                /* Glow pulse for orb */
                @keyframes glow-pulse {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 0.8; transform: scale(1.1); }
                }
                .animate-glow-pulse { animation: glow-pulse 3s ease-in-out infinite; }

                /* Animated Gradient for Apple Glow */
                @keyframes gradient-xy {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .animate-gradient-xy { animation: gradient-xy 3s ease infinite; }
                
                /* Fast Shimmer */
                @keyframes shimmer-fast {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-shimmer-fast { animation: shimmer-fast 1.5s ease-in-out infinite; }

                /* Spin slow */
                @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow { animation: spin-slow 8s linear infinite; }

                /* Spin Slower for Logo */
                @keyframes spin-slower {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slower { animation: spin-slower 12s linear infinite; }

                /* Spin Reverse for Logo */
                @keyframes spin-reverse {
                    from { transform: rotate(360deg); }
                    to { transform: rotate(0deg); }
                }
                .animate-spin-reverse { animation: spin-reverse 15s linear infinite; }


                /* Subtle breathing */
                @keyframes subtle-breathing {
                    0%, 100% { transform: scale(1); opacity: 0.9; }
                    50% { transform: scale(1.05); opacity: 1; }
                }
                .animate-subtle-breathing { animation: subtle-breathing 4s ease-in-out infinite; }

                /* Neural Stream */
                @keyframes neural-stream {
                    0% { transform: translateX(-150%); opacity: 0; }
                    50% { opacity: 1; }
                    100% { transform: translateX(250%); opacity: 0; }
                }
                .animate-neural-stream { animation: neural-stream 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite; }

                /* Fluid Wave Animation */
                @keyframes wave {
                    0%, 100% { transform: translateY(0); opacity: 0.6; }
                    50% { transform: translateY(-4px); opacity: 1; }
                }
                .animate-wave-1 { animation: wave 1.2s ease-in-out infinite; }
                .animate-wave-2 { animation: wave 1.2s ease-in-out infinite 0.2s; }
                .animate-wave-3 { animation: wave 1.2s ease-in-out infinite 0.4s; }

                /* Typing dots animation (Legacy - kept for reference if needed elsewhere) */
                @keyframes typing-dot {
                    0%, 100% { transform: translateY(0) scale(1); opacity: 0.5; }
                    50% { transform: translateY(-5px) scale(1.1); opacity: 1; }
                }
                .animate-typing-dot-1 { animation: typing-dot 1.2s ease-in-out infinite; }
                .animate-typing-dot-2 { animation: typing-dot 1.2s ease-in-out infinite 0.15s; }
                .animate-typing-dot-3 { animation: typing-dot 1.2s ease-in-out infinite 0.3s; }

                /* Cursor blink animation */
                @keyframes cursor-blink {
                    0%, 45% { opacity: 1; }
                    50%, 100% { opacity: 0; }
                }
                .animate-cursor-blink { animation: cursor-blink 1s ease-in-out infinite; }

                /* Sparkle animation */
                @keyframes sparkle {
                    0%, 100% { transform: scale(1) rotate(0deg); }
                    25% { transform: scale(1.15) rotate(5deg); }
                    50% { transform: scale(0.95) rotate(-5deg); }
                    75% { transform: scale(1.05) rotate(3deg); }
                }
                .animate-sparkle { animation: sparkle 2s ease-in-out infinite; }

                /* Animated gradient border rotation */
                @keyframes gradient-rotate {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .animate-gradient-rotate { animation: gradient-rotate 3s ease infinite; }

                /* Shimmer flow effect */
                @keyframes shimmer-flow {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-shimmer-flow { animation: shimmer-flow 2s ease-in-out infinite; }

                /* Gradient shift for button */
                @keyframes gradient-shift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .animate-gradient-shift { animation: gradient-shift 2s ease infinite; }

                /* Pulse glow for input focus */
                @keyframes pulse-glow {
                    0%, 100% { opacity: 0.4; transform: scale(0.98); }
                    50% { opacity: 0.6; transform: scale(1.02); }
                }
                .animate-pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }

                /* Gentle pulse - lightweight for loading states */
                @keyframes pulse-gentle {
                    0%, 100% { opacity: 0.6; }
                    50% { opacity: 1; }
                }
                .animate-pulse-gentle { animation: pulse-gentle 2s ease-in-out infinite; }

                /* Loading bar - smooth left-to-right animation */
                @keyframes loading-bar {
                    0% { transform: translateX(-100%); }
                    50% { transform: translateX(0%); }
                    100% { transform: translateX(100%); }
                }
                .animate-loading-bar { animation: loading-bar 1.5s ease-in-out infinite; }

                /* Streaming message - no animation to prevent jitter */
                .streaming-message { animation: none; }

                /* Sparkle particles */
                @keyframes sparkle-particle {
                    0%, 100% { opacity: 0; transform: scale(0) translate(0, 0); }
                    50% { opacity: 1; transform: scale(1) translate(2px, -2px); }
                }
                .animate-sparkle-particle-1 { animation: sparkle-particle 1.5s ease-in-out infinite; }
                .animate-sparkle-particle-2 { animation: sparkle-particle 1.5s ease-in-out infinite 0.3s; }
                .animate-sparkle-particle-3 { animation: sparkle-particle 1.5s ease-in-out infinite 0.6s; }

                /* Custom scrollbar */
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 3px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.15);
                }
            `}</style>
            </div>
        </div >
    );
};


