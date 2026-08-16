import { useRef, useEffect, useSyncExternalStore } from 'react';

export interface ThrottledSelectorOptions<T> {
  equalityFn?: (a: T, b: T) => boolean;
  throttleMs?: number;
}

export function createThrottledSelector<T, S>(
  selector: (state: T) => S,
  options: ThrottledSelectorOptions<S> = {}
) {
  const { equalityFn = Object.is, throttleMs = 16 } = options;

  let currentState: T | null = null;
  let currentSelected: S | null = null;
  let scheduled = false;
  let subscribers = new Set<() => void>();

  const getSnapshot = () => currentSelected!;
  const getServerSnapshot = () => currentSelected!;

  const subscribe = (callback: () => void) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  };

  const notify = () => {
    subscribers.forEach(cb => cb());
  };

  const setState = (newState: T) => {
    currentState = newState;
    const newSelected = selector(newState);

    if (!equalityFn(currentSelected as S, newSelected)) {
      currentSelected = newSelected;
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          notify();
        }, throttleMs);
      }
    }
  };

  return {
    getSnapshot,
    getServerSnapshot,
    subscribe,
    setState,
    useStore: () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
  };
}

export function useThrottledSelector<T, S>(
  store: { getState: () => T; subscribe: (cb: () => void) => () => void },
  selector: (state: T) => S,
  options: ThrottledSelectorOptions<S> = {}
): S {
  const { equalityFn = Object.is, throttleMs = 16 } = options;

  const selectedRef = useRef<S | null>(null);
  const scheduledRef = useRef(false);
  const selectorRef = useRef(selector);
  const equalityFnRef = useRef(equalityFn);

  selectorRef.current = selector;
  equalityFnRef.current = equalityFn;

  const getSnapshot = () => selectedRef.current as S;
  const getServerSnapshot = () => selectedRef.current as S;

  const subscribe = useRef(() => {
    const callback = () => {
      if (scheduledRef.current) return;
      scheduledRef.current = true;
      setTimeout(() => {
        scheduledRef.current = false;
        const newState = store.getState();
        const newSelected = selectorRef.current(newState);
        if (!equalityFnRef.current(selectedRef.current as S, newSelected)) {
          selectedRef.current = newSelected;
        }
      }, throttleMs);
    };
    return store.subscribe(callback);
  }).current;

  useEffect(() => {
    const initialSelected = selector(store.getState());
    selectedRef.current = initialSelected;
    return subscribe();
  }, [store, subscribe]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useFrameThrottledState<T>(
  initialValue: T | (() => T)
): [T, (value: T | ((prev: T) => T)) => void] {
  const valueRef = useRef<T>(
    typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  );
  const pendingRef = useRef<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const subscribers = useRef<Set<() => void>>(new Set());

  const getSnapshot = () => valueRef.current;
  const getServerSnapshot = () => valueRef.current;

  const subscribe = (callback: () => void) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  };

  const notify = () => {
    subscribers.current.forEach(cb => cb());
  };

  const flush = () => {
    frameRef.current = null;
    if (pendingRef.current !== null) {
      valueRef.current = pendingRef.current;
      pendingRef.current = null;
      notify();
    }
  };

  const setValue = (newValue: T | ((prev: T) => T)) => {
    const resolvedValue = typeof newValue === 'function'
      ? (newValue as (prev: T) => T)(valueRef.current)
      : newValue;

    if (Object.is(valueRef.current, resolvedValue)) return;

    pendingRef.current = resolvedValue;

    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flush);
    }
  };

  return [getSnapshot(), setValue];
}

export function useBatchedUpdates<T>(
  initialValue: T | (() => T),
  flushMs: number = 16
): [T, (value: T | ((prev: T) => T)) => void] {
  const valueRef = useRef<T>(
    typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  );
  const pendingRef = useRef<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribers = useRef<Set<() => void>>(new Set());

  const getSnapshot = () => valueRef.current;
  const getServerSnapshot = () => valueRef.current;

  const subscribe = (callback: () => void) => {
    subscribers.current.add(callback);
    return () => subscribers.current.delete(callback);
  };

  const notify = () => {
    subscribers.current.forEach(cb => cb());
  };

  const flush = () => {
    timeoutRef.current = null;
    if (pendingRef.current !== null) {
      valueRef.current = pendingRef.current;
      pendingRef.current = null;
      notify();
    }
  };

  const setValue = (newValue: T | ((prev: T) => T)) => {
    const resolvedValue = typeof newValue === 'function'
      ? (newValue as (prev: T) => T)(valueRef.current)
      : newValue;

    if (Object.is(valueRef.current, resolvedValue)) return;

    pendingRef.current = resolvedValue;

    if (timeoutRef.current === null) {
      timeoutRef.current = setTimeout(flush, flushMs);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [getSnapshot(), setValue];
}