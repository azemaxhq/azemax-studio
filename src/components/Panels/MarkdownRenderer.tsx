import React, { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  children: ReactNode;
  components?: Components;
  isStreaming?: boolean;
  onParseComplete?: () => void;
}

type LazyViewer = React.ComponentType<MarkdownRendererProps>;

let markdownPromise: Promise<LazyViewer> | null = null;

/**
 * Security: rehype-raw was removed — it rendered raw HTML from AI output
 * enabling XSS (e.g. `<img onerror>`). We now render markdown without raw
 * HTML; any HTML in AI output is escaped by react-markdown's default.
 */
function loadMarkdownViewer(): Promise<LazyViewer> {
  if (!markdownPromise) {
    markdownPromise = Promise.all([
      import('react-markdown'),
      import('remark-gfm'),
    ]).then(([markdownMod, gfmMod]) => {
      const ReactMarkdown = markdownMod.default;
      const gfm = (gfmMod as { default?: unknown }).default ?? gfmMod;
      const LazyViewer: LazyViewer = (props) => (
        <ReactMarkdown
          remarkPlugins={[gfm as never]}
          // No rehype-raw: raw HTML from AI is escaped (safe by default)
          // Enable only with DOMPurify if raw HTML is ever needed
          skipHtml
          components={props.components}
        >
          {props.children as string}
        </ReactMarkdown>
      );
      return LazyViewer;
    });
    markdownPromise.catch(() => {
      markdownPromise = null;
    });
  }
  return markdownPromise;
}

const LIGHTWEIGHT_PARSER_CACHE = new Map<string, ReactNode>();
const MAX_CACHE_SIZE = 100;

function lightweightParse(markdown: string, appendCaret = false): ReactNode {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const result: ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent: string[] = [];
  let inList = false;
  let listItems: string[] = [];

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = codeBlockContent.join('\n');
      result.push(
        React.createElement('pre', { key: `code-${result.length}`, className: 'language-' + codeBlockLang },
          React.createElement('code', { className: 'language-' + codeBlockLang }, code)
        )
      );
      codeBlockContent = [];
      inCodeBlock = false;
      codeBlockLang = '';
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      result.push(
        React.createElement('ul', { key: `list-${result.length}`, className: 'list-disc list-outside ml-6' },
          listItems.map((item, i) =>
            React.createElement('li', { key: i, className: 'pl-1 leading-relaxed' }, parseInline(item))
          )
        )
      );
      listItems = [];
      inList = false;
    }
  };

  const parseInline = (text: string): ReactNode => {
    if (!text) return '';
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[([^\]]+)\]\(([^)]+)\))/);
    return parts.map((part, i) => {
      if (!part) return null;
      if (part.startsWith('`') && part.endsWith('`')) {
        return React.createElement('code', { key: i, className: 'bg-[var(--az-surface-2)] text-[var(--az-text)] px-1 py-0.5 rounded text-sm' }, part.slice(1, -1));
      }
      if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
        return React.createElement('strong', { key: i, className: 'font-semibold' }, part.slice(2, -2));
      }
      if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
        return React.createElement('em', { key: i, className: 'italic' }, part.slice(1, -1));
      }
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        return React.createElement('a', { key: i, href: linkMatch[2], target: '_blank', rel: 'noopener noreferrer', className: 'text-[var(--az-accent)] hover:underline' }, linkMatch[1]);
      }
      return part;
    }).filter(Boolean);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim() || 'text';
      } else {
        flushCodeBlock();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      result.push(React.createElement('h1', { key: `h1-${result.length}`, className: 'text-2xl font-semibold mt-6 mb-3' }, parseInline(trimmed.slice(2))));
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      result.push(React.createElement('h2', { key: `h2-${result.length}`, className: 'text-xl font-semibold mt-5 mb-2' }, parseInline(trimmed.slice(3))));
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      result.push(React.createElement('h3', { key: `h3-${result.length}`, className: 'text-lg font-medium mt-4 mb-2' }, parseInline(trimmed.slice(4))));
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(trimmed.slice(2));
      continue;
    }

    if (trimmed.match(/^\d+\.\s/)) {
      inList = true;
      listItems.push(trimmed.replace(/^\d+\.\s/, ''));
      continue;
    }

    if (inList && !trimmed) {
      flushList();
      continue;
    } else if (inList) {
      flushList();
    }

    if (trimmed.startsWith('> ')) {
      result.push(
        React.createElement('blockquote', { key: `quote-${result.length}`, className: 'border-l-3 border-[#5B8CFF] bg-[#0D192B] pl-4 py-2 my-3 text-[#8296B4]' },
          parseInline(trimmed.slice(2))
        )
      );
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      result.push(React.createElement('hr', { key: `hr-${result.length}`, className: 'my-4 border-white/10' }));
      continue;
    }

    if (trimmed) {
      result.push(React.createElement('p', { key: `p-${result.length}`, className: 'leading-relaxed mb-3' }, parseInline(line)));
    }
  }

  flushCodeBlock();
  flushList();

  // While streaming, append a blinking caret to the last inline text run so it
  // flows right after the final word instead of on its own line.
  if (appendCaret) {
    const lastIndex = result.length - 1;
    const lastEl = result[lastIndex] as { type: string; props: { children?: React.ReactNode } } | undefined;
    if (lastEl && ['p', 'h1', 'h2', 'h3', 'blockquote', 'li'].includes(lastEl.type)) {
      const caret = React.createElement('span', { className: 'stream-caret' });
      const children = lastEl.props.children;
      const newChildren = Array.isArray(children) ? [...children, caret] : [children, caret];
      result[lastIndex] = React.createElement(lastEl.type as never, { ...lastEl.props, children: newChildren });
    }
  }

  return React.createElement(React.Fragment, null, ...result);
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  children,
  components,
  isStreaming = false,
  onParseComplete,
}) => {
  const [Viewer, setViewer] = useState<LazyViewer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const contentStr = typeof children === 'string' ? children : '';
  const cacheKey = contentStr + (isStreaming ? '-streaming' : '');

  const lightweightResult = useMemo(() => {
    if (LIGHTWEIGHT_PARSER_CACHE.has(cacheKey)) {
      return LIGHTWEIGHT_PARSER_CACHE.get(cacheKey)!;
    }
    const result = lightweightParse(contentStr, isStreaming);
    if (LIGHTWEIGHT_PARSER_CACHE.size >= MAX_CACHE_SIZE) {
      const firstKey = LIGHTWEIGHT_PARSER_CACHE.keys().next().value;
      if (firstKey) LIGHTWEIGHT_PARSER_CACHE.delete(firstKey);
    }
    LIGHTWEIGHT_PARSER_CACHE.set(cacheKey, result);
    return result;
  }, [cacheKey, isStreaming]);

  const onParseCompleteRef = useRef(onParseComplete);

  useEffect(() => {
    onParseCompleteRef.current = onParseComplete;
  });

  useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    loadMarkdownViewer()
      .then((viewer) => {
        if (cancelled) return;
        setViewer(() => viewer);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming || loadFailed || !Viewer) return;
    onParseCompleteRef.current?.();
  }, [isStreaming, loadFailed, Viewer]);

  if (isStreaming) {
    return <div className="whitespace-pre-wrap">{lightweightResult}</div>;
  }

  if (loadFailed) {
    return <div className="whitespace-pre-wrap">{lightweightResult}</div>;
  }

  if (!Viewer) {
    return <div className="whitespace-pre-wrap text-white/40">Rendering...</div>;
  }

  return <Viewer components={components}>{children}</Viewer>;
};

