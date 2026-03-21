import React, { useState, useRef, useEffect, useCallback, useDeferredValue } from 'react';
import {
    Check, ArrowRight, Edit3, RefreshCw, Zap, Bug, MessageCircle, Code2, Copy,
    Plus, MessageSquare, Trash2, X, History, ChevronUp,
    ThumbsUp, ThumbsDown, FileCode, Lightbulb, ChevronDown
} from 'lucide-react';

import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { streamChatWithAI, generateCode, getAvailableModels, type ProjectContext } from '../../utils/groqService';
import { useProject } from '../../context/ProjectContext';
import { type FileNode } from '../../utils/mockFileSystem';
import {
    saveSessions,
    loadSessions,
    createSession,
    saveCurrentSessionId,
    loadCurrentSessionId,
    type ChatSession,
    type Message
} from '../../utils/chatStorage';

// Helper to flatten file tree for context with depth limit
const flattenFileTree = (nodes: FileNode[], depth = 0, maxDepth = 2): string => {
    if (depth > maxDepth) return '';

    let result = '';
    const indent = '  '.repeat(depth);
    for (const node of nodes) {
        result += `${indent} - ${node.name} (${node.type}) \n`;
        if (node.children) {
            result += flattenFileTree(node.children, depth + 1, maxDepth);
        }
    }
    return result;
};


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
    type: 'code' | 'example' | 'explanation' | 'diagram';
    language?: string;
    content: string;
    onCopy: (text: string, id: string) => void;
    copiedId: string | null;
    id: string;
}

