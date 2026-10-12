import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useProjectActions } from '../context/ProjectContext';
import { AzemaxLogo } from './UI/AzemaxLogo';
import type { LucideIcon } from 'lucide-react';
import {
    Archive,
    Atom,
    FileCode2,
    FilePlus2,
    FolderGit2,
    FolderPlus,
    Globe,
    Loader2,
    PackageOpen,
    PlugZap,
    Server,
    Terminal,
    TriangleAlert,
    X,
} from 'lucide-react';
import './OnboardingScreen.css';

/**
 * First-time workspace experience. Rendered by MainLayout when the persisted
 * file tree contains only the canonical root (no real project yet). Creating
 * or importing files flips workspace state to 'project-loaded', which
 * transitions into the IDE automatically — no callbacks needed.
 */

type TemplateKey = 'empty' | 'web' | 'react-app' | 'node-api' | 'python-app';

interface TemplateDef {
    key: TemplateKey;
    label: string;
    description: string;
    detail: string;
}

const TEMPLATES: TemplateDef[] = [
    {
        key: 'empty',
        label: 'Empty project',
        description: 'Start with a clean workspace.',
        detail: 'No starter files',
    },
    {
        key: 'web',
        label: 'HTML, CSS & JS',
        description: 'Build a website from the ground up.',
        detail: '3 starter files',
    },
    {
        key: 'react-app',
        label: 'React + TypeScript',
        description: 'Build component-based interfaces.',
        detail: '7 starter files',
    },
    {
        key: 'node-api',
        label: 'Node.js API',
        description: 'Start with a server-side project structure.',
        detail: '5 starter files',
    },
    {
        key: 'python-app',
        label: 'Python',
        description: 'Start with a structured Python workspace.',
        detail: '5 starter files',
    },
];

const TEMPLATE_ICONS: Record<TemplateKey, LucideIcon> = {
    'empty': PackageOpen,
    'web': Globe,
    'react-app': Atom,
    'node-api': Server,
    'python-app': Terminal,
};

const WEB_STARTER: Array<{ name: string; content: string }> = [
    {
        name: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Website</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <h1>Hello from Azemax</h1>
    <p>Edit <code>index.html</code>, <code>styles.css</code> and <code>script.js</code> to make it yours.</p>
    <button id="cta" type="button">Click me</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
    },
    {
        name: 'styles.css',
        content: `* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #0b0e13;
  color: #f1f5f9;
  line-height: 1.6;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

button {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #1e293b;
  color: inherit;
  cursor: pointer;
}
`,
    },
    {
        name: 'script.js',
        content: `const button = document.getElementById('cta');

button.addEventListener('click', () => {
  button.textContent = 'Nice — it works!';
});
`,
    },
];

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_CONTENT_BYTES = 10 * 1024 * 1024;

function sanitizeFolderName(raw: string, fallback: string): string {
    const base = raw.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    const cleaned = base.replace(/\.(zip|tar\.gz|tgz)$/i, '').trim().replace(/[<>:"|?*\u0000-\u001F]/g, '').slice(0, 100);
    return cleaned || fallback;
}

function isSafeSegment(seg: string): boolean {
    if (!seg || seg === '.' || seg === '..') return false;
    if (seg.length > 255) return false;
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\u0000-\u001F]/.test(seg)) return false;
    if (seg.endsWith('.') || seg.endsWith(' ')) return false;
    return true;
}

function validateProjectName(raw: string): string | null {
    const name = raw.trim();
    if (!name) return 'Give your project a name.';
    if (name.length > 100) return 'Keep the name under 100 characters.';
    if (name === '.' || name === '..') return 'That name is reserved.';
    if (/[/\\]/.test(name)) return 'The name cannot contain / or \\.';
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\u0000-\u001F]/.test(name)) return 'The name contains an invalid character.';
    return null;
}

