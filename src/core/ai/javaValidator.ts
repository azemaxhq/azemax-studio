/**
 * Java file/class consistency validator.
 *
 * Guard before applying AI-generated Java changes:
 *   filename (Hello.java) must match `public class Hello`.
 *   Never silently insert `public class BinarySearch` into `hello.java`.
 *   Prefer modifying existing class or creating BinarySearch.java.
 */

export interface JavaValidationResult {
    valid: boolean;
    reason?: string;
    expectedClass?: string;
    foundClass?: string;
    /** When true, executor may auto-fix content (rename class to expected) */
    willAutoFix?: boolean;
    fixedContent?: string;
}

const PUBLIC_CLASS_RE = /\bpublic\s+(?:(?:final|abstract|sealed)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const ANY_CLASS_RE = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g;

export function extractJavaPublicClass(code: string): string | null {
    PUBLIC_CLASS_RE.lastIndex = 0;
    const m = PUBLIC_CLASS_RE.exec(code);
    return m ? m[1] : null;
}

export function extractAllJavaClasses(code: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    ANY_CLASS_RE.lastIndex = 0;
    while ((m = ANY_CLASS_RE.exec(code)) !== null) out.push(m[1]);
    return out;
}

export function validateJavaFileContent(
    fileName: string,
    content: string,
    opts?: { allowNewFile?: boolean; existingContent?: string | null; targetPath?: string }
): JavaValidationResult {
    const base = fileName.split('/').pop() ?? fileName;
    const ext = base.split('.').pop()?.toLowerCase();
    if (ext !== 'java') return { valid: true };
    const expected = base.replace(/\.java$/i, '');
    if (!expected) return { valid: true };

    // Extract all public types (class/interface/enum/record) from candidate
    PUBLIC_CLASS_RE.lastIndex = 0;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = PUBLIC_CLASS_RE.exec(content)) !== null) matches.push(m[1]);
    // Also check interface/enum/record that PUBLIC_CLASS_RE misses
    if (matches.length === 0) {
        const pubAlt = content.match(/\bpublic\s+(?:interface|enum|record|@interface)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (pubAlt) matches.push(pubAlt[1]);
    }

    if (matches.length === 0) {
        return { valid: true };
    }
    if (matches.length > 1) {
        return {
            valid: false,
            reason: `Java file "${base}" would contain ${matches.length} public classes (${matches.join(', ')}). A Java file may contain only one public class matching its filename.`,
            expectedClass: expected,
            foundClass: matches[0],
            willAutoFix: false,
        };
    }
    const found = matches[0];
    // Class must match filename exactly — derive expected dynamically, never hard-coded
    if (found === expected) return { valid: true, expectedClass: expected, foundClass: found };

    const foundPattern = found.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fixed = content.replace(
        new RegExp(`(\\bpublic\\s+(?:(?:final|abstract|sealed)\\s+)*(?:class|interface|enum|record|@interface)\\s+)${foundPattern}\\b`),
        `$1${expected}`
    );

    if (opts?.allowNewFile) {
        return {
            valid: false,
            reason: `Java mismatch: file "${base}" declares public class "${found}" but filename expects "${expected}".`,
            expectedClass: expected,
            foundClass: found,
            willAutoFix: false,
        };
    }

    return {
        valid: false,
        reason: `Java mismatch: file "${base}" declares public class "${found}" but expected "${expected}". Auto-fixing class name to "${expected}".`,
        expectedClass: expected,
        foundClass: found,
        willAutoFix: true,
        fixedContent: fixed,
    };
}

/** Decide whether a `create_file` vs `update_file` is appropriate for the intent */
export function shouldCreateNewJavaFile(
    activeFileName: string | null,
    activeContent: string | null,
    _requestedTopic: string,
    generatedContent: string
): { shouldCreate: boolean; suggestedPath?: string } {
    const inferred = extractJavaPublicClass(generatedContent);
    if (!inferred) return { shouldCreate: false };
    if (!activeFileName) return { shouldCreate: true, suggestedPath: `${inferred}.java` };
    const activeBase = activeFileName.split('/').pop() ?? activeFileName;
    const activeExpected = activeBase.replace(/\.java$/i, '');
    if (inferred === activeExpected) return { shouldCreate: false };
    // If active file is non-empty and already has a different public class, new class should be a new file
    if (activeContent && activeContent.trim().length > 0) {
        const activeClass = extractJavaPublicClass(activeContent);
        if (activeClass && activeClass !== inferred) {
            return { shouldCreate: true, suggestedPath: `${inferred}.java` };
        }
        if (activeClass === activeExpected && inferred !== activeExpected) {
            return { shouldCreate: true, suggestedPath: `${inferred}.java` };
        }
    }
    return { shouldCreate: false };
}
