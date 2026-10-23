/**
 * Shared Ageing Types — breaks circular dependency between codeAnalysisEngine and detectors.
 */

export interface AgeingHotspot {
    line: number;
    code: string;
    reason: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    signalId: string;
}

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

export type AgeingGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface CodeAgeingResult {
    overallScore: number;           // 0-100 (0 = fresh, 100 = legacy)
    grade: AgeingGrade;
    gradeLabel: string;
    signals: AgeingSignal[];        // all detected signals
    hotspots: AgeingHotspot[];      // line-level hotspots
    summary: string;                // human-friendly summary
    categoryScores: Record<string, number>; // per-category scores
}

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