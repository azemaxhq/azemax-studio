import React, { memo, useState } from 'react';
import { PenTool, Play, Cpu, Sparkles, ChevronRight } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

const STAGES = [
  {
    step: '01',
    id: 'write',
    title: 'Write',
    subtitle: 'Native Monaco with AI Co-authoring',
    icon: PenTool,
    summary: 'Author code with zero latency. Inline completions synthesize intent without dislodging your mental model.',
    specs: 'Monaco Core • AST Tokenizer • Ghost Completions',
  },
  {
    step: '02',
    id: 'run',
    title: 'Run',
    subtitle: 'Bi-directional PTY Terminal',
    icon: Play,
    summary: 'Execute scripts, tests, and servers locally. Hardware-accelerated terminal sessions stream outputs instantly.',
    specs: 'xterm.js WebGL • WebSocket PTY • Multi-Session',
  },
  {
    step: '03',
    id: 'understand',
    title: 'Understand',
    subtitle: 'Contextual Semantic Invariants',
    icon: Cpu,
    summary: 'Inspect any function, line, or block. Real-time explanation decomposes algorithmic complexity and boundary conditions.',
    specs: 'AST Invariants • Time Complexity • Line Highlighting',
  },
  {
    step: '04',
    id: 'improve',
    title: 'Improve',
    subtitle: 'Safe Automated Refactoring',
    icon: Sparkles,
    summary: 'Transform quadratic bottlenecks and missing guards into production-grade idioms with verifiable line diffs.',
    specs: 'Semantic Diff • Strict Verification • Rollback Safe',
  },
] as const;

type Stage = (typeof STAGES)[number];

const StageCard = memo(function StageCard({
  stage,
  isActive,
  isVisible,
  delayMs = 0,
  onActivate,
}: {
  stage: Stage;
  isActive: boolean;
  isVisible: boolean;
  delayMs?: number;
  onActivate: () => void;
}) {
  const Icon = stage.icon;
  return (
    <div
      onMouseEnter={onActivate}
      onFocus={onActivate}
      tabIndex={0}
      role="region"
      aria-label={`${stage.title} stage`}
      style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
      className={`group relative flex flex-col p-6 rounded-lg transition-[border-color,background-color,box-shadow,transform,opacity] duration-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF] az-card-lift az-reveal-scale ${isVisible ? 'az-visible' : ''} ${
        isActive
          ? 'bg-[rgba(11,23,40,0.7)] border border-[rgba(79,140,255,0.35)] shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_24px_rgba(79,140,255,0.12)]'
          : 'bg-[rgba(7,16,29,0.35)] border border-[rgba(79,140,255,0.08)] hover:border-[rgba(79,140,255,0.2)]'
      }`}
    >
      {/* Top Node Indicator */}
      <div className="flex items-center justify-between mb-6">
        <div
          className={`w-10 h-10 rounded-md flex items-center justify-center transition-[background-color,border-color,color,box-shadow] duration-300 ${
            isActive
              ? 'bg-[#152540] text-[#8FB4FF] border border-[#4F8CFF]/50 shadow-[0_0_16px_rgba(79,140,255,0.3)]'
              : 'bg-[#0A101C] text-[var(--az-muted)] border border-white/5 group-hover:text-white'
          }`}
        >
          <Icon size={18} className={`transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} />
        </div>

        <span className="font-mono text-xs text-[var(--az-muted)] tracking-wider">
          {stage.step}
        </span>
      </div>

      {/* Stage Title */}
      <h3 className="text-xl font-medium tracking-tight text-white mb-2 flex items-center gap-1.5">
        <span>{stage.title}</span>
        <ChevronRight
          size={14}
          className={`transition-[opacity,transform] duration-300 ${
            isActive ? 'text-[#4F8CFF] translate-x-1 opacity-100' : 'opacity-0 -translate-x-1'
          }`}
        />
      </h3>

      <p className="text-xs text-[var(--az-blue-pale)] font-mono mb-3">
        {stage.subtitle}
      </p>

      <p className="text-sm text-[var(--az-muted)] leading-relaxed font-sans mb-4 flex-1">
        {stage.summary}
      </p>

      {/* Technical Specs Footer */}
      <div className="pt-4 border-t border-[rgba(255,255,255,0.06)] text-[11px] font-mono text-[var(--az-muted-dark)] group-hover:text-[var(--az-muted)] transition-colors">
        {stage.specs}
      </div>
    </div>
  );
});

export const Philosophy: React.FC = memo(() => {
  const [activeStage, setActiveStage] = useState<number>(0);

  // Single consolidated reveal hook: 1 render instead of 5
  const [sectionTarget, isVisible] = useRevealAnimation({ threshold: 0.08 });

  // Stable per-card callbacks: keeps every onActivate identity stable
  const activateCallbacks = React.useMemo(
    () => STAGES.map((_, idx) => () => setActiveStage(idx)),
    [],
  );

  return (
    <div ref={sectionTarget} className="relative py-16 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 lg:px-16 bg-[#000204] overflow-hidden">

      {/* Background Subtle Atmosphere — compositor-only layer */}
      <div
        className="az-atmosphere absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] max-w-[800px] h-[350px] bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto relative z-10">

        {/* Section Header — Scroll Reveal */}
        <div
          className={`max-w-2xl mb-10 sm:mb-16 md:mb-20 az-reveal ${isVisible ? 'az-visible' : ''}`}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-4 h-[1px] bg-[var(--az-blue-electric)]" />
            <span className="az-mono-badge text-[11px] font-mono tracking-[0.2em] text-[#8FB4FF] uppercase">
              02 / PHILOSOPHY
            </span>
          </div>

          <h2 className="text-[1.75rem] sm:text-4xl md:text-5xl tracking-tight text-white mb-4 sm:mb-6 leading-[1.18] sm:leading-[1.15] text-balance">
            <span className="az-display-serif block">One workspace.</span>
            <span className="az-display-serif-italic az-text-blue block">One continuous loop.</span>
          </h2>

          <p className="text-base text-[var(--az-muted)] leading-relaxed font-sans">
            Azemax brings writing, execution, understanding, and improvement into one environment so developers can stay in flow.
            No fragmented tools, no copy-pasting code into web tabs, no lost context.
          </p>
        </div>

        {/* Continuous Pipeline Visualization */}
        <div className="relative">

          {/* Central Connecting Line — scaleX compositor progress */}
          <div className="hidden lg:block absolute top-[52px] left-8 right-8 h-[1px] bg-[rgba(79,140,255,0.15)] z-0">
            {/* Dynamic illuminated track according to active step — scaleX via CSS var */}
            <div
              className={`h-full bg-gradient-to-r from-[#3B82F6] to-[#4F8CFF] shadow-[0_0_12px_#4F8CFF] az-progress-track ${isVisible ? 'az-visible' : ''}`}
              style={{ '--az-progress': `${(activeStage + 1) / STAGES.length}` } as React.CSSProperties}
            />
          </div>

          {/* Connected Sequence Grid — GPU Compositor Stagger */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8 lg:gap-6 relative z-10">
            {STAGES.map((stage, idx) => (
              <StageCard
                key={stage.id}
                stage={stage}
                isActive={activeStage === idx}
                isVisible={isVisible}
                delayMs={idx * 90}
                onActivate={activateCallbacks[idx]}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
});

Philosophy.displayName = 'Philosophy';
