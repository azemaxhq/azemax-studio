import React, { useState } from 'react';
import { FolderTree, Code2, Bot, Terminal, AlertCircle } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

type EngineZone = 'explorer' | 'editor' | 'ai' | 'terminal' | 'diagnostics';

export const ProductSystem: React.FC = () => {
  const [activeZone, setActiveZone] = useState<EngineZone>('editor');

  // Scroll reveal hooks
  const headerReveal = useRevealAnimation({ threshold: 0.12 });
  const pillsReveal = useRevealAnimation({ threshold: 0.1, delay: 120 });
  const blueprintReveal = useRevealAnimation({ threshold: 0.06, delay: 200 });
  const detailReveal = useRevealAnimation({ threshold: 0.1, delay: 300 });

  const zoneDetails: Record<
    EngineZone,
    {
      title: string;
      label: string;
      tech: string;
      description: string;
      specs: string[];
    }
  > = {
    explorer: {
      title: 'Virtual Project Tree',
      label: 'Safe Virtualized Filesystem',
      tech: 'safeTree.ts & workspaceStore',
      description:
        'Zero-latency recursive file tree with transactional safety guards against race conditions. Instant search indexing across nested subtrees.',
      specs: ['Local workspace isolation', 'Fuzzy name search', 'Multi-tab buffer tracking'],
    },
    editor: {
      title: 'Monaco Core Engine',
      label: 'Single-Model Precision Buffer',
      tech: '@monaco-editor/react & TextModel',
      description:
        'Full multi-cursor, bracket matching, semantic token highlighting, and sub-millisecond typing response powered by Monaco.',
      specs: ['Hardware-accelerated rendering', 'Custom syntax grammars', 'Zero frame drops'],
    },
    ai: {
      title: 'Contextual AI Pipeline',
      label: 'Model Router & Reasoning Filter',
      tech: 'Groq / OpenRouter / local LLM',
      description:
        'Deep contextual awareness across open tabs and project files. Strips reasoning traces and outputs verifiable line diffs.',
      specs: ['Provider failover normalization', 'Triple-guard abort registry', 'Safe structured diffs'],
    },
    terminal: {
      title: 'Bidirectional PTY Terminal',
      label: 'Hardware-Accelerated Shell',
      tech: 'node-pty + xterm.js WebGL',
      description:
        'Real Node.js pseudo-terminal running over native WebSockets. Streams standard in/out/err with sub-5ms roundtrip latency.',
      specs: ['WebGL canvas acceleration', 'Full VT100 / ANSI escape support', 'Interactive PTY lifecycle'],
    },
    diagnostics: {
      title: 'Unified Diagnostics Engine',
      label: 'Multi-Language Health Verification',
      tech: 'TypeScript Compiler & Linter Bus',
      description:
        'Synchronous in-editor squiggle markers and unified problems panel. Instant feedback on syntax errors and type mismatches.',
      specs: ['Line-offset mapping', 'Zero remote telemetry', 'Continuous error aggregation'],
    },
  };

  const zones: { id: EngineZone; name: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: 'explorer', name: 'Explorer', icon: FolderTree },
    { id: 'editor', name: 'Editor', icon: Code2 },
    { id: 'ai', name: 'AI Assistance', icon: Bot },
    { id: 'terminal', name: 'Terminal', icon: Terminal },
    { id: 'diagnostics', name: 'Diagnostics', icon: AlertCircle },
  ];

  return (
    <section id="system" className="relative py-32 px-6 md:px-12 lg:px-16 bg-[#000204] overflow-hidden border-t border-[rgba(79,140,255,0.08)]">
      
      {/* Background Soft Blue Lighting Beam */}
      <div 
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-[radial-gradient(ellipse_at_center,rgba(79,140,255,0.08)_0%,rgba(14,30,58,0.02)_60%,transparent_75%)] pointer-events-none blur-3xl"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto relative z-10">
        
        {/* Section Header */}
        <div
          ref={headerReveal.ref}
          className={`max-w-3xl mb-16 az-reveal-left ${headerReveal.isVisible ? 'az-visible' : ''}`}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-4 h-[1px] bg-[var(--az-blue-electric)]" />
            <span className="az-mono-badge text-[11px] font-mono tracking-[0.2em] text-[#8FB4FF] uppercase">
              04 / ARCHITECTURE
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl md:text-6xl tracking-tight text-white mb-6 leading-[1.08]">
            <span className="az-display-serif block">The machine</span>
            <span className="az-display-serif-italic az-text-blue block">behind the file.</span>
          </h2>

          <p className="text-base sm:text-lg text-[var(--az-muted)] leading-relaxed font-sans">
            Explorer. Editor. AI assistance. Terminal. Diagnostics. One context.
            These aren't disconnected plugins patched together. They share memory, execution state, and file awareness.
          </p>
        </div>

        {/* Engine Zone Selector Pills */}
        <div
          ref={pillsReveal.ref}
          className={`flex flex-wrap items-center gap-3 mb-10 az-reveal ${pillsReveal.isVisible ? 'az-visible' : ''}`}
        >
          {zones.map((zone) => {
            const Icon = zone.icon;
            const isCurrent = activeZone === zone.id;

            return (
              <button
                key={zone.id}
                onClick={() => setActiveZone(zone.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF] ${
                  isCurrent
                    ? 'bg-[#12223D] text-white border border-[#4F8CFF]/60 shadow-[0_0_20px_rgba(79,140,255,0.25)]'
                    : 'bg-[#08101E]/60 text-[var(--az-muted)] border border-white/5 hover:text-white hover:bg-[#0E1A2E]'
                }`}
              >
                <Icon size={14} className={isCurrent ? 'text-[#8FB4FF]' : 'opacity-60'} />
                <span>{zone.name}</span>
              </button>
            );
          })}
        </div>

        {/* Interactive Integrated Workspace Blueprint Visual */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Main Blueprint Viewport */}
          <div
            ref={blueprintReveal.ref}
            className={`lg:col-span-8 az-glass-surface rounded-xl border border-[rgba(79,140,255,0.2)] p-3 relative overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.9)] flex flex-col justify-between az-reveal-scale ${blueprintReveal.isVisible ? 'az-visible' : ''}`}
          >
            
            {/* Blueprint Header */}
            <div className="h-8 bg-[#090F1B] border-b border-white/5 px-3 flex items-center justify-between text-[11px] font-mono text-[var(--az-muted)] mb-2">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>azemax://system/core-runtime.sys</span>
              </span>
              <span className="text-[#8FB4FF]">{zoneDetails[activeZone].tech}</span>
            </div>

            {/* Architecture Grid Layout */}
            <div className="grid grid-cols-12 gap-2 flex-1 min-h-[360px]">
              
              {/* Zone 1: File Explorer */}
              <div
                onMouseEnter={() => setActiveZone('explorer')}
                onClick={() => setActiveZone('explorer')}
                className={`col-span-3 rounded-lg p-3 transition-all duration-300 cursor-pointer flex flex-col justify-between border ${
                  activeZone === 'explorer'
                    ? 'bg-[#102038] border-[#4F8CFF] shadow-[inset_0_0_24px_rgba(79,140,255,0.25)]'
                    : 'bg-[#060B14] border-white/5 opacity-50 hover:opacity-80'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8FB4FF] mb-2 font-semibold">
                    <FolderTree size={13} />
                    <span>EXPLORER</span>
                  </div>
                  <div className="space-y-1 font-mono text-[10px] text-white/70">
                    <div className="text-white/90">▼ src/</div>
                    <div className="pl-3 text-[#8FB4FF]">› main.tsx</div>
                    <div className="pl-3 text-white/50">› engine.rs</div>
                    <div className="pl-3 text-white/50">› server.cjs</div>
                    <div className="text-white/40">▶ tests/</div>
                  </div>
                </div>
                <span className="text-[9px] font-mono text-[var(--az-muted)]">safeTree.ts</span>
              </div>

              {/* Zone 2: Editor Center */}
              <div
                onMouseEnter={() => setActiveZone('editor')}
                onClick={() => setActiveZone('editor')}
                className={`col-span-6 rounded-lg p-3 transition-all duration-300 cursor-pointer flex flex-col justify-between border ${
                  activeZone === 'editor'
                    ? 'bg-[#102038] border-[#4F8CFF] shadow-[inset_0_0_24px_rgba(79,140,255,0.25)]'
                    : 'bg-[#060B14] border-white/5 opacity-50 hover:opacity-80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#8FB4FF] mb-2 font-semibold">
                    <div className="flex items-center gap-1.5">
                      <Code2 size={13} />
                      <span>MONACO EDITOR</span>
                    </div>
                    <span className="text-[9px] text-emerald-400">active buffer</span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-white/80 leading-relaxed">
                    <div><span className="az-syntax-kw">const</span> pipeline = <span className="az-syntax-kw">new</span> <span className="az-syntax-type">VectorEngine</span>();</div>
                    <div>pipeline.attachBuffer(stream);</div>
                    <div className="text-[#8FB4FF] bg-[rgba(79,140,255,0.1)] px-1 rounded">
                      await pipeline.evaluateInPlace();
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[9px] font-mono text-[var(--az-muted)] pt-2 border-t border-white/5">
                  <span>UTF-8 • Ln 42, Col 18</span>
                  <span className="text-[#8FB4FF]">AST Synchronized</span>
                </div>
              </div>

              {/* Zone 3: AI Assistant Panel */}
              <div
                onMouseEnter={() => setActiveZone('ai')}
                onClick={() => setActiveZone('ai')}
                className={`col-span-3 rounded-lg p-3 transition-all duration-300 cursor-pointer flex flex-col justify-between border ${
                  activeZone === 'ai'
                    ? 'bg-[#102038] border-[#4F8CFF] shadow-[inset_0_0_24px_rgba(79,140,255,0.25)]'
                    : 'bg-[#060B14] border-white/5 opacity-50 hover:opacity-80'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8FB4FF] mb-2 font-semibold">
                    <Bot size={13} />
                    <span>AI ASSISTANT</span>
                  </div>
                  <div className="p-2 bg-[#08101E] rounded text-[10px] font-sans text-white/80 leading-snug">
                    "VectorEngine uses direct SIMD registers. No allocations detected in hot path."
                  </div>
                </div>
                <span className="text-[9px] font-mono text-emerald-400">Reasoning Filtered</span>
              </div>

              {/* Zone 4: Terminal Execution Bar */}
              <div
                onMouseEnter={() => setActiveZone('terminal')}
                onClick={() => setActiveZone('terminal')}
                className={`col-span-7 rounded-lg p-3 transition-all duration-300 cursor-pointer flex flex-col justify-between border ${
                  activeZone === 'terminal'
                    ? 'bg-[#102038] border-[#4F8CFF] shadow-[inset_0_0_24px_rgba(79,140,255,0.25)]'
                    : 'bg-[#060B14] border-white/5 opacity-50 hover:opacity-80'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-[#8FB4FF] mb-1 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <Terminal size={13} />
                    <span>PTY TERMINAL</span>
                  </div>
                  <span className="text-[9px] text-white/40">node-pty /bin/zsh</span>
                </div>
                <div className="font-mono text-[10px] text-white/90">
                  <span className="text-[#8FB4FF]">$</span> cargo bench --release &amp;&amp; echo "PASS"
                </div>
                <div className="text-[9px] font-mono text-emerald-400">test vector_dot ... bench: 4.12 ns/iter (+/- 0.08)</div>
              </div>

              {/* Zone 5: Diagnostics Bar */}
              <div
                onMouseEnter={() => setActiveZone('diagnostics')}
                onClick={() => setActiveZone('diagnostics')}
                className={`col-span-5 rounded-lg p-3 transition-all duration-300 cursor-pointer flex flex-col justify-between border ${
                  activeZone === 'diagnostics'
                    ? 'bg-[#102038] border-[#4F8CFF] shadow-[inset_0_0_24px_rgba(79,140,255,0.25)]'
                    : 'bg-[#060B14] border-white/5 opacity-50 hover:opacity-80'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8FB4FF] mb-1 font-semibold">
                  <AlertCircle size={13} />
                  <span>DIAGNOSTICS</span>
                </div>
                <div className="text-[10px] font-mono text-white/80">
                  0 Errors • 0 Warnings
                </div>
                <div className="text-[9px] font-mono text-[var(--az-muted)]">
                  Continuous TSC / Rust Analyzer Check
                </div>
              </div>

            </div>

          </div>

          {/* Detailed Zone Specification Card */}
          <div
            ref={detailReveal.ref}
            className={`lg:col-span-4 bg-[#060B14] border border-[rgba(79,140,255,0.2)] rounded-xl p-8 flex flex-col justify-between shadow-2xl az-reveal ${detailReveal.isVisible ? 'az-visible' : ''}`}
          >
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-[#8FB4FF] mb-3">
                <span className="w-2 h-2 rounded-full bg-[#4F8CFF] shadow-[0_0_8px_#4F8CFF]" />
                <span className="uppercase tracking-wider">{zoneDetails[activeZone].label}</span>
              </div>

              <h3 className="text-2xl font-medium text-white mb-4">
                {zoneDetails[activeZone].title}
              </h3>

              <div className="inline-block px-2.5 py-1 bg-[#0E1A2E] text-[#8FB4FF] font-mono text-xs rounded border border-[#4F8CFF]/30 mb-6">
                {zoneDetails[activeZone].tech}
              </div>

              <p className="text-sm text-[var(--az-muted)] leading-relaxed font-sans mb-8">
                {zoneDetails[activeZone].description}
              </p>

              <div className="space-y-3 pt-6 border-t border-white/5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-white/50 block">
                  Hardware &amp; System Capabilities
                </span>
                {zoneDetails[activeZone].specs.map((spec, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-white/80 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4F8CFF]" />
                    <span>{spec}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-8 text-[11px] font-mono text-[var(--az-muted)] flex items-center justify-between border-t border-white/5 mt-8">
              <span>SHARED CONTEXT</span>
              <span className="text-[#8FB4FF]">100% LOCAL</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
