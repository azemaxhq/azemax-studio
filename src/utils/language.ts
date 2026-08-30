/**
 * Central language normalization + display helpers.
 * Single source of truth — consumed by CodeEditor, AIAssistant, TerminalContext,
 * tripleSlashPipeline, and aiToolExecutor.
 */

/**
 * Comprehensive language map — covers all languages requested for IDE-grade support.
 * Keys are file extensions or common aliases, values are normalized Monaco language IDs.
 */
export const LANGUAGE_MAP: Record<string, string> = {
  // Web
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'html', htm: 'html', xhtml: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', jsonc: 'json',
  xml: 'xml', svg: 'xml', xsl: 'xml',
  // Systems / compiled
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', csharp: 'csharp',
  rs: 'rust', rust: 'rust',
  go: 'go',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  java: 'java',
  // Scripting
  py: 'python', pyw: 'python', python: 'python',
  rb: 'ruby', ruby: 'ruby',
  php: 'php', phtml: 'php',
  lua: 'lua',
  pl: 'perl', pm: 'perl', perl: 'perl',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell',
  ps1: 'powershell', psm1: 'powershell', powershell: 'powershell',
  // JVM / other
  scala: 'scala', sc: 'scala',
  groovy: 'groovy', gvy: 'groovy', gy: 'groovy',
  // Data / config
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  dockerfile: 'dockerfile',
  ini: 'ini', cfg: 'ini', conf: 'ini', gitconfig: 'ini', toml2: 'ini',
  makefile: 'makefile', mk: 'makefile',
  // Fallback / misc
  txt: 'plaintext', text: 'plaintext', log: 'plaintext',
};

export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return 'plaintext';
  const lower = String(lang).toLowerCase().trim();
  // Strip leading dot
  const cleaned = lower.startsWith('.') ? lower.slice(1) : lower;
  return LANGUAGE_MAP[cleaned] ?? cleaned;
}

export function getMonacoLanguage(lang: string | null | undefined): string {
  const normalized = normalizeLanguage(lang);
  // Monaco ships tokenizers for these IDs — map normalized → Monaco ID
  const monacoMap: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
    shell: 'shell',
    powershell: 'powershell',
    cpp: 'cpp',
    c: 'c',
    csharp: 'csharp',
    rust: 'rust',
    go: 'go',
    swift: 'swift',
    kotlin: 'kotlin',
    java: 'java',
    ruby: 'ruby',
    php: 'php',
    lua: 'lua',
    perl: 'perl',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    graphql: 'graphql',
    markdown: 'markdown',
    dockerfile: 'dockerfile',
    ini: 'ini',
    makefile: 'makefile',
    plaintext: 'plaintext',
    scala: 'scala',
    groovy: 'groovy',
  };
  return monacoMap[normalized] ?? 'plaintext';
}

/** Map filename → normalized language (extension + basename heuristics) */
export function getLanguageFromFilename(filename: string): string {
  if (!filename) return 'plaintext';
  const lower = filename.toLowerCase();
  const base = lower.split('/').pop() || lower;
  // Exact basename matches
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  if (base === '.gitconfig' || base === '.gitignore' || base.endsWith('.ini') || base.endsWith('.cfg')) {
    if (base.includes('git')) return 'ini';
  }
  const ext = base.includes('.') ? base.split('.').pop()! : base;
  return normalizeLanguage(ext);
}

export function getFileExtension(lang: string | null | undefined): string {
  const m: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    shell: 'sh',
    powershell: 'ps1',
    cpp: 'cpp',
    c: 'c',
    csharp: 'cs',
    rust: 'rs',
    go: 'go',
    swift: 'swift',
    kotlin: 'kt',
    java: 'java',
    ruby: 'rb',
    php: 'php',
    lua: 'lua',
    perl: 'pl',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    graphql: 'graphql',
    markdown: 'md',
    dockerfile: 'dockerfile',
    ini: 'ini',
    plaintext: 'txt',
    scala: 'scala',
    groovy: 'groovy',
  };
  return m[normalizeLanguage(lang)] ?? 'txt';
}

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP);
