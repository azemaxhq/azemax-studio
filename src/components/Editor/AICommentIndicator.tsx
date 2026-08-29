import React, { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';

interface Props {
  activeLine: number | null;
  intent?: string | null;
  editorRef: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.MutableRefObject<typeof Monaco | null>;
}

/**
 * Minimal inline square spinner — appears exactly where AI is working.
 * No label, no dots, no card. 12px rounded-square, theme-aware, overlay.
 */
export const AICommentIndicator: React.FC<Props> = ({ activeLine, editorRef, monacoRef }) => {
  const domRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // cleanup previous overlay
    if (domRef.current && domRef.current.parentNode) {
      domRef.current.parentNode.removeChild(domRef.current);
      domRef.current = null;
    }
    if (activeLine === null) return;

    // Create overlay spinner anchored to far right of active line
    const container = editor.getDomNode()?.parentElement as HTMLElement | null;
    if (!container) return;
    // Ensure container is relative for absolute positioning
    const prevPosition = container.style.position;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const domNode = document.createElement('div');
    domNode.className = 'ai-inline-square-spinner-overlay';
    domNode.setAttribute('aria-hidden', 'true');
    domNode.style.position = 'absolute';
    domNode.style.right = '16px';
    domNode.style.width = '16px';
    domNode.style.height = '16px';
    domNode.style.display = 'inline-flex';
    domNode.style.alignItems = 'center';
    domNode.style.justifyContent = 'center';
    domNode.style.pointerEvents = 'none';
    domNode.style.opacity = '0';
    domNode.style.transform = 'scale(0.9)';
    domNode.style.transition = 'opacity 200ms cubic-bezier(0.16,1,0.3,1), transform 200ms cubic-bezier(0.16,1,0.3,1)';
    domNode.style.willChange = 'opacity, transform';
    domNode.style.zIndex = '5';

    // Premium square spinner — 15px rounded-square, thin refined stroke, subtle accent glow
    const frame = document.createElement('div');
    frame.style.width = '15px';
    frame.style.height = '15px';
    frame.style.position = 'relative';
    frame.style.display = 'inline-flex';
    frame.style.alignItems = 'center';
    frame.style.justifyContent = 'center';
    frame.style.willChange = 'transform, opacity';

    const outer = document.createElement('div');
    outer.style.position = 'absolute';
    outer.style.inset = '0';
    outer.style.borderRadius = '4px';
    outer.style.border = '1px solid rgba(255,255,255,0.08)';
    outer.style.borderTopColor = 'var(--az-accent, #3B82F6)';
    outer.style.borderTopWidth = '1.35px';
    outer.style.boxSizing = 'border-box';
    outer.style.background = 'rgba(255,255,255,0.015)';
    outer.style.backdropFilter = 'blur(2px)';
    outer.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.03), 0 2px 10px rgba(0,0,0,0.14), 0 0 12px rgba(59,130,246,0.07)';
    outer.style.animation = 'ai-square-spin-premium 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite';
    outer.style.willChange = 'transform';

    const inner = document.createElement('div');
    inner.style.position = 'absolute';
    inner.style.inset = '4.5px';
    inner.style.borderRadius = '2px';
    inner.style.background = 'var(--az-accent, #3B82F6)';
    inner.style.opacity = '0.10';
    inner.style.animation = 'ai-square-pulse 1.8s cubic-bezier(0.65, 0, 0.35, 1) infinite';
    inner.style.willChange = 'opacity, transform';

    frame.appendChild(outer);
    frame.appendChild(inner);
    domNode.appendChild(frame);
    domRef.current = domNode;
    container.appendChild(domNode);

    if (!document.getElementById('ai-square-spin-premium-style')) {
      const style = document.createElement('style');
      style.id = 'ai-square-spin-premium-style';
      style.textContent = `
        @keyframes ai-square-spin-premium { 0% { transform: rotate(0deg) scale(1); border-radius: 4px; } 25% { border-radius: 5px; } 50% { transform: rotate(180deg) scale(0.99); } 100% { transform: rotate(360deg) scale(1); border-radius: 4px; } }
        @keyframes ai-square-pulse { 0%,100% { opacity: 0.10; transform: scale(1); } 50% { opacity: 0.18; transform: scale(0.90); } }
        .ai-inline-square-spinner-overlay > div > div { animation: ai-square-spin-premium 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .ai-inline-square-spinner-overlay > div > div > div:last-child { animation: ai-square-pulse 1.8s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .ai-inline-square-spinner-overlay > div > div, .ai-inline-square-spinner-overlay > div > div > div:last-child { animation: none !important; opacity: 0.7; transform: none !important; }
          .ai-inline-square-spinner-overlay { transition: opacity 120ms ease !important; transform: none !important; }
        }
      `;
      document.head.appendChild(style);
    }

    const updateTop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const ed = editorRef.current;
        if (!ed || activeLine === null || !domRef.current) return;
        const topForLine = ed.getTopForLineNumber(activeLine);
        const scrollTop = ed.getScrollTop();
        const lineHeight = ed.getOption(monacoRef.current!.editor.EditorOption.lineHeight) as number;
        const y = topForLine - scrollTop + lineHeight / 2 - 8; // 16px /2
        const layout = ed.getLayoutInfo();
        const editorHeight = layout.height;
        const clampedY = Math.max(4, Math.min(y, editorHeight - 20));
        domRef.current!.style.top = clampedY + 'px';
        // keep right padding comfortable, never touches scrollbar
        domRef.current!.style.right = '16px';
      });
    };

    updateTop();
    // fade/scale-in
    requestAnimationFrame(() => {
      domNode.style.opacity = '1';
      domNode.style.transform = 'scale(1)';
    });

    const d1 = editor.onDidScrollChange(updateTop);
    const d2 = editor.onDidLayoutChange(updateTop);
    const d3 = editor.onDidChangeModelContent(updateTop);
    const ro = new ResizeObserver(updateTop);
    const dom = editor.getDomNode();
    if (dom) ro.observe(dom);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      d1.dispose();
      d2.dispose();
      d3.dispose();
      ro.disconnect();
      if (domRef.current) {
        const n = domRef.current;
        n.style.opacity = '0';
        n.style.transform = 'scale(0.9)';
        setTimeout(() => {
          if (n.parentNode) n.parentNode.removeChild(n);
          if (domRef.current === n) domRef.current = null;
        }, 180);
      }
      // restore container position if we changed it
      if (prevPosition) container.style.position = prevPosition;
    };
  }, [activeLine, editorRef, monacoRef]);

  // No React DOM — content widget handles rendering
  return null;
};
