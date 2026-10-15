import type { AIOperationType } from '../../core/ai/aiRequestStore';
import type { AILoadingStatus } from '../../hooks/useAILoading';

export interface ActivityContext {
  intent?: string;
  prompt?: string;
  operation?: AIOperationType | string | null;
  phase?: AILoadingStatus | 'thinking' | 'generating' | 'streaming' | 'applying' | 'validating' | 'success' | 'error' | 'cancelled';
  activeTool?: { name: string; target?: string; label?: string };
  agentActivity?: { tool?: string; target?: string; message?: string };
  agentPhase?: string | null;
  fileName?: string;
  selectionRange?: { startLine: number; endLine: number } | null;
  hasSelection?: boolean;
  hasFiles?: boolean;
  isApplying?: boolean;
}

/** Structured activity as emitted by the agent controller (never invented). */
export interface StructuredActivity {
  tool?: string;
  status?: string;
  message?: string;
  path?: string;
  detail?: string;
  target?: string;
  label?: string;
}

const MAX_DISPLAY_NAME = 32;

/**
 * Sanitize a workspace path for display: basename only, no absolute paths,
 * no control characters, no command arguments, no secrets. Returns undefined
 * when nothing safe can be shown — callers must then use a neutral label
 * rather than guessing.
 */
export function sanitizeDisplayName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = Array.from(raw).filter((ch) => { const c = ch.codePointAt(0) ?? 32; return c >= 32 && c !== 127; }).join('').trim();
  if (!trimmed) return undefined;
  // Never display command arguments, queries, or multi-line blobs.
  if (/[\r\n\t]/.test(raw)) return undefined;
  if (trimmed.length > 160) return undefined;
  // Workspace paths come from validated tool args — basename them directly.
  // Displaying a *name* never leaks file contents.
  if (/[/\\]/.test(trimmed) || /\.[A-Za-z0-9]{1,8}$/.test(trimmed)) {
    const base = trimmed.split(/[\\/]/).pop()?.trim();
    if (!base || base === '.' || base === '..') return undefined;
    return truncateName(base);
  }
  // Free-text tokens: block anything shaped like credentials, assignments,
  // or protocol JSON rather than a filename.
  if (/[=:{}\]"']/.test(trimmed) || /\s/.test(trimmed)) return undefined;
  const lower = trimmed.toLowerCase();
  if (/(api[_-]?key|secret|token|password|passwd|auth|bearer|session)/.test(lower)) return undefined;
  if (/^[-\s]+$/.test(trimmed)) return undefined;
  return truncateName(trimmed);
}

function truncateName(base: string): string | undefined {
  if (!base) return undefined;
  if (base.length > MAX_DISPLAY_NAME) {
    const extIdx = base.lastIndexOf('.');
    const ext = extIdx > 0 && base.length - extIdx <= 8 ? base.slice(extIdx) : '';
    const stem = ext ? base.slice(0, extIdx) : base;
    return `${stem.slice(0, Math.max(1, MAX_DISPLAY_NAME - ext.length - 1))}…${ext}`;
  }
  return base;
}

function toolOf(a: StructuredActivity): string {
  return String(a.tool ?? '').toLowerCase();
}

function targetOf(a: StructuredActivity): string | undefined {
  return sanitizeDisplayName(a.path ?? a.detail ?? a.target ?? a.label);
}

export interface FormattedActivity {
  /** Short verb phrase derived from the real operation, e.g. "Reading". */
  label: string;
  /** Sanitized basename when the operation targets a known file, else undefined. */
  file?: string;
}

/**
 * Centralized, safe label formatter over structured execution events.
 *
 * - Labels come ONLY from real tool names / lifecycle stages / explicit phases.
 * - Filenames come ONLY from sanitized event metadata — never invented.
 * - Falls back to the neutral "Working" when nothing specific is known.
 */
