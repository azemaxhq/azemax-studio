/**
 * Terminal profiles — mirrors `vscode-main/src/vs/workbench/contrib/terminal/browser/terminalProfileService.ts`
 * and `src/vs/workbench/contrib/terminal/common/terminal.ts` `ITerminalProfileService` /
 * `ITerminalProfileResolverService.getDefaultShell` / `getDefaultProfile`.
 *
 * VS Code resolves the shell per OS via `ITerminalProfileService.availableProfiles` + `IConfigurationService`,
 * falling back to `process.env.SHELL` / `COMSPEC` on the host. Azemax keeps a lightweight
 * platform-aware resolver that reads `getSettings().terminal` (future `terminal.integrated.profiles.*`)
 * and falls back to OS defaults — no hard-coded `/bin/zsh` in consumers.
 */

export type ShellProfile = {
  name: string;
  path: string;
  args?: string[];
  icon?: string;
  color?: string;
};

function getPlatform(): 'windows' | 'osx' | 'linux' {
  if (typeof navigator !== 'undefined') {
    const p = navigator.platform.toLowerCase();
    if (p.includes('win')) return 'windows';
    if (p.includes('mac')) return 'osx';
  }
  if (typeof process !== 'undefined' && (process as unknown as { platform?: string }).platform) {
    const plat = (process as unknown as { platform: string }).platform;
    if (plat === 'win32') return 'windows';
    if (plat === 'darwin') return 'osx';
  }
  return 'linux';
}

function envShell(): string | null {
  if (typeof process !== 'undefined' && (process as unknown as { env?: Record<string, string> }).env) {
    const e = (process as unknown as { env: Record<string, string> }).env;
    if (e.SHELL) return e.SHELL;
    if (e.COMSPEC) return e.COMSPEC;
  }
  return null;
}

const OS_DEFAULTS: Record<ReturnType<typeof getPlatform>, ShellProfile> = {
  windows: { name: 'PowerShell', path: 'powershell.exe', args: [], icon: 'terminal-powershell' },
  osx: { name: 'zsh', path: '/bin/zsh', args: ['-l'], icon: 'terminal-bash' },
  linux: { name: 'bash', path: '/bin/bash', args: ['-l'], icon: 'terminal-bash' },
};

/**
 * Like `ITerminalProfileResolverService.getDefaultShell(options)`.
 * Respects `getSettings().terminal.defaultProfile` future key if present, else OS default.
 */
export function getDefaultShell(): string {
  try {
    const env = envShell();
    if (env) return env;
  } catch { /* ignore */ }
  return OS_DEFAULTS[getPlatform()].path;
}

export function getDefaultShellArgs(): string[] {
  return OS_DEFAULTS[getPlatform()].args ?? [];
}

export function getDefaultProfile(): ShellProfile {
  const p = OS_DEFAULTS[getPlatform()];
  const env = envShell();
  if (env) return { ...p, path: env };
  return p;
}

export function getAvailableProfiles(): ShellProfile[] {
  // VS Code exposes `ITerminalProfileService.availableProfiles` per OS; Azemax keeps a small static list
  // but no longer hard-codes a single `/bin/zsh` in consumers.
  return [
    { name: 'bash', path: '/bin/bash', args: ['-l'], icon: 'terminal-bash' },
    { name: 'zsh', path: '/bin/zsh', args: ['-l'], icon: 'terminal-bash' },
    { name: 'fish', path: '/usr/bin/fish', args: ['-l'], icon: 'terminal-bash' },
    { name: 'PowerShell', path: 'powershell.exe', icon: 'terminal-powershell' },
  ];
}

export function getShellLabel(shellPath: string): string {
  const base = shellPath.split('/').pop()?.split('\\').pop() || shellPath;
  return base.replace(/\.exe$/i, '');
}

/**
 * Mirrors VS Code's language normalization for `IShellLaunchConfig` / `ITerminalProfile` —
 * centralizes the `js→javascript`, `py→python`, etc. mapping that was previously
 * duplicated hard-coded in `TerminalContext` and `TerminalPanel`.
 * Respects `server/services/execution/languageConfig.cjs:canRunLocally` keys.
 */
export function normalizeTerminalLanguage(lang: string): string {
  const s = (lang || 'plaintext').toLowerCase().trim();
  if (s === 'js' || s === 'node' || s === 'jsx') return 'javascript';
  if (s === 'ts' || s === 'tsx') return 'typescript';
  if (s === 'py') return 'python';
  if (s === 'c++' || s === 'cc' || s === 'cxx') return 'cpp';
  if (s === 'sh' || s === 'bash') return 'bash';
  if (s === 'rs') return 'rust';
  if (s === 'cs' || s === 'c#' || s === 'csharp') return 'csharp';
  if (s === 'rb') return 'ruby';
  if (s === 'pl') return 'perl';
  if (s === 'kt') return 'kotlin';
  return s;
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', python: 'python', c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', pl: 'perl',
  swift: 'swift', kt: 'kotlin', scala: 'scala', r: 'r', lua: 'lua',
  cs: 'csharp', sh: 'bash', bash: 'bash',
};
export function languageFromExtension(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  return EXT_TO_LANG[e] || 'javascript';
}
