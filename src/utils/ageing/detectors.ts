/**
 * Data-driven ageing signal detectors.
 * Each detector is a pure function: (lines, ctx) => { signal, hotspots }.
 * Keeps cyclomatic complexity per function ~10 instead of 170 in one monolith.
 */
import type { AgeingHotspot, AgeingSignal } from '../codeAnalysisEngine';

export interface DetectorContext {
  lines: string[];
  language: string;
  isJS: boolean;
  isTS: boolean;
  isPython: boolean;
  isJava: boolean;
  isCpp: boolean;
  isRust: boolean;
  isGo: boolean;
  loc: number;
}

export type Detector = (lines: string[], ctx: DetectorContext, hotspots: AgeingHotspot[]) => AgeingSignal | null;

const add = (hotspots: AgeingHotspot[], line: number, code: string, reason: string, severity: AgeingHotspot['severity'], id: string) =>
  hotspots.push({ line, code: code.slice(0, 80), reason, severity, signalId: id });

export const detectLegacyVar: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS) return null;
  let count = 0;
  lines.forEach((line, i) => {
    const m = line.match(/\bvar\s+/g);
    if (!m) return;
    count += m.length;
    add(hotspots, i + 1, line.trim(), 'Legacy `var` declaration — use `const` or `let`', 'high', 'legacy-var');
  });
  if (count === 0) return null;
  return {
    id: 'legacy-var', name: 'Legacy var Usage',
    description: 'Uses `var` instead of `const`/`let` (pre-ES6 pattern)',
    score: Math.min(100, count * 15), weight: 1.2, count,
    severity: count > 5 ? 'critical' : 'high', category: 'syntax', icon: '⚠️',
    recommendation: `Replace ${count} \`var\` declaration${count > 1 ? 's' : ''} with \`const\` or \`let\`.`,
    autoFixable: true,
  };
};

export const detectCallbackHell: Detector = (lines, _ctx, hotspots) => {
  let count = 0;
  const pat = /function\s*\(|=>\s*{/g;
  lines.forEach((line, i) => {
    const indent = line.search(/\S/);
    const has = pat.test(line);
    pat.lastIndex = 0;
    if (has && indent >= 16) {
      count++; add(hotspots, i + 1, line.trim(), 'Deeply nested callback — consider async/await or extracting functions', 'high', 'callback-hell');
    }
  });
  if (count === 0) return null;
  return {
    id: 'callback-hell', name: 'Callback Nesting',
    description: 'Deeply nested callbacks suggesting pre-Promise patterns',
    score: Math.min(100, count * 20), weight: 1.0, count,
    severity: count > 3 ? 'critical' : 'high', category: 'patterns', icon: '🔄',
    recommendation: 'Refactor nested callbacks using `async/await` or Promise chains.', autoFixable: false,
  };
};

export const detectMagicNumbers: Detector = (lines, _ctx, hotspots) => {
  const allowed = new Set(['0', '1', '2', '-1', '100', '0.5', '1000']);
  let count = 0;
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import')) return;
    if (/^(?:export\s+|public\s+|private\s+|protected\s+|static\s+|readonly\s+|final\s+)*(?:const\s+|let\s+|var\s+|int\s+|float\s+|double\s+)*[a-zA-Z_$][a-zA-Z0-9_$]*\s*(?::\s*[a-zA-Z_0-9<>[\]\s]+)?\s*=\s*[-+]?(?:0x[\da-fA-F]+|\d+\.?\d*)\s*;?$/.test(trimmed)) return;
    const nums = trimmed.match(/(?<![a-zA-Z_$\d.])(?:0x[\da-fA-F]+|\d+\.?\d*)(?![a-zA-Z_$\d.])/g);
    if (!nums) return;
    const magics = nums.filter(n => !allowed.has(n) && n.length < 8);
    if (magics.length === 0) return;
    count += magics.length;
    if (count <= 12) add(hotspots, i + 1, trimmed, `Magic number${magics.length > 1 ? 's' : ''}: ${magics.join(', ')} — extract to named constants`, 'medium', 'magic-numbers');
  });
  if (count <= 3) return null;
  return {
    id: 'magic-numbers', name: 'Magic Numbers',
    description: 'Hard-coded numeric literals without named constants',
    score: Math.min(100, count * 5), weight: 0.6, count,
    severity: count > 10 ? 'high' : 'medium', category: 'style', icon: '🔢',
    recommendation: `Extract ${count} magic numbers into named constants for better readability.`, autoFixable: false,
  };
};

