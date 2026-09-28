import React, { Suspense, lazy } from 'react';
import { Activity, AlertTriangle, Terminal, Shield, Code, Layers, Paintbrush, Lock, TrendingDown, ChevronRight, ChevronDown, Zap, RefreshCw, Wand2, Loader2, CheckCircle, TrendingUp, Calendar, BarChart3 } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectFile, useProjectActions } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import { useSettingsSelector } from '../../context/SettingsContext';
import { analyzeCode, type AnalysisResult, type AgeingSignal, type AgeingHotspot } from '../../utils/codeAnalysisEngine';
import { analysisHistory } from '../../utils/analysisHistory';
import { sanitizeEditorOutputWithPolicy, NO_AUTO_COMMENTS_INSTRUCTION, resolveLanguageFromFilename, aiRequestManager } from '../../core/ai';
import { ProblemsPanel } from './ProblemsPanel';
import { subscribeDiagnostics, getCounts } from '../../core/diagnostics/diagnosticStore';

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
    'A+': { bg: 'rgba(53, 211, 153, 0.12)', border: 'rgba(53, 211, 153, 0.28)', text: '#35D399', glow: 'rgba(53, 211, 153, 0.12)' },
    'A': { bg: 'rgba(53, 211, 153, 0.10)', border: 'rgba(53, 211, 153, 0.24)', text: '#35D399', glow: 'rgba(53, 211, 153, 0.08)' },
    'B': { bg: 'rgba(91, 140, 255, 0.10)', border: 'rgba(91, 140, 255, 0.24)', text: '#78A7FF', glow: 'rgba(91, 140, 255, 0.08)' },
    'C': { bg: 'rgba(245, 185, 76, 0.10)', border: 'rgba(245, 185, 76, 0.24)', text: '#F5B94C', glow: 'rgba(245, 185, 76, 0.08)' },
    'D': { bg: 'rgba(245, 185, 76, 0.12)', border: 'rgba(245, 185, 76, 0.28)', text: '#F5B94C', glow: 'rgba(245, 185, 76, 0.10)' },
    'F': { bg: 'rgba(255, 100, 124, 0.10)', border: 'rgba(255, 100, 124, 0.28)', text: '#FF647C', glow: 'rgba(255, 100, 124, 0.10)' },
};

const GradeBadge: React.FC<{ grade: string; label: string }> = ({ grade, label }) => {
    const colors = gradeColors[grade] || gradeColors['C'];
    return (
        <div
            className="flex items-center gap-4 px-5 py-3 rounded-xl transition-all duration-300"
            style={{
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                boxShadow: '0 1px 2px rgba(0,0,0,.25)'
            }}
        >
            <div
                className="text-4xl font-black tracking-tight leading-none"
                style={{ color: colors.text }}
            >
                {grade}
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-[#7F8A9A] font-semibold">Code Age Grade</span>
                <span className="text-xs mt-0.5" style={{ color: colors.text }}>{label}</span>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────
// Signal Bar Component
// ────────────────────────────────────────────
const severityColors: Record<string, string> = {
    critical: '#FF647C',
    high: '#F5B94C',
    medium: '#F5B94C',
    low: '#35D399',
};

const SignalBar: React.FC<{ signal: AgeingSignal; maxScore: number }> = ({ signal, maxScore }) => {
    const barWidth = maxScore > 0 ? Math.max(4, (signal.score * signal.weight / maxScore) * 100) : 0;
    const color = severityColors[signal.severity] || '#7F8A9A';

    return (
        <div className="group p-3 rounded-[6px] bg-[var(--az-surface-3)] border border-[var(--az-border)] hover:border-[var(--az-border-strong)] transition-colors duration-150">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-base">{signal.icon}</span>
                    <span className="text-xs font-semibold text-[var(--az-text)]">{signal.name}</span>
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
                    <span className="text-[10px] text-[#7F8A9A] font-mono">{signal.count} found</span>
                    <span className="text-xs font-bold font-mono" style={{ color }}>
                        {Math.round(signal.score * signal.weight)}
                    </span>
                </div>
            </div>
            <div className="h-1.5 bg-[var(--az-bg)] rounded-full overflow-hidden border border-[var(--az-border)]">
                <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                        width: `${barWidth}%`,
                        background: color,
                    }}
                />
            </div>
            <p className="text-[10px] text-[#7F8A9A] mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
                        <span className="text-[#7F8A9A]">{categoryIcons[cat]}</span>
                        <span className="text-[10px] text-[#7F8A9A] font-medium">{categoryLabels[cat]}</span>
                    </div>
                    <div className="flex-1 h-2 bg-[var(--az-bg)] rounded-full overflow-hidden border border-[var(--az-border)]">
                        <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{
                                width: `${Math.max(2, score)}%`,
                                background: score > 60
                                    ? '#FF647C'
                                    : score > 30
                                        ? '#F5B94C'
                                        : score > 0
                                            ? '#5B8CFF'
                                            : '#35D399',
                            }}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-[#7F8A9A] w-7 text-right">{score}%</span>
                </div>
            ))}
        </div>
    );
};

