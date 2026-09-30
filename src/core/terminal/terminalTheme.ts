/**
 * Terminal theme — mirrors `vscode-main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts:1084 getXtermTheme`
 * and `src/vs/platform/theme/common/colorRegistry` / `IThemeService`.
 *
 * VS Code builds the xterm theme from `IColorTheme.getColor(terminalColorId)` and
 * `IXtermColorProvider.getBackgroundColor(theme)`, subscribing to `onDidColorThemeChange`.
 *
 * Azemax has no IThemeService; we derive the same colors from:
 *  - CSS variables `--az-surface`, `--az-text`, etc. (live theme, like `IColorTheme`)
 *  - `getSettings().general.theme` as fallback
 *  - Hard-coded Dark+ palette as final fallback (same 16 ANSI values VS Code uses)
 *
 * The function is dynamic (reads live CSS), and callers should re-call on theme change
 * (subscribe via `settingsStore.subscribe` on `general.theme` or via `MutationObserver` on
 * `data-theme` attribute — we expose a helper).
 */

import { getSettings } from '../../settings/settingsStore';
import { subscribe } from '../../settings/settingsStore';

type XtermTheme = Record<string, string | undefined>;

// Azemax terminal ANSI — calibrated for contrast and readability
const FALLBACK_ANSI = {
  black: '#0C1118',
  red: '#F47A85',          // error messages
  green: '#4EC994',         // exit code 0 / success
  yellow: '#E5C07B',        // warnings / stdin prompts
  blue: '#5B8CFF',          // links / info
  magenta: '#C678DD',       // special
  cyan: '#56D4E8',          // status lines ("Running...")
  white: '#ABB2BF',         // dim output / secondary text (distinct from foreground)
  brightBlack: '#5C6370',   // comments / muted
  brightRed: '#F28B82',
  brightGreen: '#66D9A6',
  brightYellow: '#ECD289',
  brightBlue: '#7FA9FF',
  brightMagenta: '#D19FFF',
  brightCyan: '#7EE8F5',    // bright status / highlights
  brightWhite: '#EAEEF4',   // primary foreground (used by bold text)
} as const;

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

export function getXtermTheme(): XtermTheme {
  const settingsTheme = getSettings().general.theme;
  // Prefer CSS variables (live theme), fall back to settings-driven palette
  const isDark = settingsTheme === 'dark' || (settingsTheme === 'auto' && (typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true));
  // Terminal lives on its own layer: #0C1118, never pure black
  const background = cssVar('--az-terminal-bg', isDark ? '#0C1118' : '#f8f9fa');
  // Foreground: bright enough to be clearly readable against the dark terminal bg
  const foreground = cssVar('--az-terminal-fg', isDark ? '#CDD6E0' : '#24292e');
  const selectionBackground = cssVar('--az-selection-bg', 'rgba(91,140,255,0.28)');
  // Cursor: Azemax bright accent for visibility
  const cursor = cssVar('--az-terminal-cursor', '#78A7FF');
  const cursorAccent = cssVar('--az-terminal-cursor-accent', background);

  return {
    background,
    foreground,
    cursor,
    cursorAccent,
    selectionBackground,
    // ANSI 0-15 — VS Code allows user override via terminal.integrated.minimumContrastRatio etc.,
    // but Azemax keeps the standard Dark+ set (configurable later via `terminal.ansi*` settings if needed)
    black: FALLBACK_ANSI.black,
    red: FALLBACK_ANSI.red,
    green: FALLBACK_ANSI.green,
    yellow: FALLBACK_ANSI.yellow,
    blue: FALLBACK_ANSI.blue,
    magenta: FALLBACK_ANSI.magenta,
    cyan: FALLBACK_ANSI.cyan,
    white: FALLBACK_ANSI.white,
    brightBlack: FALLBACK_ANSI.brightBlack,
    brightRed: FALLBACK_ANSI.brightRed,
    brightGreen: FALLBACK_ANSI.brightGreen,
    brightYellow: FALLBACK_ANSI.brightYellow,
    brightBlue: FALLBACK_ANSI.brightBlue,
    brightMagenta: FALLBACK_ANSI.brightMagenta,
    brightCyan: FALLBACK_ANSI.brightCyan,
    brightWhite: FALLBACK_ANSI.brightWhite,
  };
}

/**
 * Subscribe to theme changes (settingsStore `general.theme` + CSS `data-theme` attribute + `prefers-color-scheme`).
 * Mirrors `IThemeService.onDidColorThemeChange` used by `XtermTerminal._updateTheme`.
 * Returns a dispose function.
 */
export function onDidChangeTheme(callback: () => void): () => void {
  // 1) SettingsStore change
  const unsubStore = subscribe(callback);
  // 2) DOM attribute change (html[data-theme] or html.settings-*)
  let observer: MutationObserver | null = null;
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(callback);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }
  // 3) OS color-scheme change when theme === auto
  let media: MediaQueryList | null = null;
  let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    mediaHandler = () => {
      const t = getSettings().general.theme;
      if (t === 'auto') callback();
    };
    if (media.addEventListener) media.addEventListener('change', mediaHandler);
    else (media as unknown as { addListener: (h: () => void) => void }).addListener(mediaHandler as unknown as () => void);
  }
  return () => {
    unsubStore();
    observer?.disconnect();
    if (media && mediaHandler) {
      if ((media as unknown as { removeEventListener?: unknown }).removeEventListener) (media as MediaQueryList).removeEventListener('change', mediaHandler);
      else (media as unknown as { removeListener: (h: () => void) => void }).removeListener(mediaHandler as unknown as () => void);
    }
  };
}
