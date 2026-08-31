import type { AIOperationType } from '../../core/ai/aiRequestStore';
import type { AILoadingStatus } from '../../hooks/useAILoading';

export interface ActivityContext {
  intent?: string;
  prompt?: string;
  operation?: AIOperationType | string | null;
  phase?: AILoadingStatus | 'thinking' | 'generating' | 'streaming' | 'applying' | 'validating' | 'success' | 'error' | 'cancelled';
  activeTool?: { name: string; target?: string; label?: string };
  agentActivity?: { tool?: string; target?: string; message?: string };
  fileName?: string;
  selectionRange?: { startLine: number; endLine: number } | null;
  hasSelection?: boolean;
  hasFiles?: boolean;
  isApplying?: boolean;
}

// ── Azemax-native vocabulary — premium, playful but restrained ──
// Text labels are clean — no trailing "..." — animated dots are the only ellipsis
const AZEMAX_SIGNATURE = 'Azemaxing' as const;
// Curated 22 — GENERAL (8) + CODE (8) + CREATIVE (6) — sophisticated

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickNeutral(ctx: ActivityContext): string {
  // Deterministic per prompt/file to avoid flicker, but weighted to signature
  const key = `${ctx.prompt || ''}|${ctx.fileName || ''}|${ctx.operation || ''}`;
  const h = hashString(key);
  // 35% Azemaxing as signature fallback
  if (h % 7 === 0) return AZEMAX_SIGNATURE;
  if (h % 7 === 1) return 'Thinking';
  // otherwise pick from neutral rotation pool (general + creative, no code-specific)
  const neutralRotation: readonly string[] = [
    'Azemaxing',
    'Crafting',
    'On the way',
    'Building',
    'Flowing',
    'Brewing',
    'Polishing',
    'Tuning',
    'Working',
    'Shaping',
  ];
  return neutralRotation[h % neutralRotation.length];
}

function isCodeContext(ctx: ActivityContext): boolean {
  const op = String(ctx.operation || '').toLowerCase();
  return (
    !!ctx.fileName ||
    !!ctx.hasSelection ||
    !!ctx.hasFiles ||
    ['explain', 'fix', 'refactor', 'optimize', 'review', 'test'].some(k => op.includes(k))
  );
}

export function getAIActivityLabel(ctx: ActivityContext): string {
  const phase = (ctx.phase || 'thinking').toLowerCase();
  if (phase === 'success') return 'Done';
  if (phase === 'error') return 'Something went wrong';
  if (phase === 'cancelled') return 'Cancelled';

  // Only expose code-specific phrases when we have real evidence — avoid fake "Compiling"
  const toolName = (ctx.activeTool?.name || ctx.agentActivity?.tool || '').toLowerCase();
  const op = String(ctx.operation || '').toLowerCase();

  // Active tool is strongest signal — map honestly
  if (toolName) {
    if (toolName.includes('read') || toolName.includes('parse') || toolName.includes('get_editor')) {
      return 'Reading';
    }
    if (toolName.includes('search') || toolName.includes('trace') || toolName.includes('list')) {
      return 'Tracing';
    }
    if (toolName.includes('apply') || toolName.includes('build') || toolName.includes('create_file') || toolName.includes('update_file')) {
      return 'Building';
    }
    if (toolName.includes('interpret')) {
      return 'Thinking';
    }
  }

  // Operation-specific, only when operation is explicit
  if (op) {
    if (op.includes('fix') || op.includes('debug')) return 'Tuning';
    if (op.includes('refactor')) return 'Crafting';
    if (op.includes('optimize')) return 'Optimizing';
    if (op.includes('explain')) return 'Reading';
    if (op.includes('test')) return 'Assembling';
    if (op.includes('review')) return 'Polishing';
  }

  // For generic chat with no file/tool/operation evidence, use signature neutral
  // If we have file context but no specific operation, still prefer neutral to avoid "Reviewing tk.md" generic
  if (!isCodeContext(ctx)) {
    return pickNeutral(ctx);
  }

  // Code context but no specific tool/operation — use gentle code pool deterministically
  const key = `${ctx.fileName || ''}|${op}|${toolName}`;
  const h = hashString(key);
  const gentleCode: readonly string[] = ['Reading', 'Parsing', 'Wiring', 'Connecting', 'Tuning', 'Crafting'];
  // Weight signature still
  if (h % 5 === 0) return AZEMAX_SIGNATURE;
  return gentleCode[h % gentleCode.length];
}

export function resolveAIActivity(context: ActivityContext): string {
  return getAIActivityLabel(context);
}

// Export pools for rotation in UI (calm, no layout shift) — clean labels, dots separate
export const AZEMAX_ROTATION_POOL: readonly string[] = [
  'Azemaxing',
  'Crafting',
  'On the way',
  'Building',
  'Flowing',
  'Almost there',
];
