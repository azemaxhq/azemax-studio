import React, { useState, useRef, useEffect, useCallback, useDeferredValue } from 'react';
import {
    Check, ArrowRight, Edit3, RefreshCw, Zap, Bug, MessageCircle, Code2, Copy,
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

// Custom Gemini-style Animated Logo
const GeminiLogo = ({ size = 24, className = "" }: { size?: number, className?: string }) => {
    const id = React.useId();
    const gradientId = `gemini-gradient-${id.replace(/:/g, '')}`;

    return (
        <svg width={size} height={size} viewBox="0 0 100 100" className={`${className} overflow-visible`} xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6">
                        <animate attributeName="stop-color" values="#3b82f6;#8b5cf6;#ec4899;#3b82f6" dur="4s" repeatCount="indefinite" />
                    </stop>
                    <stop offset="100%" stopColor="#ec4899">
                        <animate attributeName="stop-color" values="#ec4899;#3b82f6;#8b5cf6;#ec4899" dur="4s" repeatCount="indefinite" />
                    </stop>
                </linearGradient>
            </defs>
            <path d="M50 5C50 5 65 35 95 50C65 65 50 95 50 95C50 95 35 65 5 50C35 35 50 5 50 5Z"
                fill={`url(#${gradientId})`}
                style={{ filter: 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.6))' }}
            />
            <path d="M50 25C50 25 60 40 75 50C60 60 50 75 50 75C50 75 40 60 25 50C40 40 50 25 50 25Z"
                fill="white"
                opacity="0.6"
                style={{ mixBlendMode: 'overlay' }}
            />
        </svg>
    );
};

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
    const [isExpanded, setIsExpanded] = useState(true);

    const getIcon = () => {
        switch (type) {
            case 'code': return <FileCode size={16} className="text-[#58a6ff]" />;
            case 'example': return <Lightbulb size={16} className="text-[#f0883e]" />;
            case 'explanation': return <MessageCircle size={16} className="text-[#a371f7]" />;
            default: return <Code2 size={16} className="text-[#58a6ff]" />;
        }
    };

    const getTypeLabel = () => {
        switch (type) {
            case 'code': return 'Code';
            case 'example': return 'Example';
            case 'explanation': return 'Explanation';
            case 'diagram': return 'Diagram';
            default: return 'Artifact';
        }
    };

    const highlightedCode = type === 'code' && language ? tryHighlight(content, language) : null;

    return (
        <div className="my-4 rounded-xl overflow-hidden border border-[#30363d] bg-gradient-to-b from-[#1c2128] to-[#161b22] shadow-lg">
            {/* Artifact Header */}
            <div
                className="flex items-center justify-between px-4 py-3 bg-[#21262d] border-b border-[#30363d] cursor-pointer hover:bg-[#262c36] transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    {getIcon()}
                    <div>
                        <span className="text-sm font-medium text-[#e6edf3]">{title}</span>
                        <span className="ml-2 text-xs text-[#8b949e] bg-[#30363d] px-2 py-0.5 rounded-full">
                            {getTypeLabel()}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); onCopy?.(content, id); }}
                        className="p-1.5 rounded-md text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d] transition-colors"
                        title="Copy content"
                    >
                        {copiedId === id ? <Check size={14} className="text-[#3fb950]" /> : <Copy size={14} />}
                    </button>
                    <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDown size={16} className="text-[#8b949e]" />
                    </div>
                </div>
            </div>

            {/* Artifact Content */}
            {isExpanded && (
                <div className="p-4 bg-[#0d1117]">
                    {type === 'code' && language ? (
                        <pre className="text-[13px] font-mono overflow-x-auto custom-scrollbar text-[#e6edf3] leading-relaxed">
                            {highlightedCode
                                ? <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                                : <code>{content}</code>}
                        </pre>
                    ) : (
                        <div className="text-[14px] text-[#c9d1d9] leading-relaxed whitespace-pre-wrap">
                            {content}
                        </div>
                    )}
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

            if (!inline && match) {
                // Syntax Highlighting — skip during streaming (heavy, causes jank)
                const highlightedCode = prismReady && !isStreaming ? tryHighlight(code, language) : null;

                return (
                    <div className="my-4 rounded-lg overflow-hidden border border-[#30363d] bg-[#161b22] group/code">
                        <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-[#30363d]">
                            <span className="text-xs text-[#8b949e] font-medium font-mono">{language}</span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => onCopy(code, codeId)}
                                    className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
                                    title="Copy Code"
                                >
                                    {copiedId === codeId ? <Check size={13} className="text-[#3fb950]" /> : <Copy size={13} />}
                                    <span>{copiedId === codeId ? 'Copied!' : 'Copy code'}</span>
                                </button>
                                {msg.role === 'ai' && onApplyCode && (
                                    <button
                                        onClick={() => onApplyCode(code)}
                                        className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
                                        title="Apply to Editor"
                                    >
                                        <ArrowRight size={13} />
                                        <span>Apply</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="relative">
                            <pre className="p-4 text-[13px] font-mono overflow-x-auto custom-scrollbar text-[#e6edf3] leading-relaxed bg-[#0d1117]">
                                {highlightedCode
                                    ? <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                                    : <code>{code}</code>}
                            </pre>
                        </div>
                    </div>
                );
            }
            // Inline code - ChatGPT style (subtle)
            return (
                <code
                    className="text-[14px] font-mono bg-[#343541] text-[#ececec] px-1 py-0.5 rounded"
                    {...props}
                >
                    {children}
                </code>
            );
        },
        h1({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h1 className="text-[22px] font-semibold text-[#e6edf3] mt-8 mb-4 pb-2 border-b border-[#30363d]" {...props}>{children}</h1>;
        },
        h2({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h2 className="text-[18px] font-semibold text-[#e6edf3] mt-6 mb-3" {...props}>{children}</h2>;
        },
        h3({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
            return <h3 className="text-[16px] font-medium text-[#e6edf3] mt-5 mb-2" {...props}>{children}</h3>;
        },
        p({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
            return <p className="leading-[1.7] mb-4 text-[#c9d1d9] last:mb-0" {...props}>{children}</p>;
        },
        ul({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
            return <ul className="list-disc list-outside ml-6 mb-4 space-y-2 text-[#c9d1d9]" {...props}>{children}</ul>;
        },
        ol({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) {
            return <ol className="list-decimal list-outside ml-6 mb-4 space-y-2 text-[#c9d1d9]" {...props}>{children}</ol>;
        },
        li({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) {
            return <li className="pl-1 leading-[1.7]" {...props}>{children}</li>;
        },
        blockquote({ children, ...props }: React.QuoteHTMLAttributes<HTMLQuoteElement>) {
            return (
                <blockquote className="border-l-3 border-[#58a6ff] bg-[#161b22] pl-4 py-3 my-4 rounded-r-lg text-[#8b949e]" {...props}>
                    {children}
                </blockquote>
            );
        },
        strong({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
            return <strong className="font-semibold text-[#e6edf3]" {...props}>{children}</strong>;
        },
        em({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
            return <em className="italic text-[#c9d1d9]" {...props}>{children}</em>;
        },
        hr({ ...props }: React.HTMLAttributes<HTMLHRElement>) {
            return <hr className="my-6 border-white/10" {...props} />;
        },
        // Links
        a({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
            return (
                <a target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline transition-colors" {...props}>
                    {children ?? ''}
                </a>
            );
        },
        // Tables
        table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
            return (
                <div className="overflow-x-auto my-6 border border-white/10 rounded-lg bg-black/20">
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
            return <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider" {...props}>{children}</th>;
        },
        td({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
            return <td className="px-4 py-3 whitespace-nowrap text-white/80 border-t border-white/5" {...props}>{children}</td>;
        }
    };


    return (
        <div className={`flex gap-4 w-full message-appear ${msg.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
            <div className={`flex flex-col gap-2 min-w-0 ${msg.role === 'user' ? 'items-end max-w-[85%]' : 'items-start flex-1 max-w-full'}`}>
                {isEditing ? (
                    <div className="w-full space-y-3 bg-[#161b22] p-4 rounded-xl border border-[#30363d]">
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-3 rounded-lg bg-[#0d1117] border border-[#30363d] text-sm resize-none focus:outline-none focus:border-[#58a6ff] text-[#c9d1d9] placeholder-[#8b949e] transition-colors"
                            rows={3}
                        />
                        <div className="flex gap-2 justify-end">
                            <button onClick={onCancelEdit} className="px-4 py-2 rounded-lg hover:bg-[#21262d] text-[#8b949e] text-xs font-medium transition-colors">Cancel</button>
                            <button onClick={() => onSaveEdit(msg.id)} className="px-4 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium transition-colors">Save</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className={`group relative break-words ${msg.role === 'ai'
                            ? 'w-full bg-transparent'
                            : 'px-4 py-2.5 bg-[#1f6feb] text-white rounded-2xl shadow-sm'
                            }`}>

                            <div className={`markdown-content relative z-10 ${msg.role === 'ai' ? 'text-[15px] leading-[1.8] text-[#c9d1d9]' : 'text-[15px] leading-relaxed'}`}>
                                {msg.role === 'ai' ? (
                                    // Parse and render artifacts for AI messages
                                    <>
                                        {parseArtifacts(msg.text).segments.map((segment, segIdx) =>
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
                                                >
                                                    {segment.content}
                                                </MarkdownRenderer>
                                            )
                                        )}
                                    </>
                                ) : (
                                    <MarkdownRenderer components={components}>
                                        {msg.text}
                                    </MarkdownRenderer>
                                )}
                            </div>

                            {/* Action bar for AI messages - Always visible */}
                            {msg.role === 'ai' && (
                                <div className="flex items-center justify-between mt-4 mb-2 opacity-60 hover:opacity-100 transition-opacity duration-200 px-1">
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => onCopy(msg.text, `msg-${msg.id}`)}
                                            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
                                            title="Copy"
                                        >
                                            {copiedId === `msg-${msg.id}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                            <span>{copiedId === `msg-${msg.id}` ? 'Copied' : 'Copy'}</span>
                                        </button>
                                        {onRegenerate && (
                                            <button
                                                onClick={() => typeof index === 'number' && onRegenerate(index)}
                                                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
                                                title="Regenerate"
                                            >
                                                <RefreshCw size={14} />
                                                <span>Regenerate</span>
                                            </button>
                                        )}
                                    </div>

                                    {onReaction && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => onReaction(msg.id, 'up')}
                                                className={`text-white/40 hover:text-white transition-colors ${reaction === 'up' ? 'text-emerald-400' : ''}`}
                                                title="Helpful"
                                            >
                                                <ThumbsUp size={14} />
                                            </button>
                                            <button
                                                onClick={() => onReaction(msg.id, 'down')}
                                                className={`text-white/40 hover:text-white transition-colors ${reaction === 'down' ? 'text-red-400' : ''}`}
                                                title="Not helpful"
                                            >
                                                <ThumbsDown size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* User message hover actions - Enhanced Floating Pill - Compact */}
                            {msg.role === 'user' && (
                                <div className="absolute -bottom-6 left-0 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-0.5 p-0.5 bg-[#1e1e1e]/90 backdrop-blur-sm rounded-full border border-white/10 shadow-lg shadow-black/20 translate-y-2 group-hover:translate-y-0 text-white/40">
                                    <button
                                        onClick={() => onCopy(msg.text, `msg-${msg.id}`)}
                                        className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all duration-200 group/btn"
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
                                        className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all duration-200 group/btn"
                                        title="Edit"
                                    >
                                        <Edit3 size={12} className="group-hover/btn:scale-110 transition-transform" />
                                    </button>
                                </div>
                            )}
                        </div>
                        {msg.timestamp && (
                            <span className="text-[11px] text-white/30 px-2 font-medium">
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

const PLACEHOLDER_TEXT = "💬 Ask DeepContext anything...";

const StaticPlaceholder: React.FC = () => {
    return (
        <span className="text-[15px] text-white/40 font-normal tracking-wide leading-relaxed">
            {PLACEHOLDER_TEXT}
            <span className="ml-[1px] inline-block w-[1.5px] h-[15px] align-middle bg-violet-400 animate-cursor-blink" />
        </span>
    );
};

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

            // MutationObserver: catches added/removed message nodes (childList) and subtree changes from streaming.
            // CharacterData alone is noisy, but coalesced via rAF it is cheap and ensures no missed frames.
            const mo = new MutationObserver(schedule);
            mo.observe(el, { childList: true, subtree: true, characterData: true });

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

    const [greeting, setGreeting] = useState(getGreeting());

    // Greeting only changes with the time of day; refresh when the panel
    // becomes visible instead of keeping a perpetual 60s timer alive.
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
                setAgentActivities(result.activities.slice(-8));

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
                    ? 'You are DeepContext — a warm, natural coding buddy. Greet briefly and offer help. 1-2 sentences, friendly, no file talk.'
                    : `You are DeepContext — minimax-m3, warm and efficient. Be conversational, concise, and genuinely helpful.
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

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

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

    // Character count with status
    const charCount = input.length;
    const charCountStatus = charCount > 6000 ? 'danger' : charCount > 4000 ? 'warning' : '';





    return (
        <div className="flex flex-col h-full w-full relative overflow-hidden bg-[#0c0c12] min-h-0">

            {/* Rich Background with Gradient Mesh */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Top-center glow to fix "black area" */}
                <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[80%] h-[60%] bg-violet-500/[0.03] blur-[120px] rounded-full" />

                {/* Ambient side glows */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/[0.02] blur-[100px] rounded-full" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/[0.02] blur-[100px] rounded-full" />

                {/* Subtle sheen overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
            </div>

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
                    transition: 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1), opacity 300ms ease-out, scale 400ms cubic-bezier(0.32, 0.72, 0, 1)',
                    transformOrigin: 'left center'
                }}
            >
                <div className="flex flex-col h-full bg-[#0d1117]/95 border-r border-[#30363d]/50">
                    {/* Sidebar Header */}
                    <div className="h-12 shrink-0 flex items-center justify-between px-3 border-b border-[#30363d]/40 bg-[#161b22]/50">
                        <button
                            onClick={() => { handleNewChat(); setShowSidebar(false); }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[#21262d] text-[#c9d1d9]/80 hover:text-[#c9d1d9] text-sm font-medium transition-all duration-200"
                        >
                            <Plus size={16} className="text-[#58a6ff]" />
                            New chat
                        </button>
                        <button
                            onClick={() => setShowSidebar(false)}
                            className="p-1.5 hover:bg-[#21262d] rounded-lg text-[#8b949e] hover:text-[#c9d1d9] transition-colors duration-200"
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
                                className="w-full px-3 py-2 pl-9 text-sm bg-[#0d1117] border border-[#30363d]/60 rounded-lg text-[#c9d1d9] placeholder-[#8b949e]/50 focus:outline-none focus:border-[#58a6ff]/50 focus:ring-1 focus:ring-[#58a6ff]/20 transition-all duration-200"
                                onChange={(e) => {
                                    const searchTerm = e.target.value.toLowerCase();
                                    document.querySelectorAll('[data-session-title]').forEach((el) => {
                                        const title = el.getAttribute('data-session-title')?.toLowerCase() || '';
                                        (el as HTMLElement).style.display = title.includes(searchTerm) ? '' : 'none';
                                    });
                                }}
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b949e]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Sessions List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
                        {sessions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                                <MessageSquare size={24} className="text-[#8b949e]/30 mb-3" />
                                <p className="text-sm text-[#8b949e]/60">No conversations yet</p>
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
                                        <span className="text-[11px] font-semibold text-[#8b949e]/60 uppercase tracking-wider">{group.label}</span>
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
                                                    <MessageSquare size={14} className={`shrink-0 ${isActive ? 'text-[#58a6ff]' : 'text-[#8b949e]/50'}`} />
                                                    <span className={`text-[13px] truncate ${isActive ? 'text-[#c9d1d9]' : 'text-[#8b949e]'}`}>
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
                                                        className="p-1.5 rounded-md hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
                                                        title="Rename"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                                        className="p-1.5 rounded-md hover:bg-red-500/20 text-[#8b949e] hover:text-red-400 transition-colors"
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
                    <div className="px-3 py-2.5 border-t border-[#30363d]/40 bg-[#0d1117]/50">
                        <div className="flex items-center justify-between text-[11px]">
                            <span className="text-[#8b949e]/60">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</span>
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
                                className="text-[#8b949e]/60 hover:text-red-400 transition-colors duration-200"
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
                    backdropFilter: showSidebar ? 'blur(4px)' : 'blur(0px)',
                    transition: 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1), backdrop-filter 400ms cubic-bezier(0.4, 0, 0.2, 1)'
                }}
                onClick={() => setShowSidebar(false)}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 w-full relative z-10">
                {/* Premium Header - Liquid Glass Style */}
                <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-white/10 bg-white/[0.02] backdrop-blur-lg backdrop-saturate-150 z-20 transition-all relative overflow-hidden group/header">
                    {/* Liquid Glint Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.02] to-transparent pointer-events-none" />
                    <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent pointer-events-none opacity-50" />

                    {/* Left Section - History Button */}
                    <div className="flex items-center gap-3 relative z-10">
                        <button
                            onClick={() => setShowSidebar(!showSidebar)}
                            className={`p-2 rounded-xl transition-all duration-300 ${showSidebar ? 'text-white bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
                            title="Toggle History"
                        >
                            <History size={18} strokeWidth={2} className="opacity-80" />
                        </button>
                    </div>

                    {/* Center - Chat Title */}
                    <div className="flex-1 min-w-0 flex items-center justify-center px-3 relative z-10">
                        <button
                            onClick={() => {
                                if (!currentSessionId) return;
                                const session = sessions.find(s => s.id === currentSessionId);
                                const currentTitle = session?.title || 'New Chat';
                                const newTitle = prompt('Rename chat:', currentTitle);
                                if (newTitle != null && newTitle.trim() !== '') {
                                    setSessions(prev =>
                                        prev.map(s =>
                                            s.id === currentSessionId ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s
                                        )
                                    );
                                }
                            }}
                            className="max-w-full w-full px-4 py-2 rounded-xl text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-all duration-200 text-center truncate"
                            title={`${currentSession?.title || 'New Chat'} — Click to rename`}
                        >
                            <span className="block truncate">{currentSession?.title || 'New Chat'}</span>
                        </button>
                    </div>

                    {/* Right Section - Context & New Chat */}
                    <div className="flex items-center gap-3 relative z-10">
                        {activeFileMeta && (
                            <span className="text-[11px] text-zinc-500 truncate font-medium tracking-wide leading-none px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 max-w-[140px]">
                                {activeFileMeta.name}
                            </span>
                        )}
                        <button
                            onClick={handleNewChat}
                            className="p-2 text-zinc-400 hover:text-zinc-200 transition-colors duration-300 hover:bg-white/5 rounded-xl hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
                            title="New Chat"
                        >
                            <Plus size={20} strokeWidth={2} className="opacity-80" />
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
                    className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-14 pb-10 space-y-6 custom-scrollbar w-full ${messages.length > 0 || streamingText ? 'pb-40' : ''}`}
                    style={{ overflowAnchor: 'auto' }}
                >
                    {messages.length === 0 && !streamingText && settings.general.showWelcomeScreen ? (
                        <div className="min-h-full flex flex-col items-center justify-center p-4 pb-12 animate-fade-in-up w-full">

                            {/* Hero Section Container */}
                            <div className="relative mb-8 group cursor-default">
                                {/* Ambient Glow Background (static: no perpetual pulse on blurred surfaces) */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180px] h-[180px] sm:w-[220px] sm:h-[220px] bg-violet-500/20 rounded-full blur-[50px] sm:blur-[70px] opacity-40 mix-blend-screen pointer-events-none" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] bg-blue-500/15 rounded-full blur-[30px] sm:blur-[50px] opacity-10 delay-300 mix-blend-screen pointer-events-none" />

                                {/* Main Logo - Floating with Aura */}
                                <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center animate-float-slow group/orb cursor-pointer" onClick={() => handleQuickAction("Hello AI")}>
                                    {/* Ambient Aura - static rotating-gradient look (no per-frame rotation of blurred layers) */}
                                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(139,92,246,0.15)_120deg,rgba(59,130,246,0.15)_240deg,transparent_360deg)] opacity-60 blur-2xl scale-150" />
                                    <div className="absolute inset-0 bg-[conic-gradient(from_180deg,transparent_0deg,rgba(139,92,246,0.1)_120deg,rgba(59,130,246,0.1)_240deg,transparent_360deg)] opacity-40 blur-xl mix-blend-screen scale-125" />

                                    {/* Central Pulse Glow - static */}
                                    <div className="absolute inset-0 bg-violet-500/10 rounded-full blur-xl" />

                                    {/* Logo Itself */}
                                    <div className="relative z-10 transition-transform duration-500 group-hover/orb:scale-110 group-hover/orb:rotate-12">
                                        <div className="absolute inset-0 bg-white/20 blur-lg rounded-full" />
                                        <GeminiLogo
                                            size={64}
                                            className="sm:w-[72px] sm:h-[72px] text-white drop-shadow-[0_0_15px_rgba(139,92,246,0.6)] filter brightness-110"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Greeting & Subtitle */}
                            <div className="text-center space-y-2 mb-8 max-w-[90%] mx-auto animate-fade-in-up delay-100 opacity-0" style={{ animationFillMode: 'forwards' }}>
                                <h3 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-b from-white via-white/95 to-white/70 bg-clip-text text-transparent drop-shadow-sm">
                                    {greeting}, Creator
                                </h3>
                                <p className="text-[13px] sm:text-[14px] text-white/50 leading-relaxed font-normal tracking-wide">
                                    How can I help you today?
                                </p>
                            </div>

                            {/* Quick Actions Grid - Premium Layout - Flexible Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl animate-fade-in-up delay-200 opacity-0" style={{ animationFillMode: 'forwards' }}>
                                {QUICK_ACTIONS.map((action, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleQuickAction(action.prompt)}
                                        className="group/card relative overflow-hidden flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-violet-500/10 text-left w-full"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none" />

                                        <div className="relative p-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-blue-500/10 text-violet-300 group-hover/card:text-white group-hover/card:from-violet-500/20 group-hover/card:to-blue-500/20 transition-all duration-300 shrink-0 ring-1 ring-white/5 group-hover/card:ring-white/10">
                                            <action.icon size={18} strokeWidth={1.5} className="transition-transform duration-300 group-hover/card:scale-110" />
                                        </div>

                                        <div className="relative min-w-0 flex-1">
                                            <span className="text-[13px] sm:text-[14px] font-medium text-white/80 group-hover/card:text-white transition-colors block text-left">
                                                {action.label}
                                            </span>
                                        </div>

                                        <div className="relative opacity-0 group-hover/card:opacity-100 -translate-x-2 group-hover/card:translate-x-0 transition-all duration-300 text-white/30">
                                            <ArrowRight size={14} strokeWidth={2} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg, index) => (
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
                            ))}

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
                                                    <span className="text-[11px] text-white/40">Writing…</span>
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
                    {/* Cursor-style compact activity cards — 60fps, no layout jump */}
                    {agentActivities.length > 0 && (
                        <div className="px-2 py-2 space-y-1.5 animate-fade-in">
                            {agentActivities.slice(-6).map(act => (
                                <div key={act.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm text-[12px] leading-none transition-all duration-200 will-change-transform" style={{ contain: 'layout paint' }}>
                                    <span className={`shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] ${act.status === 'running' ? 'bg-white/10 text-white/60 animate-pulse' : act.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {act.status === 'running' ? '◌' : act.status === 'done' ? '✓' : '✕'}
                                    </span>
                                    <span className={`truncate ${act.status === 'running' ? 'text-white/70' : act.status === 'done' ? 'text-white/60' : 'text-red-300/80'}`}>{act.message}</span>
                                    {act.path && <span className="ml-auto shrink-0 text-[11px] text-white/30 truncate max-w-[140px]">{act.path}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Scroll to Bottom Button */}
                <button
                    onClick={handleScrollToBottom}
                    className={`ai-scroll-btn ${showScrollButton ? 'visible' : ''} group/scroll-btn`}
                    aria-label="Scroll to bottom"
                >
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-black/80 backdrop-blur-sm border border-white/10 shadow-md transition-all duration-200 hover:scale-105 hover:bg-black hover:border-white/30">
                        {/* Icon - Down Arrow */}
                        <ChevronUp size={18} className="rotate-180 text-white/80 group-hover/scroll-btn:text-white transition-colors" />
                    </div>
                </button>

                {/* Apple Intelligence Style Input */}
                <div className="absolute bottom-6 left-0 right-0 px-4 z-30">
                    <div className="max-w-3xl mx-auto relative group">
                        {/* Apple Glow Effect - Subtler & Toned Down (static gradient: no continuous animation of a blurred layer) */}
                        <div className="absolute -inset-[2px] bg-gradient-to-r from-blue-500/30 via-purple-500/30 via-pink-500/30 to-blue-500/30 rounded-[26px] opacity-0 group-focus-within:opacity-100 blur-md transition-all duration-700" style={{ backgroundSize: '400% 400%' }} />

                        {/* Subtle ambient glow always visible */}
                        <div className="absolute -inset-[1px] bg-white/5 rounded-[26px] blur-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500" />

                        {/* Main Input Container */}
                        <div className="relative flex items-end gap-2 bg-[#18181b] backdrop-blur-lg border border-white/10 rounded-[26px] shadow-lg shadow-black/20 overflow-hidden ring-1 ring-white/5 group-focus-within:ring-white/20 transition-all duration-300 input-focus-glow">

                            {/* Input Shimmer Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent -translate-x-full group-focus-within:animate-shimmer-fast pointer-events-none" />

                            {/* Custom Placeholder Overlay with Blinking Cursor */}
                            {!input && (
                                <div className="absolute inset-0 flex items-center pointer-events-none pl-5 py-[14px] z-0">
                                    <StaticPlaceholder />
                                </div>
                            )}

                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="flex-1 bg-transparent text-white placeholder-transparent text-[15px] pl-5 pr-2 py-[14px] min-h-[52px] max-h-[200px] resize-none focus:outline-none font-normal tracking-wide leading-relaxed z-10"
                                rows={1}
                                style={{ height: '52px' }}
                                onInput={(e) => {
                                    const target = e.target as HTMLTextAreaElement;
                                    target.style.height = '52px';
                                    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                                }}
                            />

                            {/* Action Button with Character Counter */}
                            <div className="flex items-center gap-3 pb-2 pr-2 z-10">
                                {/* Character Counter */}
                                {charCount > 0 && (
                                    <span className={`ai-char-counter ${charCountStatus}`}>
                                        {charCount.toLocaleString()}
                                    </span>
                                )}
                                {isLoading ? (
                                    <button
                                        onClick={handleStop}
                                        className="w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 ring-1 ring-white/10 transition-all duration-200"
                                        title="Stop (Esc)"
                                    >
                                        <div className="w-2.5 h-2.5 bg-white rounded-[2px]" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSend}
                                        disabled={!input.trim() || !settings.ai.enabled}
                                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${input.trim() && settings.ai.enabled
                                            ? 'bg-white text-black hover:scale-105 active:scale-95 shadow-md shadow-white/10'
                                            : 'bg-white/10 text-white/30 cursor-not-allowed'
                                            }`}
                                        title={settings.ai.enabled ? "Send (Enter)" : "AI is disabled in settings"}
                                    >
                                        <ArrowRight
                                            size={18}
                                            strokeWidth={2.5}
                                            className={`transition-transform duration-300 ${input.trim() ? '-rotate-90' : 'rotate-0'
                                                }`}
                                        />
                                    </button>
                                )}
                            </div>
                        </div>
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


