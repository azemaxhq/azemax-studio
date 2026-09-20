import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface RevealOptions {
  threshold?: number;
  rootMargin?: string;
  delay?: number;
  once?: boolean;
}

let cachedReducedMotion: boolean | null = null;
function isReducedMotion(): boolean {
  if (cachedReducedMotion !== null) return cachedReducedMotion;
  try {
    cachedReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    cachedReducedMotion = false;
  }
  return cachedReducedMotion;
}

type RevealRecord = {
  onVisible: () => void;
  once: boolean;
};

// Keyed by threshold and rootMargin so observers can be shared safely
const observerPool = new Map<string, { observer: IntersectionObserver; targets: Map<Element, RevealRecord> }>();

function getObserverFor(threshold: number, rootMargin: string) {
  const key = `${threshold}_${rootMargin}`;
  let poolItem = observerPool.get(key);

  if (!poolItem) {
    const targets = new Map<Element, RevealRecord>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const record = targets.get(entry.target);
            if (record) {
              record.onVisible();
              if (record.once) {
                targets.delete(entry.target);
                try {
                  observer.unobserve(entry.target);
                } catch {
                  // Ignore if element detached
                }
              }
            }
          }
        }
      },
      { threshold, rootMargin }
    );
    poolItem = { observer, targets };
    observerPool.set(key, poolItem);
  }

  return { key, poolItem };
}

export function useRevealAnimation(
  options: RevealOptions = {},
): [RefObject<HTMLDivElement | null>, boolean] {
  const { threshold = 0.1, rootMargin = '0px 0px -40px 0px', delay = 0, once = true } = options;
  const target = useRef<HTMLDivElement | null>(null);

  // If reduced motion is active or IntersectionObserver is missing, start visible
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return true;
    return isReducedMotion();
  });

  useEffect(() => {
    if (isVisible) return;
    const el = target.current;
    if (!el) return;

    let mounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const { poolItem } = getObserverFor(threshold, rootMargin);

    const onVisible = () => {
      if (!mounted) return;
      if (delay > 0) {
        timerId = setTimeout(() => {
          if (mounted) setIsVisible(true);
        }, delay);
      } else {
        setIsVisible(true);
      }
    };

    poolItem.targets.set(el, { onVisible, once });
    poolItem.observer.observe(el);

    return () => {
      mounted = false;
      if (timerId) clearTimeout(timerId);
      poolItem.targets.delete(el);
      try {
        poolItem.observer.unobserve(el);
      } catch {
        // Element already detached
      }
    };
  }, [threshold, rootMargin, delay, once, isVisible]);

  return [target, isVisible];
}

/**
 * Retained for backwards compatibility; returns boolean array.
 */
export function useStaggerReveal(
  itemCount: number,
  staggerMs = 80,
): [RefObject<HTMLDivElement | null>, boolean[]] {
  const [containerRef, isVisible] = useRevealAnimation({ threshold: 0.08 });
  const [items, setItems] = useState<boolean[]>(() => new Array(itemCount).fill(isReducedMotion()));

  useEffect(() => {
    if (!isVisible) return;
    if (isReducedMotion()) {
      setItems(new Array(itemCount).fill(true));
      return;
    }

    let mounted = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let i = 0; i < itemCount; i++) {
      const tid = setTimeout(() => {
        if (!mounted) return;
        setItems((prev) => {
          if (prev[i]) return prev;
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }, i * staggerMs);
      timers.push(tid);
    }

    return () => {
      mounted = false;
      timers.forEach(clearTimeout);
    };
  }, [isVisible, itemCount, staggerMs]);

  return [containerRef, items];
}

