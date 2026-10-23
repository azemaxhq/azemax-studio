import { ALL_DETECTORS } from './ageing/detectors';
import { categorizeLanguage } from './ageing/helpers';
import type { AgeingSignal, AgeingHotspot, AgeingGrade, CodeAgeingResult } from './ageing/types';

// Re-export ageing types for consumers
export type { AgeingSignal, AgeingHotspot, AgeingGrade, CodeAgeingResult } from './ageing/types';

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
    const ctx = { lines, language, loc: lines.length, ...categorizeLanguage(language) };
    const signals: AgeingSignal[] = [];
    const hotspots: AgeingHotspot[] = [];

    for (const detector of ALL_DETECTORS) {
        const signal = detector(lines, ctx as any, hotspots);
        if (signal) signals.push(signal);
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


const computeAnalysis = (code: string, language: string = 'javascript'): AnalysisResult => {
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

const analysisCache = new Map<string, AnalysisResult>();
const MAX_ANALYSIS_CACHE = 30;

export const analyzeCode = (code: string, language: string = 'javascript'): AnalysisResult => {
    const cacheKey = `${language}\u0000${code}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
        analysisCache.delete(cacheKey);
        analysisCache.set(cacheKey, cached);
        return cached;
    }
    const result = computeAnalysis(code, language);
    analysisCache.set(cacheKey, result);
    if (analysisCache.size > MAX_ANALYSIS_CACHE) {
        const oldestKey = analysisCache.keys().next().value;
        if (oldestKey !== undefined) analysisCache.delete(oldestKey);
    }
    return result;
};