const ArtifactBlock: React.FC<ArtifactProps> = ({ title, type, language, content, onCopy, copiedId, id }) => {
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

    const highlightedCode = (() => {
        if (type !== 'code' || !language) return content;
        try {
            return Prism.highlight(
                content,
                Prism.languages[language] || Prism.languages.typescript,
                language
            );
        } catch (e) {
            return content;
        }
    })();

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
                        onClick={(e) => { e.stopPropagation(); onCopy(content, id); }}
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
                            <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
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

// Parse artifact blocks from AI response
const parseArtifacts = (text: string): { segments: Array<{ type: 'text' | 'artifact'; content: string; artifact?: ArtifactProps }>; } => {
    const artifactRegex = /```artifact\s*\n(?:title:\s*"([^"]+)"\s*\n)?(?:type:\s*(\w+)\s*\n)?(?:language:\s*(\w+)\s*\n)?([\s\S]*?)```/gi;
    const segments: Array<{ type: 'text' | 'artifact'; content: string; artifact?: any }> = [];
    let lastIndex = 0;
    let match;

    while ((match = artifactRegex.exec(text)) !== null) {
        // Add text before artifact
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }

        // Add artifact
        segments.push({
            type: 'artifact',
            content: '',
            artifact: {
                title: match[1] || 'Code Example',
                type: (match[2] as any) || 'code',
                language: match[3] || 'typescript',
                content: match[4]?.trim() || ''
            }
        });

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    // If no artifacts found, return original text
    if (segments.length === 0) {
        segments.push({ type: 'text', content: text });
    }

    return { segments };
};


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
    onReaction
}: {
    msg: Message | { text: string; role: 'ai' | 'user'; id: string; timestamp?: number };
    index: number | string;
    isEditing: boolean;
    editText: string;
    setEditText: (text: string) => void;
    onSaveEdit: (id: string) => void;
    onCancelEdit: () => void;
    onEditStart: (msg: any) => void;
    onCopy: (text: string, id: string) => void;
    onRegenerate?: (index: number) => void;
    onApplyCode?: (code: string) => void;
    copiedId: string | null;
    reaction?: 'up' | 'down' | null;
    onReaction?: (msgId: string, type: 'up' | 'down') => void;
}) => {
    // Enhanced markdown renderer using react-markdown
    const components = {
        code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : 'text';
            const code = String(children).replace(/\n$/, '');
            const codeId = `${msg.id}-${index}-${language}-${code.slice(0, 10)}`;

            if (!inline && match) {
                // Syntax Highlighting
                const highlightedCode = (() => {
                    try {
                        return Prism.highlight(
                            code,
                            Prism.languages[language] || Prism.languages.typescript,
                            language
                        );
                    } catch (e) {
                        return code;
                    }
                })();

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
                                <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
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
        h1({ children, ...props }: any) {
            return <h1 className="text-[22px] font-semibold text-[#e6edf3] mt-8 mb-4 pb-2 border-b border-[#30363d]" {...props}>{children}</h1>;
        },
        h2({ children, ...props }: any) {
            return <h2 className="text-[18px] font-semibold text-[#e6edf3] mt-6 mb-3" {...props}>{children}</h2>;
        },
        h3({ children, ...props }: any) {
            return <h3 className="text-[16px] font-medium text-[#e6edf3] mt-5 mb-2" {...props}>{children}</h3>;
        },
        p({ children, ...props }: any) {
            return <p className="leading-[1.7] mb-4 text-[#c9d1d9] last:mb-0" {...props}>{children}</p>;
        },
        ul({ children, ...props }: any) {
            return <ul className="list-disc list-outside ml-6 mb-4 space-y-2 text-[#c9d1d9]" {...props}>{children}</ul>;
        },
        ol({ children, ...props }: any) {
            return <ol className="list-decimal list-outside ml-6 mb-4 space-y-2 text-[#c9d1d9]" {...props}>{children}</ol>;
        },
        li({ children, ...props }: any) {
            return <li className="pl-1 leading-[1.7]" {...props}>{children}</li>;
        },
        blockquote({ children, ...props }: any) {
            return (
                <blockquote className="border-l-3 border-[#58a6ff] bg-[#161b22] pl-4 py-3 my-4 rounded-r-lg text-[#8b949e]" {...props}>
                    {children}
                </blockquote>
            );
        },
        strong({ children, ...props }: any) {
            return <strong className="font-semibold text-[#e6edf3]" {...props}>{children}</strong>;
        },
        em({ children, ...props }: any) {
            return <em className="italic text-[#c9d1d9]" {...props}>{children}</em>;
        },
        hr({ ...props }: any) {
            return <hr className="my-6 border-white/10" {...props} />;
        },
        // Links
        a({ node, children, ...props }: any) {
            return (
                <a target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline transition-colors" {...props}>
                    {children}
                </a>
            );
        },
        // Tables
        table({ children, ...props }: any) {
            return (
                <div className="overflow-x-auto my-6 border border-white/10 rounded-lg bg-black/20">
                    <table className="min-w-full divide-y divide-white/10 text-sm" {...props}>
                        {children}
                    </table>
                </div>
            );
        },
        thead({ children, ...props }: any) {
            return <thead className="bg-white/5" {...props}>{children}</thead>;
        },
        th({ children, ...props }: any) {
            return <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider" {...props}>{children}</th>;
        },
        td({ children, ...props }: any) {
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
                                                <ReactMarkdown
                                                    key={`text-${msg.id}-${segIdx}`}
                                                    remarkPlugins={[remarkGfm]}
                                                    rehypePlugins={[rehypeRaw]}
                                                    components={components}
                                                >
                                                    {segment.content}
                                                </ReactMarkdown>
                                            )
                                        )}
                                    </>
                                ) : (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw]}
                                        components={components}
                                    >
                                        {msg.text}
                                    </ReactMarkdown>
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

const PLACEHOLDER_PHRASES = [
    "💬 Ask DeepContext anything...",
    "🔍 Explain this code...",
    "🐛 Fix this bug...",
    "🧪 Generate a unit test...",
    "✨ Refactor this component...",
    "📝 Add comments to this file...",
    "🚀 Optimize for performance...",
    "⚛️ Create a new React component..."
];