// ────────────────────────────────────────────
// Hotspot Item Component
// ────────────────────────────────────────────
const HotspotItem: React.FC<{ hotspot: AgeingHotspot; index: number }> = ({ hotspot, index }) => {
    const color = severityColors[hotspot.severity] || '#7F8A9A';
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
                    <span className="text-[10px] text-[#7F8A9A]">Line {hotspot.line}</span>
                </div>
                <code className="text-[11px] text-[#A7B0BF] font-mono block truncate opacity-80">
                    {hotspot.code}
                </code>
                <p className="text-[10px] text-[#7F8A9A] mt-1 flex items-center gap-1">
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
    const color = score <= 15 ? '#35D399' : score <= 30 ? '#5B8CFF' : score <= 50 ? '#F5B94C' : score <= 70 ? '#F5B94C' : '#FF647C';

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
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold" style={{ color }}>{score}%</span>
                <span className="text-[8px] text-[#7F8A9A] uppercase tracking-wider">Aged</span>
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
                <h4 className="font-semibold mb-3 text-[#5B8CFF] flex items-center gap-2 text-sm">
                    <BarChart3 size={14} /> Code Age Trend
                </h4>
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <Calendar size={24} className="text-[#7F8A9A]/50" />
                    <span className="text-[#7F8A9A] text-sm">No trend data available</span>
                    <span className="text-[10px] text-[#7F8A9A]">Analyze this file multiple times to see trends</span>
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
            <h4 className="font-semibold mb-3 text-[#5B8CFF] flex items-center gap-2 text-sm">
                <BarChart3 size={14} /> Code Age Trend
                <div className="ml-auto flex items-center gap-2">
                    {trendData.trend.improving ? (
                        <div className="flex items-center gap-1 text-[#35D399]">
                            <TrendingUp size={12} />
                            <span className="text-[10px]">Improving</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 text-[#FF647C]">
                            <TrendingDown size={12} />
                            <span className="text-[10px]">Declining</span>
                        </div>
                    )}
                    <span className="text-[10px] text-[#7F8A9A]">
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
                        const color = score <= 30 ? '#35D399' : score <= 50 ? '#F5B94C' : score <= 70 ? '#E4B86A' : '#FF647C';
                        
                        return (
                            <div
                                key={index}
                                className="flex-1 rounded-t transition-all duration-300 hover:opacity-80"
                                style={{
                                    height: `${Math.max(4, height)}%`,
                                    background: color
                                }}
                                title={`${new Date(snapshot.timestamp).toLocaleDateString()}: ${score}%`}
                            />
                        );
                    })}
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-[8px] text-[#7F8A9A]">{minScore}%</span>
                    <span className="text-[8px] text-[#7F8A9A]">{maxScore}%</span>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#7F8A9A] uppercase">Stability</div>
                    <div className="text-sm font-bold text-[#A7B0BF]">{trendData.trend.stability}%</div>
                </div>
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#7F8A9A] uppercase">Analyses</div>
                    <div className="text-sm font-bold text-[#A7B0BF]">{trendData.snapshots.length}</div>
                </div>
                <div className="p-2 rounded bg-black/20 text-center">
                    <div className="text-[8px] text-[#7F8A9A] uppercase">Latest</div>
                    <div className="text-sm font-bold text-[#A7B0BF]">{recentSnapshots[recentSnapshots.length - 1]?.analysis.codeAgeing}%</div>
                </div>
            </div>

            {/* History toggle */}
            <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full text-center py-2 text-[11px] text-[#5B8CFF] hover:text-white bg-[#5B8CFF]/5 hover:bg-[#5B8CFF]/10 rounded-lg border border-[#5B8CFF]/10 transition-all duration-200"
            >
                {showHistory ? 'Hide' : 'Show'} Analysis History
            </button>

            {/* Detailed history */}
            {showHistory && (
                <div className="mt-3 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                    {recentSnapshots.reverse().map((snapshot: any, index: number) => (
                        <div key={index} className="flex items-center justify-between p-2 rounded bg-black/20">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[#7F8A9A]">
                                    {new Date(snapshot.timestamp).toLocaleDateString()}
                                </span>
                                <span className="text-[10px] font-mono text-[#A7B0BF]">
                                    {snapshot.analysis.codeAgeing}%
                                </span>
                            </div>
                            <span className="text-[10px] text-[#7F8A9A]">
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
export const BottomPanel: React.FC<{ isOverlay?: boolean; isOpen?: boolean; onToggle?: () => void }> = ({ isOverlay, isOpen, onToggle }) => {
    // Persist Active Tab
    const [activeTab, setActiveTab] = useState<'performance' | 'ageing' | 'terminal' | 'problems'>(() => {
        const saved = localStorage.getItem('bottomPanel_activeTab');
        return (saved === 'performance' || saved === 'ageing' || saved === 'terminal' || saved === 'problems' ? saved : 'performance') as 'performance' | 'ageing' | 'terminal' | 'problems';
    });

    useEffect(() => {
        localStorage.setItem('bottomPanel_activeTab', activeTab);
    }, [activeTab]);
    
    const { activeFile } = useProjectFile();
    const [problemCounts, setProblemCounts] = useState({ errors: 0, warnings: 0, total: 0 });
    useEffect(() => {
        const update = () => setProblemCounts(getCounts(activeFile?.id ?? null));
        update();
        const unsub = subscribeDiagnostics(update);
        return unsub;
    }, [activeFile?.id]);
    const { updateFileContent, getActiveFile } = useProjectActions();
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
    // Guards so a stale AI fix (user switched files / panel unmounted while the
    // request was in flight) can never overwrite newer content or touch state
    // after unmount.
    const fixRequestIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (fixRequestIdRef.current) aiRequestManager.abort(fixRequestIdRef.current, 'unmount');
        };
    }, []);

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
        }, 0);

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
                // Centralized safe edit — validates and prevents duplication, uses fresh Monaco snapshot
                const { executeActionPlan } = await import('../../core/ai/aiToolExecutor');
                const { getActiveEditorContext: getCtx } = await import('../../core/editor/activeEditorStore');
                const freshCtx = getCtx();
                const snapshotContent = freshCtx?.code ?? activeFile.content;
                const fileNameForSnap = freshCtx?.fileName ?? activeFile.name;
                const snap = snapshotContent ? { filePath: fileNameForSnap, content: snapshotContent, lines: snapshotContent.split('\n'), timestamp: Date.now() } as any : null;
                const snapMap = new Map<string, any>();
                if (snap) snapMap.set(fileNameForSnap, snap);
                const deps = {
                    getFileContent: (p: string): string | null => {
                        const ctx = getCtx();
                        if (ctx && p === ctx.fileName) return ctx.code;
                        if (p === fileNameForSnap) return snapshotContent;
                        return null;
                    },
                    getFileIdByPath: (p: string) => p === fileNameForSnap ? activeFile.id : null,
                    createFile: () => ({ success: false, error: 'Not supported' }),
                    deleteNode: () => {},
                    renameNode: () => ({ success: false, error: 'Not supported' }),
                    updateFileContent: (id: string, c: string) => {
                        const r = updateFileContent(id, c);
                        return { success: !r.error, error: r.error };
                    },
                    getActiveFilePath: () => freshCtx?.fileName ?? fileNameForSnap,
                    getActiveFileId: () => freshCtx?.fileId ?? activeFile.id,
                } as any;
                const resultSafe = await executeActionPlan([{ action: 'update_file', path: fileNameForSnap, content: newContent } as any], deps as any, { language, snapshot: snap, snapshotMap: snapMap } as any);
                if (!resultSafe.success) {
                    console.warn('[CodeAgeing] Safe edit rejected:', resultSafe.message);
                    // Do not apply if validation fails
                } else {
                    setAppliedIndices(prev => new Set(prev).add(index));
                    setTimeout(() => setAnalysis(analyzeCode(newContent, language)), 0);
                }
            } else {
                // Enhanced AI-powered fixes with context. Register through the
                // central request registry so the request is abortable (panel
                // unmount / newer fix) and its controller.signal threads all the
                // way to fetch. A stale result is discarded if the file changed
                // or the panel unmounted mid-flight — never overwrite newer text.
                const { sendChatRequest, getSmartModel } = await import('../../utils/groqService');

                const record = aiRequestManager.begin({ owner: 'bottom-panel-fix', task: 'complex_code' });
                fixRequestIdRef.current = record.requestId;
                const fixController = record.controller;
                const fileId = activeFile.id;
                const fileContentAtRequest = activeFile.content;

                const systemPrompt = `You are an expert code refactoring assistant. You will be given the FULL source code of a file and a specific improvement task.

RULES:
1. Return ONLY the complete, fixed source code - no markdown fences, no explanations
2. Make ONLY the changes necessary to address the specific issue
3. Preserve all existing comments, formatting, and structure
4. Ensure the code remains functional and syntactically correct
5. Follow modern best practices for the given programming language
6. Do not add new imports unless absolutely necessary for the fix
7. ${NO_AUTO_COMMENTS_INSTRUCTION}`;

                const contextPrompt = `File: ${activeFile.name}
Language: ${language}
Issue: ${signal.name}
Severity: ${signal.severity}
Category: ${signal.category}

Current code:
${fileContentAtRequest}

Required fix: ${signal.recommendation}

Apply the fix while preserving all other code exactly as-is.`;

                const result = await sendChatRequest(
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: contextPrompt }
                    ],
                    { temperature: 0.1, model: getSmartModel('fix'), task: 'complex_code', signal: fixController.signal }
                );

                // Stale-guard: the fix must only apply to the same file, same
                // content it was computed against, and only while mounted. A
                // stale result is discarded silently (never overwrites newer
                // user edits, never touches unmounted state).
                const current = getActiveFile();
                const stillCurrent =
                    mountedRef.current &&
                    fixRequestIdRef.current === record.requestId &&
                    !fixController.signal.aborted &&
                    current?.id === fileId &&
                    current?.content === fileContentAtRequest;
                if (!stillCurrent) {
                    aiRequestManager.markStatus(record.requestId, 'aborted');
                    return;
                }

                const fixedCode = sanitizeEditorOutputWithPolicy(result, {
                    task: 'fix',
                    language: language || resolveLanguageFromFilename(activeFile.name) || 'typescript',
                    filename: activeFile.name,
                    outputMode: 'fix',
                    preserve: fileContentAtRequest,
                });

                if (fixedCode && fixedCode.length > 0 && fixedCode !== fileContentAtRequest) {
                    const { executeActionPlan } = await import('../../core/ai/aiToolExecutor');
                    const { getActiveEditorContext: getCtx2 } = await import('../../core/editor/activeEditorStore');
                    const snap2 = { filePath: activeFile.name, content: fileContentAtRequest, lines: fileContentAtRequest.split('\n'), timestamp: Date.now() } as any;
                    const snapMap2 = new Map<string, any>([[activeFile.name, snap2]]);
                    const deps2 = {
                        getFileContent: (p: string) => {
                            const ctx = getCtx2();
                            if (ctx && p === ctx.fileName) return ctx.code;
                            if (p === activeFile.name) return fileContentAtRequest;
                            return null;
                        },
                        getFileIdByPath: (p: string) => p === activeFile.name ? fileId : null,
                        createFile: () => ({ success: false, error: 'Not supported' }),
                        deleteNode: () => {},
                        renameNode: () => ({ success: false, error: 'Not supported' }),
                        updateFileContent: (id: string, c: string) => {
                            const r = updateFileContent(id, c);
                            return { success: !r.error, error: r.error };
                        },
                        getActiveFilePath: () => getCtx2()?.fileName ?? activeFile.name,
                        getActiveFileId: () => getCtx2()?.fileId ?? fileId,
                    } as any;
                    const res2 = await executeActionPlan([{ action: 'update_file', path: activeFile.name, content: fixedCode } as any], deps2 as any, { language, snapshot: snap2, snapshotMap: snapMap2 } as any);
                    if (!res2.success) {
                        console.warn('[CodeAgeing] Safe edit rejected:', res2.message);
                    } else {
                        setAppliedIndices(prev => new Set(prev).add(index));
                        if (mountedRef.current) setTimeout(() => setAnalysis(analyzeCode(fixedCode, language)), 0);
                    }
                } else {
                    console.warn('AI fix did not produce changes');
                }
            }
        } catch (error) {
            console.error('[CodeAgeing] Failed to apply recommendation:', error);
        } finally {
            if (fixRequestIdRef.current) {
                aiRequestManager.markStatus(fixRequestIdRef.current, 'complete');
                fixRequestIdRef.current = null;
            }
            setApplyingIndex(null);
        }
    }, [activeFile, applyingIndex, updateFileContent, getActiveFile]);

    return (
        <div className={`h-full flex flex-col bg-transparent ${isOverlay && !isOpen ? 'overflow-hidden' : ''}`}>
            {/* Tab Bar — 32px stable, centered */}
            <div className="flex items-center gap-1 px-2 border-b shrink-0 h-8 min-h-8 overflow-hidden" style={{ background: 'var(--az-surface-2)', borderColor: 'var(--az-border)' }}>
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
                    className={`glass-tab flex items-center gap-2 ${activeTab === 'problems' ? 'active' : ''}`}
                    onClick={() => setActiveTab('problems')}
                >
                    <AlertTriangle size={14} />
                    <span className="hidden sm:inline">Problems</span>
                    {(problemCounts.errors > 0 || problemCounts.warnings > 0) && (
                        <span className={`text-[10px] px-1.5 py-0 rounded-full font-mono font-bold ${problemCounts.errors > 0 ? 'bg-[#FF647C] text-white' : 'bg-[#F5B94C] text-black'}`}>
                            {problemCounts.errors + problemCounts.warnings}
                        </span>
                    )}
                </button>
                {isOverlay && (
                    <>
                        <div className="flex-1" />
                        <button
                            onClick={onToggle}
                            className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                            title={isOpen ? 'Collapse panel' : 'Expand panel'}
                            aria-label={isOpen ? 'Collapse panel' : 'Expand panel'}
                        >
                            <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? '' : 'rotate-180'}`} />
                        </button>
                    </>
                )}
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
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-in">
                                            {/* Grade Badge & Summary */}
                                            <div className="glass-analysis-card col-span-1 hover-scale" style={{ '--card-accent': gradeColors[analysis.ageingDetails.grade]?.text || '#5B8CFF' } as React.CSSProperties}>
                                                <div className="flex flex-col items-center text-center gap-3">
                                                    <GradeBadge grade={analysis.ageingDetails.grade} label={analysis.ageingDetails.gradeLabel} />
                                                    <CircularScore score={analysis.codeAgeing} size={90} />
                                                    <p className="text-[11px] text-[#7F8A9A] leading-relaxed px-2">
                                                        {analysis.ageingDetails.summary}
                                                    </p>
                                                    <button
                                                        onClick={handleReanalyze}
                                                        className="flex items-center gap-1.5 text-[10px] text-[#5B8CFF] hover:text-white px-3 py-1.5 rounded-lg bg-[#5B8CFF]/10 hover:bg-[#5B8CFF]/20 border border-[#5B8CFF]/20 transition-all duration-200 mt-1"
                                                    >
                                                        <RefreshCw size={10} />
                                                        Re-analyze
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Ageing Signals Breakdown */}
                                            <div className="glass-analysis-card col-span-1 warning hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#F5B94C] flex items-center gap-2 text-sm">
                                                    <Zap size={14} /> Ageing Signals
                                                    <span className="text-[10px] text-[#7F8A9A] font-normal ml-auto">
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
                                                        <Shield size={28} className="text-[#35D399]/50" />
                                                        <span className="text-[#35D399] text-sm font-medium">No ageing signals</span>
                                                        <span className="text-[10px] text-[#7F8A9A]">Code is modern & clean</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Category Breakdown */}
                                            <div className="glass-analysis-card col-span-1 info hover-scale">
                                                <h4 className="font-semibold mb-4 text-[#5B8CFF] flex items-center gap-2 text-sm">
                                                    <Shield size={14} /> Category Breakdown
                                                </h4>
                                                <CategoryBreakdown scores={analysis.ageingDetails.categoryScores} />

                                                {/* Stats summary */}
                                                <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#7F8A9A] uppercase tracking-wider">Health</div>
                                                        <div className={`text-lg font-bold ${analysis.healthScore > 80 ? 'text-[#35D399]' : analysis.healthScore > 50 ? 'text-[#F5B94C]' : 'text-[#FF647C]'}`}>
                                                            {analysis.healthScore}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#7F8A9A] uppercase tracking-wider">Complexity</div>
                                                        <div className={`text-lg font-bold ${analysis.complexity === 'Low' ? 'text-[#35D399]' : analysis.complexity === 'Medium' ? 'text-[#F5B94C]' : 'text-[#FF647C]'}`}>
                                                            {analysis.complexity}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#7F8A9A] uppercase tracking-wider">Maintain.</div>
                                                        <div className="text-lg font-bold text-[#5B8CFF]">{analysis.maintainability}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-black/20">
                                                        <div className="text-[9px] text-[#7F8A9A] uppercase tracking-wider">Hotspots</div>
                                                        <div className="text-lg font-bold text-[#F5B94C]">{analysis.ageingDetails.hotspots.length}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Bottom Row: Trend + Hotspots + Recommendations ── */}
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-in">
                                            {/* Trend Chart */}
                                            <div className="hover-scale">
                                                <TrendChart fileId={activeFile.id} />
                                            </div>
                                            
                                            {/* Hotspots */}
                                            <div className="glass-analysis-card error hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#FF647C] flex items-center gap-2 text-sm">
                                                    <AlertTriangle size={14} /> Hotspots
                                                    <span className="text-[10px] text-[#7F8A9A] font-normal ml-auto">
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
                                                                className="w-full text-center py-1 text-[10px] text-[#5B8CFF] hover:text-white bg-[#5B8CFF]/5 hover:bg-[#5B8CFF]/10 rounded border border-[#5B8CFF]/10 transition-all duration-200"
                                                            >
                                                                {showAllHotspots ? 'Less' : 'More'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                                                        <Shield size={24} className="text-[#35D399]/50" />
                                                        <span className="text-[#35D399] text-xs font-medium">No hotspots</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Recommendations */}
                                            <div className="glass-analysis-card success hover-scale">
                                                <h4 className="font-semibold mb-3 text-[#35D399] flex items-center gap-2 text-sm">
                                                    <Zap size={14} /> Recommendations
                                                    <span className="text-[10px] text-[#7F8A9A] font-normal ml-auto">
                                                        {analysis.ageingDetails.signals.filter(s => s.recommendation).length}
                                                    </span>
                                                </h4>
                                                {analysis.ageingDetails.signals.filter(s => s.recommendation).length > 0 ? (
                                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                                        {analysis.ageingDetails.signals.filter(s => s.recommendation).map((signal, i) => (
                                                            <div
                                                                key={i}
                                                                className={`flex gap-2 p-2 rounded-lg border transition-all duration-200 ${appliedIndices.has(i)
                                                                    ? 'bg-[#35D399]/10 border-[#35D399]/30'
                                                                    : 'bg-[#35D399]/5 border-[#35D399]/10 hover:border-[#35D399]/20'
                                                                    }`}
                                                            >
                                                                <div className="shrink-0 w-4 h-4 rounded-full bg-[#35D399]/15 flex items-center justify-center">
                                                                    {appliedIndices.has(i)
                                                                        ? <CheckCircle size={8} className="text-[#35D399]" />
                                                                        : <span className="text-[9px] font-bold text-[#35D399]">{i + 1}</span>
                                                                    }
                                                                </div>
                                                                <p className={`text-[10px] leading-relaxed flex-1 ${appliedIndices.has(i) ? 'text-[#35D399]/70 line-through' : 'text-[#A7B0BF]'}`}>{signal.recommendation}</p>
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
                                                        <Shield size={24} className="text-[#35D399]/50" />
                                                        <span className="text-[#35D399] text-xs font-medium">All good!</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Halstead Metrics compact */}
                                        {analysis.halstead && (
                                            <div className="glass-analysis-card info hover-scale animate-slide-in">
                                                <h5 className="text-[10px] text-[#7F8A9A] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                                                    <Activity size={10} /> Halstead Metrics
                                                </h5>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                    {[
                                                        { label: 'Vocab', value: analysis.halstead.vocabulary },
                                                        { label: 'Volume', value: analysis.halstead.volume },
                                                        { label: 'Diffic.', value: analysis.halstead.difficulty },
                                                        { label: 'Effort', value: analysis.halstead.effort },
                                                    ].map(m => (
                                                        <div key={m.label} className="p-2 rounded bg-black/20 text-center hover-scale">
                                                            <div className="text-[8px] text-[#7F8A9A] uppercase">{m.label}</div>
                                                            <div className="text-sm font-mono text-[#A7B0BF] font-semibold">{m.value}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-center animate-fade-in-up">
                                        <div className="text-center">
                                            <div className="w-8 h-8 mx-auto rounded-full border-2 border-[#5B8CFF]/30 border-t-[#5B8CFF] animate-spin mb-3" />
                                            <span className="text-[#7F8A9A]">Analyzing code ageing...</span>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="glass-empty-state h-full animate-fade-in-up">
                                    <div className="glass-empty-state-icon">
                                        <AlertTriangle size={32} className="text-[#7F8A9A]" />
                                    </div>
                                    <h3 className="text-white/80 font-medium mb-2">No File Open</h3>
                                    <p className="text-[#7F8A9A] text-sm">Open a file to run code ageing analysis</p>
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'terminal' && (
                        <Suspense fallback={<PanelFallback />}>
                            <TerminalPanel />
                        </Suspense>
                    )}
                    {activeTab === 'problems' && (
                        <div className="h-full overflow-hidden">
                            <ProblemsPanel />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
