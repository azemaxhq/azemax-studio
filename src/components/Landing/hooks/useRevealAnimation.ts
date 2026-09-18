import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface RevealOptions {
  threshold?: number;
  rootMargin?: string;
  delay?: number;
  once?: boolean;
}

/**
 * Render-optimized scroll-reveal.
 *
 * - One shared IntersectionObserver per (threshold, rootMargin) bucket.
 *   Callbacks are fanned out to subscribed elements — Blink/WebKit pay for
 *   a single observer instead of a dozen.
 * - Single cached prefers-reduced-motion query (no per-hook listeners).
 * - Reduced-motion state is computed lazily in useState initializers, never
 *   via synchronous setState inside effects (no cascading renders).
 * - No setState after unmount (mounted ref + timeout cleanup).
 * - Tuple return `[target, isVisible]`: returning a plain object with a
 *   `.ref` field makes the react-hooks/refs lint rule treat the whole
 *   object as a ref and flag every read during render. A tuple keeps the
 *   RefObject in a plain local binding, which is lint-clean.
 */

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

type RevealEntry = {
  el: Element;
  onVisible: () => void;
  once: boolean;
};

type ObserverBucket = {
  observer: IntersectionObserver;
  entries: Map<Element, RevealEntry>;
};

const buckets = new Map<string, ObserverBucket>();

function getBucket(threshold: number, rootMargin: string): ObserverBucket {
  const key = `${threshold}|${rootMargin}`;
  const existing = buckets.get(key);
  if (existing) return existing;

  const entries: ObserverBucket['entries'] = new Map();
  const observer = new IntersectionObserver(
    (ioEntries) => {
      for (const ioEntry of ioEntries) {
        if (!ioEntry.isIntersecting) continue;
        const record = entries.get(ioEntry.target);
        if (!record) continue;
        record.onVisible();
        if (record.once) {
          entries.delete(ioEntry.target);
          observer.unobserve(ioEntry.target);
        }
      }
      // Release idle buckets so Blink/WebKit can GC the observer when
      // every section has revealed (common after full scroll-through).
      if (entries.size === 0) {
        observer.disconnect();
        buckets.delete(key);
      }
    },
    { threshold, rootMargin },
  );
  const bucket: ObserverBucket = { observer, entries };
  buckets.set(key, bucket);
  return bucket;
}

function unsubscribe(bucket: ObserverBucket, key: string, el: Element): void {
  bucket.entries.delete(el);
  try {
    bucket.observer.unobserve(el);
  } catch {
    // Element may already be detached — non-fatal.
  }
  if (bucket.entries.size === 0) {
    bucket.observer.disconnect();
    buckets.delete(key);
  }
}

export function useRevealAnimation(
  options: RevealOptions = {},
): [RefObject<HTMLDivElement | null>, boolean] {
  const { threshold = 0.12, rootMargin = '0px 0px -60px 0px', delay = 0, once = true } = options;
  const target = useRef<HTMLDivElement | null>(null);
  // Reduced-motion users start visible: no effect-time setState needed.
  const [isVisible, setIsVisible] = useState<boolean>(() => isReducedMotion());

  useEffect(() => {
    const el = target.current;
    if (!el || isReducedMotion()) return;

    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const bucketKey = `${threshold}|${rootMargin}`;
    const bucket = getBucket(threshold, rootMargin);

    const onVisible = () => {
      if (!mounted) return;
      if (delay > 0) {
        timeoutId = setTimeout(() => {
          if (mounted) setIsVisible(true);
        }, delay);
      } else {
        setIsVisible(true);
      }
    };

    bucket.entries.set(el, { el, onVisible, once });
    bucket.observer.observe(el);

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe(bucket, bucketKey, el);
    };
  }, [threshold, rootMargin, delay, once]);

  return [target, isVisible];
}

/**
 * Staggered reveal for a group of children.
 * Chained timeouts flip one boolean slot per tick and bail out early if
 * unmounted; a single shared observer via the pool. Item count is small
 * (4) so per-tick copies are trivial. itemCount is expected to be constant
 * for the lifetime of the component (all call sites pass literals).
 */
export function useStaggerReveal(
  itemCount: number,
  staggerMs = 80,
): [RefObject<HTMLDivElement | null>, boolean[]] {
  const container = useRef<HTMLDivElement | null>(null);
  const [visibleItems, setVisibleItems] = useState<boolean[]>(() =>
    new Array(itemCount).fill(isReducedMotion()),
  );

  useEffect(() => {
    const el = container.current;
    if (!el || isReducedMotion()) return;

    let mounted = true;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const bucketKey = '0.08|0px 0px -40px 0px';
    const bucket = getBucket(0.08, '0px 0px -40px 0px');

    const onVisible = () => {
      for (let i = 0; i < itemCount; i++) {
        const tid = setTimeout(() => {
          if (!mounted) return;
          setVisibleItems((prev) => {
            if (prev[i]) return prev;
            const next = [...prev];
            next[i] = true;
            return next;
          });
        }, i * staggerMs);
        timeouts.push(tid);
      }
    };

    bucket.entries.set(el, { el, onVisible, once: true });
    bucket.observer.observe(el);

    return () => {
      mounted = false;
      timeouts.forEach(clearTimeout);
      unsubscribe(bucket, bucketKey, el);
    };
  }, [itemCount, staggerMs]);

  return [container, visibleItems];
}