export const detectConsole: Detector = (lines, _ctx, hotspots) => {
  let count = 0;
  lines.forEach((line, i) => {
    if (!/console\.(log|debug|info|warn|error)\s*\(/.test(line)) return;
    count++; if (count <= 5) add(hotspots, i + 1, line.trim(), 'Debug console statement left in code', 'low', 'console-statements');
  });
  if (count <= 2) return null;
  return {
    id: 'console-statements', name: 'Console Statements',
    description: 'Debug logging left in production code',
    score: Math.min(100, count * 8), weight: 0.4, count,
    severity: count > 8 ? 'medium' : 'low', category: 'style', icon: '📝',
    recommendation: `Remove ${count} console statements from production code.`, autoFixable: true,
  };
};

export const detectLongFunctions: Detector = (lines, _ctx, hotspots) => {
  let count = 0; let start = -1; let depth = 0; let name = '';
  const pat = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))/;
  lines.forEach((line, i) => {
    const m = line.match(pat);
    if (m && depth === 0) { start = i; name = m[1] || m[2] || 'anonymous'; depth = 0; }
    depth += (line.match(/{/g) || []).length;
    depth -= (line.match(/}/g) || []).length;
    if (start >= 0 && depth <= 0) {
      const len = i - start + 1;
      if (len > 40) { count++; add(hotspots, start + 1, `${name}() — ${len} lines`, `Function is ${len} lines long — consider splitting into smaller functions`, len > 80 ? 'critical' : 'high', 'long-functions'); }
      start = -1; depth = 0;
    }
  });
  if (count === 0) return null;
  return {
    id: 'long-functions', name: 'Long Functions',
    description: 'Functions exceeding 40 lines, reducing readability',
    score: Math.min(100, count * 18), weight: 0.9, count,
    severity: count > 3 ? 'critical' : 'high', category: 'structure', icon: '📏',
    recommendation: `Break down ${count} long function${count > 1 ? 's' : ''} into smaller, focused helper functions.`, autoFixable: false,
  };
};

