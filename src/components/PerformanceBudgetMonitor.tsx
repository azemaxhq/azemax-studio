import React, { useEffect, useRef, useCallback } from 'react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';

export interface BudgetConfig {
  maxFrameTime: number;
  maxRenderCount: number;
  maxCommitTime: number;
  maxMemoryMB: number;
  maxFPSDrop: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxFrameTime: 16.67,
  maxRenderCount: 10,
  maxCommitTime: 5,
  maxMemoryMB: 100,
  maxFPSDrop: 10,
};

const FRAME_TIME_TOLERANCE = 1.1;
const VIOLATION_STREAK = 3;

export interface BudgetViolation {
  metric: keyof BudgetConfig;
  value: number;
  budget: number;
  timestamp: number;
  component?: string;
}

export const PerformanceBudgetMonitor: React.FC<{
  budget?: Partial<BudgetConfig>;
  onViolation?: (violation: BudgetViolation) => void;
  children?: React.ReactNode;
  enabled?: boolean;
}> = ({ 
  budget = {}, 
  onViolation, 
  children, 
  enabled = true 
}) => {
  const budgetRef = useRef({ ...DEFAULT_BUDGET, ...budget });
  const streakRef = useRef<Record<string, number>>({});
  const activeRef = useRef<Record<string, boolean>>({});

  const onViolationRef = useRef(onViolation);

  useEffect(() => {
    budgetRef.current = { ...DEFAULT_BUDGET, ...budget };
  }, [budget]);

  useEffect(() => {
    onViolationRef.current = onViolation;
  });

  const {
    fps,
    frameTime,
    renderCount,
    commitTime,
    jsHeapSize,
  } = usePerformanceMonitor({
    sampleInterval: 1000,
    enableProfiler: true,
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;

    const budget = budgetRef.current;
    const now = performance.now();

    const checks: { metric: keyof BudgetConfig; value: number; threshold: number }[] = [
      { metric: 'maxFrameTime', value: frameTime, threshold: budget.maxFrameTime * FRAME_TIME_TOLERANCE },
      { metric: 'maxRenderCount', value: renderCount, threshold: budget.maxRenderCount },
      { metric: 'maxCommitTime', value: commitTime, threshold: budget.maxCommitTime },
      { metric: 'maxMemoryMB', value: jsHeapSize / (1024 * 1024), threshold: budget.maxMemoryMB },
      { metric: 'maxFPSDrop', value: 60 - fps, threshold: budget.maxFPSDrop },
    ];

    for (const { metric, value, threshold } of checks) {
      const streak = streakRef.current;
      const active = activeRef.current;

      if (value > threshold) {
        streak[metric] = (streak[metric] || 0) + 1;

        if (streak[metric] >= VIOLATION_STREAK && !active[metric]) {
          active[metric] = true;
          onViolationRef.current?.({
            metric,
            value,
            budget: budget[metric],
            timestamp: now,
          });
          console.warn(
            `[Performance Budget] ${metric}: ${value.toFixed(2)} exceeds budget of ${budget[metric]}`
          );
        }
      } else {
        if (streak[metric]) streak[metric] = 0;
        if (active[metric]) active[metric] = false;
      }
    }
  }, [enabled, fps, frameTime, renderCount, commitTime, jsHeapSize]);

  if (!enabled && !children) return null;

  return (
    <div className="perf-budget-monitor">
      {children}
    </div>
  );
};

export const ProfilerWrapper: React.FC<{
  id: string;
  children: React.ReactNode;
  onRender?: ProfilerOnRenderCallback;
  budget?: Partial<BudgetConfig>;
}> = ({ id, children, onRender, budget }) => {
  const { onRender: monitorOnRender } = usePerformanceMonitor({ enableProfiler: true });

  const handleRender: ProfilerOnRenderCallback = useCallback((
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  ) => {
    monitorOnRender(id, phase, actualDuration, baseDuration, startTime, commitTime);
    onRender?.(id, phase, actualDuration, baseDuration, startTime, commitTime);

    if (budget && actualDuration > (budget.maxFrameTime || 16.67)) {
      console.warn(`[Profiler] ${id} (${phase}): ${actualDuration.toFixed(2)}ms exceeded frame budget`);
    }
  }, [monitorOnRender, onRender, budget]);

  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
};