export const StreamingMarkdownRenderer: React.FC<{
  content: string;
  isComplete?: boolean;
  components?: Components;
}> = ({ content, isComplete = false, components }) => {
  const [displayContent, setDisplayContent] = useState(content);
  const [hasFinished, setHasFinished] = useState(false);

  useEffect(() => {
    if (!isComplete) {
      setDisplayContent(content);
    } else if (!hasFinished) {
      setDisplayContent(content);
      setHasFinished(true);
    }
  }, [content, isComplete, hasFinished]);

  return (
    <MarkdownRenderer
      isStreaming={!isComplete}
      components={components}
      onParseComplete={() => setHasFinished(true)}
    >
      {displayContent}
    </MarkdownRenderer>
  );
};

export const CodeBlockRenderer: React.FC<{
  code: string;
  language?: string;
  onCopy?: (code: string) => void;
  copiedId?: string | null;
  id?: string;
}> = ({ code, language = 'text', onCopy, copiedId, id }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setIsCopied(true);
    onCopy?.(code);
    setTimeout(() => setIsCopied(false), 2000);
  }, [code, onCopy]);

  return (
    <div className="my-4 rounded-lg overflow-hidden border border-[#2A4164] bg-[#0D192B]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#080F1C] border-b border-[#2A4164]">
        <span className="text-xs text-[#8296B4] font-mono">{language}</span>
        {onCopy && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-[#8296B4] hover:text-[#A5B5CD] transition-colors"
            title="Copy Code"
          >
            {isCopied || copiedId === id ? (
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-[var(--az-success)]">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            <span>{isCopied || copiedId === id ? 'Copied!' : 'Copy code'}</span>
          </button>
        )}
      </div>
      <pre className="p-4 text-sm font-mono overflow-x-auto text-[var(--az-text)] leading-relaxed bg-[var(--az-surface-input)]">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
};

export function clearMarkdownCache(): void {
  LIGHTWEIGHT_PARSER_CACHE.clear();
}