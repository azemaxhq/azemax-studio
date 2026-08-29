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

function sanitize(text: string): string {
  if (!text) return '';
  let s = text.replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_\[\]!\-`]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[^\w]+|[^\w]+$/g, '');
  if (s.length > 48) s = s.slice(0, 48).trim();
  s = s.replace(/[.,;:!?]+$/g, '').trim();
  return s;
}

function humanizeToolName(name: string): string {
  const base = (name.split('_')[0] || name).trim();
  if (!base) return '';
  if (base.endsWith('ing')) return base.charAt(0).toUpperCase() + base.slice(1);
  if (base.length > 3 && base.endsWith('e')) return base.charAt(0).toUpperCase() + base.slice(1, -1) + 'ing';
  return base.charAt(0).toUpperCase() + base.slice(1) + 'ing';
}

function deriveFromPrompt(prompt: string): string | null {
  const clean = sanitize(prompt);
  if (!clean || clean.length < 2) return null;
  const words = clean.split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const take = Math.min(4, words.length);
  const phrase = words.slice(0, take).join(' ');
  if (phrase.length < 2) return null;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function deriveFromTool(tool: { name: string; target?: string; label?: string }): string | null {
  if (tool.label) {
    const s = sanitize(tool.label);
    if (s && s.length >= 3 && s.length <= 36 && !/semantic|agentController|registry/i.test(s)) {
      const w = s.split(' ').slice(0, 4).join(' ');
      return w.charAt(0).toUpperCase() + w.slice(1);
    }
  }
  const name = sanitize(tool.name);
  if (!name) return null;
  const targetRaw = tool.target ? sanitize(tool.target.split('/').pop() || tool.target) : '';
  const verb = humanizeToolName(name);
  if (targetRaw && targetRaw.length >= 2 && targetRaw.length <= 24) {
    return `${verb} ${targetRaw}`.slice(0, 32).trim();
  }
  // without target, keep generic but still derived from tool name
  return verb;
}

function deriveFromFile(fileName?: string, selectionRange?: { startLine: number; endLine: number } | null, hasSelection?: boolean, phase?: string): string | null {
  if (!fileName) return null;
  const base = fileName.split('/').pop() || fileName;
  const cleanBase = sanitize(base);
  if (!cleanBase) return null;
  const p = (phase || '').toLowerCase();
  const isApplying = p === 'applying' || p === 'validating';
  const isGenerating = p === 'generating' || p === 'streaming';
  if (hasSelection && selectionRange) {
    const { startLine, endLine } = selectionRange;
    if (isApplying) return `Updating selection`;
    if (isGenerating) return `Preparing selection`;
    if (startLine && endLine && startLine !== endLine) return `Reviewing lines ${startLine}–${endLine}`;
    if (startLine) return `Reviewing line ${startLine}`;
    return `Reviewing selection`;
  }
  if (isApplying) return `Updating ${cleanBase}`;
  if (isGenerating) return `Preparing ${cleanBase}`;
  return `Reviewing ${cleanBase}`;
}

export function getAIActivityLabel(ctx: ActivityContext): string {
  const phase = (ctx.phase || 'thinking').toLowerCase();
  if (phase === 'success') {
    if (ctx.fileName) {
      const base = sanitize(ctx.fileName.split('/').pop() || ctx.fileName);
      if (base) return `Updated ${base}`.slice(0, 28);
    }
    return 'Done';
  }
  if (phase === 'error') return 'Something went wrong';
  if (phase === 'cancelled') return 'Cancelled';

  const tool = ctx.activeTool || (ctx.agentActivity ? { name: ctx.agentActivity.tool || '', target: ctx.agentActivity.target, label: ctx.agentActivity.message } : undefined);
  if (tool && tool.name) {
    const d = deriveFromTool(tool);
    if (d && d.length >= 3) return d.slice(0, 32);
  }
  if (ctx.agentActivity?.message) {
    const s = sanitize(ctx.agentActivity.message);
    if (s && s.length >= 3 && s.length <= 36 && !/semantic|agentController|registry/i.test(s)) {
      const w = s.split(' ').slice(0, 4).join(' ');
      return w.charAt(0).toUpperCase() + w.slice(1);
    }
  }
  if (ctx.fileName || ctx.hasSelection) {
    const fd = deriveFromFile(ctx.fileName, ctx.selectionRange || null, ctx.hasSelection, phase);
    if (fd) return fd.slice(0, 30);
  }
  if (ctx.hasFiles && ctx.fileName) {
    const base = sanitize(ctx.fileName.split('/').pop() || '');
    if (base) {
      if (phase === 'applying' || phase === 'validating') return `Updating ${base}`.slice(0, 28);
      if (phase === 'generating' || phase === 'streaming') return `Preparing ${base}`.slice(0, 28);
      return `Reviewing ${base}`.slice(0, 28);
    }
  }
  const prompt = ctx.prompt || ctx.intent || '';
  if (prompt) {
    const d = deriveFromPrompt(prompt);
    if (d) return d.slice(0, 32);
  }
  if (ctx.operation) {
    const op = sanitize(String(ctx.operation).replace(/[-_]/g, ' '));
    if (op && op.length >= 3) {
      const verb = op.split(' ')[0];
      const cap = verb.charAt(0).toUpperCase() + verb.slice(1);
      if (cap.length >= 3) return cap.slice(0, 20);
    }
  }
  return 'Working';
}

export function resolveAIActivity(context: ActivityContext): string {
  return getAIActivityLabel(context);
}
