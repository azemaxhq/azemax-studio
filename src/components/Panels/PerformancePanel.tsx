import React, { useState, useEffect } from 'react';
import {
  Activity,
  Zap,
  Clock,
  Cpu,
  HardDrive,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  RefreshCw,
  Download,
  Calendar,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle
} from 'lucide-react';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useTerminal } from '../../context/TerminalContext';
import {
  analyzePerformance,
  PerformanceHistory,
  type PerformanceReport,
  type PerformanceMetrics,
  type PerformanceBottleneck
} from '../../utils/performanceService';
import performanceService from '../../utils/performanceService';
import {
  generatePerformanceAlerts,
  PerformanceAlertManager,
  type PerformanceAlert
} from '../../utils/performanceAlerts';

// Grade colors
const gradeColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  'A+': { bg: 'rgba(63, 185, 80, 0.15)', border: 'rgba(63, 185, 80, 0.4)', text: '#3fb950', glow: 'rgba(63, 185, 80, 0.3)' },
  'A': { bg: 'rgba(63, 185, 80, 0.12)', border: 'rgba(63, 185, 80, 0.35)', text: '#3fb950', glow: 'rgba(63, 185, 80, 0.2)' },
  'B': { bg: 'rgba(88, 166, 255, 0.12)', border: 'rgba(88, 166, 255, 0.35)', text: '#58a6ff', glow: 'rgba(88, 166, 255, 0.2)' },
  'C': { bg: 'rgba(254, 188, 46, 0.12)', border: 'rgba(254, 188, 46, 0.35)', text: '#febc2e', glow: 'rgba(254, 188, 46, 0.2)' },
  'D': { bg: 'rgba(248, 130, 73, 0.12)', border: 'rgba(248, 130, 73, 0.35)', text: '#f88249', glow: 'rgba(248, 130, 73, 0.2)' },
  'F': { bg: 'rgba(248, 81, 73, 0.15)', border: 'rgba(248, 81, 73, 0.4)', text: '#f85149', glow: 'rgba(248, 81, 73, 0.3)' },
};

// Severity colors
const severityColors: Record<string, string> = {
  critical: '#f85149',
  high: '#f88249',
  medium: '#febc2e',
  low: '#3fb950',
};

interface PerformancePanelProps {
  executionData?: {
    executionTime: number;
    stdout: string;
    stderr: string;
    exitCode: number;
    timestamp: number;
  };
}

