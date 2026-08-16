import React, { createContext, useContext, useRef, useState, useCallback, useEffect, startTransition, ReactNode } from 'react';
import { DisposableStore, EventBus } from '../core/runtime';

interface PerformanceContextValue {
  markRender: (componentName: string) => void;
  measureLayout: (name: string, fn: () => void) => void;
  scheduleWork: (priority: 'user-blocking' | 'normal' | 'low', work: () => void) => void;
  getMetrics: () => PerformanceMetrics;
  onFrame: (callback: (time: number) => void) => () => void;
}

interface PerformanceMetrics {
  renderCounts: Record<string, number>;
  frameTime: number;
  droppedFrames: number;
  longTasks: number;
}

const PerformanceContext = createContext<PerformanceContextValue | null>(null);

interface PerformanceProviderProps {
  children: ReactNode;
}

type FramePayload = { time: number; frameTime: number };

export const PerformanceProvider: React.FC<PerformanceProviderProps> = ({ children }) => {
  const renderCountsRef = useRef<Record<string, number>>({});
  const frameTimeRef = useRef(0);
  const droppedFramesRef = useRef(0);
  const longTasksRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const animationFrameIdRef = useRef<number | null>(null);

  // Demand-driven frame loop: the rAF loop ONLY runs while at least one
  // consumer is subscribed via onFrame(). When the last consumer unsubscribes
  // the loop stops, so an idle app does zero per-frame work.
  const [frameBus] = useState(() => new EventBus<{ frame: FramePayload }>());

  const startLoop = useCallback((loopBus: EventBus<{ frame: FramePayload }>) => {
    if (animationFrameIdRef.current !== null) return;
    const tick = (time: number) => {
      animationFrameIdRef.current = null;
      const prev = lastFrameTimeRef.current;
      const frameTime = prev === 0 ? 0 : time - prev;
      frameTimeRef.current = frameTime;
      if (frameTime > 33.33) droppedFramesRef.current++;
      if (frameTime > 50) longTasksRef.current++;
      lastFrameTimeRef.current = time;
      loopBus.emit('frame', { time, frameTime });
    };
    animationFrameIdRef.current = requestAnimationFrame(tick);
  }, []);

  const stopLoop = useCallback(() => {
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  }, []);

  const markRender = useCallback((componentName: string) => {
    renderCountsRef.current[componentName] = (renderCountsRef.current[componentName] || 0) + 1;
  }, []);

  const measureLayout = useCallback((name: string, fn: () => void) => {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;
    if (duration > 16.67) {
      console.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms (budget: 16.67ms)`);
    }
  }, []);

  const scheduleWork = useCallback((priority: 'user-blocking' | 'normal' | 'low', work: () => void) => {
    if ('scheduler' in window) {
      (window as any).scheduler.scheduleCallback(priority, work);
    } else if (priority === 'user-blocking') {
      requestAnimationFrame(() => {
        startTransition(work);
      });
    } else if (priority === 'normal') {
      requestIdleCallback(work, { timeout: 2000 });
    } else {
      requestIdleCallback(work, { timeout: 5000 });
    }
  }, []);

  const getMetrics = useCallback(() => ({
    renderCounts: { ...renderCountsRef.current },
    frameTime: frameTimeRef.current,
    droppedFrames: droppedFramesRef.current,
    longTasks: longTasksRef.current,
  }), []);

  const onFrame = useCallback((callback: (time: number) => void) => {
    const loopBus = frameBus;
    // Start the loop on first subscriber; it self-stops when the last one leaves.
    if (loopBus.store.size === 0) startLoop(loopBus);
    const disposable = loopBus.onWithStore('frame', ({ time }) => callback(time));
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      loopBus.store.delete(disposable);
      disposable.dispose();
      if (loopBus.store.size === 0) stopLoop();
    };
  }, [startLoop, stopLoop, frameBus]);

  useEffect(() => {
    const loopBus = frameBus;
    const store = new DisposableStore();
    store.add(() => stopLoop());
    return () => {
      store.dispose();
      loopBus.dispose();
    };
  }, [stopLoop]);

  const value: PerformanceContextValue = {
    markRender,
    measureLayout,
    scheduleWork,
    getMetrics,
    onFrame,
  };

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
};

export const usePerformance = () => {
  const context = useContext(PerformanceContext);
  if (!context) {
    throw new Error('usePerformance must be used within a PerformanceProvider');
  }
  return context;
};

export const useRenderTracker = (componentName: string) => {
  const { markRender } = usePerformance();
  useEffect(() => {
    markRender(componentName);
  });
};

export const useFrameCallback = (callback: (time: number) => void, deps: React.DependencyList = []) => {
  const { onFrame } = usePerformance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return onFrame(callback);
  }, deps);
};