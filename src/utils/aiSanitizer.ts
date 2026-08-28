/**
 * Backward-compatible shim. The strict editor sanitizer now lives in the AI
 * runtime (`src/core/ai/AIResponseParser.sanitizeEditorOutput`); this module
 * re-exports it under its historical name so existing importers keep working.
 */
import { sanitizeEditorOutput } from '../core/ai/AIResponseParser';
import { normalizeGeneratedCode } from '../core/ai/AICodeNormalizer';
import { validateGeneratedCode } from '../core/ai/AICodeValidator';

export const sanitizeAiCodeOutput = sanitizeEditorOutput;
export default sanitizeEditorOutput;

/**
 * Language-aware editor sanitizer used by the editor for `///` commands and
 * inline completion. Runs the SAME canonical pipeline as the policy sanitizer
 * (base -> normalizer -> validator) so a second pass in the UI layer can never
 * reintroduce reasoning, fences, or a Python indentation regression.
 */
export const sanitizeAiCodeOutputForLanguage = (
    raw: string,
    language?: string | null,
): string => {
    if (!raw) return '';
    let out = normalizeGeneratedCode(sanitizeEditorOutput(raw), { language });
    const validation = validateGeneratedCode(out, { language });
    if (!validation.valid) {
        out = normalizeGeneratedCode(out, { language });
        if (!validateGeneratedCode(out, { language }).valid) {
            console.warn('[aiSanitizer] Rejected AI output:', validation.reason);
            return '';
        }
    }
    return out;
};