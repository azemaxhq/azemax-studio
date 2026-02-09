
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
}

export const analyzeCode = (code: string): AnalysisResult => {
    if (!code || code.trim().length === 0) {
        return {
            complexity: 'Low',
            maintainability: 100,
            codeAgeing: 0,
            healthScore: 100,
            syntaxValid: true,
            suggestions: [],
            smells: [],
            halstead: { vocabulary: 0, length: 0, volume: 0, difficulty: 0, effort: 0 }
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

        const n1 = operators + keywords; // distinct operators (simplified)
        const N1 = operators + keywords; // total operators
        const n2 = operands / 2; // distinct operands estimate
        const N2 = operands; // total operands

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
        // Maintainability Index (Simplified) = 171 - 5.2 * ln(V) - 0.23 * G(branching) - 16.2 * ln(LOC)
        // We'll use a simpler linear model derived from these factors for stability
        let maintainability = 100
            - (branching * 1.5)
            - (maxDepth * 5)
            - (loc / 10)
            - (legacyVars * 5);

        maintainability = Math.max(0, Math.min(100, maintainability));

        // Code Ageing: Higher score = Older/Worse. Based on legacy patterns and lack of modern features.
        // If file uses 'var' heavily, has low maintainability, it's "aged".
        let codeAgeing = 0;
        if (legacyVars > 0) codeAgeing += 40;
        if (complexity === 'High') codeAgeing += 20;
        if (maintainability < 50) codeAgeing += 20;
        codeAgeing = Math.min(100, codeAgeing);

        // Overall Health Score (Inverse of bad things)
        const healthScore = Math.max(0, Math.round(maintainability - (codeAgeing / 5) - (smells.length * 2)));

        const suggestions: string[] = smells.map(s => s.message).slice(0, 5); // Top 5 issues

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
            }
        };

    } catch (_e) {
        return {
            complexity: 'High',
            maintainability: 0,
            codeAgeing: 0,
            healthScore: 0,
            syntaxValid: false,
            suggestions: ['Fix syntax errors to enable analysis.'],
            smells: [],
            halstead: { vocabulary: 0, length: 0, volume: 0, difficulty: 0, effort: 0 }
        };
    }
};
