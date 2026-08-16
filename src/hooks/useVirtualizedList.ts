import { useRef, useState, useEffect, useCallback, useMemo } from 'react';

export interface VirtualizedItem<T> {
  index: number;
  data: T;
  start: number;
  end: number;
  size: number;
}

export interface VirtualizedListOptions<T> {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  containerHeight: number;
  overscan?: number;
  getItemKey?: (item: T, index: number) => string | number;
  estimateSize?: (index: number) => number;
}

export interface VirtualizedListResult<T> {
  virtualItems: VirtualizedItem<T>[];
  totalHeight: number;
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'auto') => void;
  scrollToOffset: (offset: number) => void;
  measureRef: (el: HTMLDivElement | null) => void;
}

function defaultGetItemKey<T>(item: T, index: number): string | number {
  return index;
}

export function useVirtualizedList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 5,
  getItemKey = defaultGetItemKey,
  estimateSize,
}: VirtualizedListOptions<T>): VirtualizedListResult<T> {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [measuredContainerHeight, setMeasuredContainerHeight] = useState(containerHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeightsRef = useRef<Map<number, number>>(new Map());
  const scrollDirectionRef = useRef<'forward' | 'backward' | null>(null);
  const lastScrollOffsetRef = useRef(0);

  const getItemHeight = useCallback((index: number): number => {
    if (itemHeightsRef.current.has(index)) {
      return itemHeightsRef.current.get(index)!;
    }
    if (typeof itemHeight === 'function') {
      const height = itemHeight(items[index], index);
      itemHeightsRef.current.set(index, height);
      return height;
    }
    if (estimateSize) {
      const height = estimateSize(index);
      itemHeightsRef.current.set(index, height);
      return height;
    }
    return itemHeight;
  }, [itemHeight, items, estimateSize]);

  const totalHeight = useMemo(() => {
    let height = 0;
    for (let i = 0; i < items.length; i++) {
      height += getItemHeight(i);
    }
    return height;
  }, [items.length, getItemHeight]);

  const virtualItems = useMemo((): VirtualizedItem<T>[] => {
    if (items.length === 0) return [];

    let startIndex = 0;
    let offset = 0;

    const scrollTop = scrollOffset;
    const scrollBottom = scrollOffset + measuredContainerHeight;

    while (startIndex < items.length) {
      const height = getItemHeight(startIndex);
      if (offset + height >= scrollTop) break;
      offset += height;
      startIndex++;
    }

    startIndex = Math.max(0, startIndex - overscan);

    let endIndex = startIndex;
    let endOffset = offset;

    while (endIndex < items.length && endOffset < scrollBottom) {
      const height = getItemHeight(endIndex);
      endOffset += height;
      endIndex++;
    }

    endIndex = Math.min(items.length, endIndex + overscan);

    const virtualItems: VirtualizedItem<T>[] = [];
    let currentOffset = 0;

    for (let i = 0; i < startIndex; i++) {
      currentOffset += getItemHeight(i);
    }

    for (let i = startIndex; i < endIndex; i++) {
      const height = getItemHeight(i);
      virtualItems.push({
        index: i,
        data: items[i],
        start: currentOffset,
        end: currentOffset + height,
        size: height,
      });
      currentOffset += height;
    }

    return virtualItems;
  }, [items, scrollOffset, measuredContainerHeight, overscan, getItemHeight]);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      containerRef.current = el;
      setMeasuredContainerHeight(el.clientHeight);
    }
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newOffset = e.currentTarget.scrollTop;
    scrollDirectionRef.current = newOffset > lastScrollOffsetRef.current ? 'forward' : 'backward';
    lastScrollOffsetRef.current = newOffset;
    setScrollOffset(newOffset);
  }, []);

  const scrollToIndex = useCallback((
    index: number,
    align: 'start' | 'center' | 'end' | 'auto' = 'auto'
  ) => {
    if (index < 0 || index >= items.length) return;

    let targetOffset = 0;
    for (let i = 0; i < index; i++) {
      targetOffset += getItemHeight(i);
    }

    const itemHeightValue = getItemHeight(index);

    if (align === 'center') {
      targetOffset = targetOffset - (measuredContainerHeight - itemHeightValue) / 2;
    } else if (align === 'end') {
      targetOffset = targetOffset - measuredContainerHeight + itemHeightValue;
    } else if (align === 'auto') {
      const currentScrollTop = containerRef.current?.scrollTop ?? 0;
      const currentScrollBottom = currentScrollTop + measuredContainerHeight;

      if (targetOffset < currentScrollTop) {
      } else if (targetOffset + itemHeightValue > currentScrollBottom) {
        targetOffset = targetOffset - measuredContainerHeight + itemHeightValue;
      } else {
        return;
      }
    }

    targetOffset = Math.max(0, Math.min(targetOffset, totalHeight - measuredContainerHeight));

    if (containerRef.current) {
      containerRef.current.scrollTop = targetOffset;
    }
    setScrollOffset(targetOffset);
  }, [items.length, getItemHeight, measuredContainerHeight, totalHeight]);

  const scrollToOffset = useCallback((offset: number) => {
    const clampedOffset = Math.max(0, Math.min(offset, totalHeight - measuredContainerHeight));
    if (containerRef.current) {
      containerRef.current.scrollTop = clampedOffset;
    }
    setScrollOffset(clampedOffset);
  }, [totalHeight, measuredContainerHeight]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollEvent = () => {
      const newOffset = container.scrollTop;
      scrollDirectionRef.current = newOffset > lastScrollOffsetRef.current ? 'forward' : 'backward';
      lastScrollOffsetRef.current = newOffset;
      setScrollOffset(newOffset);
    };

    container.addEventListener('scroll', handleScrollEvent, { passive: true });
    return () => container.removeEventListener('scroll', handleScrollEvent);
  }, []);

  return {
    virtualItems,
    totalHeight,
    scrollToIndex,
    scrollToOffset,
    measureRef,
  };
}

