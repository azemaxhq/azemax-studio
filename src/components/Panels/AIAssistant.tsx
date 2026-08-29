import React, { useState, useRef, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import {
    Check, Edit3, RefreshCw, Zap, Bug, MessageCircle, Code2, Copy,
    Plus, MessageSquare, Trash2, X, History, ChevronUp,
    ThumbsUp, ThumbsDown, FileCode, Lightbulb, ChevronDown
} from 'lucide-react';

import { loadPrism, tryHighlight } from '../../utils/prismLoader';
import { MarkdownRenderer } from './MarkdownRenderer';
import { getActiveEditorContext } from '../../core/editor/activeEditorStore';
import { buildWorkspaceSnapshot } from '../../core/workspace/workspaceContext';
import { useAILoading } from '../../hooks/useAILoading';
import { AILoadingIndicator } from '../AI/AILoadingIndicator';
import { AIStreamingIndicator } from '../AI/AIStreamingIndicator';
import { SmoothStreamingBubble } from '../AI/SmoothStreamingBubble';
import { AIComposer } from './AIComposer';
import '../AI/ai-loading.css';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
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

    return (
        <div className="my-3 rounded-xl border border-[var(--az-border)] bg-[var(--az-surface-2)] overflow-hidden">
            <div
                className="flex items-center justify-between px-3 py-2.5 hover:bg-[var(--az-surface-2)] cursor-pointer transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-6 h-6 rounded-md bg-[var(--az-surface-3)] border border-[var(--az-border)] flex items-center justify-center shrink-0">
                        {getIcon()}
                    </span>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[var(--az-text)] truncate">{title}</span>
                            <span className="hidden sm:inline text-[11px] text-[var(--az-text-faint)]">· {isCode ? `${lineCount} lines` : type}</span>
                        </div>
                        {isCode && language && <span className="text-[11px] text-[var(--az-text-faint)] hidden sm:block">{language}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); onCopy?.(content, id); }}
                        className="px-2 py-1 rounded-md text-[11px] text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-3)] transition-colors"
                    >
                        {copiedId === id ? 'Copied' : 'Copy'}
                    </button>
                    <span className={`w-6 h-6 rounded-md bg-[var(--az-surface-3)] hover:bg-white/[0.08] flex items-center justify-center text-[var(--az-text-muted)] transition-colors ${isExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDown size={14} />
                    </span>
                </div>
            </div>
            {isExpanded && (
                <div className="border-t border-[var(--az-border)] bg-[var(--az-surface)]">
                    <pre className="p-3 text-[12.5px] font-mono overflow-x-auto custom-scrollbar text-[var(--az-text-secondary)] leading-relaxed max-h-[320px] overflow-y-auto">
                        {highlightedCode
                            ? <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                            : <code>{content}</code>}
                    </pre>
                </div>
            )}
            {!isExpanded && isCode && lineCount > 12 && (
                <div className="px-3 pb-2">
                    <button onClick={() => setIsExpanded(true)} className="text-[11px] text-[var(--az-text-faint)] hover:text-[var(--az-text-muted)] transition-colors">Show {lineCount - 12} more lines</button>
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
            if (!inline && match) {
                // Syntax Highlighting — skip during streaming (heavy, causes jank)
                const highlightedCode = prismReady && !isStreaming ? tryHighlight(code, language) : null;
                const displayCode = !expanded ? code.split('\n').slice(0, 20).join('\n') : code;

                return (
                    <div className="my-3 rounded-xl overflow-hidden border border-[var(--az-border)] bg-[var(--az-surface-2)]">
                        <div className="flex items-center justify-between px-3 py-2 bg-[var(--az-surface-2)] border-b border-[var(--az-border)]">
                            <span className="text-[11px] text-[var(--az-text-muted)] font-mono">{language}</span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => onCopy(displayCode, codeId)}
                                    className="px-2 py-1 rounded-md text-[11px] text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-3)] transition-colors"
                                >
                                    {copiedId === codeId ? 'Copied' : 'Copy'}
                                </button>
                                {msg.role === 'ai' && onApplyCode && (
                                    <button
                                        onClick={() => onApplyCode(code)}
                                        className="px-2 py-1 rounded-md text-[11px] bg-[var(--az-accent)] text-white hover:bg-[var(--az-accent-hover)] border border-[var(--az-accent)] transition-colors"
                                    >
                                        Apply
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="relative">
                            <pre className="p-3 text-[12.5px] font-mono overflow-x-auto custom-scrollbar text-[var(--az-text-secondary)] leading-relaxed bg-[var(--az-surface)] max-h-[360px] overflow-y-auto">
                                {highlightedCode && expanded
                                    ? <code dangerouslySetInnerHTML={{ __html: isLongBlock && !expanded ? tryHighlight(displayCode, language) || '' : highlightedCode }} />
                                    : <code>{displayCode}</code>}
                            </pre>
                            {isLongBlock && !expanded && (
                                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--az-surface)] to-transparent pointer-events-none" />
                            )}
                        </div>
                        {isLongBlock && (
                            <button onClick={() => setExpanded(!expanded)} className="w-full px-3 py-2 text-[11px] text-[var(--az-text-faint)] hover:text-[var(--az-text-muted)] hover:bg-[var(--az-surface-2)] border-t border-[var(--az-border)] transition-colors">
                                {expanded ? 'Show less' : `Show ${code.split('\n').length - 20} more lines`}
                            </button>
                        )}
                    </div>
                );
            }
            // Inline code - ChatGPT style (subtle)
            return (
                <code
                    className="text-[14px] font-mono bg-[var(--az-surface-3)] text-[var(--az-text)] border border-[var(--az-border)] px-1 py-0.5 rounded"
                    {...props}
                >
                    {children}
                </code>
            );
        },
        h1({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h1 className="text-[18px] font-semibold tracking-tight text-[var(--az-text)] mt-6 mb-3" {...props}>{children}</h1>;
        },
        h2({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h2 className="text-[15px] font-semibold tracking-tight text-[var(--az-text)] mt-5 mb-2" {...props}>{children}</h2>;
        },
        h3({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h3 className="text-[13px] font-medium tracking-wide text-white/75 mt-4 mb-2 uppercase" {...props}>{children}</h3>;
        },
        p({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
            return <p className="leading-[1.65] mb-3 text-[14px] text-[var(--az-text-secondary)] tracking-[-0.01em] last:mb-0" {...props}>{children}</p>;
        },
        ul({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
            return <ul className="list-disc list-outside ml-5 mb-3 space-y-1.5 text-[14px] text-[var(--az-text-secondary)]" {...props}>{children}</ul>;
        },
        ol({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) {
            return <ol className="list-decimal list-outside ml-5 mb-3 space-y-1.5 text-[14px] text-[var(--az-text-secondary)]" {...props}>{children}</ol>;
        },
        li({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) {
            return <li className="pl-1 leading-[1.6] marker:text-white/20" {...props}>{children}</li>;
        },
        blockquote({ children, ...props }: React.QuoteHTMLAttributes<HTMLQuoteElement>) {
            return (
                <blockquote className="border-l border-[var(--az-border)] pl-3 py-1 my-3 text-[13px] text-[var(--az-text-muted)] leading-relaxed" {...props}>
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
        <div className={`flex w-full message-appear ${msg.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
            <div className={`flex flex-col min-w-0 ${msg.role === 'ai' ? 'w-full max-w-full' : 'items-end max-w-[78%] ml-auto'}`}>
                {isEditing ? (
                    <div className="w-full space-y-3 p-3 rounded-[12px] border" style={{ background: '#171A20', borderColor: 'rgba(255,255,255,0.07)' }}>
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-2.5 rounded-[8px] text-[13px] resize-none focus:outline-none"
                            style={{ background: '#101217', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text)' }}
                            rows={3}
                        />
                        <div className="flex gap-1.5 justify-end">
                            <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors" style={{ color: 'var(--az-text-muted)' }}>Cancel</button>
                            <button onClick={() => onSaveEdit(msg.id)} className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors" style={{ background: 'var(--az-text)', color: '#0B0D10' }}>Save</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className={`group relative break-words ${msg.role === 'ai'
                            ? 'w-full bg-transparent'
                            : 'px-3.5 py-2 rounded-[14px] rounded-br-[4px] border max-w-full'
                            }`} style={msg.role !== 'ai' ? { background: '#1E232B', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--az-text)' } : undefined}>

                            {msg.role === 'ai' && (
                                <div className="flex items-center gap-1.5 mb-2">
                                    <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[9px] font-bold tracking-tight" style={{ background: '#171A20', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text-muted)' }}>A</span>
                                    <span className="text-[11px] font-medium" style={{ color: 'var(--az-text-muted)' }}>Azemax</span>
                                </div>
                            )}
                            <div className={`markdown-content relative z-10 ${msg.role === 'ai' ? 'text-[13.5px] leading-[1.7] text-[var(--az-text-secondary)]' : 'text-[13.5px] leading-relaxed'}`}>
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
                                <div className="flex items-center gap-1 mt-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                                    <button
                                        onClick={() => onCopy(msg.text, `msg-${msg.id}`)}
                                        className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--az-surface-3)]"
                                        style={{ color: 'var(--az-text-muted)', border: '1px solid transparent' }}
                                        title={copiedId === `msg-${msg.id}` ? 'Copied' : 'Copy'}
                                        aria-label="Copy"
                                    >
                                        {copiedId === `msg-${msg.id}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                    </button>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => typeof index === 'number' && onRegenerate(index)}
                                            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--az-surface-3)]"
                                            style={{ color: 'var(--az-text-muted)' }}
                                            title="Regenerate"
                                            aria-label="Regenerate"
                                        >
                                            <RefreshCw size={12} />
                                        </button>
                                    )}
                                    {onReaction && (
                                        <>
                                            <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />
                                            <button
                                                onClick={() => onReaction(msg.id, 'up')}
                                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--az-surface-3)] ${reaction === 'up' ? 'text-emerald-400' : ''}`}
                                                style={{ color: reaction === 'up' ? undefined : 'var(--az-text-muted)' }}
                                                title="Helpful"
                                                aria-label="Helpful"
                                            >
                                                <ThumbsUp size={12} />
                                            </button>
                                            <button
                                                onClick={() => onReaction(msg.id, 'down')}
                                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--az-surface-3)] ${reaction === 'down' ? 'text-red-400' : ''}`}
                                                style={{ color: reaction === 'down' ? undefined : 'var(--az-text-muted)' }}
                                                title="Not helpful"
                                                aria-label="Not helpful"
                                            >
                                                <ThumbsDown size={12} />
                                            </button>
                                        </>
                                    )}
                                    {copiedId === `msg-${msg.id}` && <span className="text-[10px] ml-1" style={{ color: 'var(--az-text-muted)' }}>Copied</span>}
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
                            <span className={`text-[10px] font-normal mt-1 px-1 transition-opacity duration-150 ${msg.role === 'ai' ? 'opacity-60 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100 text-right self-end'}`} style={{ color: 'var(--az-text-faint)' }}>
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
    // Session State
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // Centralized AI loading lifecycle — single source via AIRequestStore (chat operation)
    // Keep current user-facing operation for contextual status (Adding comments… vs Preparing response…)
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
        const newSession = createSession();
        setSessions(prev => {
            const updated = [newSession, ...prev];
            if (settings.privacy.localPersistence && settings.privacy.saveChatHistory) {
                saveSessions(updated);
            }
            return updated;
        });
        setCurrentSessionId(newSession.id);
        setStreamingText('');
        setAgentActivities([]);
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

    const handleApplyCode = useCallback(async (code: string) => {
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
        }
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

        // Build fresh context at request time (Monaco-first, never cached)
        const activeFile = getActiveFile();
        const fileTree = getFileTree();
        const editorCtx = getActiveEditorContext();
        const fileContent = editorCtx?.code ?? activeFile?.content ?? '';
        const fileName = editorCtx?.fileName ?? activeFile?.name ?? '';
        const language = editorCtx?.language ?? 'plaintext';

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
                const semanticPlan = await generateSemanticPlan(
                    userMessageText,
                    editorCtx,
                    buildWorkspaceSnapshot(editorCtx, fileTree).fileTreeString,
                    historyForPipeline,
                    abortController.signal
                );
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
                const result = await runAgentController({
                    userMessage: userMessageText,
                    workspace: { getFileTree, createFile, deleteNode, renameNode, updateFileContent, setActiveFile } as unknown as import('../../core/editor/workspaceBridge').WorkspaceBridgeActions & { setActiveFile?: unknown },
                    fileName: fileName || null,
                    fileId: activeFile?.id ?? null,
                    history: historyForPipeline,
                    signal: abortController.signal,
                    onActivity: (act) => {
                        setAgentActivities(prev => {
                            const idx = prev.findIndex(a => a.id === act.id);
                            if (idx >= 0) { const next = [...prev]; next[idx] = act; return next; }
                            // also collapse running->done for same tool+path
                            return [...prev, act].slice(-12);
                        });
                        // Drive loading states: interpreting→gathering→executing→verifying
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
                const fileContext = isCodeRelated && fileContent && fileContent.length > 10
                    ? `File: ${fileName} (${language}, ${fileContent.split('\n').length} lines)\n\`\`\`${language}\n${fileContent.slice(0, 6000)}\n\`\`\`\nTree: ${buildWorkspaceSnapshot(getActiveEditorContext(), fileTree).fileTreeString.slice(0, 1500)}\n\nQ: "${userMessageText}"`
                    : isCodeRelated && fileName
                        ? `File: ${fileName} (${language}) | Q: "${userMessageText}" | Tree: ${buildWorkspaceSnapshot(getActiveEditorContext(), fileTree).fileTreeString.slice(0, 1500)}`
                        : userMessageText;

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
                const code = error?.code as string | undefined;
                let friendlyError: string;
                if (code === AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR || error?.message?.includes('No AI providers are configured')) {
                    friendlyError = 'No AI providers are configured. Add NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or HF_TOKEN to .env and restart the server. Deterministic tasks like “Remove comments” and “/// hello world” work offline.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR || error?.message?.includes('API key') || error?.message?.includes('auth')) {
                    friendlyError = 'AI provider authentication failed. Please check your API keys in .env / settings.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED) {
                    friendlyError = 'AI is rate-limited. Please wait a moment and try again.';
                } else if (code === AI_ERROR_CODES.AI_PROVIDER_TIMEOUT) {
                    friendlyError = 'AI request timed out. The provider was slow — please try again.';
                } else if (code === AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED || error?.message?.includes('unavailable')) {
                    friendlyError = 'AI is temporarily unavailable. Please try again in a moment.';
                } else {
                    friendlyError = error?.message ? String(error.message).slice(0, 300) : "I'm sorry, I encountered an error. Please try again.";
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
            if (aiLoading.status !== 'success' && aiLoading.status !== 'error' && aiLoading.status !== 'idle') {
                aiLoading.stop();
            }
            setStreamingText('');
            abortControllerRef.current = null;
            currentRequestIdRef.current = null;
        }
    }, [input, sessions, currentSessionId, aiLoading, handleNewChat, settings, getActiveFile, getFileTree]);

    handleSendRef.current = handleSend;

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
        <div className="flex flex-col h-full w-full relative overflow-hidden min-h-0" style={{ background: "#101217" }}>

            {/* Subtle depth — no gradients */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'transparent' }} />

            {/* Sidebar (History) - Liquid Glass Style */}
            <div
                className={`
                    absolute top-0 left-0 z-30 h-full w-64
                    ${showSidebar
                        ? 'translate-x-0 opacity-100 scale-100'
                        : '-translate-x-full opacity-0 scale-[0.98]'
                    }
                `}
                style={{
                    transition: 'transform 200ms ease-out, opacity 180ms ease-out',
                    transformOrigin: 'left center'
                }}
            >
                <div className="flex flex-col h-full border-r" style={{ background: "#101217", borderColor: "rgba(255,255,255,0.07)" }}>
                    {/* Sidebar Header */}
                    <div className="h-12 shrink-0 flex items-center justify-between px-3 border-b border-[var(--az-border)]/40 bg-[var(--az-surface-2)]/50">
                        <button
                            onClick={() => { handleNewChat(); setShowSidebar(false); }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[#21262d] text-[var(--az-text)]/80 hover:text-[var(--az-text)] text-sm font-medium transition-all duration-200"
                        >
                            <Plus size={16} className="text-[#58a6ff]" />
                            New chat
                        </button>
                        <button
                            onClick={() => setShowSidebar(false)}
                            className="p-1.5 hover:bg-[#21262d] rounded-lg text-[var(--az-text-muted)] hover:text-[var(--az-text)] transition-colors duration-200"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Search Bar */}
                    <div className="px-2 py-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search conversations..."
                                className="w-full px-3 py-2 pl-9 text-sm bg-[var(--az-surface)] border border-[var(--az-border)]/60 rounded-lg text-[var(--az-text)] placeholder-[#8b949e]/50 focus:outline-none focus:border-[#58a6ff]/50 focus:ring-1 focus:ring-[#58a6ff]/20 transition-all duration-200"
                                onChange={(e) => {
                                    const searchTerm = e.target.value.toLowerCase();
                                    document.querySelectorAll('[data-session-title]').forEach((el) => {
                                        const title = el.getAttribute('data-session-title')?.toLowerCase() || '';
                                        (el as HTMLElement).style.display = title.includes(searchTerm) ? '' : 'none';
                                    });
                                }}
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--az-text-muted)]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Sessions List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
                        {sessions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                                <MessageSquare size={24} className="text-[var(--az-text-muted)]/30 mb-3" />
                                <p className="text-sm text-[var(--az-text-muted)]/60">No conversations yet</p>
                            </div>
                        ) : (() => {
                            // Group sessions by time period
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
                                <div key={group.label} className="mb-4">
                                    {/* Group Label */}
                                    <div className="px-2 py-1.5">
                                        <span className="text-[11px] font-semibold text-[var(--az-text-muted)]/60 uppercase tracking-wider">{group.label}</span>
                                    </div>

                                    {/* Sessions in Group */}
                                    {group.sessions.map(session => {
                                        const isActive = currentSessionId === session.id;

                                        return (
                                            <div
                                                key={session.id}
                                                data-session-title={session.title || 'New Chat'}
                                                onClick={() => handleSelectSession(session.id)}
                                                className={`group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200 mb-0.5
                                                    ${isActive
                                                        ? 'bg-[#21262d] border-l-2 border-[#58a6ff]'
                                                        : 'hover:bg-[#21262d]/50 border-l-2 border-transparent'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2.5 pr-12">
                                                    <MessageSquare size={14} className={`shrink-0 ${isActive ? 'text-[#58a6ff]' : 'text-[var(--az-text-muted)]/50'}`} />
                                                    <span className={`text-[13px] truncate ${isActive ? 'text-[var(--az-text)]' : 'text-[var(--az-text-muted)]'}`}>
                                                        {session.title || 'New Chat'}
                                                    </span>
                                                </div>

                                                {/* Hover Actions */}
                                                <div className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-[#21262d] rounded-md px-0.5 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-150`}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const newTitle = prompt('Rename:', session.title || 'New Chat');
                                                            if (newTitle !== null && newTitle.trim()) {
                                                                setSessions(prev => prev.map(s =>
                                                                    s.id === session.id ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s
                                                                ));
                                                            }
                                                        }}
                                                        className="p-1.5 rounded-md hover:bg-[#30363d] text-[var(--az-text-muted)] hover:text-[var(--az-text)] transition-colors"
                                                        title="Rename"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                                        className="p-1.5 rounded-md hover:bg-red-500/20 text-[var(--az-text-muted)] hover:text-red-400 transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ));
                        })()}
                    </div>

                    {/* Sidebar Footer */}
                    <div className="px-3 py-2.5 border-t border-[var(--az-border)]/40 bg-[var(--az-surface)]/50">
                        <div className="flex items-center justify-between text-[11px]">
                            <span className="text-[var(--az-text-muted)]/60">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</span>
                            <button
                                onClick={() => {
                                    const doClear = () => {
                                        setSessions([]);
                                        saveSessions([]);
                                        handleNewChat();
                                    };
                                    if (settings.ai.confirmClearConversation) {
                                        if (confirm('Clear all conversations?')) doClear();
                                    } else {
                                        doClear();
                                    }
                                }}
                                className="text-[var(--az-text-muted)]/60 hover:text-red-400 transition-colors duration-200"
                            >
                                Clear all
                            </button>
                        </div>
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
                {/* Header — compact premium toolbar */}
                <div className="h-10 shrink-0 flex items-center justify-between px-2.5 border-b z-20" style={{ background: '#101217', borderColor: 'rgba(255,255,255,0.07)' }}>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setShowSidebar(!showSidebar)}
                            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                            style={{ color: showSidebar ? 'var(--az-text)' : 'var(--az-text-muted)', background: showSidebar ? 'var(--az-surface-3)' : 'transparent', border: showSidebar ? '1px solid var(--az-border)' : '1px solid transparent' }}
                            title="Chat history"
                            aria-label="Toggle history"
                        >
                            <History size={14} strokeWidth={1.75} />
                        </button>
                        <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />
                        <span className="hidden sm:inline text-[11px] font-medium tracking-wide uppercase" style={{ color: 'var(--az-text-muted)' }}>Azemax</span>
                    </div>

                    <button
                        onClick={() => {
                            if (!currentSessionId) return;
                            const session = sessions.find(s => s.id === currentSessionId);
                            const currentTitle = session?.title || 'New Chat';
                            const newTitle = prompt('Rename chat:', currentTitle);
                            if (newTitle != null && newTitle.trim() !== '') {
                                setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s));
                            }
                        }}
                        className="flex-1 min-w-0 mx-3 px-2 py-1 rounded-md text-[12.5px] font-medium truncate text-center transition-colors hover:bg-[var(--az-surface-3)]"
                        style={{ color: 'var(--az-text-secondary)' }}
                        title={`${currentSession?.title || 'New Chat'} — Click to rename`}
                    >
                        <span className="truncate">{currentSession?.title || 'New Chat'}</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                        {activeFileMeta && (
                            <span className="hidden lg:inline-flex items-center max-w-[120px] truncate text-[11px] px-2 py-1 rounded-full" style={{ background: '#171A20', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text-muted)' }}>
                                {activeFileMeta.name}
                            </span>
                        )}
                        <button
                            onClick={handleNewChat}
                            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--az-surface-3)]"
                            style={{ color: 'var(--az-text-muted)', border: '1px solid transparent' }}
                            title="New chat"
                            aria-label="New chat"
                        >
                            <Plus size={14} strokeWidth={1.75} />
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
                    className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar w-full ${messages.length > 0 || streamingText ? 'pb-32' : ''}`}
                    style={{ overflowAnchor: 'auto' }}
                >
                    <div className="mx-auto w-full max-w-[640px] px-3.5 pt-5 pb-6 space-y-5">
                    {messages.length === 0 && !streamingText && settings.general.showWelcomeScreen ? (
                        <div className="flex flex-col items-center justify-center px-6 py-10 text-center animate-fade-in-up w-full max-w-[360px] mx-auto">
                            <div className="mb-4 opacity-90">
                                <AzemaxLogo size={28} />
                            </div>
                            <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--az-text)' }}>Azemax</h3>
                            <p className="text-[14px] font-medium tracking-tight mt-0.5" style={{ color: 'var(--az-text)' }}>What are you building?</p>
                            <p className="text-[12px] leading-relaxed mt-2 max-w-[280px]" style={{ color: 'var(--az-text-muted)' }}>
                                Ask about your code, files, errors, architecture or let Azemax make changes for you.
                            </p>
                            <div className="grid grid-cols-2 gap-2 mt-6 w-full">
                                {QUICK_ACTIONS.map((action) => (
                                    <button
                                        key={action.label}
                                        onClick={() => handleQuickAction(action.prompt)}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium transition-colors"
                                        style={{ background: '#15181E', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--az-text-secondary)' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = '#1C2026'; e.currentTarget.style.color = 'var(--az-text)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = '#15181E'; e.currentTarget.style.color = 'var(--az-text-secondary)'; }}
                                    >
                                        <action.icon size={13} strokeWidth={1.75} style={{ opacity: 0.7 }} />
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

                            {/* Premium smooth streaming — 60fps, rAF coalesced, no layout jump */}
                            {(streamingText || (isLoading && !streamingText)) && (
                                <div className="ai-response-container w-full flex gap-4" style={{ contain: 'layout paint' }}>
                                    <div className="flex-1 min-w-0">
                                        <div className="w-full bg-transparent">
                                            <SmoothStreamingBubble
                                                text={streamingText}
                                                isStreaming={aiLoading.status === 'streaming' || aiLoading.status === 'generating'}
                                            />
                                            {/* Inline caret only when streaming has content */}
                                            {streamingText && (aiLoading.status === 'streaming' || aiLoading.status === 'generating') && (
                                                <div className="pl-1 pt-1 flex items-center gap-1 opacity-60">
                                                    <AIStreamingIndicator active />
                                                    <span className="text-[11px] text-[var(--az-text-muted)]">Writing…</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Premium centralized AI loading — contextual operation, hidden when streaming has content to avoid duplicate */}
                    {(aiLoading.status === 'thinking' || aiLoading.status === 'preparing' || aiLoading.status === 'applying' || (aiLoading.status === 'generating' && !streamingText)) && (
                        <div className="pl-2 py-2 message-appear ai-response-container">
                            <AILoadingIndicator status={aiLoading.status} operation={currentOperation} variant="chat" />
                        </div>
                    )}
                    {/* Subtle AI activity — minimal, quiet */}
                    {agentActivities.length > 0 && (
                        <div className="px-1 py-1 space-y-0.5">
                            {agentActivities.slice(-4).map(act => (
                                <div key={act.id} className="flex items-center gap-2 px-2 py-1 text-[11px] leading-none transition-opacity duration-200" style={{ contain: 'layout paint' }}>
                                    <span className={`shrink-0 text-[11px] ${act.status === 'running' ? 'text-[var(--az-text-faint)] animate-pulse' : act.status === 'done' ? 'text-emerald-300/60' : 'text-red-300/60'}`}>
                                        {act.status === 'running' ? '◌' : act.status === 'done' ? '✓' : '✕'}
                                    </span>
                                    <span className={`truncate ${act.status === 'running' ? 'text-white/45' : 'text-white/35'}`}>{act.message}</span>
                                    {act.path && <span className="ml-auto shrink-0 text-[10px] text-white/20 truncate max-w-[120px]">{act.path}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {/* Premium diff artifacts — compact */}
                    {lastDiffs.length > 0 && (
                        <div className="px-1 py-1 space-y-2">
                            {lastDiffs.map(d => (
                                <div key={d.file} className="rounded-xl border border-[var(--az-border)] bg-[var(--az-surface-2)] overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center text-emerald-300/70 shrink-0">✓</span>
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-medium text-[var(--az-text-secondary)] truncate">{d.file}</div>
                                                <div className="text-[11px] text-[var(--az-text-faint)]">{d.summary}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className="text-[11px] text-emerald-300/60">+{d.added}</span>
                                            {d.removed > 0 && <span className="text-[11px] text-red-300/60">-{d.removed}</span>}
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
                                                        // Use setActiveFile via workspaceBridgeActions
                                                        const fromTree = getFileTree().find(n => n.id === node.id) || node;
                                                        // @ts-ignore
                                                        setActiveFile(fromTree as never);
                                                    }
                                                }}
                                                className="px-2 py-1 rounded-md text-[11px] text-[var(--az-text-muted)] hover:text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-3)] transition-colors"
                                            >
                                                Open
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Scroll to Bottom Button */}
                <button
                    onClick={handleScrollToBottom}
                    className={`ai-scroll-btn ${showScrollButton ? 'visible' : ''} group/scroll-btn`}
                    aria-label="Scroll to bottom"
                >
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-black/80 backdrop-blur-sm border border-[var(--az-border)] shadow-md transition-all duration-200 hover:scale-105 hover:bg-black hover:border-white/30">
                        {/* Icon - Down Arrow */}
                        <ChevronUp size={18} className="rotate-180 text-[var(--az-text-secondary)] group-hover/scroll-btn:text-white transition-colors" />
                    </div>
                </button>

                {/* Premium Floating Composer — minimal, quiet, responsive */}
                <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-2 z-30" style={{ background: "linear-gradient(to top, #101217 70%, transparent)" }}>
                    <div className="max-w-3xl mx-auto">
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


