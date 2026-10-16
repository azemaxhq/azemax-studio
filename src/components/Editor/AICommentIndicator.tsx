import React, { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';

interface Props {
  activeLine: number | null;
  editorRef: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.MutableRefObject<typeof Monaco | null>;
}

/**
 * Premium AI processing indicator — positioned in the glyph margin column
 * (left of the line number), using Monaco layout coords for pixel-perfect placement.
 *
 * Design: 12px spinning arc + 3px glowing core dot. Pure imperative DOM,
 * no React DOM output, zero layout shift, scroll-tracked via RAF.
 */
export const AICommentIndicator: React.FC<Props> = ({ activeLine, editorRef, monacoRef }) => {
  const domRef   = useRef<HTMLDivElement | null>(null);
  const rafRef   = useRef<number | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // ── Cleanup any prior overlay ──────────────────────────────────────────
    if (domRef.current?.parentNode) {
      domRef.current.parentNode.removeChild(domRef.current);
      domRef.current = null;
    }
    if (activeLine === null) return;

    // Attach directly to Monaco's DOM node so coordinate systems match
    const editorDom = editor.getDomNode() as HTMLElement | null;
    if (!editorDom) return;

    // Monaco's DOM node is position:relative — we can overlay directly
    const prevPos = editorDom.style.position;
    if (getComputedStyle(editorDom).position === 'static') {
      editorDom.style.position = 'relative';
    }

    // ── Build spinner DOM ──────────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    Object.assign(wrap.style, {
      position:      'absolute',
      width:         '16px',
      height:        '16px',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'center',
      pointerEvents: 'none',
      opacity:       '0',
      transform:     'scale(0.55)',
      transition:    'opacity 220ms cubic-bezier(0.16,1,0.3,1), transform 240ms cubic-bezier(0.16,1,0.3,1)',
      willChange:    'opacity, transform',
      zIndex:        '50',
    });

    // Outer arc ring — thin, spins at 800ms
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position:     'absolute',
      inset:        '0',
      borderRadius: '50%',
      border:       '1.5px solid rgba(91,140,255,0.10)',
      borderTopColor:   '#5B8CFF',
      borderRightColor: 'rgba(91,140,255,0.38)',
      boxSizing:    'border-box',
      animation:    'az-ind-spin 800ms linear infinite',
      willChange:   'transform',
    });

    // Inner pulsing glow dot
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position:     'absolute',
      width:        '3.5px',
      height:       '3.5px',
      borderRadius: '50%',
      background:   '#5B8CFF',
      boxShadow:    '0 0 5px 1.5px rgba(91,140,255,0.75)',
      animation:    'az-ind-dot 1.55s ease-in-out infinite',
      willChange:   'transform, opacity',
    });

    wrap.appendChild(ring);
    wrap.appendChild(dot);
    editorDom.appendChild(wrap);
    domRef.current = wrap;

    // Inject keyframes once per page lifetime
    if (!document.getElementById('az-ind-style')) {
      const style = document.createElement('style');
      style.id = 'az-ind-style';
      style.textContent = `
        @keyframes az-ind-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes az-ind-dot {
          0%,100% { transform:scale(1);   opacity:0.80; box-shadow:0 0 4px 1.5px rgba(91,140,255,0.65); }
          50%      { transform:scale(1.45); opacity:1;    box-shadow:0 0 9px 2px rgba(91,140,255,0.45),0 0 16px 3px rgba(127,168,240,0.18); }
        }
        @media (prefers-reduced-motion:reduce) {
          [data-az-ind] > div:first-child { animation:none !important; }
          [data-az-ind] > div:last-child  { animation:none !important; }
        }
      `;
      document.head.appendChild(style);
    }
    wrap.setAttribute('data-az-ind', '1');

    // ── Position tracker — glyph margin column, left of line number ────────
    const place = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const ed = editorRef.current;
        if (!ed || activeLine === null || !domRef.current) return;

        const layout     = ed.getLayoutInfo();
        const lineHeight = ed.getOption(monacoRef.current!.editor.EditorOption.lineHeight) as number;
        const topForLine = ed.getTopForLineNumber(activeLine);
        const scrollTop  = ed.getScrollTop();

        // Horizontal: centre of the glyph margin column
        const x = layout.glyphMarginLeft + layout.glyphMarginWidth / 2 - 8;  // 8 = 16px/2
        // Vertical:  centre of the target line
        const y = topForLine - scrollTop + lineHeight / 2 - 8;
        const clampedY = Math.max(2, Math.min(y, layout.height - 18));

        domRef.current!.style.left = `${Math.max(0, x)}px`;
        domRef.current!.style.top  = `${clampedY}px`;
      });
    };

    place();

    // Spring entrance — two rAF ticks so the browser paints the initial state first
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!domRef.current) return;
      domRef.current.style.opacity   = '1';
      domRef.current.style.transform = 'scale(1)';
    }));

    const d1 = editor.onDidScrollChange(place);
    const d2 = editor.onDidLayoutChange(place);
    const d3 = editor.onDidChangeModelContent(place);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      d1.dispose(); d2.dispose(); d3.dispose();

      const n = domRef.current;
      if (n) {
        n.style.opacity   = '0';
        n.style.transform = 'scale(0.55)';
        setTimeout(() => {
          if (n.parentNode) n.parentNode.removeChild(n);
          if (domRef.current === n) domRef.current = null;
        }, 220);
      }
      if (prevPos !== undefined) editorDom.style.position = prevPos;
    };
  }, [activeLine, editorRef, monacoRef]);

  return null;
};
