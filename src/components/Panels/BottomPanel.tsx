import React, { Suspense, lazy } from 'react';
import { Activity, AlertTriangle, Terminal, Shield, Code, Layers, Paintbrush, Lock, TrendingDown, ChevronRight, Zap, RefreshCw, Wand2, Loader2, CheckCircle, TrendingUp, Calendar, BarChart3 } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { useSettingsSelector } from '../../context/SettingsContext';
import { analyzeCode, type AnalysisResult, type AgeingSignal, type AgeingHotspot } from '../../utils/codeAnalysisEngine';
import { analysisHistory } from '../../utils/analysisHistory';

const PerformancePanel = lazy(() =>
    import('./PerformancePanel').then(m => ({ default: m.PerformancePanel }))
);

const TerminalPanel = lazy(() =>
    import('./TerminalPanel').then(m => ({ default: m.TerminalPanel }))
);

const PanelFallback = () => (
    <div className="flex-1 flex items-center justify-center bg-transparent perf-content-visibility-auto">
        <div className="text-white/30 text-sm">Loading panel...</div>
    </div>
);

// Helper to detect language from file name
const getLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', java: 'java', c: 'c', cpp: 'cpp', go: 'go',
        rs: 'rust', rb: 'ruby', php: 'php', css: 'css', html: 'html',
        json: 'json', md: 'markdown', sh: 'shell', yml: 'yaml', yaml: 'yaml',
    };
    return map[ext] || 'plaintext';
};

// ────────────────────────────────────────────
// Ageing Grade Badge Component
// ────────────────────────────────────────────
const gradeColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    'A+': { bg: 'rgba(63, 185, 80, 0.15)', border: 'rgba(63, 185, 80, 0.4)', text: '#3fb950', glow: 'rgba(63, 185, 80, 0.3)' },
    'A': { bg: 'rgba(63, 185, 80, 0.12)', border: 'rgba(63, 185, 80, 0.35)', text: '#3fb950', glow: 'rgba(63, 185, 80, 0.2)' },
    'B': { bg: 'rgba(88, 166, 255, 0.12)', border: 'rgba(88, 166, 255, 0.35)', text: '#58a6ff', glow: 'rgba(88, 166, 255, 0.2)' },
    'C': { bg: 'rgba(254, 188, 46, 0.12)', border: 'rgba(254, 188, 46, 0.35)', text: '#febc2e', glow: 'rgba(254, 188, 46, 0.2)' },
    'D': { bg: 'rgba(248, 130, 73, 0.12)', border: 'rgba(248, 130, 73, 0.35)', text: '#f88249', glow: 'rgba(248, 130, 73, 0.2)' },
    'F': { bg: 'rgba(248, 81, 73, 0.15)', border: 'rgba(248, 81, 73, 0.4)', text: '#f85149', glow: 'rgba(248, 81, 73, 0.3)' },
};