export const usePerformanceBudget = (budget: Partial<BudgetConfig> = {}) => {
  const mergedBudget = { ...DEFAULT_BUDGET, ...budget };
  const { fps, frameTime, renderCount, commitTime, jsHeapSize } = usePerformanceMonitor();

  const violations = React.useMemo(() => {
    const v: BudgetViolation[] = [];
    const now = performance.now();

    if (frameTime > mergedBudget.maxFrameTime) {
      v.push({ metric: 'maxFrameTime', value: frameTime, budget: mergedBudget.maxFrameTime, timestamp: now });
    }
    if (renderCount > mergedBudget.maxRenderCount) {
      v.push({ metric: 'maxRenderCount', value: renderCount, budget: mergedBudget.maxRenderCount, timestamp: now });
    }
    if (commitTime > mergedBudget.maxCommitTime) {
      v.push({ metric: 'maxCommitTime', value: commitTime, budget: mergedBudget.maxCommitTime, timestamp: now });
    }
    const memoryMB = jsHeapSize / (1024 * 1024);
    if (memoryMB > mergedBudget.maxMemoryMB) {
      v.push({ metric: 'maxMemoryMB', value: memoryMB, budget: mergedBudget.maxMemoryMB, timestamp: now });
    }
    const fpsDrop = 60 - fps;
    if (fpsDrop > mergedBudget.maxFPSDrop) {
      v.push({ metric: 'maxFPSDrop', value: fpsDrop, budget: mergedBudget.maxFPSDrop, timestamp: now });
    }

    return v;
  }, [fps, frameTime, renderCount, commitTime, jsHeapSize, mergedBudget]);

  const isOverBudget = violations.length > 0;

  return {
    violations,
    isOverBudget,
    metrics: { fps, frameTime, renderCount, commitTime, memoryMB: jsHeapSize / (1024 * 1024) },
    budget: mergedBudget,
  };
};

export const PerformanceDashboard: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const { fps, frameTime, renderCount, commitTime, jsHeapSize, profilerData, clearProfilerData } = usePerformanceMonitor({
    sampleInterval: 1000,
    enableProfiler: true,
  });

  if (!enabled) return null;

  const memoryMB = (jsHeapSize / (1024 * 1024)).toFixed(1);

  return (
    <div className="fixed top-4 right-4 z-40 glass-panel p-4 rounded-lg border border-white/10 min-w-[280px] animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <span className="w-2 h-2 bg-[var(--az-success)] rounded-full" />
          Performance Dashboard
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-black/20 rounded-lg p-3">
          <div className="text-[10px] text-white/50 uppercase tracking-wider">FPS</div>
          <div className={`text-2xl font-bold font-mono ${fps >= 55 ? 'text-[var(--az-success)]' : fps >= 30 ? 'text-[var(--az-warning)]' : 'text-[var(--az-error)]'}`}>
            {fps}
          </div>
        </div>
        <div className="bg-black/20 rounded-lg p-3">
          <div className="text-[10px] text-white/50 uppercase tracking-wider">Frame Time</div>
          <div className={`text-2xl font-bold font-mono ${frameTime <= 16.67 ? 'text-[var(--az-success)]' : frameTime <= 33 ? 'text-[var(--az-warning)]' : 'text-[var(--az-error)]'}`}>
            {frameTime.toFixed(1)}ms
          </div>
        </div>
        <div className="bg-black/20 rounded-lg p-3">
          <div className="text-[10px] text-white/50 uppercase tracking-wider">Renders/s</div>
          <div className="text-2xl font-bold font-mono text-[var(--az-accent)]">{renderCount}</div>
        </div>
        <div className="bg-black/20 rounded-lg p-3">
          <div className="text-[10px] text-white/50 uppercase tracking-wider">Commit Time</div>
          <div className={`text-2xl font-bold font-mono ${commitTime <= 5 ? 'text-[var(--az-success)]' : commitTime <= 16 ? 'text-[var(--az-warning)]' : 'text-[var(--az-error)]'}`}>
            {commitTime.toFixed(1)}ms
          </div>
        </div>
        <div className="bg-black/20 rounded-lg p-3 col-span-2">
          <div className="text-[10px] text-white/50 uppercase tracking-wider">JS Heap</div>
          <div className="text-2xl font-bold font-mono text-[var(--az-info)]">{memoryMB} MB</div>
        </div>
      </div>

      {profilerData.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <h4 className="text-xs text-white/50 uppercase tracking-wider mb-2">Slowest Components</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {profilerData
              .slice(-10)
              .sort((a, b) => b.actualDuration - a.actualDuration)
              .slice(0, 5)
              .map((p, i) => (
                <div key={i} className="flex justify-between text-[10px] text-white/70">
                  <span className="truncate pr-2">{p.id} ({p.phase})</span>
                  <span className={`font-mono ${p.actualDuration > 16.67 ? 'text-[var(--az-error)]' : 'text-[var(--az-success)]'}`}>
                    {p.actualDuration.toFixed(1)}ms
                  </span>
                </div>
              ))}
          </div>
          <button
            onClick={clearProfilerData}
            className="mt-2 w-full text-[10px] text-white/50 hover:text-white"
          >
            Clear Profiler Data
          </button>
        </div>
      )}
    </div>
  );
};

export default PerformanceBudgetMonitor;