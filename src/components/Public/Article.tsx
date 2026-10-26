import React from 'react';
import { ArrowUpRight, Info, ShieldAlert } from 'lucide-react';

export function PageHero({
    eyebrow,
    title,
    intro,
    meta,
}: {
    eyebrow: string;
    title: React.ReactNode;
    intro: React.ReactNode;
    meta?: React.ReactNode;
}) {
    return (
        <header className="border-b border-[var(--az-border-subtle)] pb-8">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--az-accent)]">
                <span aria-hidden="true" className="h-px w-5 bg-[var(--az-accent)]/60" />
                {eyebrow}
            </p>
            <h1 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--az-text)] sm:text-[46px]">
                {title}
            </h1>
            <div className="mt-5 max-w-3xl space-y-3 text-[15.5px] leading-[1.75] text-[var(--az-text-secondary)]">
                {intro}
            </div>
            {meta ? <div className="mt-5 text-[12px] text-[var(--az-text-muted)]">{meta}</div> : null}
        </header>
    );
}

export function ArticleSection({
    id,
    title,
    children,
}: {
    id: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
            <h2
                id={`${id}-heading`}
                className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--az-text)] sm:text-[25px]"
            >
                {title}
            </h2>
            <div className="mt-4 space-y-4 text-[15px] leading-[1.75] text-[var(--az-text-secondary)]">
                {children}
            </div>
        </section>
    );
}

export function H3({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="pt-2 text-[16.5px] font-semibold tracking-[-0.01em] text-[var(--az-text)]">
            {children}
        </h3>
    );
}

export function TextLink({
    href,
    children,
    external = false,
}: {
    href: string;
    children: React.ReactNode;
    external?: boolean;
}) {
    return (
        <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="rounded font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] hover:decoration-[var(--az-accent-hover)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
        >
            {children}
            {external ? (
                <ArrowUpRight className="ml-0.5 inline h-3.5 w-3.5" aria-hidden="true" />
            ) : null}
        </a>
    );
}

export function Callout({
    tone = 'info',
    title,
    children,
}: {
    tone?: 'info' | 'warn';
    title?: string;
    children: React.ReactNode;
}) {
    const warn = tone === 'warn';
    const Icon = warn ? ShieldAlert : Info;
    return (
        <div
            className={`rounded-[var(--az-radius-md)] border-l-2 px-4 py-3.5 ${
                warn
                    ? 'border-[var(--az-warning)] bg-[var(--az-warning-soft)]'
                    : 'border-[var(--az-accent)] bg-[var(--az-accent-soft-subtle)]'
            }`}
        >
            {title ? (
                <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-[var(--az-text)]">
                    <Icon size={13} aria-hidden="true" />
                    {title}
                </p>
            ) : null}
            <div className="text-[13.5px] leading-[1.7] text-[var(--az-text-secondary)]">{children}</div>
        </div>
    );
}

export function CodeBlock({
    children,
    label,
}: {
    children: React.ReactNode;
    label?: string;
}) {
    return (
        <figure className="overflow-hidden rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-bg-subtle)]">
            {label ? (
                <figcaption className="border-b border-[var(--az-border-subtle)] px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--az-text-muted)]">
                    {label}
                </figcaption>
            ) : null}
            <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed text-[var(--az-text-secondary)]">
                <code>{children}</code>
            </pre>
        </figure>
    );
}

export function DataTable({
    caption,
    head,
    rows,
}: {
    caption: string;
    head: readonly string[];
    rows: readonly (readonly React.ReactNode[])[];
}) {
    return (
        <div className="overflow-x-auto rounded-[var(--az-radius-md)] border border-[var(--az-border)]">
            <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                <caption className="sr-only">{caption}</caption>
                <thead className="bg-[var(--az-surface-2)]">
                    <tr>
                        {head.map((cell) => (
                            <th
                                key={cell}
                                scope="col"
                                className="border-b border-[var(--az-border)] px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--az-text-muted)]"
                            >
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="align-top">
                            {row.map((cell, cellIndex) => (
                                <td
                                    key={cellIndex}
                                    className="border-b border-[var(--az-border-subtle)] px-3.5 py-3 text-[var(--az-text-secondary)] last:border-r-0"
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function CardLink({
    href,
    title,
    children,
}: {
    href: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <a
            href={href}
            className="group flex flex-col rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4 transition-colors hover:border-[var(--az-accent-border)] hover:bg-[var(--az-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
        >
            <span className="flex items-center justify-between gap-2 text-[13.5px] font-semibold text-[var(--az-text)]">
                {title}
                <ArrowUpRight
                    size={14}
                    className="shrink-0 text-[var(--az-text-muted)] transition-colors group-hover:text-[var(--az-accent)]"
                    aria-hidden="true"
                />
            </span>
            <span className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--az-text-muted)]">
                {children}
            </span>
        </a>
    );
}