const GradeBadge: React.FC<{ grade: string; label: string }> = ({ grade, label }) => {
    const colors = gradeColors[grade] || gradeColors['C'];
    return (
        <div
            className="flex items-center gap-4 px-5 py-3 rounded-xl transition-all duration-300"
            style={{
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                boxShadow: `0 0 20px ${colors.glow}`
            }}
        >
            <div
                className="text-4xl font-black tracking-tight leading-none"
                style={{ color: colors.text, textShadow: `0 0 15px ${colors.glow}` }}
            >
                {grade}
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-[#8b949e] font-semibold">Code Age Grade</span>
                <span className="text-xs mt-0.5" style={{ color: colors.text }}>{label}</span>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────
// Signal Bar Component
// ────────────────────────────────────────────
const severityColors: Record<string, string> = {
    critical: '#f85149',
    high: '#f88249',
    medium: '#febc2e',
    low: '#3fb950',
};

const SignalBar: React.FC<{ signal: AgeingSignal; maxScore: number }> = ({ signal, maxScore }) => {
    const barWidth = maxScore > 0 ? Math.max(4, (signal.score * signal.weight / maxScore) * 100) : 0;
    const color = severityColors[signal.severity] || '#8b949e';

    return (
        <div className="group p-3 rounded-lg bg-black/20 border border-white/5 hover:border-white/10 transition-all duration-200 hover:bg-black/30">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-base">{signal.icon}</span>
                    <span className="text-xs font-semibold text-[#e6edf3]">{signal.name}</span>
                    <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider"
                        style={{
                            color,
                            background: `${color}15`,
                            border: `1px solid ${color}30`
                        }}
                    >
                        {signal.severity}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#8b949e] font-mono">{signal.count} found</span>
                    <span className="text-xs font-bold font-mono" style={{ color }}>
                        {Math.round(signal.score * signal.weight)}
                    </span>
                </div>
            </div>
            <div className="h-1.5 bg-[#0d1117] rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                        width: `${barWidth}%`,
                        background: `linear-gradient(90deg, ${color}90, ${color})`,
                        boxShadow: `0 0 8px ${color}40`
                    }}
                />
            </div>
            <p className="text-[10px] text-[#8b949e] mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {signal.description}
            </p>
        </div>
    );
};

// ────────────────────────────────────────────
// Category Radar Component (simple horizontal bars)
// ────────────────────────────────────────────
const categoryIcons: Record<string, React.ReactNode> = {
    syntax: <Code size={12} />,
    patterns: <Layers size={12} />,
    structure: <TrendingDown size={12} />,
    style: <Paintbrush size={12} />,
    security: <Lock size={12} />,
};

const categoryLabels: Record<string, string> = {
    syntax: 'Syntax',
    patterns: 'Patterns',
    structure: 'Structure',
    style: 'Style',
    security: 'Security',
};

const CategoryBreakdown: React.FC<{ scores: Record<string, number> }> = ({ scores }) => {
    return (
        <div className="space-y-2.5">
            {Object.entries(scores).map(([cat, score]) => (
                <div key={cat} className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5 w-20 shrink-0">
                        <span className="text-[#8b949e]">{categoryIcons[cat]}</span>
                        <span className="text-[10px] text-[#8b949e] font-medium">{categoryLabels[cat]}</span>
                    </div>
                    <div className="flex-1 h-2 bg-[#0d1117] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{
                                width: `${Math.max(2, score)}%`,
                                background: score > 60
                                    ? 'linear-gradient(90deg, #f85149, #f88249)'
                                    : score > 30
                                        ? 'linear-gradient(90deg, #febc2e, #f88249)'
                                        : score > 0
                                            ? 'linear-gradient(90deg, #58a6ff, #a371f7)'
                                            : '#3fb950',
                            }}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-[#8b949e] w-7 text-right">{score}%</span>
                </div>
            ))}
        </div>
    );
};

