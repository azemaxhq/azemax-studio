import React, { memo } from 'react';
import { ArrowRight, Check } from 'lucide-react';

const CAPABILITIES = [
  {
    title: 'A full editing surface',
    description:
      'Monaco provides multi-tab editing, syntax highlighting, a workspace file tree, and in-editor diagnostics.',
  },
  {
    title: 'An assistant with workspace access',
    description:
      'Agent, Ask, and Edit modes can inspect project files, search the workspace, and write changes across files.',
  },
  {
    title: 'Sandboxed code execution',
    description:
      'Run the active file in a hosted Wandbox sandbox and read compiler output, stdout, stderr, and exit status.',
  },
  {
    title: 'Bring your own model key',
    description:
      'Use OpenAI, Anthropic, Gemini, OpenRouter, Groq, NVIDIA NIM, or a custom OpenAI-compatible HTTPS endpoint.',
  },
] as const;

const PRODUCT_LINKS = [
  { href: '/features', label: 'Explore all features' },
  { href: '/docs', label: 'Read the documentation' },
  { href: '/faq', label: 'Common questions' },
] as const;

/**
 * Static product summary rendered into the prerendered home document.
 *
 * The sections below this point are lazy-loaded, so this block ensures the
 * initial HTML contains a complete, factual description of the product and
 * crawlable links to its supporting pages.
 */
export const ProductSummary: React.FC = memo(() => {
  return (
    <section
      id="overview"
      aria-labelledby="product-overview-title"
      className="relative w-full overflow-hidden border-t border-[rgba(79,140,255,0.1)] bg-[#020409] px-4 sm:px-6 md:px-12 lg:px-16"
    >
      <div
        className="absolute left-1/2 top-0 h-[320px] w-full max-w-[900px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(79,140,255,0.08)_0%,transparent_70%)] pointer-events-none blur-3xl"
        aria-hidden="true"
      />

      <div
        className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16"
        style={{
          paddingTop: 'var(--az-section-py)',
          paddingBottom: 'var(--az-section-py)',
        }}
      >
        <div className="max-w-xl">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-[1px] w-4 bg-[var(--az-blue-electric)]" />
            <span className="az-mono-badge font-mono text-[11px] uppercase tracking-[0.2em] text-[#8FB4FF]">
              Azemax Studio / Public Beta
            </span>
          </div>

          <h2
            id="product-overview-title"
            className="mb-5 text-balance tracking-tight text-white"
            style={{ fontSize: 'var(--az-heading-section)', lineHeight: 1.08 }}
          >
            <span className="az-display-serif block">A real editor.</span>
            <span className="az-display-serif-italic az-text-blue block">
              An agent that can use it.
            </span>
          </h2>

          <p
            className="mb-5 text-[var(--az-muted)] font-sans leading-relaxed"
            style={{ fontSize: 'var(--az-body)' }}
          >
            Azemax Studio is a browser-based AI code editor for writing, running, and
            changing real project files. Monaco provides the editing surface; the
            assistant can inspect the workspace, edit files, and report what changed.
          </p>

          <p className="mb-7 text-sm leading-relaxed text-[var(--az-muted)] font-sans">
            Code runs in a hosted sandbox, and AI requests can use your own provider
            key. Azemax is an independent developer project currently in public beta.
          </p>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
            {PRODUCT_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[rgba(79,140,255,0.22)] bg-[#08101E] px-3.5 py-2 text-xs font-medium text-[#C7D6ED] transition-colors hover:border-[rgba(79,140,255,0.45)] hover:bg-[#0E1A2E] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F8CFF]/60"
              >
                {link.label}
                <ArrowRight
                  size={13}
                  aria-hidden="true"
                  className="text-[#8FB4FF] transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </a>
            ))}
          </div>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <li
              key={capability.title}
              className="rounded-lg border border-[rgba(79,140,255,0.12)] bg-[rgba(7,16,29,0.55)] p-4 sm:p-5"
            >
              <div className="mb-2 flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#4F8CFF]/30 bg-[#0E1A2E] text-[#8FB4FF]">
                  <Check size={11} aria-hidden="true" />
                </span>
                <h3 className="text-sm font-semibold leading-snug text-white">
                  {capability.title}
                </h3>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--az-muted)] font-sans">
                {capability.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});

ProductSummary.displayName = 'ProductSummary';
