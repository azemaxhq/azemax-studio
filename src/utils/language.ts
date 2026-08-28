/**
 * Central language normalization + display helpers.
 * Single source of truth — consumed by CodeEditor, AIAssistant, TerminalContext,
 * tripleSlashPipeline, and aiToolExecutor.
 */

export const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'shell',
  shell: 'shell',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
};

export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return 'text';
  const lower = String(lang).toLowerCase().trim();
  return LANGUAGE_MAP[lower] ?? lower;
}

export function getMonacoLanguage(lang: string | null | undefined): string {
  const normalized = normalizeLanguage(lang);
  const monacoMap: Record<string, string> = {
    shell: 'shell',
    python: 'python',
    javascript: 'javascript',
    typescript: 'typescript',
    cpp: 'cpp',
    c: 'c',
    java: 'java',
    go: 'go',
    rust: 'rust',
    html: 'html',
    css: 'css',
    json: 'json',
    markdown: 'markdown',
  };
  return monacoMap[normalized] ?? 'plaintext';
}

export function getFileExtension(lang: string | null | undefined): string {
  const m: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    shell: 'sh',
    cpp: 'cpp',
    c: 'c',
    java: 'java',
    go: 'go',
    rust: 'rs',
    html: 'html',
    css: 'css',
    json: 'json',
  };
  return m[normalizeLanguage(lang)] ?? 'txt';
}

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP);