// ────────────────────────────────────────────
// Hotspot Item Component
// ────────────────────────────────────────────
const HotspotItem: React.FC<{ hotspot: AgeingHotspot; index: number }> = ({ hotspot, index }) => {
    const color = severityColors[hotspot.severity] || '#8b949e';
    return (
        <div
            className="flex gap-3 p-2.5 rounded-lg bg-black/20 border border-white/5 hover:border-white/10 transition-all duration-200 group"
            style={{ animationDelay: `${index * 40}ms` }}
        >
            <div className="shrink-0 flex flex-col items-center gap-1">
                <div
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold font-mono"
                    style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
                >
                    {hotspot.line}
                </div>
                <div className="w-0.5 flex-1 rounded-full" style={{ background: `${color}30` }} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span
                        className="text-[8px] px-1 py-[1px] rounded font-bold uppercase tracking-wider"
                        style={{ color, background: `${color}15` }}
                    >
                        {hotspot.severity}
                    </span>
                    <span className="text-[10px] text-[#8b949e]">Line {hotspot.line}</span>
                </div>
                <code className="text-[11px] text-[#c9d1d9] font-mono block truncate opacity-80">
                    {hotspot.code}
                </code>
                <p className="text-[10px] text-[#8b949e] mt-1 flex items-center gap-1">
                    <ChevronRight size={8} className="shrink-0" />
                    {hotspot.reason}
                </p>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────
// Circular Score Component
// ────────────────────────────────────────────
const CircularScore: React.FC<{ score: number; size?: number }> = ({ score, size = 80 }) => {
    const freshness = 100 - score;
    const radius = (size - 8) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (freshness / 100) * circumference;
    const color = score <= 15 ? '#3fb950' : score <= 30 ? '#58a6ff' : score <= 50 ? '#febc2e' : score <= 70 ? '#f88249' : '#f85149';

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(48, 54, 61, 0.5)" strokeWidth={4} />
                <circle
                    cx={size / 2} cy={size / 2} r={radius} fill="none"
                    stroke={color}
                    strokeWidth={4}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                    style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold" style={{ color }}>{score}%</span>
                <span className="text-[8px] text-[#8b949e] uppercase tracking-wider">Aged</span>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────
// Trend Chart Component
// ────────────────────────────────────────────
const TrendChart: React.FC<{ fileId: string }> = ({ fileId }) => {
    const [trendData, setTrendData] = useState<any>(null);
    const [showHistory, setShowHistory] = useState(false);

    useEffect(() => {
        const data = analysisHistory.getTrendData(fileId);
        setTrendData(data);
    }, [fileId]);

    if (!trendData || trendData.snapshots.length < 2) {
        return (
            <div className="glass-analysis-card info">
                <h4 className="font-semibold mb-3 text-[#58a6ff] flex items-center gap-2 text-sm">
                    <BarChart3 size={14} /> Code Age Trend
                </h4>
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <Calendar size={24} className="text-[#8b949e]/50" />
                    <span className="text-[#8b949e] text-sm">No trend data available</span>
                    <span className="text-[10px] text-[#8b949e]">Analyze this file multiple times to see trends</span>
                </div>
            </div>
        );
    }

    const recentSnapshots = trendData.snapshots.slice(-10);
    const maxScore = Math.max(...recentSnapshots.map((s: any) => s.analysis.codeAgeing));
    const minScore = Math.min(...recentSnapshots.map((s: any) => s.analysis.codeAgeing));
    const scoreRange = maxScore - minScore || 1;

    return (
        <div className="glass-analysis-card info">
            <h4 className="font-semibold mb-3 text-[#58a6ff] flex items-center gap-2 text-sm">
                <BarChart3 size={14} /> Code Age Trend
                <div className="ml-auto flex items-center gap-2">
                    {trendData.trend.improving ? (
                        <div className="flex items-center gap-1 text-[#3fb950]">
                            <TrendingUp size={12} />
                            <span className="text-[10px]">Improving</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 text-[#f85149]">
                            <TrendingDown size={12} />
                            <span className="text-[10px]">Declining</span>
                        </div>
                    )}
                    <span className="text-[10px] text-[#8b949e]">
                        {trendData.trend.changeRate > 0 ? '+' : ''}{trendData.trend.changeRate}%
                    </span>
                </div>
            </h4>

            {/* Mini trend chart */}
            <div className="mb-3 p-2 bg-black/20 rounded-lg">
                <div className="flex items-end gap-1 h-16">
                    {recentSnapshots.map((snapshot: any, index: number) => {
                        const score = snapshot.analysis.codeAgeing;
                        const height = ((score - minScore) / scoreRange) * 100;
                        const color = score <= 30 ? '#3fb950' : score <= 50 ? '#febc2e' : score <= 70 ? '#f88249' : '#f85149';
                        
                        return (
                            <div
                                key={index}
                                className="flex-1 bg-gradient-to-t from-black/50 to-transparent rounded-t transition-all duration-300 hover:opacity-80"
                                style={{
                                    height: `${Math.max(4, height)}%`,
                                    background: `linear-gradient(to top, ${color}90, ${color})`
                                }}
                                title={`${new Date(snapshot.timestamp).toLocaleDateString()}: ${score}%`}
                            />
                        );
                    })}
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-[8px] text-[#8b949e]">{minScore}%</span>
                    <span className="text-[8px] text-[#8b949e]">{maxScore}%</span>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#8b949e] uppercase">Stability</div>
                    <div className="text-sm font-bold text-[#c9d1d9]">{trendData.trend.stability}%</div>
                </div>
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#8b949e] uppercase">Analyses</div>
                    <div className="text-sm font-bold text-[#c9d1d9]">{trendData.snapshots.length}</div>
                </div>
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#8b949e] uppercase">Latest</div>
                    <div className="text-sm font-bold text-[#c9d1d9]">{recentSnapshots[recentSnapshots.length - 1]?.analysis.codeAgeing}%</div>
                </div>
            </div>

            {/* History toggle */}
            <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full text-center py-2 text-[11px] text-[#58a6ff] hover:text-white bg-[#58a6ff]/5 hover:bg-[#58a6ff]/10 rounded-lg border border-[#58a6ff]/10 transition-all duration-200"
            >
                {showHistory ? 'Hide' : 'Show'} Analysis History
            </button>

            {/* Detailed history */}
            {showHistory && (
                <div className="mt-3 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                    {recentSnapshots.reverse().map((snapshot: any, index: number) => (
                        <div key={index} className="flex items-center justify-between p-2 rounded bg-black/20">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[#8b949e]">
                                    {new Date(snapshot.timestamp).toLocaleDateString()}
                                </span>
                                <span className="text-[10px] font-mono text-[#c9d1d9]">
                                    {snapshot.analysis.codeAgeing}%
                                </span>
                            </div>
                            <span className="text-[10px] text-[#8b949e]">
                                {snapshot.analysis.ageingDetails.grade}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


// ────────────────────────────────────────────
// Main BottomPanel Component
// ────────────────────────────────────────────
export const BottomPanel: React.FC = () => {
    // Persist Active Tab
    const [activeTab, setActiveTab] = useState<'performance' | 'ageing' | 'terminal'>(() => {
        const saved = localStorage.getItem('bottomPanel_activeTab');
        return (saved === 'performance' || saved === 'ageing' || saved === 'terminal' ? saved : 'performance');
    });

    useEffect(() => {
        localStorage.setItem('bottomPanel_activeTab', activeTab);
    }, [activeTab]);
    
    const { activeFile } = useProjectFile();
    const { updateFileContent } = useProjectActions();
    const { lastExecutionData } = useTerminal();
    
    // Auto-switch to terminal tab when run button is clicked (before execution starts)
    const autoOpenTerminalSetting = useSettingsSelector(s => s.terminal.autoOpenTerminal);

    useEffect(() => {
        // Listen for run button click event
        const handleRunButtonClick = () => {
            if (autoOpenTerminalSetting && activeTab !== 'terminal') {
                setActiveTab('terminal');
            }
        };

        // Add event listener for run button clicks
        window.addEventListener('run-button-clicked', handleRunButtonClick);
        
        return () => {
            window.removeEventListener('run-button-clicked', handleRunButtonClick);
        };
    }, [activeTab, autoOpenTerminalSetting]);
    
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [showAllHotspots, setShowAllHotspots] = useState(false);
    const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
    const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());

    const ageingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastAnalyzedFileIdRef = useRef<string | null>(null);
    const lastAnalyzedContentRef = useRef<string | null>(null);

    // Reset state when file changes
    useEffect(() => {
        setAnalysis(null);
        setShowAllHotspots(false);
        setApplyingIndex(null);
        setAppliedIndices(new Set());
        lastAnalyzedFileIdRef.current = null;
        lastAnalyzedContentRef.current = null;
        if (ageingDebounceRef.current) {
            clearTimeout(ageingDebounceRef.current);
            ageingDebounceRef.current = null;
        }
    }, [activeFile?.id]);

    const runAgeingAnalysis = useCallback(() => {
        if (!activeFile) return;
        const content = activeFile.content ?? '';
        const lang = getLanguage(activeFile.name || 'file.ts');
        lastAnalyzedFileIdRef.current = activeFile.id;
        lastAnalyzedContentRef.current = content;
        setAnalysis(analyzeCode(content, lang));
    }, [activeFile]);

    // Run code ageing when on Code Ageing tab: run when tab or file changes, debounce when only content changes
    useEffect(() => {
        if (activeTab !== 'ageing' || !activeFile) return;
        const fileId = activeFile.id;
        const content = activeFile.content ?? '';
        const lang = getLanguage(activeFile.name || 'file.ts');

        const runNow = () => {
            try {
                const result = analyzeCode(content, lang);
                lastAnalyzedFileIdRef.current = fileId;
                lastAnalyzedContentRef.current = content;
                setAnalysis(result);
                
                // Save to history for trend tracking
                analysisHistory.saveSnapshot(fileId, activeFile.name || 'file.ts', result);
            } catch (err) {
                console.error('[Code Ageing] Analysis failed:', err);
            }
        };

        const fileChanged = lastAnalyzedFileIdRef.current !== fileId;
        const contentUnchanged = content === lastAnalyzedContentRef.current;

        if (fileChanged || lastAnalyzedContentRef.current === null) {
            if (ageingDebounceRef.current) {
                clearTimeout(ageingDebounceRef.current);
                ageingDebounceRef.current = null;
            }
            runNow();
            return;
        }
        if (contentUnchanged) return;

        if (ageingDebounceRef.current) clearTimeout(ageingDebounceRef.current);
        ageingDebounceRef.current = setTimeout(() => {
            ageingDebounceRef.current = null;
            runNow();
        }, 600);

        return () => {
            if (ageingDebounceRef.current) {
                clearTimeout(ageingDebounceRef.current);
                ageingDebounceRef.current = null;
            }
        };
    }, [activeTab, activeFile?.id, activeFile?.content]);

    const handleReanalyze = useCallback(() => {
        if (!activeFile) return;
        setAppliedIndices(new Set());
        setApplyingIndex(null);
        runAgeingAnalysis();
    }, [activeFile, runAgeingAnalysis]);

    const handleApplyRecommendation = useCallback(async (signal: AgeingSignal, index: number) => {
        if (!activeFile?.content || !activeFile.id || applyingIndex !== null) return;
        setApplyingIndex(index);
        try {
            const language = getLanguage(activeFile.name || 'file.ts');

            if (signal.autoFixable) {
                let newContent = activeFile.content;
                // Enhanced deterministic fixes for autoFixable signals
                switch (signal.id) {
                    case 'legacy-var':
                        // More sophisticated var replacement - consider scope
                        newContent = newContent.replace(/\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g, (match, varName) => {
                            // Check if the variable is reassigned later
                            const reassignPattern = new RegExp(`\\b${varName}\\s*=`, 'g');
                            const isReassigned = reassignPattern.test(newContent.split(match)[1]);
                            // Use const for non-reassigned variables, let for reassigned ones
                            return `${isReassigned ? 'let' : 'const'} ${varName} =`;
                        });
                        break;
                    case 'loose-equality':
                        // More precise loose equality replacement
                        newContent = newContent.replace(/([^!=])==([^=])/g, '$1===$2');
                        break;
                    case 'console-statements':
                        // Remove console statements but preserve structure
                        newContent = newContent.replace(/^[ \t]*console\.(log|debug|info|warn|error)\s*\([^)]*\);?[ \t]*$/gm, '');
                        // Clean up empty lines left behind
                        newContent = newContent.replace(/^\s*\n/gm, '\n').replace(/\n{3,}/g, '\n\n');
                        break;
                    case 'null-usage':
                        // Replace NULL with nullptr in C++
                        newContent = newContent.replace(/\bNULL\b/g, 'nullptr');
                        break;
                    case 'string-concat':
                        // Convert string concatenation to template literals
                        newContent = newContent.replace(/(["'])([^"']*)\1\s*\+\s*(\w+)\s*\+\s*["']([^"']*)["']/g, '$1$2$3$4$1');
                        newContent = newContent.replace(/(\w+)\s*\+\s*["']([^"']*)["']/g, '`${$1}$2`');
                        newContent = newContent.replace(/["']([^"']*)["']\s*\+\s*(\w+)/g, '`$1${$2}`');
                        break;
                    default:
                        console.warn('No autoFix implemented for', signal.id);
                        setApplyingIndex(null);
                        return;
                }
                updateFileContent(activeFile.id, newContent);
                setAppliedIndices(prev => new Set(prev).add(index));
                setTimeout(() => setAnalysis(analyzeCode(newContent, language)), 300);
            } else {
                // Enhanced AI-powered fixes with context
                const { sendChatRequest } = await import('../../utils/groqService');

                const systemPrompt = `You are an expert code refactoring assistant. You will be given the FULL source code of a file and a specific improvement task.

RULES:
1. Return ONLY the complete, fixed source code - no markdown fences, no explanations
2. Make ONLY the changes necessary to address the specific issue
3. Preserve all existing comments, formatting, and structure
4. Ensure the code remains functional and syntactically correct
5. Follow modern best practices for the given programming language
6. Do not add new imports unless absolutely necessary for the fix`;

                const contextPrompt = `File: ${activeFile.name}
Language: ${language}
Issue: ${signal.name}
Severity: ${signal.severity}
Category: ${signal.category}

Current code:
${activeFile.content}

Required fix: ${signal.recommendation}

Apply the fix while preserving all other code exactly as-is.`;

                const result = await sendChatRequest(
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: contextPrompt }
                    ],
                    { temperature: 0.1 }
                );

                if (result && result.trim().length > 0 && result !== activeFile.content) {
                    updateFileContent(activeFile.id, result);
                    setAppliedIndices(prev => new Set(prev).add(index));
                    setTimeout(() => setAnalysis(analyzeCode(result, language)), 300);
                } else {
                    console.warn('AI fix did not produce changes');
                }
            }
        } catch (error) {
            console.error('[CodeAgeing] Failed to apply recommendation:', error);
        } finally {
            setApplyingIndex(null);
        }
    }, [activeFile, applyingIndex, updateFileContent]);

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Glass Tab Bar */}
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
            </div>
            <div className="flex-1 overflow-auto p-0 custom-scrollbar">
                <div className="h-full">
                    {activeTab === 'performance' && (
                        <Suspense fallback={<PanelFallback />}>
                            <PerformancePanel executionData={lastExecutionData || undefined} />
                        </Suspense>
                    )}
                    {activeTab === 'ageing' && (
                        <div className="p-4 h-full overflow-y-auto custom-scrollbar">
                            {activeFile ? (
                                analysis ? (
                                    <div className="space-y-5 animate-fade-in-up">
                                        {/* ── Top Row: Grade + Score + Category ── */}
                                        <div className="grid grid-cols-3 gap-4 animate-slide-in">
                                            {/* Grade Badge & Summary */}
                                            <div className="glass-analysis-card col-span-1 hover-scale" style={{ '--card-accent': gradeColors[analysis.ageingDetails.grade]?.text || '#58a6ff' } as React.CSSProperties}>
                                                <div className="flex flex-col items-center text-center gap-3">
                                                    <GradeBadge grade={analysis.ageingDetails.grade} label={analysis.ageingDetails.gradeLabel} />
                                                    <CircularScore score={analysis.codeAgeing} size={90} />
                                                    <p className="text-[11px] text-[#8b949e] leading-relaxed px-2">
                                                        {analysis.ageingDetails.summary}
                                                    </p>
                                                    <button
                                                        onClick={handleReanalyze}
                                                        className="flex items-center gap-1.5 text-[10px] text-[#58a6ff] hover:text-white px-3 py-1.5 rounded-lg bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 border border-[#58a6ff]/20 transition-all duration-200 mt-1"
                                                    >
                                                        <RefreshCw size={10} />
                                                        Re-analyze
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Ageing Signals Breakdown */}
                                            <div className="glass-analysis-card col-span-1 warning hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#febc2e] flex items-center gap-2 text-sm">
                                                    <Zap size={14} /> Ageing Signals
                                                    <span className="text-[10px] text-[#8b949e] font-normal ml-auto">
                                                        {analysis.ageingDetails.signals.length} detected
                                                    </span>
                                                </h4>
                                                {analysis.ageingDetails.signals.length > 0 ? (
                                                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                                        {analysis.ageingDetails.signals.map(signal => (
                                                            <SignalBar
                                                                key={signal.id}
                                                                signal={signal}
                                                                maxScore={Math.max(...analysis.ageingDetails.signals.map(s => s.score * s.weight))}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                                                        <Shield size={28} className="text-[#3fb950]/50" />
                                                        <span className="text-[#3fb950] text-sm font-medium">No ageing signals</span>
                                                        <span className="text-[10px] text-[#8b949e]">Code is modern & clean</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Category Breakdown */}
                                            <div className="glass-analysis-card col-span-1 info hover-scale">
                                                <h4 className="font-semibold mb-4 text-[#58a6ff] flex items-center gap-2 text-sm">
                                                    <Shield size={14} /> Category Breakdown
                                                </h4>
                                                <CategoryBreakdown scores={analysis.ageingDetails.categoryScores} />

                                                {/* Stats summary */}
                                                <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#8b949e] uppercase tracking-wider">Health</div>
                                                        <div className={`text-lg font-bold ${analysis.healthScore > 80 ? 'text-[#3fb950]' : analysis.healthScore > 50 ? 'text-[#febc2e]' : 'text-[#f85149]'}`}>
                                                            {analysis.healthScore}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#8b949e] uppercase tracking-wider">Complexity</div>
                                                        <div className={`text-lg font-bold ${analysis.complexity === 'Low' ? 'text-[#3fb950]' : analysis.complexity === 'Medium' ? 'text-[#febc2e]' : 'text-[#f85149]'}`}>
                                                            {analysis.complexity}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#8b949e] uppercase tracking-wider">Maintain.</div>
                                                        <div className="text-lg font-bold text-[#58a6ff]">{analysis.maintainability}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#8b949e] uppercase tracking-wider">Hotspots</div>
                                                        <div className="text-lg font-bold text-[#febc2e]">{analysis.ageingDetails.hotspots.length}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Bottom Row: Trend + Hotspots + Recommendations ── */}
                                        <div className="grid grid-cols-3 gap-4 animate-slide-in">
                                            {/* Trend Chart */}
                                            <div className="hover-scale">
                                                <TrendChart fileId={activeFile.id} />
                                            </div>
                                            
                                            {/* Hotspots */}
                                            <div className="glass-analysis-card error hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#f85149] flex items-center gap-2 text-sm">
                                                    <AlertTriangle size={14} /> Hotspots
                                                    <span className="text-[10px] text-[#8b949e] font-normal ml-auto">
                                                        {analysis.ageingDetails.hotspots.length}
                                                    </span>
                                                </h4>
                                                {analysis.ageingDetails.hotspots.length > 0 ? (
                                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                                        {(showAllHotspots ? analysis.ageingDetails.hotspots : analysis.ageingDetails.hotspots.slice(0, 4)).map((hotspot, i) => (
                                                            <HotspotItem key={`${hotspot.line}-${i}`} hotspot={hotspot} index={i} />
                                                        ))}
                                                        {analysis.ageingDetails.hotspots.length > 4 && (
                                                            <button
                                                                onClick={() => setShowAllHotspots(prev => !prev)}
                                                                className="w-full text-center py-1 text-[10px] text-[#58a6ff] hover:text-white bg-[#58a6ff]/5 hover:bg-[#58a6ff]/10 rounded border border-[#58a6ff]/10 transition-all duration-200"
                                                            >
                                                                {showAllHotspots ? 'Less' : 'More'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                                                        <Shield size={24} className="text-[#3fb950]/50" />
                                                        <span className="text-[#3fb950] text-xs font-medium">No hotspots</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Recommendations */}
                                            <div className="glass-analysis-card success hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#3fb950] flex items-center gap-2 text-sm">
                                                    <Zap size={14} /> Recommendations
                                                    <span className="text-[10px] text-[#8b949e] font-normal ml-auto">
                                                        {analysis.ageingDetails.signals.filter(s => s.recommendation).length}
                                                    </span>
                                                </h4>
                                                {analysis.ageingDetails.signals.filter(s => s.recommendation).length > 0 ? (
                                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                                        {analysis.ageingDetails.signals.filter(s => s.recommendation).map((signal, i) => (
                                                            <div
                                                                key={i}
                                                                className={`flex gap-2 p-2 rounded-lg border transition-all duration-200 ${appliedIndices.has(i)
                                                                    ? 'bg-[#3fb950]/10 border-[#3fb950]/30'
                                                                    : 'bg-[#3fb950]/5 border-[#3fb950]/10 hover:border-[#3fb950]/20'
                                                                    }`}
                                                            >
                                                                <div className="shrink-0 w-4 h-4 rounded-full bg-[#3fb950]/15 flex items-center justify-center">
                                                                    {appliedIndices.has(i)
                                                                        ? <CheckCircle size={8} className="text-[#3fb950]" />
                                                                        : <span className="text-[9px] font-bold text-[#3fb950]">{i + 1}</span>
                                                                    }
                                                                </div>
                                                                <p className={`text-[10px] leading-relaxed flex-1 ${appliedIndices.has(i) ? 'text-[#3fb950]/70 line-through' : 'text-[#c9d1d9]'}`}>{signal.recommendation}</p>
                                                                {!appliedIndices.has(i) && (
                                                                    <button
                                                                        onClick={() => handleApplyRecommendation(signal, i)}
                                                                        disabled={applyingIndex !== null}
                                                                        className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold transition-all duration-200 ${applyingIndex === i
                                                                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                                                            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/25 hover:text-purple-300'
                                                                            }`}
                                                                    >
                                                                        {applyingIndex === i
                                                                            ? <Loader2 size={8} className="animate-spin" />
                                                                            : <Wand2 size={8} />
                                                                        }
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                                                        <Shield size={24} className="text-[#3fb950]/50" />
                                                        <span className="text-[#3fb950] text-xs font-medium">All good!</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Halstead Metrics compact */}
                                        {analysis.halstead && (
                                            <div className="glass-analysis-card info hover-scale animate-slide-in">
                                                <h5 className="text-[10px] text-[#8b949e] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                                                    <Activity size={10} /> Halstead Metrics
                                                </h5>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[
                                                        { label: 'Vocab', value: analysis.halstead.vocabulary },
                                                        { label: 'Volume', value: analysis.halstead.volume },
                                                        { label: 'Diffic.', value: analysis.halstead.difficulty },
                                                        { label: 'Effort', value: analysis.halstead.effort },
                                                    ].map(m => (
                                                        <div key={m.label} className="p-2 rounded bg-black/20 text-center hover-scale">
                                                            <div className="text-[8px] text-[#8b949e] uppercase">{m.label}</div>
                                                            <div className="text-sm font-mono text-[#c9d1d9] font-semibold">{m.value}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-center animate-fade-in-up">
                                        <div className="text-center">
                                            <div className="w-8 h-8 mx-auto rounded-full border-2 border-[#58a6ff]/30 border-t-[#58a6ff] animate-spin mb-3" />
                                            <span className="text-[#8b949e]">Analyzing code ageing...</span>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="glass-empty-state h-full animate-fade-in-up">
                                    <div className="glass-empty-state-icon">
                                        <AlertTriangle size={32} className="text-[#8b949e]" />
                                    </div>
                                    <h3 className="text-white/80 font-medium mb-2">No File Open</h3>
                                    <p className="text-[#8b949e] text-sm">Open a file to run code ageing analysis</p>
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'terminal' && (
                        <Suspense fallback={<PanelFallback />}>
                            <TerminalPanel />
                        </Suspense>
                    )}
                </div>
            </div>
        </div>
    );
};
