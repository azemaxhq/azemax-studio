import React, { useState } from 'react';
import { PenTool, Play, Cpu, Sparkles, Terminal, CheckCircle2, RotateCcw } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

type ModeType = 'write' | 'run' | 'understand' | 'improve';

export const WorkspaceShowcase: React.FC = () => {
  const [activeMode, setActiveMode] = useState<ModeType>('write');

  // WRITE Mode States
  const [acceptedGhost, setAcceptedGhost] = useState<boolean>(false);

  // RUN Mode States
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runLogs, setRunLogs] = useState<string[]>([
    'azemax-pty: ready (node v20.11.0, python 3.12.2)',
  ]);
  const [hasRun, setHasRun] = useState<boolean>(false);

  const handleRunExecution = () => {
    if (isRunning) return;
    setIsRunning(true);
    setRunLogs(['$ python3 -m azemax.bench --dataset=production']);

    setTimeout(() => {
      setRunLogs((prev) => [...prev, '› Initializing zero-copy memory buffers...']);
    }, 400);

    setTimeout(() => {
      setRunLogs((prev) => [...prev, '› [1/3] Warmup passes completed: 1,000 iterations']);
    }, 900);

    setTimeout(() => {
      setRunLogs((prev) => [
        ...prev,
        '› [2/3] Throughput: 142,800 ops/sec | Latency p99: 0.18ms',
        '› [3/3] Memory footprint: 14.8 MB (RSS)',
        '✓ Execution completed with exit code 0.',
      ]);
      setIsRunning(false);
      setHasRun(true);
    }, 1500);
  };

  // UNDERSTAND Mode States
  const [selectedLine, setSelectedLine] = useState<number>(4);

  const understandSnippets: Record<number, { title: string; complexity: string; details: string }> = {
    2: {
      title: 'Type Invariant & Memory Layout',
      complexity: 'Zero-cost abstraction',
      details: 'DenseVector utilizes contiguous memory storage. Pointer arithmetic ensures SIMD vectorization during vectorized multiply passes.',
    },
    4: {
      title: 'Algorithmic Core (Dot Product)',
      complexity: 'O(N) time • O(1) space',
      details: 'Inner product accumulator loop. Azemax static analyzer verifies loop bounds at compile time, eliminating branch mispredictions.',
    },
    7: {
      title: 'Guard Clause & Dimension Assert',
      complexity: 'O(1) condition',
      details: 'Explicit dimension parity check. Protects against buffer overrun before passing slice pointers into the hardware accelerator.',
    },
  };

  // IMPROVE Mode States
  const [improveTab, setImproveTab] = useState<'before' | 'after'>('after');

  // Scroll reveal hooks
  const headerReveal = useRevealAnimation({ threshold: 0.12 });
  const tabReveal = useRevealAnimation({ threshold: 0.1, delay: 150 });
  const frameReveal = useRevealAnimation({ threshold: 0.08, delay: 250 });

  const modes = [
    { id: 'write' as const, label: 'Write', icon: PenTool, caption: 'Ghost Completion' },
    { id: 'run' as const, label: 'Run', icon: Play, caption: 'Integrated PTY' },
    { id: 'understand' as const, label: 'Understand', icon: Cpu, caption: 'Contextual AST' },
    { id: 'improve' as const, label: 'Improve', icon: Sparkles, caption: 'Verifiable Diff' },
  ];

  return (
    <section id="modes" className="relative py-28 px-6 md:px-12 lg:px-16 bg-[#020409] border-t border-[rgba(79,140,255,0.08)]">
      
      {/* Atmosphere wash */}
      <div 
        className="absolute top-0 right-1/4 w-[600px] h-[300px] bg-[radial-gradient(circle,rgba(79,140,255,0.07)_0%,transparent_70%)] pointer-events-none blur-3xl"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto relative z-10">
        
        {/* Section Header */}
        <div
          ref={headerReveal.ref}
          className={`flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12 az-reveal-left ${headerReveal.isVisible ? 'az-visible' : ''}`}
        >
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-4 h-[1px] bg-[var(--az-blue-electric)]" />
              <span className="az-mono-badge text-[11px] font-mono tracking-[0.2em] text-[#8FB4FF] uppercase">
                03 / EXPERIENCE
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl tracking-tight text-white leading-[1.15]">
              <span className="az-display-serif block">One environment.</span>
              <span className="az-display-serif-italic az-text-blue block">Four modes.</span>
            </h2>
          </div>

          <p className="text-sm text-[var(--az-muted)] max-w-md font-sans leading-relaxed">
            Switch between authoring, live execution, AST explanation, and semantic refactoring without leaving your current file context.
          </p>
        </div>

        {/* Mode Selector Tabs (Keyboard Accessible) */}
        <div
          ref={tabReveal.ref}
          role="tablist"
          aria-label="Workspace Modes"
          className={`flex items-center gap-2 p-1.5 bg-[#060A12] border border-[rgba(79,140,255,0.15)] rounded-lg mb-8 max-w-xl az-reveal ${tabReveal.isVisible ? 'az-visible' : ''}`}
        >
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isSelected = activeMode === mode.id;

            return (
              <button
                key={mode.id}
                role="tab"
                id={`tab-${mode.id}`}
                aria-selected={isSelected}
                aria-controls={`panel-${mode.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setActiveMode(mode.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-md font-mono text-xs transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF] ${
                  isSelected
                    ? 'bg-[#0E1A2E] text-white border border-[#4F8CFF]/40 shadow-[0_0_16px_rgba(79,140,255,0.2)]'
                    : 'text-[var(--az-muted)] hover:text-white/80 hover:bg-[#0A101C]'
                }`}
              >
                <Icon size={14} className={isSelected ? 'text-[#8FB4FF]' : 'opacity-70'} />
                <span className="font-medium">{mode.label}</span>
              </button>
            );
          })}
        </div>

        {/* Persistent Unified Workspace Frame */}
        <div
          ref={frameReveal.ref}
          id={`panel-${activeMode}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeMode}`}
          className={`az-glass-surface rounded-xl border border-[rgba(79,140,255,0.2)] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] az-reveal-scale ${frameReveal.isVisible ? 'az-visible' : ''}`}
        >
          {/* Workstation Frame Header */}
          <div className="h-10 bg-[#070D18] border-b border-[rgba(79,140,255,0.12)] px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/70" />
              </div>
              <span className="h-3 w-[1px] bg-white/10" />
              <span className="text-xs font-mono text-[#8FB4FF]">
                {activeMode === 'write' && 'src/compute/optimizer.py'}
                {activeMode === 'run' && 'src/benchmark/runner.py'}
                {activeMode === 'understand' && 'src/tensor/vector.rs'}
                {activeMode === 'improve' && 'src/io/stream_pipeline.ts'}
              </span>
            </div>

            {/* Mode-specific actions in header */}
            <div className="flex items-center gap-3 text-xs font-mono">
              {activeMode === 'write' && (
                <button
                  onClick={() => setAcceptedGhost(!acceptedGhost)}
                  className="flex items-center gap-1.5 text-xs text-[#8FB4FF] bg-[#0E1A2E] hover:bg-[#142642] px-2.5 py-1 rounded border border-[#4F8CFF]/30 transition-colors"
                >
                  <Sparkles size={12} />
                  <span>{acceptedGhost ? 'Reset Ghost State' : 'Simulate Tab Accept'}</span>
                </button>
              )}

              {activeMode === 'run' && (
                <button
                  onClick={handleRunExecution}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 text-xs text-white bg-[#1A4580] hover:bg-[#20559E] px-3 py-1 rounded transition-colors disabled:opacity-50"
                >
                  <Play size={12} className={isRunning ? 'animate-spin' : ''} />
                  <span>{isRunning ? 'Running...' : 'Execute Script'}</span>
                </button>
              )}

              {activeMode === 'improve' && (
                <div className="flex items-center bg-[#070D18] border border-[rgba(79,140,255,0.2)] rounded p-0.5">
                  <button
                    onClick={() => setImproveTab('before')}
                    className={`px-2.5 py-0.5 rounded text-[11px] transition-colors ${
                      improveTab === 'before' ? 'bg-[#2A1515] text-[#FF8585]' : 'text-[var(--az-muted)]'
                    }`}
                  >
                    Original
                  </button>
                  <button
                    onClick={() => setImproveTab('after')}
                    className={`px-2.5 py-0.5 rounded text-[11px] transition-colors ${
                      improveTab === 'after' ? 'bg-[#0E281C] text-[#55EB9B]' : 'text-[var(--az-muted)]'
                    }`}
                  >
                    Azemax AI (Optimized)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Workstation Frame Body */}
          <div className="p-6 bg-[#040810] min-h-[380px] font-mono text-xs">
            
            {/* 1. WRITE MODE CONTENT */}
            {activeMode === 'write' && (
              <div className="space-y-2">
                <div className="text-[var(--az-muted)]/60 select-none pb-2 border-b border-white/5 flex items-center justify-between text-[11px]">
                  <span>// Native Monaco model with continuous background AST analysis</span>
                  <span className="text-[#8FB4FF]">Language: Python 3.12</span>
                </div>

                <div className="text-white/80 pt-2">
                  <span className="text-[var(--az-muted)] select-none mr-4">01</span>
                  <span className="az-syntax-kw">import</span> torch.nn <span className="az-syntax-kw">as</span> nn
                </div>
                <div className="text-white/80">
                  <span className="text-[var(--az-muted)] select-none mr-4">02</span>
                  <span className="az-syntax-kw">from</span> typing <span className="az-syntax-kw">import</span> Generator, Optional
                </div>
                <div className="text-white/80 mt-3">
                  <span className="text-[var(--az-muted)] select-none mr-4">03</span>
                  <span className="az-syntax-kw">def</span> <span className="az-syntax-fn">evaluate_streaming_weights</span>(weights: torch.Tensor, threshold: <span className="az-syntax-type">float</span>):
                </div>
                <div className="text-white/80 pl-6">
                  <span className="text-[var(--az-muted)] select-none mr-4">04</span>
                  normalized = torch.nn.functional.softmax(weights, dim=-1)
                </div>

                {/* Ghost completion line */}
                <div className="pl-6 flex items-center flex-wrap gap-2">
                  <span className="text-[var(--az-muted)] select-none mr-4">05</span>
                  {acceptedGhost ? (
                    <span className="text-[#8FB4FF]">
                      pruned_mask = (normalized &gt; threshold).to(dtype=torch.bfloat16)
                      <span className="az-caret" />
                    </span>
                  ) : (
                    <span className="text-white/70">
                      pruned_mask = <span className="az-caret" />
                      <span className="az-syntax-ghost ml-1.5">
                        (normalized &gt; threshold).to(dtype=torch.bfloat16)
                      </span>
                    </span>
                  )}
                </div>

                {acceptedGhost && (
                  <div className="text-white/80 pl-6 animate-fadeIn">
                    <span className="text-[var(--az-muted)] select-none mr-4">06</span>
                    <span className="az-syntax-kw">return</span> torch.where(pruned_mask, normalized, 0.0)
                  </div>
                )}

                {/* Ghost Tooltip */}
                {!acceptedGhost && (
                  <div className="mt-6 p-3 bg-[rgba(11,23,40,0.85)] border border-[rgba(79,140,255,0.25)] rounded-md flex items-center justify-between max-w-lg">
                    <div className="flex items-center gap-2 text-xs text-white/90">
                      <Sparkles size={14} className="text-[#4F8CFF]" />
                      <span>Ghost suggestion ready: <strong>bfloat16 tensor mask</strong></span>
                    </div>
                    <span className="text-[10px] text-[var(--az-muted)] font-mono border border-white/10 px-1.5 py-0.5 rounded">
                      Press Tab
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 2. RUN MODE CONTENT */}
            {activeMode === 'run' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Script snippet */}
                <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-[rgba(255,255,255,0.06)] pb-4 lg:pb-0 lg:pr-6">
                  <div className="text-[var(--az-muted)]/70 text-[11px] mb-3 flex items-center justify-between">
                    <span>Benchmark Definition</span>
                    <span className="text-emerald-400">● Validated</span>
                  </div>
                  <div className="text-white/80 space-y-1">
                    <div><span className="az-syntax-kw">import</span> time, math</div>
                    <div><span className="az-syntax-kw">from</span> azemax.bench <span className="az-syntax-kw">import</span> BenchmarkSuite</div>
                    <div className="pt-2"><span className="az-syntax-kw">def</span> <span className="az-syntax-fn">run_suite</span>():</div>
                    <div className="pl-4">suite = BenchmarkSuite(target_threads=8)</div>
                    <div className="pl-4">suite.profile_memory_allocations()</div>
                    <div className="pl-4"><span className="az-syntax-kw">return</span> suite.summarize()</div>
                  </div>
                </div>

                {/* Live xterm Terminal */}
                <div className="lg:col-span-6 flex flex-col h-[280px] bg-[#02050B] rounded-lg border border-[rgba(79,140,255,0.15)] p-3">
                  <div className="flex items-center justify-between text-[11px] text-[var(--az-muted)] pb-2 border-b border-white/5 mb-2">
                    <span className="flex items-center gap-1.5 text-[#8FB4FF]">
                      <Terminal size={12} /> xterm.js PTY session
                    </span>
                    <span className="text-[10px] text-white/40">WebSocket: 127.0.0.1:3001</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1.5 text-xs text-white/90">
                    {runLogs.map((log, i) => (
                      <div
                        key={i}
                        className={
                          log.startsWith('$')
                            ? 'text-[#8FB4FF]'
                            : log.startsWith('✓')
                            ? 'text-emerald-400'
                            : 'text-white/70'
                        }
                      >
                        {log}
                      </div>
                    ))}
                    {isRunning && (
                      <div className="text-[#4F8CFF] animate-pulse">
                        › Running matrix benchmarks...
                      </div>
                    )}
                  </div>
                  {hasRun && (
                    <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-[var(--az-muted)]">
                      <span>Status: SUCCESS</span>
                      <button
                        onClick={() => {
                          setRunLogs(['azemax-pty: ready (node v20.11.0, python 3.12.2)']);
                          setHasRun(false);
                        }}
                        className="flex items-center gap-1 hover:text-white"
                      >
                        <RotateCcw size={10} /> Clear
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. UNDERSTAND MODE CONTENT */}
            {activeMode === 'understand' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Selectable Code Lines */}
                <div className="lg:col-span-7 space-y-1">
                  <div className="text-[var(--az-muted)]/70 text-[11px] mb-3">
                    Click any highlighted line to inspect AST invariants and semantic breakdown:
                  </div>

                  <div className="text-white/60">
                    <span className="select-none text-[var(--az-muted)] mr-4">01</span>
                    <span className="az-syntax-kw">pub struct</span> <span className="az-syntax-type">DenseVector</span> {'{'} data: Vec&lt;f32&gt; {'}'}
                  </div>

                  <div
                    onClick={() => setSelectedLine(2)}
                    className={`cursor-pointer p-1.5 rounded transition-all ${
                      selectedLine === 2
                        ? 'bg-[#13233D] border border-[#4F8CFF]/50 text-white shadow-[0_0_12px_rgba(79,140,255,0.2)]'
                        : 'hover:bg-[#0A1220] text-white/80'
                    }`}
                  >
                    <span className="select-none text-[#8FB4FF] mr-4">02</span>
                    <span className="az-syntax-kw">impl</span> <span className="az-syntax-type">DenseVector</span> {'{'}
                  </div>

                  <div className="text-white/60 pl-4">
                    <span className="select-none text-[var(--az-muted)] mr-4">03</span>
                    <span className="az-syntax-kw">pub fn</span> <span className="az-syntax-fn">dot</span>(&amp;self, other: &amp;Self) -&gt; f32 {'{'}
                  </div>

                  <div
                    onClick={() => setSelectedLine(4)}
                    className={`cursor-pointer p-1.5 pl-6 rounded transition-all ${
                      selectedLine === 4
                        ? 'bg-[#13233D] border border-[#4F8CFF]/50 text-white shadow-[0_0_12px_rgba(79,140,255,0.2)]'
                        : 'hover:bg-[#0A1220] text-white/80'
                    }`}
                  >
                    <span className="select-none text-[#8FB4FF] mr-4">04</span>
                    self.data.iter().zip(&amp;other.data).map(|(a, b)| a * b).sum()
                  </div>

                  <div className="text-white/60 pl-4">
                    <span className="select-none text-[var(--az-muted)] mr-4">05</span>
                    {'}'}
                  </div>

                  <div className="text-white/60 pl-4">
                    <span className="select-none text-[var(--az-muted)] mr-4">06</span>
                    <span className="az-syntax-kw">pub fn</span> <span className="az-syntax-fn">assert_shape</span>(&amp;self, len: usize) {'{'}
                  </div>

                  <div
                    onClick={() => setSelectedLine(7)}
                    className={`cursor-pointer p-1.5 pl-6 rounded transition-all ${
                      selectedLine === 7
                        ? 'bg-[#13233D] border border-[#4F8CFF]/50 text-white shadow-[0_0_12px_rgba(79,140,255,0.2)]'
                        : 'hover:bg-[#0A1220] text-white/80'
                    }`}
                  >
                    <span className="select-none text-[#8FB4FF] mr-4">07</span>
                    assert_eq!(self.data.len(), len, <span className="az-syntax-str">"Dimension mismatch"</span>);
                  </div>

                  <div className="text-white/60 pl-4">
                    <span className="select-none text-[var(--az-muted)] mr-4">08</span>
                    {'}'}
                  </div>
                </div>

                {/* Explanation Sidebar */}
                <div className="lg:col-span-5 bg-[#08101E] border border-[rgba(79,140,255,0.2)] rounded-lg p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
                      <span className="text-[10px] uppercase font-mono text-[#8FB4FF] tracking-wider">
                        Azemax Explanation
                      </span>
                      <span className="text-[10px] font-mono text-[var(--az-muted)]">
                        Line {selectedLine} Selected
                      </span>
                    </div>

                    <h4 className="text-base font-semibold text-white mb-2">
                      {understandSnippets[selectedLine]?.title}
                    </h4>

                    <div className="inline-block font-mono text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded mb-3">
                      {understandSnippets[selectedLine]?.complexity}
                    </div>

                    <p className="text-xs text-[var(--az-muted)] leading-relaxed font-sans">
                      {understandSnippets[selectedLine]?.details}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-white/5 flex items-center gap-2 text-[10px] text-[#8FB4FF]">
                    <CheckCircle2 size={12} />
                    <span>Continuous local AST verification</span>
                  </div>
                </div>
              </div>
            )}

            {/* 4. IMPROVE MODE CONTENT */}
            {activeMode === 'improve' && (
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#8FB4FF] font-semibold">Refactor Report:</span>
                    <span className="text-white/70">Quadratic array scan replaced with streaming set</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                    -94% execution time
                  </span>
                </div>

                {improveTab === 'before' ? (
                  <div className="bg-[#100808] border border-red-500/20 rounded-md p-4 space-y-1 text-red-200/90">
                    <div className="text-red-400/70 text-[11px] mb-2 font-mono">// Original unoptimized implementation (O(N^2))</div>
                    <div><span className="text-red-400">-</span> export function filterDuplicates&lt;T&gt;(items: T[]): T[] {'{'}</div>
                    <div className="pl-4"><span className="text-red-400">-</span>   return items.filter((item, index) =&gt; {'{'}</div>
                    <div className="pl-8"><span className="text-red-400">-</span>     // Repeated linear indexOf allocation on every item</div>
                    <div className="pl-8"><span className="text-red-400">-</span>     return items.indexOf(item) === index;</div>
                    <div className="pl-4"><span className="text-red-400">-</span>   {'}'});</div>
                    <div><span className="text-red-400">-</span> {'}'}</div>
                  </div>
                ) : (
                  <div className="bg-[#06150E] border border-emerald-500/20 rounded-md p-4 space-y-1 text-emerald-200/90">
                    <div className="text-emerald-400/70 text-[11px] mb-2 font-mono">// Azemax suggested refactor (O(N) single-pass)</div>
                    <div><span className="text-emerald-400">+</span> export function filterDuplicates&lt;T&gt;(items: readonly T[]): T[] {'{'}</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   // Constant-time lookup set eliminates quadratic traversal</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   const seen = new Set&lt;T&gt;();</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   const result: T[] = [];</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   for (const item of items) {'{'}</div>
                    <div className="pl-8"><span className="text-emerald-400">+</span>     if (!seen.has(item)) {'{'}</div>
                    <div className="pl-12"><span className="text-emerald-400">+</span>       seen.add(item);</div>
                    <div className="pl-12"><span className="text-emerald-400">+</span>       result.push(item);</div>
                    <div className="pl-8"><span className="text-emerald-400">+</span>     {'}'}</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   {'}'}</div>
                    <div className="pl-4"><span className="text-emerald-400">+</span>   return result;</div>
                    <div><span className="text-emerald-400">+</span> {'}'}</div>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Workstation Frame Footer */}
          <div className="h-7 bg-[#060B14] border-t border-[rgba(79,140,255,0.12)] px-4 flex items-center justify-between text-[10px] font-mono text-[var(--az-muted)]">
            <span className="text-[#8FB4FF]">Azemax Core Engine Active</span>
            <span>Zero Remote Leakage</span>
          </div>
        </div>

      </div>
    </section>
  );
};
