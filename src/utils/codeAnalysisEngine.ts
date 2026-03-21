
export interface CodeSmell {
    id: string;
    message: string;
    line?: number;
    severity: 'info' | 'warning' | 'error';
}

export interface HalsteadMetrics {
    vocabulary: number;
    length: number;
    volume: number;
    difficulty: number;
    effort: number;
}

// ── Code Ageing Types ──

export interface AgeingSignal {
    id: string;
    name: string;
    description: string;
    score: number;       // 0-100 contribution to ageing
    weight: number;      // multiplier for final score
    count: number;       // number of occurrences found
    severity: 'low' | 'medium' | 'high' | 'critical';
    category: 'syntax' | 'patterns' | 'structure' | 'style' | 'security';
    icon: string;        // emoji icon for the UI
    recommendation: string;  // actionable fix suggestion
    autoFixable: boolean;    // true if can be fixed programmatically
}

export interface AgeingHotspot {
    line: number;
    code: string;
    reason: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    signalId: string;
}

export type AgeingGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface CodeAgeingResult {
    overallScore: number;           // 0-100 (0 = fresh, 100 = legacy)
    grade: AgeingGrade;
    gradeLabel: string;
    signals: AgeingSignal[];        // all detected signals
    hotspots: AgeingHotspot[];      // line-level hotspots
    summary: string;                // human-friendly summary
    categoryScores: {
        syntax: number;
        patterns: number;
        structure: number;
        style: number;
        security: number;
    };
}

export interface AnalysisResult {
    complexity: 'Low' | 'Medium' | 'High';
    maintainability: number; // 0-100
    codeAgeing: number; // 0-100 (0 = fresh, 100 = legacy)
    healthScore: number; // 0-100 (100 = perfect)
    syntaxValid: boolean;
    suggestions: string[];
    smells: CodeSmell[];
    halstead: HalsteadMetrics;
    ageingDetails: CodeAgeingResult; // full ageing breakdown
}

// ── Code Ageing Engine ──