export const detectDeprecatedApis: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS) return null;
  let count = 0;
  const pats: { re: RegExp; name: string }[] = [
    { re: /document\.write\s*\(/, name: 'document.write()' },
    { re: /\.substr\s*\(/, name: '.substr() — use .slice()' },
    { re: /new\s+Date\(\)\.getYear\(\)/, name: '.getYear() — use .getFullYear()' },
    { re: /\.fontcolor\s*\(|\.fontsize\s*\(/, name: 'String HTML methods' },
    { re: /escape\s*\(|unescape\s*\(/, name: 'escape()/unescape()' },
    { re: /arguments\s*\[/, name: 'arguments[] — use rest params' },
    { re: /eval\s*\(/, name: 'eval() — avoid for security' },
    { re: /with\s*\(/, name: 'with statement — deprecated' },
    { re: /__proto__/, name: '__proto__ — use Object.getPrototypeOf()' },
  ];
  lines.forEach((line, i) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    for (const p of pats) if (p.re.test(line)) {
      count++; add(hotspots, i + 1, line.trim(), `Deprecated API: ${p.name}`, 'critical', 'deprecated-apis');
    }
  });
  if (count === 0) return null;
  return {
    id: 'deprecated-apis', name: 'Deprecated APIs',
    description: 'Uses deprecated or obsolete JavaScript APIs',
    score: Math.min(100, count * 25), weight: 1.5, count,
    severity: 'critical', category: 'syntax', icon: '🚫',
    recommendation: `Replace ${count} deprecated API usage${count > 1 ? 's' : ''} with modern equivalents.`, autoFixable: false,
  };
};

export const detectWeakTyping: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isTS) return null;
  let c = 0; lines.forEach((line, i) => {
    if (!/:\s*any\b/.test(line) && !/as\s+any\b/.test(line)) return;
    c++; if (c <= 5) add(hotspots, i + 1, line.trim(), 'Using `any` type — provide explicit types', 'medium', 'weak-typing');
  });
  if (c === 0) return null;
  return {
    id: 'weak-typing', name: 'Weak Typing',
    description: 'Uses `any` type which defeats TypeScript safety',
    score: Math.min(100, c * 12), weight: 0.8, count: c,
    severity: c > 5 ? 'high' : 'medium', category: 'syntax', icon: '🏷️',
    recommendation: `Replace ${c} \`any\` type${c > 1 ? 's' : ''} with explicit type annotations.`, autoFixable: false,
  };
};

export const detectStringConcat: Detector = (lines, _ctx, hotspots) => {
  let count = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/["']\s*\+\s*\w|(\w)\s*\+\s*["']/.test(line) || line.includes('`')) return;
    count++; if (count <= 5) add(hotspots, i + 1, t, 'String concatenation — use template literals', 'low', 'string-concat');
  });
  if (count <= 2) return null;
  return {
    id: 'string-concat', name: 'String Concatenation',
    description: 'Uses + for strings instead of ES6 template literals',
    score: Math.min(100, count * 8), weight: 0.5, count,
    severity: 'low', category: 'syntax', icon: '🔗',
    recommendation: `Convert ${count} string concatenation${count > 1 ? 's' : ''} to template literals.`, autoFixable: true,
  };
};

export const detectDuplicatedCode: Detector = (lines, _ctx, hotspots) => {
  let count = 0; const map = new Map<string, number[]>();
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length <= 20 || t.startsWith('//') || t.startsWith('*') || t.startsWith('import')) return;
    const prev = map.get(t);
    if (prev) { prev.push(i + 1); if (prev.length === 2) { count++; add(hotspots, i + 1, t, `Duplicate code — also on line ${prev[0]}`, 'medium', 'duplicated-code'); } }
    else map.set(t, [i + 1]);
  });
  if (count <= 2) return null;
  return {
    id: 'duplicated-code', name: 'Duplicated Code',
    description: 'Identical code blocks found at multiple locations',
    score: Math.min(100, count * 10), weight: 0.7, count,
    severity: count > 5 ? 'high' : 'medium', category: 'structure', icon: '📋',
    recommendation: `Extract ${count} duplicated code pattern${count > 1 ? 's' : ''} into shared utility functions.`, autoFixable: false,
  };
};

export const detectTodos: Detector = (lines, _ctx, hotspots) => {
  let count = 0; lines.forEach((line, i) => {
    if (!/\b(TODO|FIXME|HACK|XXX|BUG|TEMP)\b/i.test(line)) return;
    count++; if (count <= 5) add(hotspots, i + 1, line.trim(), 'Unresolved marker comment — address or remove', 'medium', 'todo-markers');
  });
  if (count === 0) return null;
  return {
    id: 'todo-markers', name: 'TODO/FIXME Markers',
    description: 'Unresolved development markers left in code',
    score: Math.min(100, count * 10), weight: 0.5, count,
    severity: count > 5 ? 'high' : 'medium', category: 'style', icon: '📌',
    recommendation: `Address ${count} TODO/FIXME marker${count > 1 ? 's' : ''} — resolve or create tickets.`, autoFixable: false,
  };
};

export const detectLargeFile: Detector = (_lines, ctx, _hotspots) => {
  if (ctx.loc <= 200) return null;
  const score = Math.min(100, Math.round((ctx.loc - 200) / 3));
  return {
    id: 'large-file', name: 'Large File',
    description: `File has ${ctx.loc} lines — consider splitting`,
    score, weight: 0.6, count: 1,
    severity: ctx.loc > 500 ? 'critical' : ctx.loc > 300 ? 'high' : 'medium',
    category: 'structure', icon: '📄',
    recommendation: `Split this ${ctx.loc}-line file into smaller, focused modules.`, autoFixable: false,
  };
};

export const detectEmptyCatch: Detector = (lines, _ctx, hotspots) => {
  let c = 0; lines.forEach((line, i) => {
    if (!/catch\s*\(/.test(line)) return;
    const nxt = lines[i + 1]?.trim() || '';
    if (nxt !== '}' && !nxt.startsWith('//') && nxt !== '') return;
    c++; add(hotspots, i + 1, line.trim(), 'Empty catch block — silently swallowing errors', 'high', 'empty-catch');
  });
  if (c === 0) return null;
  return {
    id: 'empty-catch', name: 'Empty Catch Blocks',
    description: 'Catch blocks that silently swallow errors',
    score: Math.min(100, c * 25), weight: 1.0, count: c,
    severity: 'high', category: 'security', icon: '🛡️',
    recommendation: `Handle errors properly in ${c} empty catch block${c > 1 ? 's' : ''}.`, autoFixable: false,
  };
};

export const detectCommonJsRequire: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS) return null;
  let count = 0; lines.forEach((line, i) => {
    if (!/\brequire\s*\(/.test(line) || line.trim().startsWith('//')) return;
    count++; if (count <= 3) add(hotspots, i + 1, line.trim(), 'CommonJS require() — use ES module import', 'medium', 'commonjs-require');
  });
  if (count === 0) return null;
  return {
    id: 'commonjs-require', name: 'CommonJS Imports',
    description: 'Uses require() instead of ES module imports',
    score: Math.min(100, count * 15), weight: 0.7, count,
    severity: count > 3 ? 'high' : 'medium', category: 'patterns', icon: '📦',
    recommendation: `Migrate ${count} require() call${count > 1 ? 's' : ''} to ES module \`import\` statements.`, autoFixable: false,
  };
};

export const detectLooseEquality: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS && ctx.language !== 'php') return null;
  let count = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    const m = line.match(/[^!=]==[^=]/g); if (!m) return;
    count += m.length; if (count <= 5) add(hotspots, i + 1, t, 'Loose equality `==` — use strict `===`', 'medium', 'loose-equality');
  });
  if (count === 0) return null;
  return {
    id: 'loose-equality', name: 'Loose Equality',
    description: 'Uses == instead of === for comparisons',
    score: Math.min(100, count * 10), weight: 0.6, count,
    severity: count > 5 ? 'high' : 'medium', category: 'patterns', icon: '⚖️',
    recommendation: `Replace ${count} loose equality \`==\` check${count > 1 ? 's' : ''} with strict \`===\`.`, autoFixable: true,
  };
};

export const detectInnerHtml: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS) return null;
  let count = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/\.innerHTML\s*=/.test(line) && !/dangerouslySetInnerHTML/.test(line)) return;
    count++; add(hotspots, i + 1, t, 'Direct innerHTML / dangerouslySetInnerHTML — XSS risk; use safe APIs or sanitize', 'critical', 'inner-html');
  });
  if (count === 0) return null;
  return {
    id: 'inner-html', name: 'Unsafe HTML Injection',
    description: 'Assigning to innerHTML or using dangerouslySetInnerHTML without sanitization',
    score: Math.min(100, count * 30), weight: 1.4, count,
    severity: 'critical', category: 'security', icon: '🔓',
    recommendation: `Replace ${count} unsafe HTML assignment${count > 1 ? 's' : ''} with textContent, safe DOM APIs, or a sanitization library.`, autoFixable: false,
  };
};