export const PerformancePanel: React.FC<PerformancePanelProps> = ({ executionData }) => {
  const { getActiveFile } = useProjectActions();
  const { activeFileMeta } = useProjectUI();
  const { isRunning } = useTerminal();
  
  const [currentReport, setCurrentReport] = useState<PerformanceReport | null>(null);
  const [history, setHistory] = useState<PerformanceReport[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<'overview' | 'efficiency' | 'memory' | 'cpu' | 'timeline'>('overview');
  const [showDetails, setShowDetails] = useState(false);
  const [expandedBottlenecks, setExpandedBottlenecks] = useState<Set<number>>(new Set());
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([]);

  // Load history on mount
  useEffect(() => {
    const performanceHistory = PerformanceHistory.getHistory();
    setHistory(performanceHistory);
    if (performanceHistory.length > 0) {
      setCurrentReport(performanceHistory[performanceHistory.length - 1]);
    }
  }, []);

  // Analyze new execution data
  useEffect(() => {
    const activeFile = getActiveFile();
    if (executionData && activeFile && !isRunning) {
      // Get the previous report BEFORE saving the new one
      const previousReport = PerformanceHistory.getPrevious();
      
      const report = analyzePerformance(
        activeFile.content || '',
        getLanguageFromExtension(activeFile.name || ''),
        executionData.executionTime,
        executionData.stdout,
        executionData.stderr,
        executionData.exitCode
      );
      
      // Compare with previous report if exists
      if (previousReport) {
        report.comparison.previousRun = previousReport.metrics;
        report.comparison.improvement = calculateImprovement(previousReport.metrics, report.metrics);
      }
      
      setCurrentReport(report);
      PerformanceHistory.save(report);
      setHistory(prev => [...prev.slice(-19), report]);
      
      // Generate alerts for this report
      const newAlerts = generatePerformanceAlerts(report, previousReport || undefined);
      if (newAlerts.length > 0) {
        PerformanceAlertManager.addAlerts(newAlerts);
        setAlerts(newAlerts);
      }
    }
  }, [executionData, isRunning, getActiveFile]);

  const getLanguageFromExtension = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', java: 'java', c: 'c', cpp: 'cpp', go: 'go',
      rs: 'rust', rb: 'ruby', php: 'php', css: 'css', html: 'html',
      json: 'json', md: 'markdown', sh: 'shell', yml: 'yaml', yaml: 'yaml',
    };
    return langMap[ext] || 'plaintext';
  };

  const calculateImprovement = (previous: PerformanceMetrics, current: PerformanceMetrics): number => {
    const timeImprovement = ((previous.executionTime - current.executionTime) / previous.executionTime) * 100;
    const memoryImprovement = ((previous.memoryUsage.peak - current.memoryUsage.peak) / previous.memoryUsage.peak) * 100;
    return (timeImprovement + memoryImprovement) / 2;
  };

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  };

  const formatMemory = (mb: number): string => {
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    return `${(mb / 1024).toFixed(2)}GB`;
  };

  const exportReport = () => {
    if (!currentReport) return;
    
    const data = {
      report: currentReport,
      timestamp: new Date().toISOString(),
      file: activeFileMeta?.name,
      exported: true
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleBottleneck = (index: number) => {
    setExpandedBottlenecks(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (!currentReport && history.length === 0) {
    return (
      <div className="p-4 glass-empty-state h-full">
        <div className="glass-empty-state-icon">
          <Activity size={32} className="text-[#8b949e]" />
        </div>
        <h3 className="text-white/80 font-medium mb-2">Performance Metrics</h3>
        <p className="text-[#8b949e] text-sm">Run your code to see performance metrics</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-transparent p-4 overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/10 border border-blue-500/30 flex items-center justify-center">
            <BarChart3 size={18} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Performance Analysis</h2>
            <p className="text-xs text-white/50">
              {activeFileMeta?.name} • {currentReport?.metrics.language}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all"
            title="Toggle Details"
          >
            <Info size={14} />
          </button>
          <button
            onClick={exportReport}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all"
            title="Export Report"
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => PerformanceHistory.clear()}
            className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Clear History"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Performance Grade Card */}
      {currentReport && (
        <div className="mb-6">
          <div
            className="p-6 rounded-2xl border transition-all duration-300"
            style={{
              background: gradeColors[currentReport.grade].bg,
              borderColor: gradeColors[currentReport.grade].border,
              boxShadow: `0 0 30px ${gradeColors[currentReport.grade].glow}`
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div
                    className="text-5xl font-black"
                    style={{ color: gradeColors[currentReport.grade].text }}
                  >
                    {currentReport.grade}
                  </div>
                  <div className="text-xs text-white/50 uppercase tracking-wider mt-1">Performance Grade</div>
                </div>
                
                <div className="h-12 w-px bg-white/20" />
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Target size={14} className="text-white/60" />
                    <span className="text-sm text-white/80">Score: <span className="font-bold">{currentReport.score}/100</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-white/60" />
                    <span className="text-sm text-white/80">Time: <span className="font-mono">{formatTime(currentReport.metrics.executionTime)}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive size={14} className="text-white/60" />
                    <span className="text-sm text-white/80">Memory: <span className="font-mono">{formatMemory(currentReport.metrics.memoryUsage.peak)}</span></span>
                  </div>
                </div>
              </div>
              
              {currentReport.comparison.previousRun && (() => {
                  // Get the previous report from history for grade comparison
                  const previousReport = PerformanceHistory.getPrevious();
                  return (
                    <div className="text-right">
                      <div className="text-xs text-white/50 mb-1">vs Previous Run</div>
                      <div className={`flex items-center gap-1 text-sm font-bold ${
                        currentReport.comparison.improvement > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {currentReport.comparison.improvement > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {Math.abs(currentReport.comparison.improvement).toFixed(1)}%
                      </div>
                      {previousReport && (
                        <div className="text-xs text-white/40 mt-1">
                          {previousReport.grade} → {currentReport.grade}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* Performance Comparison Card */}
      {currentReport && currentReport.comparison.previousRun && (
        <div className="mb-6">
          <div className="glass-analysis-card">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-400" />
              Performance Comparison
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ComparisonMetric
                label="Execution Time"
                current={currentReport.metrics.executionTime}
                previous={currentReport.comparison.previousRun?.executionTime || 0}
                formatter={formatTime}
                inverse={true} // Lower is better
              />
              <ComparisonMetric
                label="Memory Peak"
                current={currentReport.metrics.memoryUsage.peak}
                previous={currentReport.comparison.previousRun?.memoryUsage.peak || 0}
                formatter={formatMemory}
                inverse={true} // Lower is better
              />
              <ComparisonMetric
                label="CPU Peak"
                current={currentReport.metrics.cpuUsage.peak}
                previous={currentReport.comparison.previousRun?.cpuUsage.peak || 0}
                formatter={(val: number) => `${val.toFixed(1)}%`}
                inverse={true} // Lower is better
              />
              <ComparisonMetric
                label="Performance Score"
                current={currentReport.score}
                previous={currentReport.comparison.previousRun ? performanceService.calculateScore(currentReport.comparison.previousRun) : 0}
                formatter={(val: number) => `${val}/100`}
                inverse={false} // Higher is better
              />
            </div>
            
            {/* Overall Improvement Indicator */}
            <div className="mt-4 p-3 rounded-lg border" style={{
              background: currentReport.comparison.improvement > 0 
                ? 'rgba(63, 185, 80, 0.1)' 
                : 'rgba(248, 81, 73, 0.1)',
              borderColor: currentReport.comparison.improvement > 0 
                ? 'rgba(63, 185, 80, 0.3)' 
                : 'rgba(248, 81, 73, 0.3)'
            }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {currentReport.comparison.improvement > 0 ? (
                    <TrendingUp size={16} className="text-green-400" />
                  ) : (
                    <TrendingDown size={16} className="text-red-400" />
                  )}
                  <span className={`text-sm font-medium ${
                    currentReport.comparison.improvement > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {currentReport.comparison.improvement > 0 ? 'Performance Improved' : 'Performance Regressed'}
                  </span>
                </div>
                <div className={`text-sm font-bold ${
                  currentReport.comparison.improvement > 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {Math.abs(currentReport.comparison.improvement).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6">
          <div className="glass-analysis-card">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle size={14} className="text-orange-400" />
              Performance Alerts ({alerts.length})
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${
                    alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                    alert.severity === 'high' ? 'bg-orange-500/10 border-orange-500/30' :
                    alert.severity === 'medium' ? 'bg-yellow-500/10 border-yellow-500/30' :
                    'bg-blue-500/10 border-blue-500/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 ${
                      alert.severity === 'critical' ? 'bg-red-400' :
                      alert.severity === 'high' ? 'bg-orange-400' :
                      alert.severity === 'medium' ? 'bg-yellow-400' :
                      'bg-blue-400'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${
                          alert.type === 'achievement' ? 'text-green-400' :
                          alert.type === 'improvement' ? 'text-blue-400' :
                          alert.type === 'regression' ? 'text-orange-400' :
                          'text-white'
                        }`}>
                          {alert.title}
                        </span>
                        <span className="text-xs text-white/40 capitalize">
                          {alert.type}
                        </span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed">{alert.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Metric Tabs */}
      <div className="flex items-center gap-1 mb-6 p-1 bg-white/5 rounded-xl border border-white/10">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'efficiency', label: 'Efficiency', icon: Zap },
          { id: 'memory', label: 'Memory', icon: HardDrive },
          { id: 'cpu', label: 'CPU', icon: Cpu },
          { id: 'timeline', label: 'Timeline', icon: Calendar }
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSelectedMetric(id as any)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedMetric === id
                ? 'bg-white/20 text-white border border-white/20'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Content Based on Selected Metric */}
      {currentReport && (
        <div className="flex-1 space-y-6">
          {selectedMetric === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Key Metrics */}
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Zap size={14} className="text-yellow-400" />
                  Key Metrics
                </h3>
                <div className="space-y-3">
                  <MetricRow label="Execution Time" value={formatTime(currentReport.metrics.executionTime)} />
                  <MetricRow label="Memory Peak" value={formatMemory(currentReport.metrics.memoryUsage.peak)} />
                  <MetricRow label="CPU Peak" value={`${currentReport.metrics.cpuUsage.peak.toFixed(1)}%`} />
                  <MetricRow label="Operations" value={currentReport.metrics.operations.totalOperations.toLocaleString()} />
                  <MetricRow label="Code Lines" value={currentReport.metrics.codeSize.lines.toString()} />
                </div>
              </div>

              {/* Operations Analysis */}
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Activity size={14} className="text-blue-400" />
                  Operations Analysis
                </h3>
                <div className="space-y-3">
                  <MetricRow label="Total Operations" value={currentReport.metrics.operations.totalOperations.toLocaleString()} />
                  <MetricRow label="Ops/Second" value={currentReport.metrics.operations.operationsPerSecond.toFixed(0)} />
                  <MetricRow label="Complexity" value={currentReport.metrics.operations.bigOComplexity || 'Unknown'} />
                  <MetricRow label="I/O Operations" value={currentReport.metrics.ioStats.fileOperations.toString()} />
                  <MetricRow label="Bytes Read" value={`${(currentReport.metrics.ioStats.bytesRead / 1024).toFixed(1)}KB`} />
                </div>
              </div>
            </div>
          )}

          {selectedMetric === 'efficiency' && (
            <div className="space-y-4">
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Zap size={14} className="text-yellow-400" />
                  Efficiency Metrics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Time per Operation</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.efficiency.timePerOperation.toFixed(3)}ms
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {currentReport.metrics.efficiency.timePerOperation < 1 ? 'Excellent' : 
                       currentReport.metrics.efficiency.timePerOperation < 5 ? 'Good' : 'Needs Improvement'}
                    </div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Memory per Line</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.efficiency.memoryPerLine.toFixed(2)}MB
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {currentReport.metrics.efficiency.memoryPerLine < 0.1 ? 'Excellent' : 
                       currentReport.metrics.efficiency.memoryPerLine < 0.5 ? 'Good' : 'High Usage'}
                    </div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">CPU Efficiency</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.efficiency.cpuEfficiency.toFixed(1)}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {currentReport.metrics.efficiency.cpuEfficiency > 10 ? 'Excellent' : 
                       currentReport.metrics.efficiency.cpuEfficiency > 5 ? 'Good' : 'Inefficient'}
                    </div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Operations per Second</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.operations.operationsPerSecond.toFixed(0)}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {currentReport.metrics.operations.operationsPerSecond > 10000 ? 'Excellent' : 
                       currentReport.metrics.operations.operationsPerSecond > 1000 ? 'Good' : 'Slow'}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Target size={14} className="text-blue-400" />
                  Code Quality Metrics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Code Quality</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.quality.codeQuality}/100
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${currentReport.metrics.quality.codeQuality}%`,
                          background: `linear-gradient(90deg, #3fb95080, #3fb950)`
                        }}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Maintainability</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.quality.maintainability}/100
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${currentReport.metrics.quality.maintainability}%`,
                          background: `linear-gradient(90deg, #58a6ff80, #58a6ff)`
                        }}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="text-xs text-white/60 mb-1">Complexity</div>
                    <div className="text-lg font-mono text-white">
                      {currentReport.metrics.quality.complexity}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {currentReport.metrics.quality.complexity < 10 ? 'Simple' : 
                       currentReport.metrics.quality.complexity < 20 ? 'Moderate' : 'Complex'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedMetric === 'memory' && (
            <div className="space-y-4">
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4">Memory Usage Breakdown</h3>
                <div className="space-y-4">
                  <MemoryBar
                    label="Peak Memory"
                    value={currentReport.metrics.memoryUsage.peak}
                    max={200}
                    color="#f85149"
                  />
                  <MemoryBar
                    label="Average Memory"
                    value={currentReport.metrics.memoryUsage.average}
                    max={200}
                    color="#f88249"
                  />
                  <MemoryBar
                    label="Final Memory"
                    value={currentReport.metrics.memoryUsage.final}
                    max={200}
                    color="#febc2e"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedMetric === 'cpu' && (
            <div className="space-y-4">
              <div className="glass-analysis-card">
                <h3 className="text-sm font-semibold text-white mb-4">CPU Usage Analysis</h3>
                <div className="space-y-4">
                  <CpuBar
                    label="Peak CPU"
                    value={currentReport.metrics.cpuUsage.peak}
                    max={100}
                    color="#f85149"
                  />
                  <CpuBar
                    label="Average CPU"
                    value={currentReport.metrics.cpuUsage.average}
                    max={100}
                    color="#58a6ff"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedMetric === 'timeline' && history.length > 0 && (
            <div className="glass-analysis-card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Calendar size={14} className="text-blue-400" />
                Performance History
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.slice(-10).reverse().map((report, index, array) => {
                  const previousReport = index < array.length - 1 ? array[index + 1] : null;
                  const timeImprovement = previousReport 
                    ? ((previousReport.metrics.executionTime - report.metrics.executionTime) / previousReport.metrics.executionTime) * 100
                    : 0;
                  const memoryImprovement = previousReport
                    ? ((previousReport.metrics.memoryUsage.peak - report.metrics.memoryUsage.peak) / previousReport.metrics.memoryUsage.peak) * 100
                    : 0;
                  
                  return (
                    <div key={index} className="p-3 bg-white/5 rounded-lg border border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                            style={{
                              background: gradeColors[report.grade].bg,
                              color: gradeColors[report.grade].text
                            }}
                          >
                            {report.grade}
                          </div>
                          <div>
                            <div className="text-sm text-white/80">{formatTime(report.metrics.executionTime)}</div>
                            <div className="text-xs text-white/50">{formatMemory(report.metrics.memoryUsage.peak)}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-white">{report.score}/100</div>
                          <div className="text-xs text-white/50">
                            {new Date(report.metrics.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                      
                      {previousReport && (
                        <div className="flex items-center gap-4 text-xs border-t border-white/10 pt-2">
                          <div className="flex items-center gap-1">
                            <Clock size={10} className="text-white/40" />
                            <span className="text-white/60">Time:</span>
                            <span className={timeImprovement > 0 ? 'text-green-400' : 'text-red-400'}>
                              {timeImprovement > 0 ? '-' : '+'}{Math.abs(timeImprovement).toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <HardDrive size={10} className="text-white/40" />
                            <span className="text-white/60">Memory:</span>
                            <span className={memoryImprovement > 0 ? 'text-green-400' : 'text-red-400'}>
                              {memoryImprovement > 0 ? '-' : '+'}{Math.abs(memoryImprovement).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottlenecks */}
          {currentReport.bottlenecks.length > 0 && (
            <div className="glass-analysis-card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <AlertTriangle size={14} className="text-orange-400" />
                Performance Bottlenecks ({currentReport.bottlenecks.length})
              </h3>
              <div className="space-y-2">
                {currentReport.bottlenecks.map((bottleneck, index) => (
                  <BottleneckCard
                    key={index}
                    bottleneck={bottleneck}
                    isExpanded={expandedBottlenecks.has(index)}
                    onToggle={() => toggleBottleneck(index)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {currentReport.recommendations.length > 0 && (
            <div className="glass-analysis-card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-400" />
                Recommendations
              </h3>
              <div className="space-y-2">
                {currentReport.recommendations.map((rec, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-white/80 leading-relaxed">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper Components
const MetricRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-xs text-white/60">{label}</span>
    <span className="text-sm font-mono text-white">{value}</span>
  </div>
);

const MemoryBar: React.FC<{ label: string; value: number; max: number; color: string }> = ({
  label, value, max, color
}) => {
  const percentage = Math.min(100, (value / max) * 100);
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-white/60">{label}</span>
        <span className="text-xs font-mono text-white">{formatMemory(value)}</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percentage}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
            boxShadow: `0 0 8px ${color}40`
          }}
        />
      </div>
    </div>
  );
};

const CpuBar: React.FC<{ label: string; value: number; max: number; color: string }> = ({
  label, value, max, color
}) => {
  const percentage = Math.min(100, (value / max) * 100);
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-white/60">{label}</span>
        <span className="text-xs font-mono text-white">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percentage}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
            boxShadow: `0 0 8px ${color}40`
          }}
        />
      </div>
    </div>
  );
};

const BottleneckCard: React.FC<{
  bottleneck: PerformanceBottleneck;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ bottleneck, isExpanded, onToggle }) => {
  const color = severityColors[bottleneck.severity];
  
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="text-left">
            <div className="text-sm font-medium text-white">{bottleneck.description}</div>
            <div className="text-xs text-white/50 capitalize">{bottleneck.severity} severity</div>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      
      {isExpanded && (
        <div className="p-3 bg-black/20 border-t border-white/10 space-y-2">
          <div>
            <div className="text-xs text-white/50 mb-1">Suggestion:</div>
            <div className="text-sm text-white/80">{bottleneck.suggestion}</div>
          </div>
          <div>
            <div className="text-xs text-white/50 mb-1">Impact:</div>
            <div className="text-sm text-white/80">{bottleneck.impact}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const formatMemory = (mb: number): string => {
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
};

// Comparison Metric Component
interface ComparisonMetricProps {
  label: string;
  current: number;
  previous: number;
  formatter: (val: number) => string;
  inverse: boolean; // If true, lower values are better
}

const ComparisonMetric: React.FC<ComparisonMetricProps> = ({
  label,
  current,
  previous,
  formatter,
  inverse
}) => {
  const change = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  const isImproved = inverse ? change < 0 : change > 0;
  
  return (
    <div className="p-3 bg-white/5 rounded-lg border border-white/10">
      <div className="text-xs text-white/60 mb-1">{label}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">Current:</span>
          <span className="text-sm font-mono text-white">{formatter(current)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">Previous:</span>
          <span className="text-sm font-mono text-white/60">{formatter(previous)}</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <span className="text-xs text-white/50">Change:</span>
          <div className={`flex items-center gap-1 text-xs font-bold ${
            isImproved ? 'text-green-400' : 'text-red-400'
          }`}>
            {isImproved ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(change).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
};
