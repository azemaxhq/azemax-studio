import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { BookOpen, Lightbulb, Code2, Copy, Trash2, RefreshCw, AlertCircle, Download, Share2, Clock, Star, TrendingUp, FileText, Zap, Target, Layers, MessageSquare } from 'lucide-react';
import { ModernAILogo } from '../Icons/ModernAILogo';

interface ExplanationPanelProps {
    explanation?: string | null;
    isLoading?: boolean;
    error?: string | null;
    onClear?: () => void;
    onRetry?: () => void;
    onExport?: () => void;
    onShare?: () => void;
    onSearch?: (query: string) => void;
    explanationStats?: {
        wordCount: number;
        readingTime: number;
        topics: string[];
    };
}

export const ExplanationPanel: React.FC<ExplanationPanelProps> = ({
    explanation,
    isLoading,
    error,
    onClear,
    onRetry,
    onExport,
    onShare,
    explanationStats
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (!explanation) return;
        navigator.clipboard.writeText(explanation);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [explanation]);

    const hasContent = explanation || error;
    const showEmpty = !isLoading && !explanation && !error;

    const handleExport = useCallback(() => {
        if (!explanation) return;
        const blob = new Blob([explanation], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'explanation.md';
        a.click();
        URL.revokeObjectURL(url);
        onExport?.();
    }, [explanation, onExport]);

    const handleShare = useCallback(() => {
        if (!explanation) return;
        navigator.clipboard.writeText(explanation);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        onShare?.();
    }, [explanation, onShare]);



    return (
        <div className="h-full flex flex-col glass-explanation overflow-hidden">
            {/* Enhanced Header */}
            <div className="glass-explanation-header flex-shrink-0 w-full">
                <div className="flex items-start justify-between w-full">
                    <div className="flex items-start gap-3">
                        <div className="glass-explanation-icon shrink-0">
                            <BookOpen size={16} />
                        </div>
                        <div>
                            <span className="font-semibold text-white text-sm block leading-tight">Code Explanation</span>
                            {explanationStats && (
                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                    <span className="text-xs text-gray-400">{explanationStats.wordCount} words</span>
                                    <span className="text-xs text-gray-400">{explanationStats.readingTime} min read</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-auto pt-0.5">
                        {explanation && (
                            <>
                                <button
                                    onClick={handleExport}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    title="Export explanation"
                                >
                                    <Download size={13} />
                                </button>
                                <button
                                    onClick={handleShare}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    title="Share explanation"
                                >
                                    <Share2 size={13} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-4 overflow-y-auto custom-scrollbar min-h-0">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center min-h-[300px] gap-6 animate-in fade-in duration-500">
                        {/* Premium Glowing Core */}
                        <div className="relative flex items-center justify-center w-24 h-24">
                            {/* Outer pulsing rings */}
                            <div className="absolute inset-0 rounded-full border border-[#a371f7]/20 border-t-[#a371f7]/60 animate-[spin_3s_linear_infinite]" />
                            <div className="absolute inset-1 rounded-full border border-dashed border-[#58a6ff]/30 animate-[spin_4s_linear_infinite_reverse]" />
                            <div className="absolute inset-2 rounded-full border border-[#a371f7]/10 border-b-[#a371f7]/40 animate-[spin_2s_linear_infinite]" />
                            
                            {/* Inner ambient glow */}
                            <div className="absolute inset-6 rounded-full bg-gradient-to-tr from-[#a371f7]/30 to-[#58a6ff]/30 blur-xl animate-pulse" style={{ animationDuration: '2s' }} />
                            
                            {/* Center Logo */}
                            <div className="relative w-12 h-12 rounded-2xl bg-[#0d1117] border border-[#a371f7]/40 flex items-center justify-center shadow-[0_0_20px_rgba(163,113,247,0.3)] z-10 transition-transform hover:scale-105">
                                <ModernAILogo className="w-6 h-6 text-[#e6edf3] drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] animate-pulse" />
                            </div>
                        </div>
                        
                        {/* Status Text */}
                        <div className="text-center space-y-2">
                            <h3 className="text-[#e6edf3] font-medium text-sm tracking-wide flex items-center justify-center gap-2">
                                Decoding Logic
                                <div className="flex gap-0.5 mt-0.5">
                                    <div className="w-1 h-1 rounded-full bg-[#a371f7] animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <div className="w-1 h-1 rounded-full bg-[#58a6ff] animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <div className="w-1 h-1 rounded-full bg-[#a371f7] animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </h3>
                            <p className="text-[#8b949e] text-xs max-w-[200px] mx-auto leading-relaxed">
                                Analyzing architecture, patterns, and structure...
                            </p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="glass-analysis-card animate-fade-in-up rounded-xl border border-[#f85149]/30 bg-[#f85149]/5 p-4">
                        <div className="flex items-start gap-3">
                            <AlertCircle size={20} className="text-[#f85149] shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <h3 className="text-[#f85149] font-medium text-sm mb-1">Explanation failed</h3>
                                <p className="text-[#8b949e] text-xs leading-relaxed mb-3">{error}</p>
                                <div className="flex gap-2 flex-wrap">
                                    {onRetry && (
                                        <button
                                            onClick={onRetry}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#58a6ff]/15 text-[#58a6ff] hover:bg-[#58a6ff]/25 text-xs font-medium transition-colors"
                                        >
                                            <RefreshCw size={12} />
                                            Try again
                                        </button>
                                    )}
                                    <button
                                        onClick={handleCopy}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-gray-300 hover:bg-white/20 text-xs font-medium transition-colors"
                                    >
                                        <Copy size={12} />
                                        Copy error
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : explanation ? (
                    <div className="animate-fade-in-up space-y-4">
                        {/* Topics */}
                        {explanationStats?.topics && explanationStats.topics.length > 0 && (
                            <div className="glass-analysis-card info">
                                <div className="flex items-center gap-2 mb-3">
                                    <Target size={16} className="text-blue-400 shrink-0" />
                                    <span className="text-white font-medium text-sm">Key Topics</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {explanationStats.topics.map((topic, index) => (
                                        <span
                                            key={index}
                                            className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-md border border-blue-500/30"
                                        >
                                            {topic}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        
                        {/* Main Explanation Card */}
                        <div className="glass-analysis-card info">
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#58a6ff]/20 to-[#a371f7]/20 border border-[#58a6ff]/30 flex items-center justify-center shrink-0">
                                        <ModernAILogo className="w-3.5 h-3.5 text-[#58a6ff]" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-white font-medium text-sm mb-0.5 truncate">Analysis</h3>
                                        <p className="text-[#8b949e] text-xs truncate">Understanding your code</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={handleCopy}
                                        className="p-1.5 rounded-lg text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/5 transition-colors flex-shrink-0"
                                        title="Copy explanation"
                                    >
                                        <Copy size={13} />
                                    </button>
                                    {onClear && (
                                        <button
                                            onClick={onClear}
                                            className="p-1.5 rounded-lg text-[#8b949e] hover:text-[#f85149] hover:bg-[#f85149]/10 transition-colors flex-shrink-0"
                                            title="Clear"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                    {onRetry && (
                                        <button
                                            onClick={onRetry}
                                            className="p-1.5 rounded-lg text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10 transition-colors flex-shrink-0"
                                            title="Regenerate"
                                        >
                                            <RefreshCw size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {copied && (
                                <p className="text-[10px] text-[#3fb950] mb-2 flex items-center gap-1">
                                    <Star size={10} className="fill-current" />
                                    Copied to clipboard
                                </p>
                            )}
                            <div className="glass-divider" />
                            <div className="explanation-markdown text-[#c9d1d9] text-sm leading-relaxed overflow-x-auto">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeRaw]}
                                    components={{
                                        h1: ({ children }) => <h1 className="text-lg font-semibold text-white mt-4 mb-2 first:mt-0 flex items-center gap-2 flex-wrap"><Zap size={16} className="text-yellow-400 shrink-0" />{children}</h1>,
                                        h2: ({ children }) => <h2 className="text-base font-semibold text-white mt-4 mb-2 flex items-center gap-2 flex-wrap"><Layers size={14} className="text-blue-400 shrink-0" />{children}</h2>,
                                        h3: ({ children }) => <h3 className="text-sm font-medium text-white mt-3 mb-1.5 flex items-center gap-2 flex-wrap"><Target size={12} className="text-green-400 shrink-0" />{children}</h3>,
                                        p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed break-words">{children}</p>,
                                        ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1">{children}</ul>,
                                        ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1">{children}</ol>,
                                        li: ({ children }) => <li className="pl-1 break-words">{children}</li>,
                                        code: ({ node, inline, className, children, ...props }: any) => {
                                            const content = String(children).replace(/\n$/, '');
                                            if (inline) {
                                                return <code className="px-1.5 py-0.5 rounded bg-white/10 text-[#e6edf3] font-mono text-xs break-all" {...props}>{content}</code>;
                                            }
                                            return (
                                                <pre className="my-2 p-3 rounded-lg bg-[#0d1117] border border-white/10 overflow-x-auto text-xs font-mono text-[#e6edf3] max-w-full">
                                                    <code {...props}>{content}</code>
                                                </pre>
                                            );
                                        },
                                        blockquote: ({ children }) => (
                                            <blockquote className="border-l-2 border-[#58a6ff] pl-3 py-1 my-2 text-[#8b949e] text-xs bg-blue-500/5 rounded-r break-words">
                                                {children}
                                            </blockquote>
                                        ),
                                        strong: ({ children }) => <strong className="font-semibold text-white break-words">{children}</strong>,
                                        a: ({ href, children }) => (
                                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline inline-flex items-center gap-1 break-all">
                                                {children}
                                                <Share2 size={10} className="shrink-0" />
                                            </a>
                                        )
                                    }}
                                >
                                    {explanation}
                                </ReactMarkdown>
                            </div>
                        </div>
                        
                        {/* Quick Actions */}
                        <div className="flex gap-1.5 justify-center flex-wrap">
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors text-sm"
                            >
                                <Download size={13} />
                                Export
                            </button>
                            <button
                                onClick={handleShare}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-300 hover:bg-blue-500/30 transition-colors text-sm"
                            >
                                <Share2 size={13} />
                                Share
                            </button>
                        </div>
                    </div>
                ) : showEmpty ? (
                    <div className="flex flex-col items-center justify-center min-h-[220px] px-4 py-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#a371f7]/20 to-[#58a6ff]/10 border border-[#a371f7]/25 flex items-center justify-center mb-5 shadow-[0_4px_24px_-4px_rgba(163,113,247,0.2)]">
                            <BookOpen size={28} className="text-[#a371f7]/90" />
                        </div>
                        <h3 className="text-white/90 font-semibold text-base mb-1.5">No explanation yet</h3>
                        <p className="text-[#8b949e] text-sm text-center max-w-[260px] mb-6">
                            Use the buttons above to explain the active file or a selection.
                        </p>
                        <div className="w-full max-w-[280px] space-y-2.5">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-[#a371f7]/20 hover:bg-white/[0.06] transition-colors">
                                <div className="w-9 h-9 rounded-lg bg-[#a371f7]/15 flex items-center justify-center shrink-0">
                                    <Code2 size={16} className="text-[#a371f7]" />
                                </div>
                                <div className="min-w-0">
                                    <span className="text-xs font-medium text-white/90 block">Explain File</span>
                                    <span className="text-[11px] text-[#8b949e]">Analyzes the whole file</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-[#58a6ff]/20 hover:bg-white/[0.06] transition-colors">
                                <div className="w-9 h-9 rounded-lg bg-[#58a6ff]/15 flex items-center justify-center shrink-0">
                                    <Lightbulb size={16} className="text-[#58a6ff]" />
                                </div>
                                <div className="min-w-0">
                                    <span className="text-xs font-medium text-white/90 block">Explain Selection</span>
                                    <span className="text-[11px] text-[#8b949e]">Select code first, then click above</span>
                                </div>
                            </div>
                        </div>
                        
                        {/* Feature Highlights */}
                        <div className="mt-6 text-center">
                            <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                    <Zap size={12} className="text-yellow-400" />
                                    <span>Smart Analysis</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Target size={12} className="text-blue-400" />
                                    <span>Key Topics</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <MessageSquare size={12} className="text-green-400" />
                                    <span>Clear Explanations</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};