export const detectDeepNesting: Detector = (lines, _ctx, hotspots) => {
  let depth = 0, max = 0; const deep: number[] = [];
  lines.forEach((line, i) => {
    depth += (line.match(/{/g) || []).length;
    depth -= (line.match(/}/g) || []).length;
    if (depth > max) max = depth;
    if (depth > 4) deep.push(i + 1);
  });
  if (max <= 4 || deep.length === 0) return null;
  deep.slice(0, 5).forEach(n => {
    const line = lines[n - 1] || '';
    add(hotspots, n, line.trim(), `Deep nesting (depth > 4) — consider extracting functions or early returns`, max > 6 ? 'high' : 'medium', 'deep-nesting');
  });
  return {
    id: 'deep-nesting', name: 'Deep Nesting',
    description: 'Excessive brace/block nesting reduces readability and testability',
    score: Math.min(100, (max - 4) * 15 + deep.length * 3), weight: 0.8, count: deep.length,
    severity: max > 6 ? 'high' : 'medium', category: 'structure', icon: '📐',
    recommendation: `Reduce nesting at ${deep.length} location${deep.length > 1 ? 's' : ''} using early returns, guards, or extracted functions.`, autoFixable: false,
  };
};

// Language-specific detectors kept concise via same pattern — python/java/cpp/rust/go
export const detectPythonPrint: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isPython) return null;
  let c = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('#')) return;
    if (!/\bprint\s*\(/.test(line)) return;
    c++; if (c <= 5) add(hotspots, i + 1, t, 'print() in module — use logging for production', 'low', 'python-print');
  });
  if (c <= 2) return null;
  return { id: 'python-print', name: 'Print in Module', description: 'Use of print() instead of logging', score: Math.min(100, c * 8), weight: 0.4, count: c, severity: c > 10 ? 'medium' : 'low', category: 'style', icon: '🐍', recommendation: `Replace ${c} print() call${c > 1 ? 's' : ''} with logging module.`, autoFixable: false };
};

