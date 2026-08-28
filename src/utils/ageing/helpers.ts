import type { AgeingHotspot, AgeingSignal } from '../codeAnalysisEngine';

export type HotspotList = AgeingHotspot[];

export function pushHotspot(
  list: HotspotList,
  line: number,
  code: string,
  reason: string,
  severity: AgeingHotspot['severity'],
  signalId: string,
  opts: { trim?: boolean; cap?: number } = {},
): void {
  if (opts.cap !== undefined && list.filter(h => h.signalId === signalId).length >= opts.cap) return;
  list.push({
    line,
    code: opts.trim === false ? code : code.trim().slice(0, 80),
    reason,
    severity,
    signalId,
  });
}

export function makeSignal(
  id: string,
  partial: Omit<AgeingSignal, 'id'> & { count: number },
): AgeingSignal | null {
  if (partial.count === 0) return null;
  return { id, ...partial };
}

export function isCommentOrImport(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('import');
}

export function categorizeLanguage(lang: string) {
  const lower = lang.toLowerCase();
  return {
    lang: lower,
    isJS: ['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'].includes(lower),
    isTS: ['typescript', 'ts', 'tsx'].includes(lower),
    isPython: lower === 'python',
    isJava: lower === 'java',
    isCpp: lower === 'cpp' || lower === 'c++',
    isRust: lower === 'rust',
    isGo: lower === 'go',
  };
}