function computeCodeAgeing(lines: string[], language: string): CodeAgeingResult {
    const lang = language.toLowerCase();
    const isJS = ['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'].includes(lang);
    const isTS = ['typescript', 'ts', 'tsx'].includes(lang);
    const isPython = lang === 'python';
    const signals: AgeingSignal[] = [];
    const hotspots: AgeingHotspot[] = [];
    const loc = lines.length;

    // ────────────────────────────────────────────
    // SIGNAL 1: Legacy var declarations
    // ────────────────────────────────────────────
    if (isJS) {
        let count = 0;
        lines.forEach((line, i) => {
            const matches = line.match(/\bvar\s+/g);
            if (matches) {
                count += matches.length;
                hotspots.push({
                    line: i + 1,
                    code: line.trim(),
                    reason: 'Legacy `var` declaration — use `const` or `let`',
                    severity: 'high',
                    signalId: 'legacy-var'
                });
            }
        });
        if (count > 0) {
            signals.push({
                id: 'legacy-var',
                name: 'Legacy var Usage',
                description: 'Uses `var` instead of `const`/`let` (pre-ES6 pattern)',
                score: Math.min(100, count * 15),
                weight: 1.2,
                count,
                severity: count > 5 ? 'critical' : 'high',
                category: 'syntax',
                icon: '⚠️',
                recommendation: `Replace ${count} \`var\` declaration${count > 1 ? 's' : ''} with \`const\` or \`let\`.`,
                autoFixable: true
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 2: Callback hell / deeply nested callbacks
    // ────────────────────────────────────────────
    {
        let count = 0;
        const callbackPattern = /function\s*\(|=>\s*{/g;
        lines.forEach((line, i) => {
            const indent = line.search(/\S/);
            const hasCallback = callbackPattern.test(line);
            callbackPattern.lastIndex = 0;
            if (hasCallback && indent >= 16) {
                count++;
                hotspots.push({
                    line: i + 1,
                    code: line.trim().substring(0, 80),
                    reason: 'Deeply nested callback — consider async/await or extracting functions',
                    severity: 'high',
                    signalId: 'callback-hell'
                });
            }
        });
        if (count > 0) {
            signals.push({
                id: 'callback-hell',
                name: 'Callback Nesting',
                description: 'Deeply nested callbacks suggesting pre-Promise patterns',
                score: Math.min(100, count * 20),
                weight: 1.0,
                count,
                severity: count > 3 ? 'critical' : 'high',
                category: 'patterns',
                icon: '🔄',
                recommendation: 'Refactor nested callbacks using `async/await` or Promise chains.',
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 3: Magic numbers
    // ────────────────────────────────────────────
    {
        let count = 0;
        const allowedNumbers = new Set(['0', '1', '2', '-1', '100', '0.5', '1000']);
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import')) return;

            // Skip lines that look like standard constant definitions or direct variable assignments
            // Matches formats like: "MAX_RETRIES = 5", "const timeout: number = 5000;", "public static final int MAX = 10;"
            // It ensures we don't flag the definition of a magic number constant itself.
            if (/^(?:export\s+|public\s+|private\s+|protected\s+|static\s+|readonly\s+|final\s+)*(?:const\s+|let\s+|var\s+|int\s+|float\s+|double\s+)*[a-zA-Z_$][a-zA-Z0-9_$]*\s*(?::\s*[a-zA-Z_0-9<>[\]\s]+)?\s*=\s*[-+]?(?:0x[\da-fA-F]+|\d+\.?\d*)\s*;?$/.test(trimmed)) {
                return;
            }

            const nums = trimmed.match(/(?<![a-zA-Z_$\d.])(?:0x[\da-fA-F]+|\d+\.?\d*)(?![a-zA-Z_$\d.])/g);
            if (nums) {
                const magics = nums.filter(n => !allowedNumbers.has(n) && n.length < 8);
                if (magics.length > 0) {
                    count += magics.length;
                    if (count <= 8) {
                        hotspots.push({
                            line: i + 1,
                            code: trimmed.substring(0, 80),
                            reason: `Magic number${magics.length > 1 ? 's' : ''}: ${magics.join(', ')} — extract to named constants`,
                            severity: 'medium',
                            signalId: 'magic-numbers'
                        });
                    }
                }
            }
        });
        if (count > 3) {
            signals.push({
                id: 'magic-numbers',
                name: 'Magic Numbers',
                description: 'Hard-coded numeric literals without named constants',
                score: Math.min(100, count * 5),
                weight: 0.6,
                count,
                severity: count > 10 ? 'high' : 'medium',
                category: 'style',
                icon: '🔢',
                recommendation: `Extract ${count} magic numbers into named constants for better readability.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 4: console.log / console.debug left in code
    // ────────────────────────────────────────────
    {
        let count = 0;
        lines.forEach((line, i) => {
            if (/console\.(log|debug|info|warn|error)\s*\(/.test(line)) {
                count++;
                if (count <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: line.trim().substring(0, 80),
                        reason: 'Debug console statement left in code',
                        severity: 'low',
                        signalId: 'console-statements'
                    });
                }
            }
        });
        if (count > 2) {
            signals.push({
                id: 'console-statements',
                name: 'Console Statements',
                description: 'Debug logging left in production code',
                score: Math.min(100, count * 8),
                weight: 0.4,
                count,
                severity: count > 8 ? 'medium' : 'low',
                category: 'style',
                icon: '📝',
                recommendation: `Remove ${count} console statements from production code.`,
                autoFixable: true
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 5: Long functions (>40 lines)
    // ────────────────────────────────────────────
    {
        let count = 0;
        let funcStart = -1;
        let braceDepth = 0;
        let funcName = '';
        const funcPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))/;

        lines.forEach((line, i) => {
            const match = line.match(funcPattern);
            if (match && braceDepth === 0) {
                funcStart = i;
                funcName = match[1] || match[2] || 'anonymous';
                braceDepth = 0;
            }
            braceDepth += (line.match(/{/g) || []).length;
            braceDepth -= (line.match(/}/g) || []).length;

            if (funcStart >= 0 && braceDepth <= 0) {
                const length = i - funcStart + 1;
                if (length > 40) {
                    count++;
                    hotspots.push({
                        line: funcStart + 1,
                        code: `${funcName}() — ${length} lines`,
                        reason: `Function is ${length} lines long — consider splitting into smaller functions`,
                        severity: length > 80 ? 'critical' : 'high',
                        signalId: 'long-functions'
                    });
                }
                funcStart = -1;
                braceDepth = 0;
            }
        });
        if (count > 0) {
            signals.push({
                id: 'long-functions',
                name: 'Long Functions',
                description: 'Functions exceeding 40 lines, reducing readability',
                score: Math.min(100, count * 18),
                weight: 0.9,
                count,
                severity: count > 3 ? 'critical' : 'high',
                category: 'structure',
                icon: '📏',
                recommendation: `Break down ${count} long function${count > 1 ? 's' : ''} into smaller, focused helper functions.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 6: Deprecated / legacy API usage
    // ────────────────────────────────────────────
    if (isJS) {
        let count = 0;
        const deprecatedPatterns: { pattern: RegExp; name: string }[] = [
            { pattern: /document\.write\s*\(/, name: 'document.write()' },
            { pattern: /\.substr\s*\(/, name: '.substr() — use .slice()' },
            { pattern: /new\s+Date\(\)\.getYear\(\)/, name: '.getYear() — use .getFullYear()' },
            { pattern: /\.fontcolor\s*\(|\.fontsize\s*\(/, name: 'String HTML methods' },
            { pattern: /escape\s*\(|unescape\s*\(/, name: 'escape()/unescape()' },
            { pattern: /arguments\s*\[/, name: 'arguments[] — use rest params' },
            { pattern: /eval\s*\(/, name: 'eval() — avoid for security' },
            { pattern: /with\s*\(/, name: 'with statement — deprecated' },
            { pattern: /__proto__/, name: '__proto__ — use Object.getPrototypeOf()' },
        ];
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            for (const dp of deprecatedPatterns) {
                if (dp.pattern.test(line)) {
                    count++;
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: `Deprecated API: ${dp.name}`,
                        severity: 'critical',
                        signalId: 'deprecated-apis'
                    });
                }
            }
        });
        if (count > 0) {
            signals.push({
                id: 'deprecated-apis',
                name: 'Deprecated APIs',
                description: 'Uses deprecated or obsolete JavaScript APIs',
                score: Math.min(100, count * 25),
                weight: 1.5,
                count,
                severity: 'critical',
                category: 'syntax',
                icon: '🚫',
                recommendation: `Replace ${count} deprecated API usage${count > 1 ? 's' : ''} with modern equivalents.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 7: No TypeScript types (any, missing annotations)
    // ────────────────────────────────────────────
    if (isTS) {
        let anyCount = 0;
        lines.forEach((line, i) => {
            if (/:\s*any\b/.test(line) || /as\s+any\b/.test(line)) {
                anyCount++;
                if (anyCount <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: line.trim().substring(0, 80),
                        reason: 'Using `any` type — provide explicit types',
                        severity: 'medium',
                        signalId: 'weak-typing'
                    });
                }
            }
        });
        if (anyCount > 0) {
            signals.push({
                id: 'weak-typing',
                name: 'Weak Typing',
                description: 'Uses `any` type which defeats TypeScript safety',
                score: Math.min(100, anyCount * 12),
                weight: 0.8,
                count: anyCount,
                severity: anyCount > 5 ? 'high' : 'medium',
                category: 'syntax',
                icon: '🏷️',
                recommendation: `Replace ${anyCount} \`any\` type${anyCount > 1 ? 's' : ''} with explicit type annotations.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 8: String concatenation instead of template literals
    // ────────────────────────────────────────────
    {
        let count = 0;
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (/["']\s*\+\s*\w|(\w)\s*\+\s*["']/.test(line) && !line.includes('`')) {
                count++;
                if (count <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'String concatenation — use template literals',
                        severity: 'low',
                        signalId: 'string-concat'
                    });
                }
            }
        });
        if (count > 2) {
            signals.push({
                id: 'string-concat',
                name: 'String Concatenation',
                description: 'Uses + for strings instead of ES6 template literals',
                score: Math.min(100, count * 8),
                weight: 0.5,
                count,
                severity: 'low',
                category: 'syntax',
                icon: '🔗',
                recommendation: `Convert ${count} string concatenation${count > 1 ? 's' : ''} to template literals.`,
                autoFixable: true
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 9: Duplicated code blocks
    // ────────────────────────────────────────────
    {
        let count = 0;
        const lineSet = new Map<string, number[]>();
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.length > 20 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('import')) {
                const existing = lineSet.get(trimmed);
                if (existing) {
                    existing.push(i + 1);
                    if (existing.length === 2) {
                        count++;
                        hotspots.push({
                            line: i + 1,
                            code: trimmed.substring(0, 80),
                            reason: `Duplicate code — also on line ${existing[0]}`,
                            severity: 'medium',
                            signalId: 'duplicated-code'
                        });
                    }
                } else {
                    lineSet.set(trimmed, [i + 1]);
                }
            }
        });
        if (count > 2) {
            signals.push({
                id: 'duplicated-code',
                name: 'Duplicated Code',
                description: 'Identical code blocks found at multiple locations',
                score: Math.min(100, count * 10),
                weight: 0.7,
                count,
                severity: count > 5 ? 'high' : 'medium',
                category: 'structure',
                icon: '📋',
                recommendation: `Extract ${count} duplicated code pattern${count > 1 ? 's' : ''} into shared utility functions.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 10: TODO/FIXME/HACK comments
    // ────────────────────────────────────────────
    {
        let count = 0;
        lines.forEach((line, i) => {
            if (/\b(TODO|FIXME|HACK|XXX|BUG|TEMP)\b/i.test(line)) {
                count++;
                if (count <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: line.trim().substring(0, 80),
                        reason: 'Unresolved marker comment — address or remove',
                        severity: 'medium',
                        signalId: 'todo-markers'
                    });
                }
            }
        });
        if (count > 0) {
            signals.push({
                id: 'todo-markers',
                name: 'TODO/FIXME Markers',
                description: 'Unresolved development markers left in code',
                score: Math.min(100, count * 10),
                weight: 0.5,
                count,
                severity: count > 5 ? 'high' : 'medium',
                category: 'style',
                icon: '📌',
                recommendation: `Address ${count} TODO/FIXME marker${count > 1 ? 's' : ''} — resolve or create tickets.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 11: Large file size
    // ────────────────────────────────────────────
    {
        if (loc > 200) {
            const score = Math.min(100, Math.round((loc - 200) / 3));
            signals.push({
                id: 'large-file',
                name: 'Large File',
                description: `File has ${loc} lines — consider splitting`,
                score,
                weight: 0.6,
                count: 1,
                severity: loc > 500 ? 'critical' : loc > 300 ? 'high' : 'medium',
                category: 'structure',
                icon: '📄',
                recommendation: `Split this ${loc}-line file into smaller, focused modules.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 12: Inconsistent or missing error handling
    // ────────────────────────────────────────────
    {
        let emptyCount = 0;
        lines.forEach((line, i) => {
            if (/catch\s*\(/.test(line)) {
                const nextLine = lines[i + 1]?.trim() || '';
                if (nextLine === '}' || nextLine.startsWith('//') || nextLine === '') {
                    emptyCount++;
                    hotspots.push({
                        line: i + 1,
                        code: line.trim().substring(0, 80),
                        reason: 'Empty catch block — silently swallowing errors',
                        severity: 'high',
                        signalId: 'empty-catch'
                    });
                }
            }
        });
        if (emptyCount > 0) {
            signals.push({
                id: 'empty-catch',
                name: 'Empty Catch Blocks',
                description: 'Catch blocks that silently swallow errors',
                score: Math.min(100, emptyCount * 25),
                weight: 1.0,
                count: emptyCount,
                severity: 'high',
                category: 'security',
                icon: '🛡️',
                recommendation: `Handle errors properly in ${emptyCount} empty catch block${emptyCount > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 13: CommonJS require() in modern code
    // ────────────────────────────────────────────
    if (isJS) {
        let count = 0;
        lines.forEach((line, i) => {
            if (/\brequire\s*\(/.test(line) && !line.trim().startsWith('//')) {
                count++;
                if (count <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: line.trim().substring(0, 80),
                        reason: 'CommonJS require() — use ES module import',
                        severity: 'medium',
                        signalId: 'commonjs-require'
                    });
                }
            }
        });
        if (count > 0) {
            signals.push({
                id: 'commonjs-require',
                name: 'CommonJS Imports',
                description: 'Uses require() instead of ES module imports',
                score: Math.min(100, count * 15),
                weight: 0.7,
                count,
                severity: count > 3 ? 'high' : 'medium',
                category: 'patterns',
                icon: '📦',
                recommendation: `Migrate ${count} require() call${count > 1 ? 's' : ''} to ES module \`import\` statements.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 14: == instead of ===
    // ────────────────────────────────────────────
    if (isJS || language.toLowerCase() === 'php') {
        let count = 0;
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            const matches = line.match(/[^!=]==[^=]/g);
            if (matches) {
                count += matches.length;
                if (count <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Loose equality `==` — use strict `===`',
                        severity: 'medium',
                        signalId: 'loose-equality'
                    });
                }
            }
        });
        if (count > 0) {
            signals.push({
                id: 'loose-equality',
                name: 'Loose Equality',
                description: 'Uses == instead of === for comparisons',
                score: Math.min(100, count * 10),
                weight: 0.6,
                count,
                severity: count > 5 ? 'high' : 'medium',
                category: 'patterns',
                icon: '⚖️',
                recommendation: `Replace ${count} loose equality \`==\` check${count > 1 ? 's' : ''} with strict \`===\`.`,
                autoFixable: true
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 15: innerHTML / dangerouslySetInnerHTML (XSS risk)
    // ────────────────────────────────────────────
    if (isJS) {
        let count = 0;
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (/\.innerHTML\s*=/.test(line) || /dangerouslySetInnerHTML/.test(line)) {
                count++;
                hotspots.push({
                    line: i + 1,
                    code: trimmed.substring(0, 80),
                    reason: 'Direct innerHTML / dangerouslySetInnerHTML — XSS risk; use safe APIs or sanitize',
                    severity: 'critical',
                    signalId: 'inner-html'
                });
            }
        });
        if (count > 0) {
            signals.push({
                id: 'inner-html',
                name: 'Unsafe HTML Injection',
                description: 'Assigning to innerHTML or using dangerouslySetInnerHTML without sanitization',
                score: Math.min(100, count * 30),
                weight: 1.4,
                count,
                severity: 'critical',
                category: 'security',
                icon: '🔓',
                recommendation: `Replace ${count} unsafe HTML assignment${count > 1 ? 's' : ''} with textContent, safe DOM APIs, or a sanitization library.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 16: Deep nesting (structure)
    // ────────────────────────────────────────────
    {
        let depth = 0;
        let maxDepth = 0;
        const deepLines: number[] = [];
        lines.forEach((line, i) => {
            depth += (line.match(/{/g) || []).length;
            depth -= (line.match(/}/g) || []).length;
            if (depth > maxDepth) maxDepth = depth;
            if (depth > 4) deepLines.push(i + 1);
        });
        if (maxDepth > 4 && deepLines.length > 0) {
            deepLines.slice(0, 5).forEach(lineNum => {
                const line = lines[lineNum - 1];
                hotspots.push({
                    line: lineNum,
                    code: (line?.trim() || '').substring(0, 80),
                    reason: `Deep nesting (depth > 4) — consider extracting functions or early returns`,
                    severity: maxDepth > 6 ? 'high' : 'medium',
                    signalId: 'deep-nesting'
                });
            });
            signals.push({
                id: 'deep-nesting',
                name: 'Deep Nesting',
                description: 'Excessive brace/block nesting reduces readability and testability',
                score: Math.min(100, (maxDepth - 4) * 15 + deepLines.length * 3),
                weight: 0.8,
                count: deepLines.length,
                severity: maxDepth > 6 ? 'high' : 'medium',
                category: 'structure',
                icon: '📐',
                recommendation: `Reduce nesting at ${deepLines.length} location${deepLines.length > 1 ? 's' : ''} using early returns, guards, or extracted functions.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 17–18: Python-specific ageing
    // ────────────────────────────────────────────
    if (isPython) {
        let printCount = 0;
        let formatCount = 0;
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) return;
            if (/\bprint\s*\(/.test(line)) {
                printCount++;
                if (printCount <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'print() in module — use logging for production',
                        severity: 'low',
                        signalId: 'python-print'
                    });
                }
            }
            if (/%\s*[sdfe]/.test(line) || /\.format\s*\(/.test(line)) {
                formatCount++;
                if (formatCount <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Old-style % or .format() — prefer f-strings',
                        severity: 'low',
                        signalId: 'python-format'
                    });
                }
            }
        });
        if (printCount > 2) {
            signals.push({
                id: 'python-print',
                name: 'Print in Module',
                description: 'Use of print() instead of logging for production code',
                score: Math.min(100, printCount * 8),
                weight: 0.4,
                count: printCount,
                severity: printCount > 10 ? 'medium' : 'low',
                category: 'style',
                icon: '🐍',
                recommendation: `Replace ${printCount} print() call${printCount > 1 ? 's' : ''} with logging module.`,
                autoFixable: false
            });
        }
        if (formatCount > 0) {
            signals.push({
                id: 'python-format',
                name: 'Legacy String Formatting',
                description: 'Uses % or .format() instead of f-strings',
                score: Math.min(100, formatCount * 12),
                weight: 0.5,
                count: formatCount,
                severity: 'low',
                category: 'syntax',
                icon: '📎',
                recommendation: `Convert ${formatCount} string format${formatCount > 1 ? 's' : ''} to f-strings.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 19–22: Java-specific ageing
    // ────────────────────────────────────────────
    if (language.toLowerCase() === 'java') {
        let rawTypes = 0;
        let legacyCollections = 0;
        let deprecatedAnnotations = 0;
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            
            // Raw types (generic without type parameters)
            if (/List|Map|Set|Collection|Queue|Deque/.test(line) && !/<.*>/.test(line)) {
                rawTypes++;
                if (rawTypes <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Raw type usage — use generics for type safety',
                        severity: 'medium',
                        signalId: 'raw-types'
                    });
                }
            }
            
            // Legacy collections (Vector, Hashtable)
            if (/Vector|Hashtable|Enumeration/.test(line)) {
                legacyCollections++;
                hotspots.push({
                    line: i + 1,
                    code: trimmed.substring(0, 80),
                    reason: 'Legacy collection class — use modern alternatives',
                    severity: 'high',
                    signalId: 'legacy-collections'
                });
            }
            
            // Deprecated annotations
            if (/@Deprecated/.test(line)) {
                deprecatedAnnotations++;
            }
        });
        
        if (rawTypes > 0) {
            signals.push({
                id: 'raw-types',
                name: 'Raw Types',
                description: 'Uses raw types instead of parameterized generics',
                score: Math.min(100, rawTypes * 15),
                weight: 0.8,
                count: rawTypes,
                severity: rawTypes > 3 ? 'high' : 'medium',
                category: 'syntax',
                icon: '☕',
                recommendation: `Add type parameters to ${rawTypes} raw type${rawTypes > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
        
        if (legacyCollections > 0) {
            signals.push({
                id: 'legacy-collections',
                name: 'Legacy Collections',
                description: 'Uses deprecated Vector/Hashtable instead of ArrayList/HashMap',
                score: Math.min(100, legacyCollections * 20),
                weight: 1.1,
                count: legacyCollections,
                severity: 'critical',
                category: 'patterns',
                icon: '🗃️',
                recommendation: `Replace ${legacyCollections} legacy collection${legacyCollections > 1 ? 's' : ''} with modern equivalents.`,
                autoFixable: false
            });
        }
        
        if (deprecatedAnnotations > 0) {
            signals.push({
                id: 'deprecated-usage',
                name: 'Deprecated API Usage',
                description: 'Uses deprecated APIs or methods',
                score: Math.min(100, deprecatedAnnotations * 10),
                weight: 0.9,
                count: deprecatedAnnotations,
                severity: 'medium',
                category: 'syntax',
                icon: '⚠️',
                recommendation: `Update ${deprecatedAnnotations} deprecated API usage${deprecatedAnnotations > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 23–26: C++ specific ageing
    // ────────────────────────────────────────────
    if (language.toLowerCase() === 'cpp' || language.toLowerCase() === 'c++') {
        let cStyleCasts = 0;
        let rawPointers = 0;
        let mallocUsage = 0;
        let nullPointers = 0;
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            
            // C-style casts
            if (/^\s*\([^)]+\)\s*\w+/.test(line) && !/reinterpret_cast|static_cast|dynamic_cast|const_cast/.test(line)) {
                cStyleCasts++;
                if (cStyleCasts <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'C-style cast — use C++ cast operators',
                        severity: 'medium',
                        signalId: 'c-style-casts'
                    });
                }
            }
            
            // Raw pointers
            if (/\*\s+\w+|\w+\s*\*/.test(line) && !/unique_ptr|shared_ptr|weak_ptr/.test(line)) {
                rawPointers++;
            }
            
            // malloc/free
            if (/malloc\s*\(|free\s*\(|calloc\s*\(|realloc\s*\(/.test(line)) {
                mallocUsage++;
                hotspots.push({
                    line: i + 1,
                    code: trimmed.substring(0, 80),
                    reason: 'C-style memory management — use RAII/smart pointers',
                    severity: 'critical',
                    signalId: 'c-memory'
                });
            }
            
            // NULL instead of nullptr
            if (/\bNULL\b/.test(line)) {
                nullPointers++;
            }
        });
        
        if (cStyleCasts > 0) {
            signals.push({
                id: 'c-style-casts',
                name: 'C-Style Casts',
                description: 'Uses C-style casts instead of C++ cast operators',
                score: Math.min(100, cStyleCasts * 12),
                weight: 0.7,
                count: cStyleCasts,
                severity: cStyleCasts > 5 ? 'high' : 'medium',
                category: 'patterns',
                icon: '🔄',
                recommendation: `Replace ${cStyleCasts} C-style cast${cStyleCasts > 1 ? 's' : ''} with C++ cast operators.`,
                autoFixable: false
            });
        }
        
        if (mallocUsage > 0) {
            signals.push({
                id: 'c-memory',
                name: 'C Memory Management',
                description: 'Uses malloc/free instead of RAII and smart pointers',
                score: Math.min(100, mallocUsage * 25),
                weight: 1.3,
                count: mallocUsage,
                severity: 'critical',
                category: 'patterns',
                icon: '🧠',
                recommendation: `Replace ${mallocUsage} C-style memory allocation${mallocUsage > 1 ? 's' : ''} with RAII patterns.`,
                autoFixable: false
            });
        }
        
        if (nullPointers > 0) {
            signals.push({
                id: 'null-usage',
                name: 'NULL Macro',
                description: 'Uses NULL macro instead of nullptr keyword',
                score: Math.min(100, nullPointers * 5),
                weight: 0.4,
                count: nullPointers,
                severity: 'low',
                category: 'style',
                icon: '📍',
                recommendation: `Replace ${nullPointers} NULL macro${nullPointers > 1 ? 's' : ''} with nullptr.`,
                autoFixable: true
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 27–30: Rust specific ageing
    // ────────────────────────────────────────────
    if (language.toLowerCase() === 'rust') {
        let unwrapUsage = 0;
        let expectUsage = 0;
        let panicMacro = 0;
        let mutableGlobals = 0;
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;
            
            // .unwrap() calls
            if (/\.unwrap\s*\(\)/.test(line)) {
                unwrapUsage++;
                if (unwrapUsage <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'unwrap() call — handle errors gracefully',
                        severity: 'medium',
                        signalId: 'unwrap-usage'
                    });
                }
            }
            
            // .expect() calls
            if (/\.expect\s*\(/.test(line)) {
                expectUsage++;
            }
            
            // panic! macro
            if (/panic!\s*\(/.test(line)) {
                panicMacro++;
                hotspots.push({
                    line: i + 1,
                    code: trimmed.substring(0, 80),
                    reason: 'panic! macro — prefer Result/Option handling',
                    severity: 'high',
                    signalId: 'panic-macro'
                });
            }
            
            // mutable static variables
            if (/static mut\s+\w+/.test(line)) {
                mutableGlobals++;
                hotspots.push({
                    line: i + 1,
                    code: trimmed.substring(0, 80),
                    reason: 'mutable static variable — consider thread-safe alternatives',
                    severity: 'high',
                    signalId: 'mutable-static'
                });
            }
        });
        
        if (unwrapUsage > 2) {
            signals.push({
                id: 'unwrap-usage',
                name: 'Excessive unwrap()',
                description: 'Uses unwrap() which can cause panics',
                score: Math.min(100, unwrapUsage * 8),
                weight: 0.9,
                count: unwrapUsage,
                severity: unwrapUsage > 10 ? 'high' : 'medium',
                category: 'patterns',
                icon: '📦',
                recommendation: `Replace ${unwrapUsage} unwrap() call${unwrapUsage > 1 ? 's' : ''} with proper error handling.`,
                autoFixable: false
            });
        }
        
        if (panicMacro > 0) {
            signals.push({
                id: 'panic-macro',
                name: 'Panic Macro Usage',
                description: 'Uses panic! instead of graceful error handling',
                score: Math.min(100, panicMacro * 20),
                weight: 1.0,
                count: panicMacro,
                severity: 'high',
                category: 'patterns',
                icon: '🚨',
                recommendation: `Replace ${panicMacro} panic! macro${panicMacro > 1 ? 's' : ''} with Result/Option handling.`,
                autoFixable: false
            });
        }
        
        if (mutableGlobals > 0) {
            signals.push({
                id: 'mutable-static',
                name: 'Mutable Static Variables',
                description: 'Uses mutable static variables (unsafe)',
                score: Math.min(100, mutableGlobals * 15),
                weight: 1.1,
                count: mutableGlobals,
                severity: 'critical',
                category: 'security',
                icon: '🔧',
                recommendation: `Replace ${mutableGlobals} mutable static${mutableGlobals > 1 ? 's' : ''} with thread-safe alternatives.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 31–34: Go specific ageing
    // ────────────────────────────────────────────
    if (language.toLowerCase() === 'go') {
        let goroutineLeaks = 0;
        let errorIgnored = 0;
        let globalVars = 0;
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;
            
            // Potential goroutine leaks (goroutines without proper handling)
            if (/go\s+\w+\(/.test(line)) {
                goroutineLeaks++;
                if (goroutineLeaks <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Goroutine without proper lifecycle management',
                        severity: 'medium',
                        signalId: 'goroutine-leaks'
                    });
                }
            }
            
            // Ignored errors
            if (/\w+,\s*:=|_\s*,\s*err|err\s*:=|_,\s*err/.test(line) && !/if\s+err\s*!=|err\s*!=\s*nil/.test(line)) {
                errorIgnored++;
                if (errorIgnored <= 5) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Error value ignored — handle errors properly',
                        severity: 'medium',
                        signalId: 'error-ignored'
                    });
                }
            }
            
            // Package-level variables
            if (/^var\s+\w+/.test(line)) {
                globalVars++;
            }
        });
        
        if (goroutineLeaks > 2) {
            signals.push({
                id: 'goroutine-leaks',
                name: 'Unmanaged Goroutines',
                description: 'Goroutines without proper lifecycle management',
                score: Math.min(100, goroutineLeaks * 12),
                weight: 0.8,
                count: goroutineLeaks,
                severity: goroutineLeaks > 5 ? 'high' : 'medium',
                category: 'structure',
                icon: '🐹',
                recommendation: `Add proper lifecycle management for ${goroutineLeaks} goroutine${goroutineLeaks > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
        
        if (errorIgnored > 3) {
            signals.push({
                id: 'error-ignored',
                name: 'Ignored Errors',
                description: 'Error return values are not handled',
                score: Math.min(100, errorIgnored * 10),
                weight: 0.7,
                count: errorIgnored,
                severity: errorIgnored > 10 ? 'high' : 'medium',
                category: 'patterns',
                icon: '⚠️',
                recommendation: `Handle ${errorIgnored} ignored error${errorIgnored > 1 ? 's' : ''} properly.`,
                autoFixable: false
            });
        }
        
        if (globalVars > 5) {
            signals.push({
                id: 'global-vars',
                name: 'Excessive Global Variables',
                description: 'Too many package-level variables',
                score: Math.min(100, globalVars * 5),
                weight: 0.5,
                count: globalVars,
                severity: 'low',
                category: 'structure',
                icon: '🌍',
                recommendation: `Reduce ${globalVars} global variable${globalVars > 1 ? 's' : ''} by using structs.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 35: Modern async/await patterns vs callbacks
    // ────────────────────────────────────────────
    if (isJS) {
        let callbackCount = 0;
        let thenChains = 0;
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            
            // Count callback functions
            if (/function\s*\([^)]*\)\s*{|\s*=>\s*{/.test(line) && /callback|cb|done/.test(line)) {
                callbackCount++;
            }
            
            // Count Promise .then() chains
            if (/\.then\s*\(/.test(line)) {
                thenChains++;
                if (thenChains <= 3) {
                    hotspots.push({
                        line: i + 1,
                        code: trimmed.substring(0, 80),
                        reason: 'Promise .then() chain — consider async/await',
                        severity: 'low',
                        signalId: 'promise-chains'
                    });
                }
            }
        });
        
        if (thenChains > 2) {
            signals.push({
                id: 'promise-chains',
                name: 'Promise Chains',
                description: 'Uses .then() chains instead of async/await',
                score: Math.min(100, thenChains * 6),
                weight: 0.4,
                count: thenChains,
                severity: 'low',
                category: 'patterns',
                icon: '⛓️',
                recommendation: `Convert ${thenChains} Promise chain${thenChains > 1 ? 's' : ''} to async/await for better readability.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 36: Missing JSDoc/TSDoc comments
    // ────────────────────────────────────────────
    {
        let documentedFunctions = 0;
        let totalFunctions = 0;
        let hasJSDoc = false;
        
        lines.forEach((line) => {
            const trimmed = line.trim();
            
            // Check for JSDoc comment before function
            if (trimmed.startsWith('/**') || trimmed.startsWith('/**')) {
                hasJSDoc = true;
            }
            
            // Count function declarations
            if (/function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|class\s+\w+|interface\s+\w+|type\s+\w+/.test(line)) {
                totalFunctions++;
                if (hasJSDoc) {
                    documentedFunctions++;
                }
                hasJSDoc = false;
            }
            
            // Reset JSDoc flag if we hit a non-comment line
            if (!trimmed.startsWith('*') && !trimmed.startsWith('/**') && !trimmed.startsWith('*/') && trimmed !== '') {
                if (!/function|const|class|interface|type/.test(trimmed)) {
                    hasJSDoc = false;
                }
            }
        });
        
        const undocumentedFunctions = totalFunctions - documentedFunctions;
        if (totalFunctions > 3 && undocumentedFunctions > totalFunctions * 0.5) {
            signals.push({
                id: 'missing-documentation',
                name: 'Missing Documentation',
                description: 'Functions lack JSDoc/TSDoc comments',
                score: Math.min(100, Math.round((undocumentedFunctions / totalFunctions) * 80)),
                weight: 0.3,
                count: undocumentedFunctions,
                severity: 'low',
                category: 'style',
                icon: '📝',
                recommendation: `Add JSDoc comments to ${undocumentedFunctions} undocumented function${undocumentedFunctions > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
    }

    // ────────────────────────────────────────────
    // SIGNAL 37: Inconsistent naming conventions
    // ────────────────────────────────────────────
    {
        const namingIssues: { line: number; issue: string }[] = [];
        
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import')) return;
            
            // Check for various naming convention issues
            if (isJS || isTS) {
                // Constants should be UPPER_SNAKE_CASE
                if (/const\s+[a-z][a-zA-Z0-9]*\s*=/.test(line) && !/[a-z]/.test(line.match(/const\s+([a-zA-Z0-9_]+)/)?.[1] || '')) {
                    namingIssues.push({ line: i + 1, issue: 'Constant should use UPPER_SNAKE_CASE' });
                }
                
                // Classes should be PascalCase
                if (/class\s+[a-z]/.test(line)) {
                    namingIssues.push({ line: i + 1, issue: 'Class should use PascalCase' });
                }
                
                // Functions and variables should be camelCase
                if (/function\s+[A-Z_]/.test(line) || /(?:const|let|var)\s+[A-Z_]/.test(line)) {
                    namingIssues.push({ line: i + 1, issue: 'Function/variable should use camelCase' });
                }
            }
        });
        
        if (namingIssues.length > 3) {
            namingIssues.slice(0, 5).forEach(issue => {
                hotspots.push({
                    line: issue.line,
                    code: lines[issue.line - 1]?.trim().substring(0, 80) || '',
                    reason: issue.issue,
                    severity: 'low',
                    signalId: 'naming-conventions'
                });
            });
            
            signals.push({
                id: 'naming-conventions',
                name: 'Naming Convention Issues',
                description: 'Inconsistent naming conventions detected',
                score: Math.min(100, namingIssues.length * 4),
                weight: 0.3,
                count: namingIssues.length,
                severity: 'low',
                category: 'style',
                icon: '🏷️',
                recommendation: `Fix ${namingIssues.length} naming convention issue${namingIssues.length > 1 ? 's' : ''}.`,
                autoFixable: false
            });
        }
    }

    // ── Compute weighted overall score ──
    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const s of signals) {
        totalWeightedScore += s.score * s.weight;
        totalWeight += s.weight * 100; // max possible
    }
    const overallScore = totalWeight > 0
        ? Math.min(100, Math.round((totalWeightedScore / totalWeight) * 100))
        : 0;

    // ── Compute category scores ──
    const categoryScores = { syntax: 0, patterns: 0, structure: 0, style: 0, security: 0 };
    const categoryCounts = { syntax: 0, patterns: 0, structure: 0, style: 0, security: 0 };
    for (const s of signals) {
        categoryScores[s.category] += s.score * s.weight;
        categoryCounts[s.category]++;
    }
    for (const cat of Object.keys(categoryScores) as (keyof typeof categoryScores)[]) {
        categoryScores[cat] = categoryCounts[cat] > 0
            ? Math.min(100, Math.round(categoryScores[cat] / categoryCounts[cat]))
            : 0;
    }

    // ── Grade ──
    const grade: AgeingGrade = overallScore <= 5 ? 'A+' : overallScore <= 15 ? 'A' : overallScore <= 30 ? 'B' : overallScore <= 50 ? 'C' : overallScore <= 70 ? 'D' : 'F';
    const gradeLabels: Record<AgeingGrade, string> = {
        'A+': 'Pristine — Modern & Clean',
        'A': 'Excellent — Well Maintained',
        'B': 'Good — Minor Issues',
        'C': 'Fair — Needs Attention',
        'D': 'Poor — Significant Tech Debt',
        'F': 'Critical — Major Refactoring Needed'
    };

    // ── Summary ──
    const signalCount = signals.length;
    const hotspotCount = hotspots.length;
    const summary = signalCount === 0
        ? 'This code is modern and well-structured with no ageing signals detected.'
        : `Found ${signalCount} ageing signal${signalCount > 1 ? 's' : ''} across ${hotspotCount} hotspot${hotspotCount > 1 ? 's' : ''}.` +
        ` Overall code age grade: ${grade} (${gradeLabels[grade]}).`;

    // Sort hotspots by severity priority
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    hotspots.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

    // Sort signals by weighted score descending
    signals.sort((a, b) => (b.score * b.weight) - (a.score * a.weight));

    return {
        overallScore,
        grade,
        gradeLabel: gradeLabels[grade],
        signals,
        hotspots: hotspots.slice(0, 20), // cap at 20 hotspots for readability
        summary,
        categoryScores
    };
}


export const analyzeCode = (code: string, language: string = 'javascript'): AnalysisResult => {
    if (!code || code.trim().length === 0) {
        return {
            complexity: 'Low',
            maintainability: 100,
            codeAgeing: 0,
            healthScore: 100,
            syntaxValid: true,
            suggestions: [],
            smells: [],
            halstead: { vocabulary: 0, length: 0, volume: 0, difficulty: 0, effort: 0 },
            ageingDetails: {
                overallScore: 0,
                grade: 'A+',
                gradeLabel: 'Pristine — Modern & Clean',
                signals: [],
                hotspots: [],
                summary: 'No code to analyze.',
                categoryScores: { syntax: 0, patterns: 0, structure: 0, style: 0, security: 0 }
            }
        };
    }

    try {
        const lines = code.split('\n');
        const loc = lines.length;
        const smells: CodeSmell[] = [];

        // 1. Nesting Depth Analysis
        let maxDepth = 0;
        let currentDepth = 0;
        lines.forEach((line, index) => {
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;
            currentDepth += openBraces - closeBraces;
            if (currentDepth > maxDepth) maxDepth = currentDepth;

            if (currentDepth > 4) {
                smells.push({
                    id: 'deep-nesting',
                    message: `Deep nesting detected (Depth: ${currentDepth})`,
                    line: index + 1,
                    severity: 'warning'
                });
            }
        });

        // 2. Halstead Metrics (Simplified Heuristic)
        const operators = (code.match(/[+\-*/=<>!&|^~%?:]+/g) || []).length;
        const keywords = (code.match(/\b(if|else|for|while|return|function|const|let|var|import|export|class)\b/g) || []).length;
        const operands = (code.match(/\b[a-zA-Z_]\w*\b/g) || []).length;

        const n1 = operators + keywords;
        const N1 = operators + keywords;
        const n2 = operands / 2;
        const N2 = operands;

        const vocabulary = n1 + n2 || 1;
        const length = N1 + N2;
        const volume = length * Math.log2(vocabulary || 1);
        const difficulty = (n1 / 2) * (N2 / (n2 || 1));
        const effort = difficulty * volume;

        // 3. Complexity & Smells
        const branching = (code.match(/if\s*\(|else|switch|case|for|while/g) || []).length;
        const legacyVars = (code.match(/\bvar\s+/g) || []).length;
        const consoleLogs = (code.match(/console\.log/g) || []).length;

        if (legacyVars > 0) smells.push({ id: 'use-let-const', message: `Avoid using 'var', use 'let' or 'const' instead. Found ${legacyVars} instances.`, severity: 'warning' });
        if (loc > 300) smells.push({ id: 'large-file', message: `File is too large (${loc} lines). Consider splitting.`, severity: 'error' });
        if (consoleLogs > 2) smells.push({ id: 'console-log', message: `Remove console logs before production.`, severity: 'info' });

        let complexity: 'Low' | 'Medium' | 'High' = 'Low';
        if (maxDepth > 4 || loc > 300 || branching > 20) complexity = 'High';
        else if (maxDepth > 2 || loc > 150 || branching > 10) complexity = 'Medium';

        // 4. Scoring
        let maintainability = 100
            - (branching * 1.5)
            - (maxDepth * 5)
            - (loc / 10)
            - (legacyVars * 5);

        maintainability = Math.max(0, Math.min(100, maintainability));

        // 5. Full Code Ageing Analysis
        const ageingDetails = computeCodeAgeing(lines, language);
        const codeAgeing = ageingDetails.overallScore;

        // Overall Health Score (0–100)
        const healthScore = Math.min(100, Math.max(0, Math.round(maintainability - (codeAgeing / 5) - (smells.length * 2))));

        const suggestions: string[] = smells.map(s => s.message).slice(0, 5);

        return {
            complexity,
            maintainability: Math.round(maintainability),
            codeAgeing,
            healthScore,
            syntaxValid: true,
            suggestions,
            smells,
            halstead: {
                vocabulary: Math.round(vocabulary),
                length,
                volume: Math.round(volume),
                difficulty: Math.round(difficulty),
                effort: Math.round(effort)
            },
            ageingDetails
        };

    } catch {
        return {
            complexity: 'High',
            maintainability: 0,
            codeAgeing: 0,
            healthScore: 0,
            syntaxValid: false,
            suggestions: ['Fix syntax errors to enable analysis.'],
            smells: [],
            halstead: { vocabulary: 0, length: 0, volume: 0, difficulty: 0, effort: 0 },
            ageingDetails: {
                overallScore: 0,
                grade: 'A+',
                gradeLabel: 'Pristine — Modern & Clean',
                signals: [],
                hotspots: [],
                summary: 'Unable to analyze — fix syntax errors first.',
                categoryScores: { syntax: 0, patterns: 0, structure: 0, style: 0, security: 0 }
            }
        };
    }
};