const useTypewriter = (phrases: string[], typingSpeed = 100, deletingSpeed = 30, pauseDuration = 1500) => {
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    // Refs for state to avoid dependency cycles and re-renders
    const state = useRef({
        isDeleting: false,
        loopNum: 0,
        text: '',
        timer: null as any
    });

    useEffect(() => {
        const handleTyping = () => {
            const { isDeleting, loopNum, text } = state.current;
            const i = loopNum % phrases.length;
            const fullText = phrases[i];

            // Determine next text state
            let nextText = '';
            if (isDeleting) {
                nextText = fullText.substring(0, text.length - 1);
            } else {
                nextText = fullText.substring(0, text.length + 1);
            }

            // Update refs and state
            state.current.text = nextText;
            setDisplayedText(nextText);

            // Calculate next speed
            let typeSpeed = typingSpeed;
            if (isDeleting) {
                typeSpeed = deletingSpeed;
                setIsTyping(true);
            } else {
                // Add human variance only when typing
                typeSpeed += Math.random() * 30 - 15;

                // Add natural pause after spaces (between words)
                if (nextText.endsWith(' ')) {
                    typeSpeed += 40;
                }

                setIsTyping(true);
            }

            // Determine logic for next frame
            if (!isDeleting && nextText === fullText) {
                // Finished typing phrase
                typeSpeed = pauseDuration;
                state.current.isDeleting = true;
                setIsTyping(false); // Pause -> Cursor blinks
            } else if (isDeleting && nextText === '') {
                // Finished deleting
                state.current.isDeleting = false;
                state.current.loopNum++;
                typeSpeed = 300; // Pause before next phrase
                setIsTyping(false); // Pause -> Cursor blinks
            }

            state.current.timer = setTimeout(handleTyping, typeSpeed);
        };

        // Start the loop
        state.current.timer = setTimeout(handleTyping, 100);

        return () => {
            if (state.current.timer) clearTimeout(state.current.timer);
        };
    }, []); // Empty dependency array ensures this runs once and uses refs

    return { text: displayedText, isTyping };
};

export // Custom hook for robust auto-scrolling
    const useAutoScroll = (dependencies: any[]) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const isStickyRef = useRef(true);
        const lastScrollTopRef = useRef(0);

        const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
            if (containerRef.current) {
                containerRef.current.scrollTo({
                    top: containerRef.current.scrollHeight,
                    behavior
                });
            }
        }, []);

        // 1. Handle User Scroll
        const handleScroll = useCallback(() => {
            if (!containerRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

            // If we are scrolling UP, break sticky
            // If we are scrolling DOWN and hit bottom, re-enable sticky
            if (distanceFromBottom < 10) {
                isStickyRef.current = true;
            } else if (scrollTop < lastScrollTopRef.current) {
                // User is scrolling UP
                isStickyRef.current = false;
            }

            lastScrollTopRef.current = scrollTop;
        }, []);

        // 2. Observer for content changes (Streaming/New Messages)
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const observer = new ResizeObserver(() => {
                if (isStickyRef.current) {
                    // Use instant scroll to prevent jitter during streaming
                    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
                }
            });

            // Observe the LAST child (content), or the container itself if children change size
            // Better to observe the container's scrollHeight changes
            // Since ResizeObserver monitors dimensions, we can observe the chat content wrapper
            Array.from(container.children).forEach(child => observer.observe(child));

            return () => observer.disconnect();
        }, dependencies); // Re-run if dependencies (like messages list) change strictly

        return { containerRef, scrollToBottom, handleScroll, isStickyRef };
    };