export const detectPythonFormat: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isPython) return null;
  let c = 0; lines.forEach((line, i) => {
    if (line.trim().startsWith('#')) return;
    if (!/%\s*[sdfe]/.test(line) && !/\.format\s*\(/.test(line)) return;
    c++; if (c <= 3) add(hotspots, i + 1, line.trim(), 'Old-style % or .format() — prefer f-strings', 'low', 'python-format');
  });
  if (c === 0) return null;
  return { id: 'python-format', name: 'Legacy String Formatting', description: 'Uses % or .format() instead of f-strings', score: Math.min(100, c * 12), weight: 0.5, count: c, severity: 'low', category: 'syntax', icon: '📎', recommendation: `Convert ${c} string format${c > 1 ? 's' : ''} to f-strings.`, autoFixable: false };
};

export const detectPromiseChains: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS) return null;
  let chains = 0;
  lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/\.then\s*\(/.test(line)) return;
    chains++; if (chains <= 3) add(hotspots, i + 1, t, 'Promise .then() chain — consider async/await', 'low', 'promise-chains');
  });
  if (chains <= 2) return null;
  return { id: 'promise-chains', name: 'Promise Chains', description: 'Uses .then() chains instead of async/await', score: Math.min(100, chains * 6), weight: 0.4, count: chains, severity: 'low', category: 'patterns', icon: '⛓️', recommendation: `Convert ${chains} .then() chain${chains > 1 ? 's' : ''} to async/await.`, autoFixable: false };
};

