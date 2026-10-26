import React from 'react';
import { ArrowRight } from 'lucide-react';
import {
    ArticleSection,
    Callout,
    CardLink,
    DataTable,
    PageHero,
    TextLink,
} from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { PROVIDERS } from '../../content/providers';

const TOC = [
    { href: '#workspace', label: 'Editing workspace' },
    { href: '#agent', label: 'Agentic editing' },
    { href: '#providers', label: 'AI providers and models' },
    { href: '#execution', label: 'Code execution' },
    { href: '#context', label: 'Workspace context' },
    { href: '#sync', label: 'Accounts and sync' },
    { href: '#security', label: 'Keys and data' },
    { href: '#limits', label: 'Limits' },
] as const;

export const FeaturesPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/features" breadcrumb="Features">
            <PageHero
                eyebrow="Product features"
                title={
                    <>
                        An AI code editor built around
                        <span className="block text-[var(--az-accent)]">the whole development loop.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            Azemax Studio keeps editing, AI-assisted changes, code execution, and
                            diagnostics in one browser workspace. You can work with Azemax’s default
                            model routing or connect your own provider key and choose the model.
                        </p>
                        <p>
                            This page describes what the shipped product actually does, including the
                            limits that matter when you decide whether it fits your workflow.
                        </p>
                    </>
                }
                meta="Last reviewed 26 October 2026 · Public beta"
            />

            <nav aria-label="On this page" className="mt-8 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4 sm:p-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                    On this page
                </p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {TOC.map((item) => (
                        <li key={item.href}>
                            <a
                                href={item.href}
                                className="rounded text-[13px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                            >
                                {item.label}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="mt-12 space-y-12">
                <ArticleSection id="workspace" title="A full editing workspace, not a chat box">
                    <p>
                        The editor is built on Monaco, the editing engine behind Visual Studio Code.
                        You get syntax highlighting, multi-cursor editing, bracket matching, folding,
                        and a file tree with create, rename, delete, and drag-and-drop operations.
                        Open files stay in tabs so you can move between related parts of a project
                        without losing your place.
                    </p>
                    <p>
                        The explorer includes fuzzy search across file names and a recent-work view.
                        A problems panel collects diagnostics from the editor and shows file and line
                        references so you can jump back to the source of an error.
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>Monaco editing with multi-tab buffers and configurable editor settings.</li>
                        <li>Workspace file tree with validated create, rename, delete, and move operations.</li>
                        <li>Fuzzy file-name search, recent files, and a unified problems list.</li>
                        <li>Account-scoped persistence, so a signed-in workspace can be reopened later.</li>
                    </ul>
                    <Callout title="Browser workspace, not a local IDE">
                        Azemax runs in the browser. It does not index your whole machine, attach to a
                        local Git repository, or expose your local filesystem. The workspace is the
                        project you create or open inside Azemax.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="agent" title="Agentic editing across real workspace files">
                    <p>
                        The assistant can work across multiple files instead of returning a single
                        pasted snippet. In Agent and Edit modes it can list and read the workspace,
                        search for relevant files, inspect diagnostics, and create, modify, rename, or
                        delete files as part of the task.
                    </p>
                    <p>
                        File changes are validated against the current workspace before they are
                        written, and the assistant reports which paths it touched. The main assistant
                        flow is live: it edits the workspace rather than stopping at a suggestion.
                        Inline editor actions can present a preview for review in some surfaces.
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>Read, search, list, write, create, rename, and delete tools with validation.</li>
                        <li>Streaming activity so you can see what the agent is inspecting or changing.</li>
                        <li>Diagnostics-aware inspection of the files involved in a task.</li>
                        <li>Ask mode for questions; Agent and Edit modes when you want changes.</li>
                    </ul>
                    <Callout tone="warn" title="Review is still required">
                        An agent can produce incorrect, insecure, or incomplete code, and live edits
                        are written to the workspace. Read the changed files, run the code, and keep
                        your own tests and backups. Azemax does not automatically commit to Git.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="providers" title="AI providers and model configuration">
                    <p>
                        Azemax has two AI modes. <strong className="text-[var(--az-text)]">Azemax Default</strong>{' '}
                        sends requests through the Azemax backend and uses the service’s model routing.
                        <strong className="text-[var(--az-text)]"> Bring Your Own Key</strong> sends requests
                        from your browser to the provider you configure, using your own credentials and
                        model selection.
                    </p>
                    <DataTable
                        caption="AI providers supported by Azemax Studio Bring Your Own Key"
                        head={['Provider', 'Starter models', 'Credential']}
                        rows={PROVIDERS.map((provider) => [
                            <span className="font-medium text-[var(--az-text)]">{provider.name}</span>,
                            provider.models,
                            provider.credential,
                        ])}
                    />
                    <p>
                        The model list shown in settings is a starter catalog. Providers add, rename,
                        and retire models on their own schedule, so the exact list can change. When a
                        provider exposes a model-discovery endpoint, Azemax can fetch the current
                        catalog; otherwise you can enter a model identifier manually. The Custom
                        provider accepts any HTTPS endpoint that implements an OpenAI-compatible chat
                        completions API.
                    </p>
                    <p>
                        Bring-your-own-key usage is billed by your provider, under that provider’s
                        terms. Azemax does not add a markup to provider usage and does not receive your
                        provider key when you use BYOK mode.
                    </p>
                    <p>
                        Step-by-step provider setup, including the exact settings path and custom-endpoint
                        requirements, is in the{' '}
                        <TextLink href="/docs#providers">provider configuration guide</TextLink>.
                    </p>
                </ArticleSection>

                <ArticleSection id="execution" title="Run code without leaving the editor">
                    <p>
                        The Run action sends the active file to the hosted execution service and opens
                        the output panel with stdout, stderr, compile errors, and the exit status. The
                        hosted product uses an isolated Wandbox sandbox rather than executing code on
                        the application server.
                    </p>
                    <p>
                        Hosted execution supports Python, JavaScript, TypeScript, C, C++, Java, Ruby,
                        PHP, Perl, Rust, Go, Swift, Lua, Bash, C#, Scala, and R. Compiler and runtime
                        versions are supplied by the sandbox service and can change.
                    </p>
                    <Callout title="Development-only shell sessions">
                        The source project can attach a real PTY shell when it runs locally with local
                        execution enabled. The hosted public beta does not expose that shell. Treat the
                        hosted Run panel as a sandboxed code runner, not as a general-purpose server
                        terminal or a CI environment.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="context" title="Context comes from the workspace">
                    <p>
                        The assistant receives context assembled from your project: the active file,
                        relevant open files, the file tree, selected text, and results from workspace
                        tools. That is why it can refer to real paths and propose changes in the right
                        place instead of guessing from a pasted excerpt.
                    </p>
                    <p>
                        Context is not unlimited. Large repositories and long conversations can exceed
                        a model’s context window, and different providers accept different input sizes.
                        Azemax may ask the agent to search for specific files rather than sending the
                        entire tree. If a request feels like it is missing context, name the file or
                        folder you want the assistant to inspect.
                    </p>
                </ArticleSection>

                <ArticleSection id="sync" title="Accounts, email verification, and sync">
                    <p>
                        Azemax Studio requires an account; there is no guest workspace. You can sign up
                        with email and password or with Google. Email/password accounts must verify their
                        address before the workspace and product APIs unlock. Google sign-in arrives with
                        a verified email and skips the separate verification step.
                    </p>
                    <p>
                        When you are signed in, projects, settings, and assistant conversations are
                        associated with your account and can be restored on another device. Access is
                        scoped to the authenticated user; the workspace is not a public sharing surface.
                        Multiplayer editing and public project links are not part of this beta.
                    </p>
                </ArticleSection>

                <ArticleSection id="security" title="Keys, credentials, and data boundaries">
                    <p>
                        Provider keys are sensitive. By default, a BYOK key lives only in memory for the
                        current tab. If you opt into “Remember on this device,” the key is encrypted with
                        AES-GCM using a key derived from a passphrase you choose; only the ciphertext is
                        stored in IndexedDB. The passphrase and derived key are not persisted.
                    </p>
                    <p>
                        In BYOK mode, AI requests go to your provider. In Azemax Default mode, requests go
                        to the Azemax backend. Code you run goes to the hosted execution sandbox. The
                        workspace syncs through Firebase when you are signed in. None of this is a
                        local-only or offline product.
                    </p>
                    <p>
                        Read the <TextLink href="/privacy">Privacy Policy</TextLink> for the data
                        categories, providers, retention practices, and deletion process. Security issues
                        can be reported through the <TextLink href="/contact">contact page</TextLink>.
                    </p>
                </ArticleSection>

                <ArticleSection id="limits" title="What Azemax Studio is not">
                    <p>
                        Setting expectations is part of shipping an honest developer tool. In the public
                        beta:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>It is a browser workspace, not a replacement for a full local IDE or your existing toolchain.</li>
                        <li>It does not run a general-purpose hosted shell or provide production CI runners.</li>
                        <li>It does not guarantee that AI output is correct, secure, or license-compatible.</li>
                        <li>It does not work offline, and it depends on third-party AI and execution providers.</li>
                        <li>It does not yet offer self-service account deletion; deletion requests are handled by email.</li>
                        <li>It is under active development, so interfaces and provider catalogs can change.</li>
                    </ul>
                </ArticleSection>
            </div>

            <div className="mt-14 grid gap-3 sm:grid-cols-3">
                <CardLink href="/docs" title="Read the documentation">
                    Setup, workspace basics, provider configuration, and troubleshooting.
                </CardLink>
                <CardLink href="/faq" title="Check the FAQ">
                    Direct answers about keys, privacy, execution, pricing, and the beta.
                </CardLink>
                <CardLink href="/app" title="Open the workspace">
                    Sign in and start a project in the hosted Azemax editor.
                </CardLink>
            </div>

            <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:flex-row sm:items-center">
                <div>
                    <p className="text-[14px] font-semibold text-[var(--az-text)]">
                        See the workflow in the actual editor.
                    </p>
                    <p className="mt-1 text-[12.5px] text-[var(--az-text-muted)]">
                        No install. An account is required for the workspace.
                    </p>
                </div>
                <a
                    href="/app"
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[var(--az-text)] px-4 py-2.5 text-[13px] font-medium text-[#080F1C] transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--az-bg)]"
                >
                    Enter workspace
                    <ArrowRight size={14} aria-hidden="true" />
                </a>
            </div>
        </PublicShell>
    );
};
