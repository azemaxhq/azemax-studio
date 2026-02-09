import React from 'react';
import { Activity, AlertTriangle, Terminal, BookOpen } from 'lucide-react';
import { ExplanationPanel } from './ExplanationPanel';
import { TerminalPanel } from './TerminalPanel';
import { useState, useEffect } from 'react';
import { useProject } from '../../context/ProjectContext';
import { generateContent } from '../../utils/groqService';
import { analyzeCode, type AnalysisResult } from '../../utils/codeAnalysisEngine';

export const BottomPanel: React.FC = () => {
    // Persist Active Tab
    const [activeTab, setActiveTab] = useState<'performance' | 'ageing' | 'terminal' | 'explanation'>(() => {
        return (localStorage.getItem('bottomPanel_activeTab') as any) || 'terminal';
    });

    useEffect(() => {
        localStorage.setItem('bottomPanel_activeTab', activeTab);
    }, [activeTab]);

    // Listen for global event to switch to terminal (e.g. on Run)
    useEffect(() => {
        const handleOpenTerminal = () => setActiveTab('terminal');
        window.addEventListener('open-terminal-tab', handleOpenTerminal);
        return () => window.removeEventListener('open-terminal-tab', handleOpenTerminal);
    }, []);
    const { activeFile } = useProject();
    const [explanation, setExplanation] = useState<string | null>(null);
    const [isExplaining, setIsExplaining] = useState(false);
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

    // Reset state when file changes
    useEffect(() => {
        setExplanation(null);
        setAnalysis(null);
    }, [activeFile?.id]);

    const handleExplain = async () => {
        if (!activeFile?.content) return;
        setIsExplaining(true);
        try {
            const result = await generateContent(`Explain this code briefly:\n\n${activeFile.content}`);
            setExplanation(result);
        } catch (e) {
            setExplanation("Failed to generate explanation.");
        } finally {
            setIsExplaining(false);
        }
    };



    // Auto-run analysis when switching to Code Ageing tab or when file changes
    useEffect(() => {
        if (activeTab === 'ageing' && activeFile && !analysis) {
            // Run analysis even for empty content
            const content = activeFile.content || '';
            const result = analyzeCode(content);
            setAnalysis(result);
        }
    }, [activeTab, activeFile, analysis]);

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Glass Tab Bar */}
            {/* Glass Tab Bar - Compact & Solid */}
            <div className="flex items-center px-2 border-b border-white/5 bg-white/[0.02] shrink-0 h-8">
                <button
                    className={`glass-tab flex items-center gap-2 ${activeTab === 'performance' ? 'active' : ''}`}
                    onClick={() => setActiveTab('performance')}
                >
                    <Activity size={14} />
                    <span className="hidden sm:inline">Performance</span>
                </button>
                <button
                    className={`glass-tab flex items-center gap-2 ${activeTab === 'ageing' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ageing')}
                >
                    <AlertTriangle size={14} />
                    <span className="hidden sm:inline">Code Ageing</span>
                </button>
                <button
                    className={`glass-tab flex items-center gap-2 ${activeTab === 'terminal' ? 'active' : ''}`}
                    onClick={() => setActiveTab('terminal')}
                >
                    <Terminal size={14} />
                    <span className="hidden sm:inline">Terminal</span>
                </button>
                <button
                    className={`glass-tab flex items-center gap-2 ${activeTab === 'explanation' ? 'active' : ''}`}
                    onClick={() => setActiveTab('explanation')}
                >
                    <BookOpen size={14} />
                    <span className="hidden sm:inline">Explanation</span>
                </button>
            </div>
            <div className="flex-1 overflow-auto p-0 custom-scrollbar">
                <div className="h-full">
                    {activeTab === 'performance' && (
                        <div className="p-4 glass-empty-state h-full">
                            <div className="glass-empty-state-icon">
                                <Activity size={32} className="text-[#8b949e]" />
                            </div>
                            <h3 className="text-white/80 font-medium mb-2">Performance Metrics</h3>
                            <p className="text-[#8b949e] text-sm">Run your code to see performance metrics</p>
                        </div>
                    )}
                    {activeTab === 'ageing' && (
                        <div className="p-4 h-full overflow-y-auto custom-scrollbar">
                            {activeFile ? (
                                analysis ? (
                                    <div className="space-y-6 animate-fade-in-up">
                                        {/* Premium Glass Stats Cards */}
                                        <div className="grid grid-cols-4 gap-4">
                                            <div className="glass-analysis-card success">
                                                <div className="text-[#8b949e] text-[10px] uppercase tracking-wider mb-2 font-semibold">Health Score</div>
                                                <div className={`text-3xl font-bold ${analysis.healthScore > 80 ? 'text-[#3fb950]' : analysis.healthScore > 50 ? 'text-[#febc2e]' : 'text-[#f85149]'}`}>
                                                    {analysis.healthScore}
                                                </div>
                                                <div className="glass-meter mt-3">
                                                    <div className="glass-meter-fill" style={{ width: `${analysis.healthScore}%` }} />
                                                </div>
                                            </div>
                                            <div className={`glass-analysis-card ${analysis.complexity === 'High' ? 'error' : analysis.complexity === 'Medium' ? 'warning' : 'success'}`}>
                                                <div className="text-[#8b949e] text-[10px] uppercase tracking-wider mb-2 font-semibold">Complexity</div>
                                                <div className={`text-2xl font-semibold ${analysis.complexity === 'High' ? 'text-[#f85149]' : analysis.complexity === 'Medium' ? 'text-[#febc2e]' : 'text-[#3fb950]'}`}>
                                                    {analysis.complexity}
                                                </div>
                                            </div>
                                            <div className="glass-analysis-card info">
                                                <div className="text-[#8b949e] text-[10px] uppercase tracking-wider mb-2 font-semibold">Maintainability</div>
                                                <div className="text-2xl font-semibold text-[#58a6ff]">{analysis.maintainability}</div>
                                            </div>
                                            <div className="glass-analysis-card warning">
                                                <div className="text-[#8b949e] text-[10px] uppercase tracking-wider mb-2 font-semibold">Code Ageing</div>
                                                <div className="text-2xl font-semibold text-[#febc2e]">{analysis.codeAgeing}%</div>
                                                <div className="glass-meter mt-3">
                                                    <div className="glass-meter-fill" style={{ width: `${analysis.codeAgeing}%`, background: 'linear-gradient(90deg, #febc2e, #f85149)' }} />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-6">
                                            {/* Code Smells */}
                                            <div className="glass-analysis-card error">
                                                <h4 className="font-semibold mb-3 text-[#f85149] flex items-center gap-2">
                                                    <AlertTriangle size={16} /> Hotspots & Smells
                                                </h4>
                                                {analysis.smells && analysis.smells.length > 0 ? (
                                                    <div className="space-y-3">
                                                        {analysis.smells.map((smell, i) => (
                                                            <div key={i} className="flex gap-3 items-start p-3 bg-black/20 rounded-lg border border-white/5 text-sm">
                                                                <span className={`glass-badge ${smell.severity === 'error' ? 'glass-badge-error' : smell.severity === 'warning' ? 'glass-badge-warning' : ''}`}>
                                                                    {smell.severity}
                                                                </span>
                                                                <div>
                                                                    <div className="text-[#c9d1d9]">{smell.message}</div>
                                                                    {smell.line && <div className="text-[#8b949e] text-xs mt-1">Line {smell.line}</div>}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-[#3fb950] text-sm flex items-center gap-2">
                                                        <span className="glass-status-dot online" />
                                                        No major code smells detected. Good job!
                                                    </div>
                                                )}
                                            </div>

                                            {/* Halstead Metrics */}
                                            <div className="glass-analysis-card info">
                                                <h4 className="font-semibold mb-3 text-[#58a6ff] flex items-center gap-2">
                                                    <Activity size={16} /> Halstead Metrics
                                                </h4>
                                                <div className="grid grid-cols-2 gap-4 text-sm">
                                                    <div className="p-3 bg-black/20 rounded-lg">
                                                        <div className="text-[#8b949e] text-xs mb-1">Vocabulary</div>
                                                        <div className="font-mono text-[#c9d1d9] text-lg">{analysis.halstead?.vocabulary}</div>
                                                    </div>
                                                    <div className="p-3 bg-black/20 rounded-lg">
                                                        <div className="text-[#8b949e] text-xs mb-1">Program Volume</div>
                                                        <div className="font-mono text-[#c9d1d9] text-lg">{analysis.halstead?.volume}</div>
                                                    </div>
                                                    <div className="p-3 bg-black/20 rounded-lg">
                                                        <div className="text-[#8b949e] text-xs mb-1">Difficulty</div>
                                                        <div className="font-mono text-[#c9d1d9] text-lg">{analysis.halstead?.difficulty}</div>
                                                    </div>
                                                    <div className="p-3 bg-black/20 rounded-lg">
                                                        <div className="text-[#8b949e] text-xs mb-1">Est. Effort</div>
                                                        <div className="font-mono text-[#c9d1d9] text-lg">{analysis.halstead?.effort}</div>
                                                    </div>
                                                </div>
                                                {analysis.suggestions.length > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-white/10">
                                                        <div className="glass-badge glass-badge-success mb-2">AI Suggestion</div>
                                                        <div className="text-sm text-[#c9d1d9] bg-[#3fb950]/10 p-3 rounded-lg border border-[#3fb950]/20 italic">
                                                            "{analysis.suggestions[0]}"
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="text-center">
                                            <div className="w-8 h-8 mx-auto rounded-full border-2 border-[#58a6ff]/30 border-t-[#58a6ff] animate-spin mb-3" />
                                            <span className="text-[#8b949e]">Analyzing code...</span>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="glass-empty-state h-full">
                                    <div className="glass-empty-state-icon">
                                        <BookOpen size={32} className="text-[#8b949e]" />
                                    </div>
                                    <h3 className="text-white/80 font-medium mb-2">No File Open</h3>
                                    <p className="text-[#8b949e] text-sm">Open a file to run code ageing analysis</p>
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'terminal' && (
                        <TerminalPanel />
                    )}
                    {activeTab === 'explanation' && (
                        <div className="h-full flex flex-col">
                            {!explanation && !isExplaining && (
                                <div className="p-4 text-center border-b border-white/10 bg-gradient-to-r from-[#a371f7]/5 to-transparent">
                                    <button
                                        onClick={handleExplain}
                                        disabled={!activeFile}
                                        className="glass-button-primary"
                                    >
                                        {activeFile ? 'Explain Active File' : 'Open a file to explain'}
                                    </button>
                                </div>
                            )}
                            <ExplanationPanel explanation={explanation} isLoading={isExplaining} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