export function formatAgentActivity(activity: StructuredActivity): FormattedActivity {
  const tool = toolOf(activity);
  const file = targetOf(activity);

  switch (tool) {
    case 'understand':
    case 'interpret':
      return { label: 'Thinking' };
    case 'inspect':
      return { label: 'Inspecting workspace' };
    case 'plan':
    case 'execute':
      return { label: 'Planning changes' };
    case 'list_files':
      return { label: file ? 'Browsing files' : 'Searching project files', ...(file ? { file } : {}) };
    case 'read_file':
    case 'get_file_info':
    case 'get_editor_context':
    case 'read':
      return { label: 'Reading', ...(file ? { file } : {}) };
    case 'search_files':
      return { label: 'Searching project files' };
    case 'get_diagnostics':
    case 'check':
      return { label: 'Checking diagnostics', ...(file ? { file } : {}) };
    case 'create_file':
    case 'create_directory':
    case 'create':
      return { label: 'Creating', ...(file ? { file } : {}) };
    case 'write_file':
    case 'replace_range':
    case 'insert_text':
    case 'delete_range':
    case 'rename_file':
    case 'delete_file':
    case 'update':
      return { label: 'Updating', ...(file ? { file } : {}) };
    case 'apply':
      return { label: 'Applying code changes', ...(file ? { file } : {}) };
    case 'fix':
      return { label: 'Fixing issues', ...(file ? { file } : {}) };
    case 'summarize':
      return { label: 'Preparing summary' };
    default:
      break;
  }

  // Substring fallback for forward-compatible / namespaced tool ids.
  if (tool.includes('search') || tool.includes('trace') || tool.includes('list')) {
    return { label: 'Searching project files' };
  }
  if (tool.includes('read') || tool.includes('parse') || tool.includes('inspect') || tool.includes('editor')) {
    return { label: 'Reading', ...(file ? { file } : {}) };
  }
  if (tool.includes('diagnos') || tool.includes('valid') || tool.includes('check') || tool.includes('verif')) {
    return { label: 'Verifying changes', ...(file ? { file } : {}) };
  }
  if (tool.includes('create') || tool.includes('mkdir')) {
    return { label: 'Creating', ...(file ? { file } : {}) };
  }
  if (tool.includes('write') || tool.includes('edit') || tool.includes('update') || tool.includes('apply') || tool.includes('replace') || tool.includes('insert') || tool.includes('delete') || tool.includes('rename')) {
    return { label: 'Updating', ...(file ? { file } : {}) };
  }
  if (tool.includes('plan')) {
    return { label: 'Planning changes' };
  }
  if (tool.includes('think') || tool.includes('understand') || tool.includes('interpret')) {
    return { label: 'Thinking' };
  }

  // No recognizable tool — neutral, never fabricated.
  return { label: 'Working' };
}

/** Render "Reading" + "src/App.tsx" as "Reading src/App.tsx". */
export function renderActivityText(f: FormattedActivity): string {
  return f.file ? `${f.label} ${f.file}` : f.label;
}

function phaseLabel(phase: string): string | null {
  // Handles both agent lifecycle phases and the request statuses implying them.
  switch (phase) {
    case 'understanding':
    case 'thinking':
    case 'preparing':
      return 'Thinking';
    case 'inspecting':
      return 'Inspecting workspace';
    case 'planning':
      return 'Planning changes';
    case 'applying':
      return 'Applying code changes';
    case 'executing':
    case 'generating':
    case 'streaming':
      return null; // tool signal below is more specific; generic fallback otherwise
    case 'validating':
      return 'Verifying changes';
    case 'summarizing':
      return 'Preparing summary';
    default:
      return null;
  }
}

export function getAIActivityLabel(ctx: ActivityContext): string {
  const phase = String(ctx.phase || '').toLowerCase();
  if (phase === 'success') return 'Done';
  if (phase === 'error') return 'Something went wrong';
  if (phase === 'cancelled') return 'Cancelled';

  const agentPhase = String(ctx.agentPhase || '').toLowerCase();

  // 1. Active tool is the strongest signal — map honestly.
  const toolName = String(ctx.activeTool?.name || ctx.agentActivity?.tool || '').trim();
  if (toolName) {
    const target = sanitizeDisplayName(ctx.activeTool?.target ?? ctx.agentActivity?.target);
    const f = formatAgentActivity({
      tool: toolName,
      path: target,
      detail: ctx.activeTool?.label ?? ctx.agentActivity?.message,
    });
    // Prefer the tool's own truthful message when it already names the file,
    // otherwise compose verb + sanitized basename.
    if (!f.file) {
      const honest = sanitizeActivityMessage(ctx.activeTool?.label ?? ctx.agentActivity?.message);
      if (honest) return honest;
    }
    return renderActivityText(f);
  }

  // 2. Explicit agent lifecycle phase (real execution state, never simulated).
  const fromAgentPhase = agentPhase ? phaseLabel(agentPhase) : null;
  if (fromAgentPhase) return fromAgentPhase;
  const fromPhase = phase ? phaseLabel(phase) : null;
  if (fromPhase) return fromPhase;

  // 3. Applying state without tool detail.
  if (ctx.isApplying || phase === 'applying') return 'Applying code changes';

  // 4. Neutral fallback — never invent an operation or filename.
  return 'Working';
}

/**
 * Accept a controller-emitted stage message only when it is a known,
 * truthful stage label. Anything else is discarded so internal protocol
 * text can never leak into the UI.
 */
const HONEST_STAGE_MESSAGES = new Set([
  'Understanding your request',
  'Inspecting workspace',
  'Planning changes',
  'Reading relevant files',
  'Creating files',
  'Updating code',
  'Running checks',
  'Fixing reported issues',
  'Preparing final summary',
]);

function sanitizeActivityMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > 80 || /[\r\n\t{}"]/.test(t)) return null;
  if (HONEST_STAGE_MESSAGES.has(t)) return t;
  return null;
}

export function resolveAIActivity(context: ActivityContext): string {
  return getAIActivityLabel(context);
}
