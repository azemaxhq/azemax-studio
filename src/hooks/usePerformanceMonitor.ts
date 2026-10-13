import { useEffect, useRef, useState, useCallback } from 'react';

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  renderCount: number;
  commitTime: number;
  jsHeapSize: number;
  memoryPressure: 'low' | 'medium' | 'high';
}

export interface ProfilerMetrics {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
}

export interface UsePerformanceMonitorOptions {
  sampleInterval?: number;
  onMetrics?: (metrics: PerformanceMetrics) => void;
  enableProfiler?: boolean;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Shared, ref-counted measurement loop.
//
// Exactly ONE requestAnimationFrame loop measures frame times for the whole
// page, regardless of how many components subscribe through
// usePerformanceMonitor(). The loop starts when the first subscriber mounts and
// stops when the last one unmounts, so an idle app performs no per-frame work.
// Subscribers read the shared per-frame delta and each keeps its own sampling
// window. This is StrictMode-safe: mount/unmount/remount simply bumps the
// ref-count and never starts a second loop.
// ---------------------------------------------------------------------------

const EMA_ALPHA = 0.2; // smoothing for the reported per-frame time
const MAX_FRAME_DELTA = 5000; // ignore rAF gaps caused by tab switching/backgrounding

interface FrameInstance {
  frameCount: number;
  lastSample: number;
  smoothFrameTime: number;
  renderCount: number;
  commitTime: number;
  sampleInterval: number;
  notify: ((metrics: PerformanceMetrics) => void) | null;
}

const loopState: {
  instances: Set<FrameInstance>;
  rafId: number | null;
  lastTime: number;
} = { instances: new Set(), rafId: null, lastTime: 0 };

function readMemory(): Pick<PerformanceMetrics, 'jsHeapSize' | 'memoryPressure'> {
  const memory = (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!memory) return { jsHeapSize: 0, memoryPressure: 'low' };
  const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
  return {
    jsHeapSize: memory.usedJSHeapSize,
    memoryPressure: ratio > 0.8 ? 'high' : ratio > 0.5 ? 'medium' : 'low',
  };
}

function frameTick(now: number): void {
  loopState.rafId = null;

  const prev = loopState.lastTime;
  const dt = prev === 0 ? 0 : now - prev;
  loopState.lastTime = now;

  for (const inst of loopState.instances) {
    inst.frameCount++;
    if (dt > 0 && dt < MAX_FRAME_DELTA) {
      inst.smoothFrameTime =
        inst.smoothFrameTime === 0 ? dt : inst.smoothFrameTime + (dt - inst.smoothFrameTime) * EMA_ALPHA;
    }

    const elapsed = now - inst.lastSample;
    if (elapsed < inst.sampleInterval) continue;

    inst.lastSample = now;
    if (elapsed > inst.sampleInterval * 2) {
      // The window is dominated by a backgrounded/hidden gap: discard it so a
      // resume is never reported as an FPS drop.
      inst.frameCount = 0;
      continue;
    }

    const frames = inst.frameCount;
    const renderCount = inst.renderCount;
    const commitTime = inst.commitTime;
    inst.frameCount = 0;
    inst.renderCount = 0;
    inst.commitTime = 0;

    const memory = readMemory();
    inst.notify?.({
      fps: frames > 0 ? Math.round((frames * 1000) / elapsed) : 60,
      frameTime: inst.smoothFrameTime,
      renderCount,
      commitTime,
      jsHeapSize: memory.jsHeapSize,
      memoryPressure: memory.memoryPressure,
    });
  }

  if (loopState.instances.size > 0) {
    loopState.rafId = requestAnimationFrame(frameTick);
  }
}

function startLoop(): void {
  if (loopState.rafId !== null) return;
  loopState.lastTime = 0;
  loopState.rafId = requestAnimationFrame(frameTick);
}

function stopLoop(): void {
  if (loopState.rafId !== null) {
    cancelAnimationFrame(loopState.rafId);
    loopState.rafId = null;
  }
}

export function usePerformanceMonitor(
  options: UsePerformanceMonitorOptions = {}
): PerformanceMetrics & {
  profilerData: ProfilerMetrics[];
  clearProfilerData: () => void;
  onRender: (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => void;
} {
  const { sampleInterval = 1000, onMetrics, enableProfiler = false, enabled = true } = options;

  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 60,
    frameTime: 16.67,
    renderCount: 0,
    commitTime: 0,
    jsHeapSize: 0,
    memoryPressure: 'low',
  });

  const [profilerData, setProfilerData] = useState<ProfilerMetrics[]>([]);

  const instRef = useRef<FrameInstance | null>(null);
  if (instRef.current === null) {
    instRef.current = {
      frameCount: 0,
      lastSample: 0,
      smoothFrameTime: 0,
      renderCount: 0,
      commitTime: 0,
      sampleInterval,
      notify: null,
    };
  }

  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    inst.sampleInterval = sampleInterval;
    inst.notify = (m) => {
      setMetrics(m);
      onMetrics?.(m);
    };
  });

  useEffect(() => {
    if (!enabled) return;
    const inst = instRef.current;
    if (!inst) return;
    loopState.instances.add(inst);
    if (loopState.instances.size === 1) startLoop();
    return () => {
      loopState.instances.delete(inst);
      if (loopState.instances.size === 0) stopLoop();
    };
  }, [enabled]);

  const onRender = useCallback(
    (id: string, phase: 'mount' | 'update' | 'nested-update', actualDuration: number, baseDuration: number, startTime: number, commitTime: number) => {
      const inst = instRef.current;
      if (!inst) return;
      inst.renderCount++;
      inst.commitTime += commitTime;
      if (enableProfiler) {
        setProfilerData(prev => [
          ...prev.slice(-99),
          { id, phase, actualDuration, baseDuration, startTime, commitTime },
        ]);
      }
    },
    [enableProfiler]
  );

  const clearProfilerData = useCallback(() => {
    setProfilerData([]);
  }, []);

  return {
    ...metrics,
    profilerData,
    clearProfilerData,
    onRender,
  };
}