export function useVirtualizedGrid<T>({
  items,
  columnCount,
  itemHeight,
  containerHeight,
  containerWidth,
  overscan = 2,
  getItemKey = defaultGetItemKey,
}: {
  items: T[];
  columnCount: number;
  itemHeight: number | ((item: T, index: number) => number);
  containerHeight: number;
  containerWidth: number;
  overscan?: number;
  getItemKey?: (item: T, index: number) => string | number;
}) {
  const [scrollOffset, setScrollOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeightsRef = useRef<Map<number, number>>(new Map());

  const getItemHeightFn = useCallback((index: number): number => {
    if (itemHeightsRef.current.has(index)) {
      return itemHeightsRef.current.get(index)!;
    }
    const height = typeof itemHeight === 'function'
      ? itemHeight(items[index], index)
      : itemHeight;
    itemHeightsRef.current.set(index, height);
    return height;
  }, [itemHeight, items]);

  const rowCount = Math.ceil(items.length / columnCount);
  const columnWidth = containerWidth / columnCount;
  const totalHeight = rowCount * (typeof itemHeight === 'number' ? itemHeight : 0);

  const virtualItems = useMemo((): Array<VirtualizedItem<T> & { column: number; row: number }> => {
    if (items.length === 0) return [];

    const scrollTop = scrollOffset.y;
    const scrollBottom = scrollTop + containerHeight;
    const scrollLeft = scrollOffset.x;
    const scrollRight = scrollLeft + containerWidth;

    const startRow = Math.max(0, Math.floor(scrollTop / (typeof itemHeight === 'number' ? itemHeight : 20)) - overscan);
    const endRow = Math.min(rowCount - 1, Math.ceil(scrollBottom / (typeof itemHeight === 'number' ? itemHeight : 20)) + overscan);
    const startCol = Math.max(0, Math.floor(scrollLeft / columnWidth) - overscan);
    const endCol = Math.min(columnCount - 1, Math.ceil(scrollRight / columnWidth) + overscan);

    const result: Array<VirtualizedItem<T> & { column: number; row: number }> = [];

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const index = row * columnCount + col;
        if (index >= items.length) continue;

        const height = getItemHeightFn(index);
        const y = row * height;
        const x = col * columnWidth;

        result.push({
          index,
          data: items[index],
          start: y,
          end: y + height,
          size: height,
          column: col,
          row,
        });
      }
    }

    return result;
  }, [items, columnCount, containerHeight, containerWidth, scrollOffset, overscan, getItemHeightFn]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollOffset({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop });
  }, []);

  return {
    virtualItems,
    totalHeight: rowCount * (typeof itemHeight === 'number' ? itemHeight : 20),
    totalWidth: containerWidth,
    onScroll: handleScroll,
    measureRef: (el: HTMLDivElement | null) => { containerRef.current = el; },
    scrollToIndex: (index: number) => {
      const row = Math.floor(index / columnCount);
      const col = index % columnCount;
      const height = typeof itemHeight === 'number' ? itemHeight : 20;
      if (containerRef.current) {
        containerRef.current.scrollTop = row * height;
        containerRef.current.scrollLeft = col * columnWidth;
      }
    },
  };
}

export function useWindowVirtualizer<T>({
  items,
  itemHeight,
  overscan = 5,
  getItemKey = defaultGetItemKey,
}: {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  overscan?: number;
  getItemKey?: (item: T, index: number) => string | number;
}) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const containerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const totalHeight = useMemo(() => {
    let height = 0;
    for (let i = 0; i < items.length; i++) {
      height += typeof itemHeight === 'function' ? itemHeight(items[i], i) : itemHeight;
    }
    return height;
  }, [items, itemHeight]);

  useEffect(() => {
    const handleScroll = () => setScrollOffset(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return useVirtualizedList({ items, itemHeight, containerHeight, overscan, getItemKey });
}