export const detectJavaRawTypes: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJava) return null;
  let c = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/List|Map|Set|Collection|Queue|Deque/.test(line) || /<.*>/.test(line)) return;
    c++; if (c <= 3) add(hotspots, i + 1, t, 'Raw type usage — use generics for type safety', 'medium', 'raw-types');
  });
  if (c === 0) return null;
  return { id: 'raw-types', name: 'Raw Types', description: 'Uses raw types instead of parameterized generics', score: Math.min(100, c * 15), weight: 0.8, count: c, severity: c > 3 ? 'high' : 'medium', category: 'syntax', icon: '☕', recommendation: `Add type parameters to ${c} raw type${c > 1 ? 's' : ''}.`, autoFixable: false };
};

export const detectJavaLegacyCollections: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJava) return null;
  let c = 0; lines.forEach((line, i) => {
    if (!/Vector|Hashtable|Enumeration/.test(line)) return;
    c++; add(hotspots, i + 1, line.trim(), 'Legacy collection class — use modern alternatives', 'high', 'legacy-collections');
  });
  if (c === 0) return null;
  return { id: 'legacy-collections', name: 'Legacy Collections', description: 'Uses deprecated Vector/Hashtable instead of ArrayList/HashMap', score: Math.min(100, c * 20), weight: 1.1, count: c, severity: 'critical', category: 'patterns', icon: '🗃️', recommendation: `Replace ${c} legacy collection${c > 1 ? 's' : ''} with modern equivalents.`, autoFixable: false };
};

export const detectCppCasts: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isCpp) return null;
  let c = 0; lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/^\s*\([^)]+\)\s*\w+/.test(line) || /reinterpret_cast|static_cast|dynamic_cast|const_cast/.test(line)) return;
    c++; if (c <= 3) add(hotspots, i + 1, t, 'C-style cast — use C++ cast operators', 'medium', 'c-style-casts');
  });
  if (c === 0) return null;
  return { id: 'c-style-casts', name: 'C-Style Casts', description: 'Uses C-style casts instead of C++ cast operators', score: Math.min(100, c * 12), weight: 0.7, count: c, severity: c > 5 ? 'high' : 'medium', category: 'patterns', icon: '🔄', recommendation: `Replace ${c} C-style cast${c > 1 ? 's' : ''} with C++ cast operators.`, autoFixable: false };
};

export const detectCppMalloc: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isCpp) return null;
  let c = 0; lines.forEach((line, i) => {
    if (!/malloc\s*\(|free\s*\(|calloc\s*\(|realloc\s*\(/.test(line)) return;
    c++; add(hotspots, i + 1, line.trim(), 'C-style memory management — use RAII/smart pointers', 'critical', 'c-memory');
  });
  if (c === 0) return null;
  return { id: 'c-memory', name: 'C Memory Management', description: 'Uses malloc/free instead of RAII and smart pointers', score: Math.min(100, c * 25), weight: 1.3, count: c, severity: 'critical', category: 'patterns', icon: '🧠', recommendation: `Replace ${c} C-style memory allocation${c > 1 ? 's' : ''} with RAII patterns.`, autoFixable: false };
};

export const detectRustUnwrap: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isRust) return null;
  let c = 0; lines.forEach((line, i) => {
    if (!/\.unwrap\s*\(\)/.test(line)) return;
    c++; if (c <= 5) add(hotspots, i + 1, line.trim(), 'unwrap() call — handle errors gracefully', 'medium', 'unwrap-usage');
  });
  if (c <= 2) return null;
  return { id: 'unwrap-usage', name: 'Excessive unwrap()', description: 'Uses unwrap() which can cause panics', score: Math.min(100, c * 8), weight: 0.9, count: c, severity: c > 10 ? 'high' : 'medium', category: 'patterns', icon: '📦', recommendation: `Replace ${c} unwrap() call${c > 1 ? 's' : ''} with proper error handling.`, autoFixable: false };
};

export const detectGoGoroutines: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isGo) return null;
  let c = 0; lines.forEach((line, i) => {
    if (!/go\s+\w+\(/.test(line)) return;
    c++; if (c <= 3) add(hotspots, i + 1, line.trim(), 'Goroutine without proper lifecycle management', 'medium', 'goroutine-leaks');
  });
  if (c <= 2) return null;
  return { id: 'goroutine-leaks', name: 'Unmanaged Goroutines', description: 'Goroutines without proper lifecycle management', score: Math.min(100, c * 12), weight: 0.8, count: c, severity: c > 5 ? 'high' : 'medium', category: 'structure', icon: '🐹', recommendation: `Add proper lifecycle management for ${c} goroutine${c > 1 ? 's' : ''}.`, autoFixable: false };
};

