import React from 'react';
import { BookOpen, Lightbulb, Code2, FileText } from 'lucide-react';
import { ModernAILogo } from '../Icons/ModernAILogo';

interface ExplanationPanelProps {
    explanation?: string | null;
    isLoading?: boolean;
}

export const ExplanationPanel: React.FC<ExplanationPanelProps> = ({ explanation, isLoading }) => {
    return (
        <div className="h-full flex flex-col glass-explanation">
            {/* Premium Glass Header */}
            <div className="glass-explanation-header">
                <div className="glass-explanation-icon">
                    <BookOpen size={16} />
                </div>
                <div className="flex flex-col">
                    <span className="font-semibold text-white text-sm">Code Explanation</span>
                    <span className="text-[10px] text-[#8b949e]">AI-powered insights</span>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="relative">
                            <div className="w-12 h-12 rounded-full border-2 border-[#a371f7]/30 border-t-[#a371f7] animate-spin" />
                            <Lightbulb size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#a371f7]" />
                        </div>
                        <div className="text-[#8b949e] text-sm animate-pulse">
                            Generating explanation...
                        </div>
                    </div>
                ) : explanation ? (
                    <div className="glass-analysis-card info animate-fade-in-up">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#58a6ff]/20 to-[#a371f7]/20 border border-[#58a6ff]/30 flex items-center justify-center shrink-0">
                                <ModernAILogo className="w-3.5 h-3.5 text-[#58a6ff]" />
                            </div>
                            <div>
                                <h3 className="text-white font-medium text-sm mb-1">Analysis</h3>
                                <p className="text-[#8b949e] text-xs">Understanding your code</p>
                            </div>
                        </div>
                        <div className="glass-divider" />
                        <div className="text-[#c9d1d9] text-sm leading-relaxed whitespace-pre-wrap">
                            {explanation}
                        </div>
                    </div>
                ) : (
                    <div className="glass-empty-state h-full">
                        <div className="glass-empty-state-icon">
                            <FileText size={32} className="text-[#8b949e]" />
                        </div>
                        <h3 className="text-white/80 font-medium mb-2">No Explanation Yet</h3>
                        <p className="text-[#8b949e] text-sm max-w-xs">
                            Select code in the editor or ask the AI assistant to explain something.
                        </p>

                        {/* Quick tips */}
                        <div className="mt-6 space-y-2 text-left">
                            <div className="flex items-center gap-2 text-xs text-[#8b949e]">
                                <Code2 size={12} className="text-[#58a6ff]" />
                                <span>Select code and ask "Explain this"</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-[#8b949e]">
                                <Lightbulb size={12} className="text-[#febc2e]" />
                                <span>Use /// comments for inline help</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