export const AIAssistant: React.FC = () => {
    // Session State
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // UI State
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [streamingText, setStreamingText] = useState('');
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [reactions, setReactions] = useState<Record<string, 'up' | 'down'>>({}); // msgId -> reaction

    // Deferred value for streaming performance
    const deferredStreamingText = useDeferredValue(streamingText);

    const [selectedModel, setSelectedModel] = useState<string>('llama-3.3-70b-versatile');
    const { text: placeholderText, isTyping: isPlaceholderTyping } = useTypewriter(PLACEHOLDER_PHRASES);

    // Time-based greeting
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "☀️ Good morning";
        if (hour < 18) return "🌤️ Good afternoon";
        return "🌙 Good evening";
    };

    const [greeting, setGreeting] = useState(getGreeting());

    useEffect(() => {
        setGreeting(getGreeting());
        const interval = setInterval(() => setGreeting(getGreeting()), 60000);
        return () => clearInterval(interval);
    }, []);

    // Load available models on mount
    useEffect(() => {
        getAvailableModels().then(models => {
            if (models.length > 0) {
                // Check if current model is in list, if not set first
                if (!models.includes(selectedModel)) {
                    setSelectedModel(models[0]);
                }
            }
        });
    }, []);

    // Load saved sessions on mount
    useEffect(() => {
        const savedSessions = loadSessions();
        const savedCurrentSessionId = loadCurrentSessionId();

        if (savedSessions.length > 0) {
            setSessions(savedSessions);
            // Restore the current session if it exists, otherwise use the first one
            if (savedCurrentSessionId && savedSessions.some(s => s.id === savedCurrentSessionId)) {
                setCurrentSessionId(savedCurrentSessionId);
            } else {
                setCurrentSessionId(savedSessions[0].id);
            }
        }
    }, []);

    // Project Context
    const { createFile, activeFile, updateFileContent, fileTree, createFolder, deleteNode } = useProject();

    // Action Execution
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

    // Refs
    // const messagesContainerRef = useRef<HTMLDivElement>(null); // Replaced by hook
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isSendingRef = useRef(false); // Track internal sending state to prevent duplicates
    const currentRequestIdRef = useRef<string | null>(null); // Track current request to prevent duplicate responses
    const processedRequestsRef = useRef<Set<string>>(new Set()); // Track processed requests

    // Derived state: Current Session
    const currentSession = sessions.find(s => s.id === currentSessionId);
    const messages = currentSession?.messages || [];

    // Use robust auto-scroll hook
    // We pass [messages, streamingText] as dependencies so the observer re-attaches/checks when content structure changes
    const { containerRef: messagesContainerRef, scrollToBottom, handleScroll: hookHandleScroll, isStickyRef } = useAutoScroll([messages, streamingText]);

    const handleStop = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            setStreamingText('');
        }
    }, []);

    // Combine hook scroll handler with button visibility logic
    const handleScroll = useCallback(() => {
        hookHandleScroll();

        if (messagesContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            setShowScrollButton(distanceFromBottom > 200);
        }
    }, [hookHandleScroll]);

    // Scroll to bottom wrapper for UI button
    const handleScrollToBottom = useCallback(() => {
        scrollToBottom('smooth');
        isStickyRef.current = true; // Re-engage sticky when manually clicked
    }, [scrollToBottom]);

    // Reaction handler
    const handleReaction = useCallback((msgId: string, type: 'up' | 'down') => {
        setReactions(prev => {
            const current = prev[msgId];
            if (current === type) {
                // Toggle off
                const { [msgId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [msgId]: type };
        });
    }, []);

    // Track previous messages length to detect new messages
    const prevMessagesLengthRef = useRef(messages.length);
    // Track if user is at bottom (for non-hook logic backup if needed, though hook handles mostly)
    const isAtBottomRef = useRef(true);

    // Auto-scroll effect starts here...
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        // 1. New Message: Always scroll to bottom and re-enable sticky
        if (messages.length > prevMessagesLengthRef.current) {
            prevMessagesLengthRef.current = messages.length;
            const lastMsg = messages[messages.length - 1];

            // If user sent it, or we were already sticky/at-bottom -> Force scroll
            if (lastMsg?.role === 'user' || isStickyRef.current || isAtBottomRef.current) {
                isStickyRef.current = true;
                // Use smooth scroll for new messages
                setTimeout(() => scrollToBottom('smooth'), 50);
            }
        }

        // 2. Streaming: If sticky, keep scrolling to bottom INSTANTLY (terminal style)
        if (streamingText && isStickyRef.current) {
            // Use 'auto' behavior (instant) for terminal-like sticky scroll
            container.scrollTop = container.scrollHeight;
        }

    }, [messages, streamingText, scrollToBottom]);

    const handleNewChat = useCallback(() => {
        const newSession = createSession();
        setSessions(prev => {
            const updated = [newSession, ...prev];
            saveSessions(updated);
            return updated;
        });
        setCurrentSessionId(newSession.id);
        setStreamingText(''); // Fix: Clear streaming text so home page can show
        if (window.innerWidth < 768) setShowSidebar(false);
    }, []);

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        const newSessions = sessions.filter(s => s.id !== sessionId);
        setSessions(newSessions);
        saveSessions(newSessions);

        if (currentSessionId === sessionId) {
            setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
            if (newSessions.length === 0) handleNewChat();
        }
    };

    const handleSelectSession = (sessionId: string) => {
        setCurrentSessionId(sessionId);
        if (window.innerWidth < 768) setShowSidebar(false);
    };

    const handleCopyCode = (code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleCopyMessage = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleApplyCode = (code: string) => {
        if (activeFile) {
            updateFileContent(activeFile.id, code);
        }
    };

    const handleQuickAction = (prompt: string) => {
        if (isSendingRef.current || isLoading) return; // Prevent double submission
        handleSend(prompt);
    };

    const handleEditMessage = (msg: Message) => {
        setEditingMessageId(msg.id);
        setEditText(msg.text);
    };

    const handleCancelEdit = () => {
        setEditingMessageId(null);
        setEditText('');
    };

    const handleSaveEdit = async (msgId: string) => {
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

        setEditingMessageId(null);
        setInput(editText);
        setEditText('');

        // Trigger send
        setTimeout(() => handleSend(), 100);
    };

    const handleRegenerate = async (msgIndex: number) => {
        // Find the user message before this AI message
        const userMsgIndex = msgIndex - 1;
        if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') return;

        const userMessage = messages[userMsgIndex].text;

        // Remove the AI message
        const newMessages = messages.slice(0, msgIndex);

        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                return { ...s, messages: newMessages, updatedAt: Date.now() };
            }
            return s;
        }));

        // Resend the user message
        setInput(userMessage);
        setTimeout(() => handleSend(), 100);
    };

    const handleSend = useCallback(async (arg?: string | React.MouseEvent | unknown) => {
        const textToSend = typeof arg === 'string' ? arg : input;

        if (!textToSend.trim() || isLoading || isSendingRef.current) return;
        isSendingRef.current = true; // Block duplicate calls

        if (!currentSessionId) handleNewChat();

        const userMessageText = textToSend.trim();

        // Slash Commands
        if (userMessageText === '/clear') {
            setSessions(prev =>
                prev.map(s => s.id === currentSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s)
            );
            setInput('');
            setStreamingText('');
            isSendingRef.current = false; // Reset sending flag
            return;
        }

        setInput('');
        setIsLoading(true);
        setStreamingText('');

        // Update UI immediately with User Message
        const tempUserMsg: Message = {
            id: Date.now().toString() + Math.random().toString(36).slice(2), // Ensure unique ID
            role: 'user',
            text: userMessageText,
            timestamp: Date.now()
        };

        // Update Session State
        setSessions(prev => {
            return prev.map(s => {
                if (s.id === currentSessionId) {
                    const updatedMessages = [...s.messages, tempUserMsg];
                    const newTitle = s.messages.length === 0 ? userMessageText.slice(0, 30) : s.title;
                    return { ...s, messages: updatedMessages, title: newTitle, updatedAt: Date.now() };
                }
                return s;
            });
        });

        // Initialize AbortController and Request ID
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Generate unique request ID to prevent duplicates
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        currentRequestIdRef.current = requestId;

        // Build Project Context
        const projectContext: ProjectContext = {
            // Limit file tree depth to 3 levels to save context window
            fileStructure: flattenFileTree(fileTree, 0, 3),
            activeFile: activeFile ? { name: activeFile.name, content: activeFile.content || '' } : undefined,
            // Only send active file as "open file" to avoid duplication and excessive context
            openFiles: activeFile ? [{ name: activeFile.name, content: activeFile.content || '' }] : []
        };

        // --- AI Logic ---
        try {
            const createMatch = userMessageText.match(/create (?:a )?file (?:named )?['"]?([\w./-]+)['"]?/i);
            let responseText = '';

            if (createMatch) {
                const fileName = createMatch[1];
                const contentPrompt = `Generate code for a file named "${fileName}" based on this context: "${userMessageText}". Output ONLY the code, no markdown fences if possible, or minimally wrapped.`;
                const codeContent = await generateCode(contentPrompt, 'typescript', '', abortController.signal);
                let cleanContent = codeContent;
                const match = codeContent.match(/```(?:\w+)?\n([\s\S]*?)```/);
                if (match) {
                    cleanContent = match[1];
                } else {
                    cleanContent = codeContent.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
                }
                createFile(fileName, cleanContent.trim());
                responseText = `I've created the file **${fileName}** with some initial code. Check the explorer!`;
            } else if (activeFile) {
                const prompt = `
Current Active File: ${activeFile.name} (Language: ${activeFile.type})
File Content:
\`\`\`${activeFile.name.split('.').pop()}
${activeFile.content}
\`\`\`

User Request: "${userMessageText}"

INSTRUCTIONS:
1. If the user's request is a greeting, question, or general conversation UNRELATED to the code, simply answer it naturally. DO NOT explain why you are not modifying the code. IGNORE the file context if it is not relevant.
2. If the user wants to WRITE, CREATE, IMPLEMENT, MODIFY, REFACTOR, or UPDATE the code, return the COMPLETE updated file content inside a single markdown code block.
3. If providing updated code, do NOT truncate it. Return the full file.
`;
                // Try streaming 
                try {
                    let fullResponse = '';
                    const history = messages.map(m => ({
                        role: m.role === 'ai' ? 'assistant' : 'user' as 'user' | 'assistant' | 'system',
                        content: m.text
                    })).filter(m => m.role !== 'system') as any[];

                    let lastUpdateTime = 0;
                    const THROTTLE_MS = 50; // Tuned for better responsiveness

                    for await (const chunk of streamChatWithAI(
                        prompt,
                        history,
                        abortController.signal,
                        projectContext,
                        selectedModel
                    )) {
                        fullResponse += chunk;
                        const now = Date.now();
                        if (now - lastUpdateTime > THROTTLE_MS) {
                            const capturedRequestId = requestId;
                            const capturedResponse = fullResponse;
                            requestAnimationFrame(() => {
                                if (currentRequestIdRef.current === capturedRequestId) {
                                    setStreamingText(capturedResponse);
                                }
                            });
                            lastUpdateTime = now;
                        }
                    }
                    // Ensure final update with any pending content
                    // requestAnimationFrame(() => setStreamingText(fullResponse)); // REMOVED: Causing duplicate "ghost" message before clear
                    responseText = fullResponse;
                } catch (e: any) {
                    if (e.name === 'AbortError') {
                        responseText = streamingText;
                    } else {
                        throw e;
                    }
                }

                const codeBlockMatch = responseText.match(/```(?:\w+)?\n([\s\S]*?)```/);

                if (codeBlockMatch && (userMessageText.match(/(write|create|implement|update|change|add|refactor|fix|modify)/i))) {
                    const newContent = codeBlockMatch[1].trim();
                    updateFileContent(activeFile.id, newContent);
                    
                    // Strip the code block from the chat response
                    const strippedResponse = responseText.replace(/```(?:\w+)?\n([\s\S]*?)```/, '').trim();
                    
                    if (strippedResponse === '') {
                        responseText = `✅ **I have updated \`${activeFile.name}\` directly in the editor with your changes.**`;
                    } else {
                        responseText = `${strippedResponse}\n\n✅ **I have updated \`${activeFile.name}\` directly in the editor.**`;
                    }
                }
            } else {
                try {
                    let fullResponse = '';
                    const history = messages.map(m => ({
                        role: m.role === 'ai' ? 'assistant' : 'user' as 'user' | 'assistant' | 'system',
                        content: m.text
                    })).filter(m => m.role !== 'system') as any[];

                    let lastUpdateTime = 0;
                    const THROTTLE_MS = 50; // Tuned for better responsiveness

                    for await (const chunk of streamChatWithAI(
                        userMessageText,
                        history,
                        abortController.signal,
                        projectContext,
                        selectedModel
                    )) {
                        fullResponse += chunk;
                        const now = Date.now();
                        if (now - lastUpdateTime > THROTTLE_MS) {
                            const capturedRequestId = requestId;
                            const capturedResponse = fullResponse;
                            requestAnimationFrame(() => {
                                if (currentRequestIdRef.current === capturedRequestId) {
                                    setStreamingText(capturedResponse);
                                }
                            });
                            lastUpdateTime = now;
                        }
                    }
                    // Ensure final update with any pending content
                    // requestAnimationFrame(() => setStreamingText(fullResponse)); // REMOVED: Causing duplicate "ghost" message before clear
                    responseText = fullResponse;
                } catch (e: any) {
                    if (e.name === 'AbortError') {
                        responseText = streamingText;
                    } else {
                        throw e;
                    }
                }
            }

            // --- Action Parsing & Execution (Post-Stream) ---
            const actionRegex = /```action\n([\s\S]*?)```/g;
            let match;
            const actionResults: string[] = [];

            while ((match = actionRegex.exec(responseText)) !== null) {
                const actionJson = match[1];
                const result = await executeAction(actionJson);
                actionResults.push(result);
            }

            if (actionResults.length > 0) {
                responseText += `\n\n**Executed Actions:**\n${actionResults.map(r => `- ${r}`).join('\n')}`;
            }

            // Remove the action blocks from the displayed text to keep UI clean
            responseText = responseText.replace(/```action\s*[\s\S]*?```/gi, '').trim();

            // CRITICAL FIX: Clear streaming text and current request id FIRST, before adding the AI message.
            // Nulling currentRequestIdRef ensures any late requestAnimationFrame from the stream won't re-apply streaming text (no duplicate).
            setStreamingText('');
            abortControllerRef.current = null;
            currentRequestIdRef.current = null;

            // Append AI Response (only if we have something and this request hasn't been processed)
            if (responseText && !processedRequestsRef.current.has(requestId)) {
                // Mark this request as processed
                processedRequestsRef.current.add(requestId);

                // Clean up old processed requests (keep last 10 to prevent memory leak)
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

                setSessions(prev => {
                    const newSessions = prev.map(s => {
                        if (s.id === currentSessionId) {
                            // Additional safety check - verify message ID doesn't already exist
                            const alreadyExists = s.messages.some(m => m.id === aiMsgId);
                            if (alreadyExists) {
                                console.log('[AIAssistant] Skipping duplicate AI message by ID');
                                return s;
                            }

                            return { ...s, messages: [...s.messages, aiMsg], updatedAt: Date.now() };
                        }
                        return s;
                    });
                    return newSessions;
                });
            }

        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error('AI Error:', error);
                const errorMsg: Message = {
                    id: Date.now().toString(),
                    role: 'ai',
                    text: "I'm sorry, I encountered an error. Please try again.",
                    timestamp: Date.now()
                };
                setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, errorMsg], updatedAt: Date.now() } : s));
            }
        } finally {
            setIsLoading(false);
            setStreamingText('');
            abortControllerRef.current = null;
            currentRequestIdRef.current = null;
            // Add a small delay before allowing next send to prevent double-clicks
            setTimeout(() => {
                isSendingRef.current = false;
            }, 300);
        }
    }, [input, sessions, currentSessionId, isLoading, activeFile, fileTree, handleNewChat, selectedModel]);

    // Persist sessions whenever they change
    useEffect(() => {
        if (sessions.length > 0) {
            saveSessions(sessions);
        }
    }, [sessions]);

    // Persist current session ID
    useEffect(() => {
        saveCurrentSessionId(currentSessionId);
    }, [currentSessionId]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

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
                <div className="flex flex-col h-full bg-[#0d1117]/95 backdrop-blur-xl border-r border-[#30363d]/50">
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
                                    if (confirm('Clear all conversations?')) {
                                        setSessions([]);
                                        saveSessions([]);
                                        handleNewChat();
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
                <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-white/10 bg-white/[0.02] backdrop-blur-2xl backdrop-saturate-150 z-20 transition-all relative overflow-hidden group/header">
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
                        {activeFile && (
                            <span className="text-[11px] text-zinc-500 truncate font-medium tracking-wide leading-none px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 max-w-[140px]">
                                {activeFile.name}
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
                <div
                    ref={messagesContainerRef}
                    onScroll={handleScroll}
                    className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-14 pb-10 space-y-6 custom-scrollbar w-full scroll-smooth ${messages.length > 0 || streamingText ? 'pb-40' : ''}`}
                    style={{ overflowAnchor: 'auto' }}
                >
                    {messages.length === 0 && !streamingText ? (
                        <div className="min-h-full flex flex-col items-center justify-center p-4 pb-12 animate-fade-in-up w-full">

                            {/* Hero Section Container */}
                            <div className="relative mb-8 group cursor-default">
                                {/* Ambient Glow Background */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180px] h-[180px] sm:w-[220px] sm:h-[220px] bg-violet-500/20 rounded-full blur-[50px] sm:blur-[70px] opacity-40 animate-pulse-slow mix-blend-screen pointer-events-none" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] bg-blue-500/15 rounded-full blur-[30px] sm:blur-[50px] opacity-10 animate-pulse-slow delay-300 mix-blend-screen pointer-events-none" />

                                {/* Main Logo - Floating with Aura */}
                                <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center animate-float-slow group/orb cursor-pointer" onClick={() => handleQuickAction("Hello AI")}>
                                    {/* Ambient Aura - Soft rotating gradients */}
                                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(139,92,246,0.15)_120deg,rgba(59,130,246,0.15)_240deg,transparent_360deg)] animate-spin-slower opacity-60 blur-2xl scale-150" />
                                    <div className="absolute inset-0 bg-[conic-gradient(from_180deg,transparent_0deg,rgba(139,92,246,0.1)_120deg,rgba(59,130,246,0.1)_240deg,transparent_360deg)] animate-spin-reverse opacity-40 blur-xl mix-blend-screen scale-125" />

                                    {/* Central Pulse Glow */}
                                    <div className="absolute inset-0 bg-violet-500/10 rounded-full blur-xl animate-pulse-slow" />

                                    {/* Logo Itself */}
                                    <div className="relative z-10 transition-transform duration-500 group-hover/orb:scale-110 group-hover/orb:rotate-12">
                                        <div className="absolute inset-0 bg-white/20 blur-lg rounded-full animate-pulse-glow" />
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
                                    onSaveEdit={(id) => handleSaveEdit(id)}
                                    onCancelEdit={handleCancelEdit}
                                    onEditStart={handleEditMessage}
                                    onCopy={handleCopyMessage}
                                    onRegenerate={handleRegenerate}
                                    onApplyCode={handleApplyCode}
                                    copiedId={copiedId}
                                    reaction={reactions[msg.id] || null}
                                    onReaction={handleReaction}
                                />
                            ))}

                            {/* Streaming Response */}
                            {streamingText && (
                                <MessageItem
                                    msg={{ text: streamingText, role: 'ai', id: 'streaming' }}
                                    index="streaming"
                                    isEditing={false}
                                    editText=""
                                    setEditText={() => { }}
                                    onSaveEdit={() => { }}
                                    onCancelEdit={() => { }}
                                    onEditStart={() => { }}
                                    onCopy={handleCopyCode}
                                    onRegenerate={undefined}
                                    onApplyCode={handleApplyCode}
                                    copiedId={copiedId}
                                />
                            )}
                        </>
                    )}

                    {isLoading && !deferredStreamingText && (
                        <div className="flex items-center gap-4 pl-2 py-2 message-appear">
                            <div className="relative shrink-0">
                                <div className="w-8 h-8 rounded-2xl bg-[#1a1a2e] border border-white/10 flex items-center justify-center shadow-lg shadow-violet-500/10">
                                    <GeminiLogo size={16} className="text-white/80 animate-pulse" />
                                </div>
                            </div>
                            <div className="typing-indicator">
                                <div className="typing-dot" />
                                <div className="typing-dot" />
                                <div className="typing-dot" />
                            </div>
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
                        {/* Apple Glow Effect - Subtler & Toned Down */}
                        <div className="absolute -inset-[2px] bg-gradient-to-r from-blue-500/30 via-purple-500/30 via-pink-500/30 to-blue-500/30 rounded-[26px] opacity-0 group-focus-within:opacity-100 blur-md transition-all duration-700 animate-gradient-xy" style={{ backgroundSize: '400% 400%' }} />

                        {/* Subtle ambient glow always visible */}
                        <div className="absolute -inset-[1px] bg-white/5 rounded-[26px] blur-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500" />

                        {/* Main Input Container */}
                        <div className="relative flex items-end gap-2 bg-[#18181b] backdrop-blur-3xl border border-white/10 rounded-[26px] shadow-lg shadow-black/20 overflow-hidden ring-1 ring-white/5 group-focus-within:ring-white/20 transition-all duration-300 input-focus-glow">

                            {/* Input Shimmer Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent -translate-x-full group-focus-within:animate-shimmer-fast pointer-events-none" />

                            {/* Custom Placeholder Overlay with Blinking Cursor */}
                            {!input && (
                                <div className="absolute inset-0 flex items-center pointer-events-none pl-5 py-[14px] z-0">
                                    <span className="text-[15px] text-white/40 font-normal tracking-wide leading-relaxed">
                                        {placeholderText}
                                        <span className={`ml-[1px] inline-block w-[1.5px] h-[15px] align-middle bg-violet-400 ${!isPlaceholderTyping ? 'animate-cursor-blink' : ''}`} />
                                    </span>
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
                                        disabled={!input.trim()}
                                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${input.trim()
                                            ? 'bg-white text-black hover:scale-105 active:scale-95 shadow-md shadow-white/10'
                                            : 'bg-white/10 text-white/30 cursor-not-allowed'
                                            }`}
                                        title="Send (Enter)"
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


