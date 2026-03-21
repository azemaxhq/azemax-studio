import React from 'react';
import { BookOpen, FileText, MousePointer, Settings, History, Star, TrendingUp } from 'lucide-react';
import { useExplanation } from '../../context/ExplanationContext';
import { ExplanationPanel } from '../Panels/ExplanationPanel';
import { motion } from 'framer-motion';

export const ExplanationSidebar: React.FC = () => {
    const {
        explanation,
        explanationError,
        isExplaining,
        handleExplain,
        handleExplainSelection,
        handleClearExplanation,
        handleRetryExplanation,
        handleSendExplanationToTerminal,
        canSendToTerminal,
    } = useExplanation();

    const extractTopics = (text: string): string[] => {
        if (!text) return [];
        const topics: string[] = [];
        
        const hasWord = (words: string[]) => words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(text));

        if (hasWord(['function', 'method', 'callback', 'arrow', 'def'])) topics.push('Functions');
        if (hasWord(['class', 'object', 'oop', 'constructor'])) topics.push('Classes & Objects');
        if (hasWord(['async', 'await', 'promise', 'fetch'])) topics.push('Async/Promises');
        if (hasWord(['error', 'exception', 'try', 'catch', 'throw'])) topics.push('Error Handling');
        if (hasWord(['api', 'endpoint', 'http', 'rest', 'graphql'])) topics.push('API');
        if (hasWord(['react', 'component', 'hook', 'jsx', 'tsx', 'useeffect', 'usestate', 'render'])) topics.push('React');
        if (hasWord(['typescript', 'type', 'interface', 'enum', 'generic'])) topics.push('TypeScript');
        if (hasWord(['state', 'context', 'redux', 'zustand', 'reducer'])) topics.push('State Management');
        if (hasWord(['style', 'css', 'tailwind', 'classname', 'sass'])) topics.push('Styling');
        if (hasWord(['test', 'mock', 'jest', 'vitest', 'expect'])) topics.push('Testing');
        if (hasWord(['database', 'sql', 'query', 'model', 'schema', 'orm'])) topics.push('Database');
        if (hasWord(['security', 'auth', 'token', 'jwt', 'password', 'login'])) topics.push('Security');
        if (hasWord(['performance', 'optimize', 'memo', 'cache'])) topics.push('Performance');

        if (topics.length === 0) topics.push('General');
        
        // Return up to 4 to keep UI clean
        return topics.slice(0, 4);
    };

    // Mock explanation stats - in a real app, this would come from the explanation service
    const explanationStats = explanation ? {
        wordCount: explanation.split(/\s+/).length,
        readingTime: Math.ceil(explanation.split(/\s+/).length / 200), // Assuming 200 words per minute
        topics: extractTopics(explanation)
    } : undefined;

    const handleExport = () => {
        console.log('Export explanation');
    };

    const handleShare = () => {
        console.log('Share explanation');
    };

    return (
        <motion.div
            key="explanation-sidebar"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-full flex flex-col min-h-0 bg-transparent"
        >
            {/* Header */}
            <div className="shrink-0 relative z-10">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#a371f7]/25 to-transparent z-20" />
                <div className="h-11 px-3 flex items-center justify-between border-b border-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#a371f7]/20 to-[#58a6ff]/10 border border-[#a371f7]/30 flex items-center justify-center shrink-0">
                            <BookOpen size={14} className="text-[#a371f7]" />
                        </div>
                        <span className="text-[11px] font-medium tracking-wider text-white/70 uppercase truncate">
                            Explanation
                        </span>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="shrink-0 p-2.5 flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-gradient-to-r from-[#a371f7]/[0.07] to-transparent">
                <button
                    onClick={handleExplain}
                    disabled={isExplaining}
                    title="Explain the entire active file"
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#a371f7]/25 bg-[#a371f7]/10 text-[#c9a8ff] hover:bg-[#a371f7]/20 hover:border-[#a371f7]/35 text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none shadow-sm"
                >
                    <FileText size={14} className="shrink-0" />
                    Explain File
                </button>
                <button
                    onClick={handleExplainSelection}
                    disabled={isExplaining}
                    title="Select code in the editor, then click"
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#58a6ff]/25 bg-[#58a6ff]/10 text-[#58a6ff] hover:bg-[#58a6ff]/20 hover:border-[#58a6ff]/35 text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none shadow-sm"
                >
                    <MousePointer size={14} className="shrink-0" />
                    Explain Selection
                </button>
            </div>

            {/* Content - flexible */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <ExplanationPanel
                    explanation={explanation}
                    isLoading={isExplaining}
                    error={explanationError}
                    onClear={handleClearExplanation}
                    onRetry={handleRetryExplanation}
                    onExport={handleExport}
                    onShare={handleShare}
                    explanationStats={explanationStats}
                />
            </div>
        </motion.div>
    );
};
