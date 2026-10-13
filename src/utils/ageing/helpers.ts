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
