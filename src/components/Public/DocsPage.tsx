import React from 'react';
import { ArrowRight } from 'lucide-react';
import {
    ArticleSection,
    Callout,
    CardLink,
    DataTable,
    H3,
    PageHero,
    TextLink,
} from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { PROVIDERS } from '../../content/providers';

const TOC = [
    { href: '#quick-start', label: 'Quick start' },
    { href: '#workspace', label: 'The workspace' },
    { href: '#assistant', label: 'Using the assistant' },
    { href: '#providers', label: 'Provider configuration' },
    { href: '#execution', label: 'Running code' },
    { href: '#saving', label: 'Saving and sync' },
    { href: '#troubleshooting', label: 'Troubleshooting' },
    { href: '#privacy', label: 'Privacy and data' },
] as const;

export const DocsPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/docs" breadcrumb="Documentation">
            <PageHero
                eyebrow="Documentation"
                title={
                    <>
                        Everything you need to
                        <span className="block text-[var(--az-accent)]">start working in Azemax.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            This guide covers the hosted public beta: creating an account, opening a
                            workspace, working with the AI assistant, connecting a provider key, and
                            running code.
                        </p>
                        <p>
                            Azemax is a browser workspace. It does not install a local toolchain or attach
                            to a repository on your computer. If you are looking for the product overview
                            first, read the <TextLink href="/features">features page</TextLink>.
                        </p>
                    </>
                }
                meta="Last reviewed 26 October 2026 · Applies to v1.0.0-beta"
            />

            <nav
                aria-label="On this page"
                className="mt-8 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4 sm:p-5"
            >
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
                <ArticleSection id="quick-start" title="Quick start">
                    <p>
                        The hosted product has no installer. You need a current desktop browser and an
                        internet connection, because sign-in, workspace sync, AI requests, and code
                        execution all use online services.
                    </p>
                    <ol className="list-decimal space-y-3 pl-5">
                        <li>
                            Open the <TextLink href="/app">workspace</TextLink>. If you are signed out,
                            Azemax shows the authentication surface instead of the editor.
                        </li>
                        <li>
                            Create an account with email and password, or continue with Google. Email and
                            password accounts must verify their address before the workspace unlocks.
                            Google sign-in arrives with a verified address.
                        </li>
                        <li>
                            After sign-in, create a project or open an existing one from the workspace.
                            A project contains the file tree, open tabs, and conversation history for that
                            workspace.
                        </li>
                        <li>
                            Add or open a file in the explorer, then edit it in the Monaco editor. Use the
                            assistant panel when you want to ask a question or request a change.
                        </li>
                    </ol>
                    <Callout title="No guest mode">
                        The workspace requires an account. There is no anonymous or shared editing mode in
                        the public beta, and projects are scoped to the signed-in user.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="workspace" title="The workspace">
                    <p>
                        The interface has four working areas: the file explorer, the editor and tab strip,
                        the assistant panel, and the bottom panel for output and diagnostics. You can
                        resize the major panels by dragging their dividers.
                    </p>

                    <H3>Files and tabs</H3>
                    <p>
                        The explorer supports creating files and folders, renaming, deleting, and moving
                        items. Destructive operations are validated against the current tree, and the
                        delete confirmation can be disabled in settings if you prefer. Open files appear
                        as tabs; a modified file is marked until it is saved.
                    </p>

                    <H3>Editor behavior</H3>
                    <p>
                        The editor is Monaco, with syntax highlighting, multi-cursor editing, bracket
                        matching, folding, and a minimap that can be turned off. Editor settings such as
                        font size, tab size, word wrap, and auto-save live under{' '}
                        <strong className="text-[var(--az-text)]">Settings → Editor</strong>.
                    </p>

                    <H3>Diagnostics</H3>
                    <p>
                        The problems panel collects diagnostics reported by the editor tooling and lists
                        the file and location for each entry. Selecting an item jumps to the relevant
                        line. Diagnostics are a development aid, not a guarantee that a program is correct.
                    </p>

                    <H3>Layout</H3>
                    <p>
                        The bottom panel hosts execution output and diagnostics. You can collapse it or
                        switch between its tabs. If you work on a smaller screen, the layout adapts, but
                        the hosted product is designed primarily for desktop browsers.
                    </p>
                </ArticleSection>

                <ArticleSection id="assistant" title="Using the assistant">
                    <p>
                        Open the assistant from the activity bar or the panel toggle. The composer has
                        three modes, and the mode changes what the assistant is allowed to do.
                    </p>
                    <DataTable
                        caption="Assistant modes in Azemax Studio"
                        head={['Mode', 'Behavior', 'Use it when']}
                        rows={[
                            [
                                <span className="font-medium text-[var(--az-text)]">Agent</span>,
                                'Can inspect the workspace, read and search files, check diagnostics, and create, modify, rename, or delete files.',
                                'You want a multi-file change carried out in the workspace.',
                            ],
                            [
                                <span className="font-medium text-[var(--az-text)]">Ask</span>,
                                'Answers questions about the code and workspace without writing changes.',
                                'You want an explanation or a second opinion before editing.',
                            ],
                            [
                                <span className="font-medium text-[var(--az-text)]">Edit</span>,
                                'Applies a focused code change, typically to the file or selection you are working in.',
                                'You know what should change and want it applied directly.',
                            ],
                        ]}
                    />
                    <p>
                        Agent and Edit modes write to the workspace as part of the task. The assistant
                        reports the paths it touched, and changes are validated against the current tree
                        before they are written. Some inline editor actions show a preview for review;
                        the main assistant flow does not require an Accept/Reject step.
                    </p>
                    <Callout tone="warn" title="Review every change">
                        Model output can be wrong, insecure, or incomplete. Read the modified files, run
                        the code, and keep your own tests and backups. Azemax does not automatically commit
                        to Git, and not every file operation has a guaranteed undo.
                    </Callout>

                    <H3>Giving the assistant useful context</H3>
                    <p>
                        The assistant receives the active file, relevant open files, the file tree, selected
                        text, and results from workspace tools. When a request is vague, name the file,
                        folder, function, or error you mean. For large projects, ask the assistant to search
                        for the relevant files instead of assuming it has the entire tree in context.
                    </p>

                    <H3>Stopping a response</H3>
                    <p>
                        A streaming response can be stopped from the composer while it is running. Stopping
                        a response does not roll back file changes that were already written, so check the
                        workspace afterwards.
                    </p>
                </ArticleSection>

                <ArticleSection id="providers" title="Provider configuration">
                    <p>
                        Azemax has two AI modes. <strong className="text-[var(--az-text)]">Azemax Default</strong>{' '}
                        routes requests through the Azemax backend and uses the service’s model selection.
                        <strong className="text-[var(--az-text)]"> Bring Your Own Key</strong> sends requests
                        from your browser directly to a provider you configure.
                    </p>

                    <H3>Switch modes</H3>
                    <p>
                        Open <strong className="text-[var(--az-text)]">Settings → AI → Provider</strong> and
                        choose the mode. The AI Providers category is where credentials and model selection
                        live.
                    </p>

                    <H3>Connect a built-in provider</H3>
                    <ol className="list-decimal space-y-2 pl-5">
                        <li>Open <strong className="text-[var(--az-text)]">Settings → AI Providers</strong>.</li>
                        <li>Select a provider, then paste an API key created in that provider’s console.</li>
                        <li>Choose a model from the starter list, or let Azemax fetch the provider’s catalog when the provider supports model discovery.</li>
                        <li>Save the configuration, then send a short test message from the assistant.</li>
                    </ol>
                    <DataTable
                        caption="Built-in bring-your-own-key providers"
                        head={['Provider', 'Credential', 'Notes']}
                        rows={PROVIDERS.map((provider) => [
                            <span className="font-medium text-[var(--az-text)]">{provider.name}</span>,
                            provider.credential,
                            provider.note,
                        ])}
                    />
                    <p>
                        The exact model catalog is controlled by the provider and can change without an
                        Azemax release. If a model you expect is missing, enter its identifier manually or
                        refresh the catalog.
                    </p>

                    <H3>Connect a custom OpenAI-compatible endpoint</H3>
                    <p>
                        Select the <strong className="text-[var(--az-text)]">Custom OpenAI-compatible</strong>{' '}
                        provider and supply:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>An HTTPS base URL that accepts OpenAI-style chat completion requests.</li>
                        <li>An API key, if your endpoint requires one.</li>
                        <li>The model identifier your endpoint expects.</li>
                    </ul>
                    <p>
                        Agent features that use tools require the endpoint to support tool or function
                        calling. Endpoints that depend on client certificates, a VPN, or a browser extension
                        cannot be reached from the hosted page.
                    </p>

                    <H3>How keys are stored</H3>
                    <p>
                        By default, a key is held only in memory for the current tab and is lost when the tab
                        closes. If you enable <strong className="text-[var(--az-text)]">Remember on this device</strong>,
                        Azemax encrypts the key with AES-GCM using a key derived from a passphrase you choose.
                        Only the ciphertext is written to IndexedDB; the passphrase and derived key are not
                        stored.
                    </p>
                    <Callout title="Key hygiene">
                        Use a restricted key with a spending limit where the provider offers one. Revoke the
                        key at the provider if you suspect it was exposed. Browser storage cannot protect a
                        key from malicious script running in an unlocked session.
                    </Callout>

                    <H3>Remove stored keys</H3>
                    <p>
                        The AI Providers page includes an action to remove stored provider API keys from the
                        device. Clearing site data in the browser also removes the encrypted vault, and you
                        can revoke the key in the provider console independently.
                    </p>
                </ArticleSection>

                <ArticleSection id="execution" title="Running code">
                    <p>
                        The Run action sends the active file to the hosted execution service and opens the
                        output panel. The panel shows standard output, standard error, compiler messages, and
                        the exit status for the run.
                    </p>
                    <p>
                        The hosted product uses an isolated Wandbox sandbox. It does not execute arbitrary
                        code on the application server, and it does not expose a general-purpose PTY shell
                        to hosted users. Local development builds of the source project can enable a local
                        shell, but that capability is not part of the hosted beta.
                    </p>
                    <DataTable
                        caption="Hosted execution languages"
                        head={['Language', 'Notes']}
                        rows={[
                            ['Python', 'Script execution'],
                            ['JavaScript / TypeScript', 'Node-based execution'],
                            ['C / C++', 'Compile and run'],
                            ['Java', 'Compile and run; the public class should match the file name'],
                            ['Ruby, PHP, Perl', 'Script execution'],
                            ['Rust, Go, Swift, Scala', 'Compile and run'],
                            ['Lua, Bash', 'Script execution'],
                            ['C#', 'Compile and run'],
                            ['R', 'Script execution'],
                        ]}
                    />
                    <p>
                        The service allows roughly 60 seconds of execution time and 30 seconds of compile
                        time per run. These limits keep the sandbox available to other users. Versions are
                        supplied by the sandbox provider and can change; pin behavior in your own environment
                        if exact versions matter.
                    </p>
                    <Callout tone="warn" title="Not a production runner">
                        The Run panel is for learning, experiments, and small programs. Do not use it for
                        long-running servers, scheduled jobs, private data, or CI. Network access and
                        available system resources are limited by the sandbox.
                    </Callout>
                    <p>
                        A program that reads from standard input may wait for a line before continuing. If
                        execution appears stalled, stop it and check whether the program is blocked on input
                        or an infinite loop.
                    </p>
                </ArticleSection>

                <ArticleSection id="saving" title="Saving and sync">
                    <p>
                        Edits are kept in the open editor buffer until they are saved. Auto-save can be
                        enabled under <strong className="text-[var(--az-text)]">Settings → Editor → Saving &amp; Files</strong>.
                        The tab strip marks unsaved files so you can see what still needs to be written.
                    </p>
                    <p>
                        When you are signed in, projects, settings, and assistant conversations are associated
                        with your account and can be restored on another device. Access is scoped to the
                        authenticated user. Workspace sync uses Firebase; it is not a peer-to-peer or
                        local-only sync mechanism.
                    </p>
                    <p>
                        There is no public project-sharing link and no multiplayer editing in the beta.
                        Export or copy files you need to keep outside the workspace, and do not treat Azemax
                        as your only backup.
                    </p>
                </ArticleSection>

                <ArticleSection id="troubleshooting" title="Troubleshooting">
                    <H3>The workspace will not load after sign-in</H3>
                    <p>
                        Email and password accounts must verify their address before product access is
                        enabled. Check the verification email, including spam. Google accounts skip this
                        step. If the page still fails, sign out, reload, and sign in again; then check that
                        your browser allows storage for the site.
                    </p>

                    <H3>The first request is slow</H3>
                    <p>
                        The API runs on a hosted service that may sleep when idle. The client sends a
                        lightweight health request when the workspace starts, but the first real request
                        after a long idle period can take longer while the backend wakes. Retry once the
                        connection is established.
                    </p>

                    <H3>Bring Your Own Key fails</H3>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>Confirm the key belongs to the provider you selected and has not been revoked.</li>
                        <li>Check that the provider account has access to the model you chose.</li>
                        <li>For a custom endpoint, confirm the base URL is HTTPS and implements OpenAI-style chat completions.</li>
                        <li>If the browser blocks the request, check whether an extension, proxy, or corporate network is intercepting it.</li>
                    </ul>

                    <H3>A run fails immediately</H3>
                    <p>
                        Check the output panel for a compiler message before assuming the sandbox failed.
                        Unsupported languages, missing file names for Java classes, and syntax errors are
                        reported as compile or runtime errors. If the service itself is unavailable, retry;
                        the sandbox is a third-party dependency.
                    </p>

                    <H3>The assistant ignores a file</H3>
                    <p>
                        Large files and long conversations can exceed a model’s context window. Reference the
                        file explicitly, close unrelated tabs, or start a new conversation for a separate
                        task. Ask mode is useful for narrowing down what the assistant actually sees.
                    </p>

                    <H3>Something else is wrong</H3>
                    <p>
                        Report it through the <TextLink href="/contact">contact page</TextLink>. Include the
                        browser, the action you took, the expected result, and any error text. Do not include
                        API keys, passwords, or private source code in a support message.
                    </p>
                </ArticleSection>

                <ArticleSection id="privacy" title="Privacy and data">
                    <p>
                        Data handling depends on the features you use. Signed-in workspaces and settings sync
                        through Firebase. AI prompts and the context you include go to your selected provider
                        in BYOK mode, or to the Azemax backend in default mode. Code you run goes to the
                        hosted sandbox.
                    </p>
                    <p>
                        Do not paste secrets, regulated data, or code you are not allowed to share into a
                        hosted tool. Read the <TextLink href="/privacy">Privacy Policy</TextLink> for the data
                        categories, providers, retention practices, and deletion process, and the{' '}
                        <TextLink href="/terms">Terms of Service</TextLink> for acceptable use and execution
                        risks.
                    </p>
                </ArticleSection>
            </div>

            <div className="mt-14 grid gap-3 sm:grid-cols-3">
                <CardLink href="/features" title="Product features">
                    What the editor, agent, providers, and sandbox actually do.
                </CardLink>
                <CardLink href="/faq" title="Frequently asked questions">
                    Short answers about accounts, keys, execution, privacy, and pricing.
                </CardLink>
                <CardLink href="/contact" title="Contact support">
                    Report a bug, request account deletion, or ask a product question.
                </CardLink>
            </div>

            <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:flex-row sm:items-center">
                <div>
                    <p className="text-[14px] font-semibold text-[var(--az-text)]">
                        Ready to try the workflow?
                    </p>
                    <p className="mt-1 text-[12.5px] text-[var(--az-text-muted)]">
                        Sign in and open a project. No install and no payment card.
                    </p>
                </div>
                <a
                    href="/app"
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[var(--az-text)] px-4 py-2.5 text-[13px] font-medium text-[#080F1C] transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--az-bg)]"
                >
                    Open workspace
                    <ArrowRight size={14} aria-hidden="true" />
                </a>
            </div>
        </PublicShell>
    );
};