export const detectMissingDocs: Detector = (lines, _ctx, _hotspots) => {
  let documented = 0, total = 0; let hasDoc = false;
  lines.forEach((line) => {
    const t = line.trim();
    if (t.startsWith('/**')) hasDoc = true;
    if (/function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|class\s+\w+|interface\s+\w+|type\s+\w+/.test(line)) {
      total++; if (hasDoc) documented++; hasDoc = false;
    }
    if (!t.startsWith('*') && !t.startsWith('/**') && !t.startsWith('*/') && t !== '') {
      if (!/function|const|class|interface|type/.test(t)) hasDoc = false;
    }
  });
  const undoc = total - documented;
  if (total <= 3 || undoc <= total * 0.5) return null;
  return { id: 'missing-documentation', name: 'Missing Documentation', description: 'Functions lack JSDoc/TSDoc comments', score: Math.min(100, Math.round((undoc / total) * 80)), weight: 0.3, count: undoc, severity: 'low', category: 'style', icon: '📝', recommendation: `Add JSDoc comments to ${undoc} undocumented function${undoc > 1 ? 's' : ''}.`, autoFixable: false };
};

export const detectNaming: Detector = (lines, ctx, hotspots) => {
  if (!ctx.isJS && !ctx.isTS) return null;
  const issues: { line: number; issue: string }[] = [];
  lines.forEach((line, i) => {
    const t = line.trim(); if (t.startsWith('//') || t.startsWith('*') || t.startsWith('import')) return;
    if (/const\s+[a-z][a-zA-Z0-9]*\s*=/.test(line) && !/[a-z]/.test(line.match(/const\s+([a-zA-Z0-9_]+)/)?.[1] || '')) issues.push({ line: i + 1, issue: 'Constant should use UPPER_SNAKE_CASE' });
    if (/class\s+[a-z]/.test(line)) issues.push({ line: i + 1, issue: 'Class should use PascalCase' });
    if (/function\s+[A-Z_]/.test(line) || /(?:const|let|var)\s+[A-Z_]/.test(line)) issues.push({ line: i + 1, issue: 'Function/variable should use camelCase' });
  });
  if (issues.length <= 3) return null;
  issues.slice(0, 5).forEach(iss => add(hotspots, iss.line, (lines[iss.line - 1] || '').trim(), iss.issue, 'low', 'naming-conventions'));
  return { id: 'naming-conventions', name: 'Naming Convention Issues', description: 'Inconsistent naming conventions detected', score: Math.min(100, issues.length * 4), weight: 0.3, count: issues.length, severity: 'low', category: 'style', icon: '🏷️', recommendation: `Fix ${issues.length} naming convention issue${issues.length > 1 ? 's' : ''}.`, autoFixable: false };
};

export const ALL_DETECTORS: Detector[] = [
  detectLegacyVar, detectCallbackHell, detectMagicNumbers, detectConsole, detectLongFunctions,
  detectDeprecatedApis, detectWeakTyping, detectStringConcat, detectDuplicatedCode, detectTodos,
  detectLargeFile, detectEmptyCatch, detectCommonJsRequire, detectLooseEquality, detectInnerHtml,
  detectDeepNesting, detectPythonPrint, detectPythonFormat, detectPromiseChains,
  detectJavaRawTypes, detectJavaLegacyCollections, detectCppCasts, detectCppMalloc,
  detectRustUnwrap, detectGoGoroutines, detectMissingDocs, detectNaming,
];