export const OnboardingScreen: React.FC = () => {
    const { createFile, createFolder, createNestedFolders, createProjectTemplate, deleteNode } = useProjectActions();

    const [dialog, setDialog] = useState<'create' | 'import' | null>(null);
    const [templateKey, setTemplateKey] = useState<TemplateKey>('web');
    const [projectName, setProjectName] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const descId = useId();

    const openDialog = useCallback((which: 'create' | 'import') => {
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        setFormError(null);
        setProgress(null);
        setDialog(which);
    }, []);

    // Template cards pre-select a template and continue the existing
    // creation flow (the dialog's radio list stays the source of truth).
    const handleTemplateCard = useCallback((key: TemplateKey) => {
        setTemplateKey(key);
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        setFormError(null);
        setProgress(null);
        setDialog('create');
    }, []);

    const closeDialog = useCallback(() => {
        if (busy) return;
        setDialog(null);
        setFormError(null);
        setProgress(null);
        previouslyFocused.current?.focus?.();
    }, [busy]);

    useEffect(() => {
        if (!dialog) return;
        const t = requestAnimationFrame(() => {
            if (dialog === 'create') nameInputRef.current?.focus();
            else dialogRef.current?.querySelector<HTMLElement>('input[type="file"]')?.focus();
        });
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeDialog();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            cancelAnimationFrame(t);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [dialog, closeDialog]);

    const handleCreate = useCallback(() => {
        if (busy) return;
        const err = validateProjectName(projectName);
        if (err) {
            setFormError(err);
            nameInputRef.current?.focus();
            return;
        }
        setBusy(true);
        setFormError(null);
        try {
            const name = projectName.trim();
            if (templateKey === 'empty') {
                const res = createFolder(name);
                if (res.error) {
                    setFormError(res.error.message);
                    return;
                }
            } else if (templateKey === 'web') {
                const res = createFolder(name);
                if (res.error || !res.node) {
                    setFormError(res.error?.message ?? 'Could not create the project folder.');
                    return;
                }
                const folderName = res.node.name;
                for (const file of WEB_STARTER) {
                    const r = createFile(`${folderName}/${file.name}`, file.content);
                    if (r.error) {
                        setFormError(`Created "${folderName}" but failed on ${file.name}: ${r.error.message}`);
                        return;
                    }
                }
            } else {
                // Delegates to the existing scaffolding implementation, which
                // creates the folder, nested paths, and starter files by name.
                createProjectTemplate(templateKey, name);
            }
            setProjectName('');
            setDialog(null);
            previouslyFocused.current?.focus?.();
        } finally {
            setBusy(false);
        }
    }, [busy, projectName, templateKey, createFolder, createFile, createProjectTemplate]);

    const importZip = useCallback(async (file: File) => {
        if (file.size > MAX_ARCHIVE_BYTES) {
            setFormError(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The import limit is 50 MB.`);
            return;
        }
        setBusy(true);
        setFormError(null);
        // Import under one top-level folder so a failed import can be removed
        // atomically instead of leaving a partial project behind.
        const rootName = sanitizeFolderName(file.name, 'Imported project');
        const rootRes = createFolder(rootName);
        if (rootRes.error || !rootRes.node) {
            setBusy(false);
            setFormError(rootRes.error?.message ?? 'Could not create the import folder.');
            return;
        }
        const rootFolderName = rootRes.node.name;
        let imported = 0;
        let skipped = 0;
        let totalBytes = 0;
        try {
            const { default: JSZip } = await import('jszip');
            const zip = await JSZip.loadAsync(file);
            const paths = Object.keys(zip.files);
            if (paths.length === 0) throw new Error('empty-archive');
            if (paths.length > MAX_ARCHIVE_ENTRIES) throw new Error('too-many-entries');
            let done = 0;
            for (const rawPath of paths) {
                const entry = zip.files[rawPath];
                done += 1;
                if (done % 25 === 0) {
                    setProgress(`Reading archive… ${done}/${paths.length}`);
                    await new Promise((r) => setTimeout(r, 0));
                }
                if (entry.dir) continue;
                // Defense in depth: skip anything with a parent-directory
                // segment in the RAW stored name (some archives preserve `..`;
                // JSZip normalizes others away). Everything that survives is
                // additionally namespaced under the import root folder, so a
                // hostile archive can never escape into the wider workspace.
                const rawSegments = rawPath.split('/');
                if (rawSegments.some((s) => s === '..')) {
                    skipped += 1;
                    continue;
                }
                const normalized = rawPath.replace(/\\/g, '/');
                const segments = normalized.split('/').filter((s) => s.length > 0);
                if (segments.length === 0) continue;
                if (segments.some((s) => !isSafeSegment(s))) {
                    skipped += 1;
                    continue;
                }
                // JSZip exposes no public uncompressed-size API, so read then
                // enforce the per-file cap: oversized entries are skipped before
                // anything touches the filesystem or persistence layer. The
                // 50 MB archive cap bounds transient memory either way.
                const content = await entry.async('string');
                if (content.length > MAX_FILE_BYTES) {
                    skipped += 1;
                    continue;
                }
                if (totalBytes + content.length > MAX_TOTAL_CONTENT_BYTES) {
                    skipped += 1;
                    continue;
                }
                const relDir = segments.slice(0, -1).join('/');
                if (relDir) {
                    const d = createNestedFolders(`${rootFolderName}/${relDir}`);
                    if (d.error) {
                        skipped += 1;
                        continue;
                    }
                }
                const relPath = segments.join('/');
                const r = createFile(`${rootFolderName}/${relPath}`, content);
                if (r.error) {
                    skipped += 1;
                    continue;
                }
                totalBytes += content.length;
                imported += 1;
                if (imported % 25 === 0) setProgress(`Importing… ${imported} files`);
            }
            if (imported === 0) throw new Error('nothing-importable');
            setDialog(null);
            previouslyFocused.current?.focus?.();
        } catch (err) {
            // Roll back the import root so a failed import never presents as
            // a successful (partial) project. The previous workspace is dead
            // simple here: onboarding only renders when nothing else exists.
            try {
                if (rootRes.node) deleteNode(rootRes.node.id);
            } catch {
                /* best-effort cleanup */
            }
            if (err instanceof Error && err.message === 'empty-archive') {
                setFormError(`"${file.name}" contains no files to import.`);
            } else if (err instanceof Error && err.message === 'too-many-entries') {
                setFormError(`"${file.name}" has too many entries (limit ${MAX_ARCHIVE_ENTRIES}). Try a smaller archive.`);
            } else if (err instanceof Error && err.message === 'nothing-importable') {
                setFormError(
                    `"${file.name}" had no importable files${skipped > 0 ? ` (${skipped} skipped — unsupported names or oversized files)` : ''}.`,
                );
            } else {
                setFormError(`Could not read "${file.name}". The archive may be corrupted or password-protected.`);
            }
        } finally {
            setBusy(false);
            setProgress(null);
        }
    }, [createFolder, createNestedFolders, createFile, deleteNode]);

    const importLooseFiles = useCallback(async (files: FileList) => {
        const list = Array.from(files);
        if (list.length === 0) return;
        if (list.length > 200) {
            setFormError(`Too many files selected (${list.length}). Select up to 200, or use a ZIP archive.`);
            return;
        }
        setBusy(true);
        setFormError(null);
        const rootRes = createFolder('Imported files');
        if (rootRes.error || !rootRes.node) {
            setBusy(false);
            setFormError(rootRes.error?.message ?? 'Could not create the import folder.');
            return;
        }
        const rootFolderName = rootRes.node.name;
        let imported = 0;
        let skipped = 0;
        try {
            for (const f of list) {
                // Basename only: the picker gives no directory structure, and
                // path separators in names must never create folders by accident.
                const base = (f.name.split(/[\\/]/).pop() ?? '').trim();
                if (!isSafeSegment(base)) {
                    skipped += 1;
                    continue;
                }
                if (f.size > MAX_FILE_BYTES) {
                    skipped += 1;
                    continue;
                }
                const content = await f.text();
                const r = createFile(`${rootFolderName}/${base}`, content);
                if (r.error) skipped += 1;
                else imported += 1;
            }
            if (imported === 0) throw new Error('nothing-importable');
            setDialog(null);
            previouslyFocused.current?.focus?.();
        } catch {
            try {
                if (rootRes.node) deleteNode(rootRes.node.id);
            } catch {
                /* best-effort cleanup */
            }
            setFormError(
                `None of the selected files could be imported${skipped > 0 ? ` (${skipped} skipped)` : ''}. Only text files up to 2 MB each are supported.`,
            );
        } finally {
            setBusy(false);
        }
    }, [createFolder, createFile, deleteNode]);

    return (
        <div className="az-onboard">
            <div className="az-onboard-inner">
                <header className="az-onboard-hero">
                    <AzemaxLogo size={40} />
                    <div className="az-onboard-hero-text">
                        <p className="az-onboard-eyebrow">{BRAND_NAME} Studio</p>
                        <h1 className="az-onboard-title">Welcome to Azemax Studio</h1>
                    </div>
                </header>

                <p className="az-onboard-sub">
                    Your workspace for building, running, and understanding code.
                </p>

                <main className="az-onboard-actions">
                    <section aria-labelledby="onboard-create-title" className="az-onboard-action">
                        <div className="az-onboard-action-head">
                            <span className="az-onboard-icon-box az-onboard-icon-box--accent">
                                <FolderPlus size={16} strokeWidth={1.75} />
                            </span>
                            <h2 id="onboard-create-title" className="az-onboard-action-title">Create a project</h2>
                        </div>
                        <p className="az-onboard-action-desc">
                            Start fresh with a workspace tailored to your next idea.
                        </p>
                        <button
                            type="button"
                            onClick={() => openDialog('create')}
                            className="az-onboard-btn az-onboard-btn--primary"
                        >
                            <FilePlus2 size={15} strokeWidth={1.75} />
                            New project
                        </button>
                    </section>

                    <section aria-labelledby="onboard-import-title" className="az-onboard-action">
                        <div className="az-onboard-action-head">
                            <span className="az-onboard-icon-box az-onboard-icon-box--neutral">
                                <Archive size={16} strokeWidth={1.75} />
                            </span>
                            <h2 id="onboard-import-title" className="az-onboard-action-title">Open or import project</h2>
                        </div>
                        <p className="az-onboard-action-desc">
                            Continue working with an existing codebase.
                        </p>
                        <button
                            type="button"
                            onClick={() => openDialog('import')}
                            className="az-onboard-btn az-onboard-btn--neutral"
                        >
                            <FolderGit2 size={15} strokeWidth={1.75} />
                            Import code
                        </button>
                    </section>
                </main>

                <section aria-labelledby="onboard-templates-title" className="az-onboard-section">
                    <div className="az-onboard-section-head">
                        <h2 id="onboard-templates-title" className="az-onboard-section-title">
                            Starter templates
                        </h2>
                        <p className="az-onboard-section-hint">Select a template to begin</p>
                    </div>
                    <ul className="az-onboard-grid">
                        {TEMPLATES.map((t) => {
                            const Icon = TEMPLATE_ICONS[t.key];
                            const selected = templateKey === t.key;
                            return (
                                <li key={t.key}>
                                    <button
                                        type="button"
                                        onClick={() => handleTemplateCard(t.key)}
                                        aria-haspopup="dialog"
                                        data-selected={selected}
                                        aria-label={`${t.label} — ${t.description} ${t.detail}. Create a project with this template.`}
                                        title={`${t.label} — create a project`}
                                        className="az-onboard-card"
                                    >
                                        <span className="az-onboard-card-top">
                                            <span className="az-onboard-icon-box">
                                                <Icon size={15} strokeWidth={1.75} />
                                            </span>
                                            <span aria-hidden="true" className="az-onboard-card-check" />
                                        </span>
                                        <span className="az-onboard-card-title">{t.label}</span>
                                        <span className="az-onboard-card-desc">{t.description}</span>
                                        <span className="az-onboard-card-meta">{t.detail}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="az-onboard-note">
                        <PlugZap size={12} />
                        Templates scaffold editable files. Running Node, React, or Python code uses the
                        terminal runtimes available in this environment.
                    </p>
                </section>

                <section aria-labelledby="onboard-recents-title" className="az-onboard-section">
                    <h2 id="onboard-recents-title" className="az-onboard-section-title">
                        Recent projects
                    </h2>
                    <div className="az-onboard-empty">
                        <span aria-hidden="true" className="az-onboard-empty-icon">
                            <FileCode2 size={14} strokeWidth={1.75} />
                        </span>
                        <div>
                            <p className="az-onboard-empty-title">No recent projects</p>
                            <p className="az-onboard-empty-sub">Projects you create or import will appear here.</p>
                        </div>
                    </div>
                </section>

                {dialog && (
                    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="presentation" onClick={closeDialog}>
                        <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
                        <div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            aria-describedby={descId}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-[480px] rounded-xl border p-6 shadow-2xl"
                            style={{ background: 'var(--az-overlay)', borderColor: 'var(--az-border)' }}
                        >
                            <button
                                type="button"
                                onClick={closeDialog}
                                disabled={busy}
                                aria-label="Close dialog"
                                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.07] disabled:opacity-40"
                                style={{ color: 'var(--az-text-muted)' }}
                            >
                                <X size={15} strokeWidth={1.75} />
                            </button>

                            {dialog === 'create' ? (
                                <>
                                    <h2 id={titleId} className="pr-8 text-[15px] font-semibold">Create a project</h2>
                                    <p id={descId} className="mt-1 text-[12.5px]" style={{ color: 'var(--az-text-secondary)' }}>
                                        Name your project and pick a starter template.
                                    </p>
                                    <label htmlFor="onboard-project-name" className="mt-4 block text-[12px] font-medium">
                                        Project name
                                    </label>
                                    <input
                                        ref={nameInputRef}
                                        id="onboard-project-name"
                                        type="text"
                                        value={projectName}
                                        onChange={(e) => {
                                            setProjectName(e.target.value);
                                            if (formError) setFormError(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreate();
                                        }}
                                        placeholder="my-project"
                                        maxLength={100}
                                        autoComplete="off"
                                        spellCheck={false}
                                        disabled={busy}
                                        aria-invalid={!!formError}
                                        className="mt-1.5 h-9 w-full rounded-lg border bg-transparent px-3 text-[13px] outline-none transition-colors placeholder:text-white/25 focus:border-[var(--az-accent-border)] disabled:opacity-60"
                                        style={{ borderColor: formError ? 'var(--az-error-border)' : 'var(--az-border)' }}
                                    />
                                    <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Project template">
                                        {TEMPLATES.map((t) => {
                                            const selected = templateKey === t.key;
                                            return (
                                                <button
                                                    key={t.key}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={selected}
                                                    disabled={busy}
                                                    onClick={() => setTemplateKey(t.key)}
                                                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60"
                                                    style={{
                                                        borderColor: selected ? 'var(--az-accent-border)' : 'var(--az-border)',
                                                        background: selected ? 'var(--az-accent-soft)' : 'transparent',
                                                    }}
                                                >
                                                    <span
                                                        aria-hidden="true"
                                                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                                        style={{ borderColor: selected ? 'var(--az-accent)' : 'var(--az-border-strong)' }}
                                                    >
                                                        {selected && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--az-accent)' }} />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-[13px] font-medium">{t.label}</span>
                                                        <span className="block truncate text-[11.5px]" style={{ color: 'var(--az-text-secondary)' }}>{t.description}</span>
                                                    </span>
                                                    <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--az-text-faint)' }}>{t.detail}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {formError && (
                                        <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: 'var(--az-error)' }}>
                                            <TriangleAlert size={13} className="mt-[1px] shrink-0" />
                                            {formError}
                                        </p>
                                    )}
                                    <div className="mt-5 flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={closeDialog}
                                            disabled={busy}
                                            className="h-9 rounded-lg border px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                                            style={{ borderColor: 'var(--az-border)', color: 'var(--az-text-secondary)' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCreate}
                                            disabled={busy}
                                            className="inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-[13px] font-semibold transition-colors disabled:opacity-60"
                                            style={{ background: 'var(--az-accent)', borderColor: 'var(--az-accent)', color: '#fff' }}
                                        >
                                            {busy && <Loader2 size={14} className="animate-spin" />}
                                            {busy ? 'Creating…' : 'Create project'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2 id={titleId} className="pr-8 text-[15px] font-semibold">Import code</h2>
                                    <p id={descId} className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--az-text-secondary)' }}>
                                        Import a <strong>ZIP archive</strong> (folder structure preserved) or pick{' '}
                                        <strong>individual text files</strong>. Imports land in their own folder;
                                        a failed import is removed automatically.
                                    </p>
                                    <div className="mt-4 grid gap-2">
                                        <label
                                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-white/[0.03] focus-within:ring-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}
                                            style={{ borderColor: 'var(--az-border)' }}
                                        >
                                            <Archive size={16} className="shrink-0 opacity-70" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13px] font-medium">ZIP archive</span>
                                                <span className="block text-[11.5px]" style={{ color: 'var(--az-text-secondary)' }}>
                                                    Up to 50 MB · structure preserved · unsafe paths skipped
                                                </span>
                                            </span>
                                            <input
                                                type="file"
                                                accept=".zip,application/zip"
                                                disabled={busy}
                                                className="sr-only"
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    e.target.value = '';
                                                    if (f) void importZip(f);
                                                }}
                                            />
                                        </label>
                                        <label
                                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-white/[0.03] focus-within:ring-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}
                                            style={{ borderColor: 'var(--az-border)' }}
                                        >
                                            <FilePlus2 size={16} className="shrink-0 opacity-70" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13px] font-medium">Individual files</span>
                                                <span className="block text-[11.5px]" style={{ color: 'var(--az-text-secondary)' }}>
                                                    Text files up to 2 MB each · up to 200 at once
                                                </span>
                                            </span>
                                            <input
                                                type="file"
                                                multiple
                                                disabled={busy}
                                                className="sr-only"
                                                onChange={(e) => {
                                                    const fs = e.target.files;
                                                    e.target.value = '';
                                                    if (fs && fs.length > 0) void importLooseFiles(fs);
                                                }}
                                            />
                                        </label>
                                    </div>
                                    {(busy || progress) && (
                                        <p role="status" className="mt-3 flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--az-text-secondary)' }}>
                                            {busy && <Loader2 size={14} className="animate-spin" />}
                                            {progress ?? 'Working…'}
                                        </p>
                                    )}
                                    {formError && (
                                        <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: 'var(--az-error)' }}>
                                            <TriangleAlert size={13} className="mt-[1px] shrink-0" />
                                            {formError}
                                        </p>
                                    )}
                                    <div className="mt-5 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={closeDialog}
                                            disabled={busy}
                                            className="h-9 rounded-lg border px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                                            style={{ borderColor: 'var(--az-border)', color: 'var(--az-text-secondary)' }}
                                        >
                                            {busy ? 'Please wait…' : 'Done'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const BRAND_NAME = 'Azemax';
