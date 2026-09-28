import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PenTool, Play, Cpu, Sparkles, Terminal, CheckCircle2, RotateCcw } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

type ModeType = 'write' | 'run' | 'understand' | 'improve';

const isModeType = (v: unknown): v is ModeType =>
  v === 'write' || v === 'run' || v === 'understand' || v === 'improve';

const MODES = [
  { id: 'write' as const, label: 'Write', icon: PenTool },
  { id: 'run' as const, label: 'Run', icon: Play },
  { id: 'understand' as const, label: 'Understand', icon: Cpu },
  { id: 'improve' as const, label: 'Improve', icon: Sparkles },
] as const;

const UNDERSTAND_SNIPPETS: Record<number, { title: string; complexity: string; details: string }> = {
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

const MODE_FILES: Record<ModeType, string> = {
  write: 'src/compute/optimizer.py',
  run: 'src/benchmark/runner.py',
  understand: 'src/tensor/vector.rs',
  improve: 'src/io/stream_pipeline.ts',
};

// --- Memoized panels: only the active mode subscribes to its state. ---
// Before, every keystroke of state (runLogs tick, selectedLine, ghost toggle)
// re-rendered the entire showcase including all four hidden modes.

const WritePanel = memo(function WritePanel({
  acceptedGhost,
}: {
  acceptedGhost: boolean;
}) {
  return (
    <div className="space-y-2 overflow-x-auto">
      <div className="text-[var(--az-muted)]/60 select-none pb-2 border-b border-white/5 flex flex-wrap items-center justify-between gap-2 text-[10px] sm:text-[11px]">
        <span className="min-w-0 break-words">// Native Monaco model with continuous background AST analysis</span>
        <span className="shrink-0 text-[#8FB4FF]">Language: Python 3.12</span>
      </div>

      <div className="text-white/80 pt-2 whitespace-pre-wrap break-words">
        <span className="text-[var(--az-muted)] select-none mr-3 sm:mr-4">01</span>
        <span className="az-syntax-kw">import</span> torch.nn <span className="az-syntax-kw">as</span> nn
      </div>
      <div className="text-white/80 whitespace-pre-wrap break-words">
        <span className="text-[var(--az-muted)] select-none mr-3 sm:mr-4">02</span>
        <span className="az-syntax-kw">from</span> typing <span className="az-syntax-kw">import</span> Generator, Optional
      </div>
      <div className="text-white/80 mt-3 whitespace-pre-wrap break-words">
        <span className="text-[var(--az-muted)] select-none mr-3 sm:mr-4">03</span>
        <span className="az-syntax-kw">def</span> <span className="az-syntax-fn">evaluate_streaming_weights</span>(weights: torch.Tensor, threshold: <span className="az-syntax-type">float</span>):
      </div>
      <div className="text-white/80 pl-4 sm:pl-6 whitespace-pre-wrap break-words">
        <span className="text-[var(--az-muted)] select-none mr-3 sm:mr-4">04</span>
        normalized = torch.nn.functional.softmax(weights, dim=-1)
      </div>

      {/* Ghost completion line */}
      <div className="pl-4 sm:pl-6 flex items-center flex-wrap gap-2 whitespace-pre-wrap break-words">
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
        <div className="mt-6 p-3 bg-[rgba(11,23,40,0.85)] border border-[rgba(79,140,255,0.25)] rounded-md flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between max-w-lg">
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
  );
});

const RunLogLine = memo(function RunLogLine({ log }: { log: string }) {
  const cls = log.startsWith('$')
    ? 'text-[#8FB4FF]'
    : log.startsWith('✓')
      ? 'text-emerald-400'
      : 'text-white/70';
  return <div className={cls}>{log}</div>;
});

const RunPanel = memo(function RunPanel({
  isRunning,
  runLogs,
  hasRun,
  onClear,
}: {
  isRunning: boolean;
  runLogs: string[];
  hasRun: boolean;
  onClear: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
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
      <div className="lg:col-span-6 flex flex-col min-h-[240px] sm:h-[280px] bg-[#02050B] rounded-lg border border-[rgba(79,140,255,0.15)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--az-muted)] pb-2 border-b border-white/5 mb-2">
          <span className="flex items-center gap-1.5 text-[#8FB4FF]">
            <Terminal size={12} /> xterm.js PTY session
          </span>
          <span className="hidden sm:inline text-[10px] text-white/40">WebSocket: 127.0.0.1:3001</span>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5 text-xs text-white/90 break-words">
          {runLogs.map((log, i) => (
            <RunLogLine key={i} log={log} />
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
              onClick={onClear}
              className="flex items-center gap-1 hover:text-white"
            >
              <RotateCcw size={10} /> Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const UnderstandLine = memo(function UnderstandLine({
  line,
  selected,
  indented,
  onSelect,
  children,
}: {
  line: number;
  selected: boolean;
  indented?: boolean;
  onSelect: (line: number) => void;
  children: React.ReactNode;
}) {
  const handleClick = useCallback(() => {
    onSelect(line);
  }, [onSelect, line]);

  return (
    <div
      onClick={handleClick}
      className={`cursor-pointer p-1.5 rounded transition-[background-color,border-color,box-shadow] ${indented ? 'pl-6' : ''} ${
        selected
          ? 'bg-[#13233D] border border-[#4F8CFF]/50 text-white shadow-[0_0_12px_rgba(79,140,255,0.2)]'
          : 'hover:bg-[#0A1220] text-white/80'
      }`}
    >
      <span className="select-none text-[#8FB4FF] mr-4">{String(line).padStart(2, '0')}</span>
      {children}
    </div>
  );
});

const UnderstandPanel = memo(function UnderstandPanel({
  selectedLine,
  onSelectLine,
}: {
  selectedLine: number;
  onSelectLine: (line: number) => void;
}) {
  const snippet = UNDERSTAND_SNIPPETS[selectedLine];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
      {/* Selectable Code Lines */}
      <div className="lg:col-span-7 space-y-1">
        <div className="text-[var(--az-muted)]/70 text-[11px] mb-3">
          Click any highlighted line to inspect AST invariants and semantic breakdown:
        </div>

        <div className="text-white/60">
          <span className="select-none text-[var(--az-muted)] mr-4">01</span>
          <span className="az-syntax-kw">pub struct</span> <span className="az-syntax-type">DenseVector</span> {'{'} data: Vec&lt;f32&gt; {'}'}
        </div>

        <UnderstandLine line={2} selected={selectedLine === 2} onSelect={onSelectLine}>
          <span className="az-syntax-kw">impl</span> <span className="az-syntax-type">DenseVector</span> {'{'}
        </UnderstandLine>

        <div className="text-white/60 pl-4">
          <span className="select-none text-[var(--az-muted)] mr-4">03</span>
          <span className="az-syntax-kw">pub fn</span> <span className="az-syntax-fn">dot</span>(&amp;self, other: &amp;Self) -&gt; f32 {'{'}
        </div>

        <UnderstandLine line={4} selected={selectedLine === 4} indented onSelect={onSelectLine}>
          self.data.iter().zip(&amp;other.data).map(|(a, b)| a * b).sum()
        </UnderstandLine>

        <div className="text-white/60 pl-4">
          <span className="select-none text-[var(--az-muted)] mr-4">05</span>
          {'}'}
        </div>

        <div className="text-white/60 pl-4">
          <span className="select-none text-[var(--az-muted)] mr-4">06</span>
          <span className="az-syntax-kw">pub fn</span> <span className="az-syntax-fn">assert_shape</span>(&amp;self, len: usize) {'{'}
        </div>

        <UnderstandLine line={7} selected={selectedLine === 7} indented onSelect={onSelectLine}>
          <>assert_eq!(self.data.len(), len, <span className="az-syntax-str">&quot;Dimension mismatch&quot;</span>);</>
        </UnderstandLine>

        <div className="text-white/60 pl-4">
          <span className="select-none text-[var(--az-muted)] mr-4">08</span>
          {'}'}
        </div>
      </div>

      {/* Explanation Sidebar */}
      <div className="lg:col-span-5 bg-[#08101E] border border-[rgba(79,140,255,0.2)] rounded-lg p-4 sm:p-5 flex flex-col justify-between gap-4">
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
            {snippet?.title}
          </h4>

          <div className="inline-block font-mono text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded mb-3">
            {snippet?.complexity}
          </div>

          <p className="text-xs text-[var(--az-muted)] leading-relaxed font-sans">
            {snippet?.details}
          </p>
        </div>

        <div className="pt-4 border-t border-white/5 flex items-center gap-2 text-[10px] text-[#8FB4FF]">
          <CheckCircle2 size={12} />
          <span>Continuous local AST verification</span>
        </div>
      </div>
    </div>
  );
});

const ImprovePanel = memo(function ImprovePanel({
  improveTab,
}: {
  improveTab: 'before' | 'after';
}) {
  return (
    <div className="overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between pb-3 border-b border-white/5 mb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#8FB4FF] font-semibold">Refactor Report:</span>
          <span className="text-white/70">Quadratic array scan replaced with streaming set</span>
        </div>
        <span className="self-start sm:self-auto shrink-0 text-[11px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
          -94% execution time
        </span>
      </div>

      {improveTab === 'before' ? (
        <div className="bg-[#100808] border border-red-500/20 rounded-md p-3 sm:p-4 space-y-1 text-red-200/90 overflow-x-auto text-[11px] sm:text-xs">
          <div className="text-red-400/70 text-[11px] mb-2 font-mono">// Original unoptimized implementation (O(N^2))</div>
          <div><span className="text-red-400">-</span> export function filterDuplicates&lt;T&gt;(items: T[]): T[] {'{'}</div>
          <div className="pl-4"><span className="text-red-400">-</span>   return items.filter((item, index) =&gt; {'{'}</div>
          <div className="pl-8"><span className="text-red-400">-</span>     // Repeated linear indexOf allocation on every item</div>
          <div className="pl-8"><span className="text-red-400">-</span>     return items.indexOf(item) === index;</div>
          <div className="pl-4"><span className="text-red-400">-</span>   {'}'});</div>
          <div><span className="text-red-400">-</span> {'}'}</div>
        </div>
      ) : (
        <div className="bg-[#06150E] border border-emerald-500/20 rounded-md p-3 sm:p-4 space-y-1 text-emerald-200/90 overflow-x-auto text-[11px] sm:text-xs">
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
  );
});

const ModeTab = memo(function ModeTab({
  mode,
  isSelected,
  onSelect,
}: {
  mode: (typeof MODES)[number];
  isSelected: boolean;
  onSelect: (mode: ModeType) => void;
}) {
  const Icon = mode.icon;
  const handleClick = useCallback(() => {
    onSelect(mode.id);
  }, [onSelect, mode.id]);

  return (
    <button
      role="tab"
      id={`tab-${mode.id}`}
      aria-selected={isSelected}
      aria-controls={`panel-${mode.id}`}
      tabIndex={isSelected ? 0 : -1}
      onClick={handleClick}
      className={`flex items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-2.5 px-2 sm:px-3 min-h-[44px] rounded-md font-mono text-[11px] sm:text-xs transition-[background-color,border-color,color,box-shadow] duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF] ${
        isSelected
          ? 'bg-[#0E1A2E] text-white border border-[#4F8CFF]/40 shadow-[0_0_16px_rgba(79,140,255,0.2)]'
          : 'text-[var(--az-muted)] hover:text-white/80 hover:bg-[#0A101C]'
      }`}
    >
      <Icon size={14} className={isSelected ? 'text-[#8FB4FF]' : 'opacity-70'} />
      <span className="font-medium">{mode.label}</span>
    </button>
  );
});

export const WorkspaceShowcase: React.FC = memo(() => {
  const [activeMode, setActiveMode] = useState<ModeType>('write');

  // Hero discovery control preselects the matching tab before scrolling here.
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<unknown>).detail;
      if (isModeType(mode)) setActiveMode(mode);
    };
    window.addEventListener('azemax:set-mode', handler);
    return () => window.removeEventListener('azemax:set-mode', handler);
  }, []);

  // WRITE Mode States
  const [acceptedGhost, setAcceptedGhost] = useState<boolean>(false);

  // RUN Mode States — timeouts tracked so unmount / re-run never leaks or
  // calls setState on an unmounted component (React 18 strict-mode safe).
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runLogs, setRunLogs] = useState<string[]>([
    'azemax-pty: ready (node v20.11.0, python 3.12.2)',
  ]);
  const [hasRun, setHasRun] = useState<boolean>(false);
  const runTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isRunningRef = useRef(false);

  useEffect(() => () => {
    runTimers.current.forEach(clearTimeout);
    runTimers.current = [];
  }, []);

  const handleRunExecution = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setIsRunning(true);
    setRunLogs(['$ python3 -m azemax.bench --dataset=production']);

    runTimers.current.forEach(clearTimeout);
    runTimers.current = [
      setTimeout(() => {
        setRunLogs((prev) => [...prev, '› Initializing zero-copy memory buffers...']);
      }, 400),
      setTimeout(() => {
        setRunLogs((prev) => [...prev, '› [1/3] Warmup passes completed: 1,000 iterations']);
      }, 900),
      setTimeout(() => {
        setRunLogs((prev) => [
          ...prev,
          '› [2/3] Throughput: 142,800 ops/sec | Latency p99: 0.18ms',
          '› [3/3] Memory footprint: 14.8 MB (RSS)',
          '✓ Execution completed with exit code 0.',
        ]);
        isRunningRef.current = false;
        setIsRunning(false);
        setHasRun(true);
      }, 1500),
    ];
  }, []);

  const handleClearRun = useCallback(() => {
    runTimers.current.forEach(clearTimeout);
    runTimers.current = [];
    isRunningRef.current = false;
    setIsRunning(false);
    setRunLogs(['azemax-pty: ready (node v20.11.0, python 3.12.2)']);
    setHasRun(false);
  }, []);

  const handleToggleGhost = useCallback(() => setAcceptedGhost((v) => !v), []);

  // UNDERSTAND Mode States
  const [selectedLine, setSelectedLine] = useState<number>(4);
  const handleSelectLine = useCallback((line: number) => {
    startTransition(() => {
      setSelectedLine(line);
    });
  }, []);

  // IMPROVE Mode States
  const [improveTab, setImproveTab] = useState<'before' | 'after'>('after');
  const handleSelectBefore = useCallback(() => {
    startTransition(() => {
      setImproveTab('before');
    });
  }, []);
  const handleSelectAfter = useCallback(() => {
    startTransition(() => {
      setImproveTab('after');
    });
  }, []);

  // Consolidated scroll reveal hook: 1 render instead of 3
  const [sectionTarget, isVisible] = useRevealAnimation({ threshold: 0.08 });

  const handleSelectMode = useCallback((mode: ModeType) => {
    startTransition(() => {
      setActiveMode(mode);
    });
  }, []);
  const activeFile = useMemo(() => MODE_FILES[activeMode], [activeMode]);

  return (
    <div ref={sectionTarget} className="relative py-16 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 lg:px-16 bg-[#020409] border-t border-[rgba(79,140,255,0.08)] overflow-hidden">

      {/* Atmosphere wash — compositor-only */}
      <div
        className="az-atmosphere absolute top-0 right-1/4 w-[600px] max-w-full h-[300px] bg-[radial-gradient(circle,rgba(79,140,255,0.07)_0%,transparent_70%)] pointer-events-none blur-3xl"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto relative z-10">

        {/* Section Header */}
        <div
          className={`flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6 mb-8 sm:mb-12 az-reveal-left ${isVisible ? 'az-visible' : ''}`}
        >
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-4 h-[1px] bg-[var(--az-blue-electric)]" />
              <span className="az-mono-badge text-[11px] font-mono tracking-[0.2em] text-[#8FB4FF] uppercase">
                03 / EXPERIENCE
              </span>
            </div>
            <h2 className="text-[1.75rem] sm:text-4xl md:text-5xl tracking-tight text-white leading-[1.15] text-balance">
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
          role="tablist"
          aria-label="Workspace Modes"
          className={`grid grid-cols-2 sm:flex sm:items-center gap-1.5 sm:gap-2 p-1.5 bg-[#060A12] border border-[rgba(79,140,255,0.15)] rounded-lg mb-6 sm:mb-8 max-w-xl az-reveal az-delay-1 ${isVisible ? 'az-visible' : ''}`}
        >
          {MODES.map((mode) => (
            <ModeTab key={mode.id} mode={mode} isSelected={activeMode === mode.id} onSelect={handleSelectMode} />
          ))}
        </div>

        {/* Persistent Unified Workspace Frame */}
        <div
          id={`panel-${activeMode}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeMode}`}
          className={`az-glass-surface rounded-xl border border-[rgba(79,140,255,0.2)] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] az-reveal-scale az-delay-2 ${isVisible ? 'az-visible' : ''}`}
        >
          {/* Workstation Frame Header */}
          <div className="min-h-[2.5rem] bg-[#070D18] border-b border-[rgba(79,140,255,0.12)] px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/70" />
              </div>
              <span className="hidden sm:block h-3 w-[1px] bg-white/10" />
              <span className="truncate text-[11px] sm:text-xs font-mono text-[#8FB4FF]">
                {activeFile}
              </span>
            </div>

            {/* Mode-specific actions in header */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono">
              {activeMode === 'write' && (
                <button
                  onClick={handleToggleGhost}
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
                    onClick={handleSelectBefore}
                    className={`px-2.5 py-0.5 rounded text-[11px] transition-colors ${
                      improveTab === 'before' ? 'bg-[#2A1515] text-[#FF8585]' : 'text-[var(--az-muted)]'
                    }`}
                  >
                    Original
                  </button>
                  <button
                    onClick={handleSelectAfter}
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

          {/* Workstation Frame Body — only the active panel mounts,
              key forces a remount so .az-tab-panel-enter triggers each switch */}
          <div key={activeMode} className="p-3 sm:p-6 bg-[#040810] min-h-[380px] font-mono text-[11px] sm:text-xs overflow-x-hidden az-tab-panel-enter">
            {activeMode === 'write' && <WritePanel acceptedGhost={acceptedGhost} />}
            {activeMode === 'run' && (
              <RunPanel isRunning={isRunning} runLogs={runLogs} hasRun={hasRun} onClear={handleClearRun} />
            )}
            {activeMode === 'understand' && (
              <UnderstandPanel selectedLine={selectedLine} onSelectLine={handleSelectLine} />
            )}
            {activeMode === 'improve' && <ImprovePanel improveTab={improveTab} />}
          </div>

          {/* Workstation Frame Footer */}
          <div className="min-h-7 bg-[#060B14] border-t border-[rgba(79,140,255,0.12)] px-3 sm:px-4 py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono text-[var(--az-muted)]">
            <span className="text-[#8FB4FF]">Azemax Core Engine Active</span>
            <span>Zero Remote Leakage</span>
          </div>
        </div>

      </div>
    </div>
  );
});

WorkspaceShowcase.displayName = 'WorkspaceShowcase';
