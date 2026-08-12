import React, { useState, useEffect, type ReactNode } from 'react';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
    children: ReactNode;
    components?: Components;
}

type LazyViewer = React.ComponentType<MarkdownRendererProps>;

// Lazy-loads react-markdown + remark/rehype plugins only when the first
// markdown message renders, keeping ~150KB of module evaluation out of startup.
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ children, components }) => {
    const [Viewer, setViewer] = useState<LazyViewer | null>(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([import('react-markdown'), import('remark-gfm'), import('rehype-raw')])
            .then(([markdownMod, gfmMod, rawMod]) => {
                if (cancelled) return;
                const ReactMarkdown = markdownMod.default;
                const gfm = (gfmMod as { default?: unknown }).default ?? gfmMod;
                const raw = (rawMod as { default?: unknown }).default ?? rawMod;
                const LazyViewer: LazyViewer = (props) => (
                    <ReactMarkdown
                        remarkPlugins={[gfm as never]}
                        rehypePlugins={[raw as never]}
                        components={props.components}
                    >
                        {props.children as string}
                    </ReactMarkdown>
                );
                setViewer(() => LazyViewer);
            });
        return () => { cancelled = true; };
    }, []);

    if (!Viewer) {
        return <span className="whitespace-pre-wrap">{children}</span>;
    }
    return <Viewer components={components}>{children}</Viewer>;
};
