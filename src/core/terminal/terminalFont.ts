/**
 * Terminal font metrics — mirrors `vscode-main/src/vs/workbench/contrib/terminal/browser/terminalConfigurationService.ts`:
 *  - `TerminalFontMetrics.getFont` (family fallback, size clamp 6-100, letterSpacing MINIMUM, lineHeight DEFAULT,
 *    AppleBraille on mac, devicePixelRatio-aware charWidth/charHeight)
 *  - `configFontIsMonospace` via 'i' vs 'w' bounding rect
 *  - Constants: DEFAULT_LETTER_SPACING, MINIMUM_LETTER_SPACING, DEFAULT_LINE_HEIGHT
 *
 * Azemax uses plain settings (no IConfigurationService); the helpers read `getSettings().terminal`
 * so ShellTerminal stays thin and all VS Code alignment lives here.
 */

import { getSettings } from '../../settings/settingsStore';

export const DEFAULT_LETTER_SPACING = 0;
export const MINIMUM_LETTER_SPACING = -5;
export const DEFAULT_LINE_HEIGHT = 1; // VS Code: isLinux ? 1.1 : 1 — detection below
export const MINIMUM_FONT_WEIGHT = 1;
export const MAXIMUM_FONT_WEIGHT = 1000;
export const DEFAULT_FONT_WEIGHT = 'normal' as const;
export const DEFAULT_BOLD_FONT_WEIGHT = 'bold' as const;

function isLinux(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /linux/i.test(navigator.platform) || /linux/i.test(navigator.userAgent);
}

function isMacintosh(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampInt(source: string | number | undefined, min: number, max: number, fallback: number): number {
  if (source === null || source === undefined) return fallback;
  const r = typeof source === 'string' ? parseInt(source, 10) : source;
  if (isNaN(r as number)) return fallback;
  return clamp(r as number, min, max);
}

type ITerminalFont = {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  fontWeight: string | number;
  fontWeightBold: string | number;
  charWidth?: number;
  charHeight?: number;
};

// Hidden measure element — created lazily, reused (like VS Code's _charMeasureElement)
let measureEl: HTMLDivElement | null = null;
function ensureMeasureEl(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (measureEl && measureEl.parentElement) return measureEl;
  measureEl = document.createElement('div');
  measureEl.style.position = 'absolute';
  measureEl.style.top = '-9999px';
  measureEl.style.left = '-9999px';
  measureEl.style.visibility = 'hidden';
  measureEl.style.pointerEvents = 'none';
  measureEl.style.whiteSpace = 'nowrap';
  document.body.appendChild(measureEl);
  return measureEl;
}

function getBoundingRectFor(char: string, fontFamily: string, fontSize: number): DOMRect | undefined {
  const el = ensureMeasureEl();
  if (!el) return undefined;
  el.style.display = 'inline-block';
  el.style.fontFamily = fontFamily;
  el.style.fontSize = fontSize + 'px';
  el.style.lineHeight = 'normal';
  el.style.fontWeight = 'normal';
  el.textContent = char;
  const rect = el.getBoundingClientRect();
  el.style.display = 'none';
  return rect;
}

/**
 * Mirrors `TerminalFontMetrics.configFontIsMonospace()` — measures 'i' vs 'w' at 15px.
 * Returns true if widths equal or measurement unavailable.
 */
export function configFontIsMonospace(): boolean {
  try {
    const s = getSettings();
    const rawFamily = s.terminal.fontFamily || s.editor.fontFamily || 'monospace';
    const testFamily = rawFamily + ', monospace';
    const iRect = getBoundingRectFor('i', testFamily, 15);
    const wRect = getBoundingRectFor('w', testFamily, 15);
    if (!iRect || !wRect || !iRect.width || !wRect.width) return true;
    return iRect.width === wRect.width;
  } catch {
    return true;
  }
}

function normalizeFontWeight(input: unknown, fallback: string | number): string | number {
  if (input === 'normal' || input === 'bold') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return clamp(input, MINIMUM_FONT_WEIGHT, MAXIMUM_FONT_WEIGHT);
  if (typeof input === 'string') {
    const n = parseInt(input, 10);
    if (!isNaN(n)) return clamp(n, MINIMUM_FONT_WEIGHT, MAXIMUM_FONT_WEIGHT);
    if (input === 'normal' || input === 'bold') return input;
  }
  return fallback;
}

/**
 * Mirrors `TerminalFontMetrics.getFont(window, xtermCore?, excludeDimensions?)`
 * — family fallback, size clamp, letterSpacing/lineHeight defaults, AppleBraille, devicePixelRatio.
 */
export function getTerminalFont(excludeDimensions = false): ITerminalFont {
  const s = getSettings();
  const t = s.terminal as unknown as Record<string, unknown>;
  // Family: terminal.fontFamily || editor.fontFamily || 'monospace' + fallbacks
  let fontFamily = (t.fontFamily as string) || (s.editor.fontFamily as string) || 'monospace';
  // Always fallback to monospace per VS Code, plus AppleBraille on mac
  if (!/monospace/i.test(fontFamily)) fontFamily += ', monospace';
  if (isMacintosh()) fontFamily += ', AppleBraille';

  const fontSize = clampInt(t.fontSize as number, 6, 100, 14);
  const letterSpacing = t.letterSpacing !== undefined
    ? Math.max(Math.floor(t.letterSpacing as number), MINIMUM_LETTER_SPACING)
    : DEFAULT_LETTER_SPACING;
  const lineHeightRaw = t.lineHeight as number | undefined;
  const defaultLH = isLinux() ? 1.1 : 1;
  const lineHeight = lineHeightRaw ? Math.max(lineHeightRaw, 1) : defaultLH;

  const fontWeight = normalizeFontWeight(t.fontWeight, DEFAULT_FONT_WEIGHT);
  const fontWeightBold = normalizeFontWeight(t.fontWeightBold, DEFAULT_BOLD_FONT_WEIGHT);

  if (excludeDimensions) {
    return { fontFamily, fontSize, letterSpacing, lineHeight, fontWeight, fontWeightBold };
  }

  // Try to get cell dims from xtermCore if available — caller can pass pre-measured cell; otherwise measure ourselves
  // Fallback to DOM measurement (like VS Code's _measureFont)
  const w = typeof window !== 'undefined' ? window : ({} as Window);
  const dpr = (w as unknown as { devicePixelRatio?: number }).devicePixelRatio || 1;
  const rect = getBoundingRectFor('X', fontFamily, fontSize);
  let charWidth: number | undefined;
  let charHeight: number | undefined;
  if (rect && rect.width && rect.height) {
    charHeight = Math.ceil(rect.height);
    // VS Code: GPU off uses rect.width directly; GPU on uses devicePixelRatio correction
    // We mimic the GPU-on path (the common case) to keep fit calculations retina-aware
    const deviceCharWidth = Math.floor(rect.width * dpr);
    const deviceCellWidth = deviceCharWidth + Math.round(letterSpacing);
    const cssCellWidth = deviceCellWidth / dpr;
    charWidth = cssCellWidth - Math.round(letterSpacing) / dpr;
    // letterSpacing already subtracted to get content width, matching VS Code's charWidth
  }

  return { fontFamily, fontSize, letterSpacing, lineHeight, fontWeight, fontWeightBold, charWidth, charHeight };
}

/**
 * Minimal helper for xterm's `font` initialization — returns the subset xterm needs
 * plus the full ITerminalFont for consumers that want metrics.
 */
export function getXtermFontOptions(): ITerminalFont {
  return getTerminalFont(false);
}
