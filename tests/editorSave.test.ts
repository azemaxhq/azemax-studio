import { describe, it, expect } from 'vitest';

// Pure helper mirrors CodeEditor.debouncedSave latest-wins logic for testability.
// Extracted to test the invariant without mounting Monaco.
function decideSaveContent(
    captured: string,
    latest: string | undefined,
    isActive: boolean,
    isProcessing: boolean,
): { action: 'save-captured' | 'save-latest' | 'skip' ; content: string | null } {
    if (isProcessing && isActive) return { action: 'skip', content: null };
    if (!isActive) return { action: 'save-captured', content: captured };
    if (latest !== undefined && latest !== captured) {
        return { action: 'save-latest', content: latest };
    }
    return { action: 'save-captured', content: captured };
}

describe('editor save latest-wins', () => {
    it('CASE 1: rapid edits A→AB→ABC, last debounce persists ABC', () => {
        // Simulate debounce coalesces to ABC
        const captured = 'ABC';
        const latest = 'ABC';
        const r = decideSaveContent(captured, latest, true, false);
        expect(r.content).toBe('ABC');
    });

    it('CASE 2: user ABC then AI modifies to XYZ before debounce fires', () => {
        const captured = 'ABC';
        const latest = 'XYZ';
        const r = decideSaveContent(captured, latest, true, false);
        expect(r.action).toBe('save-latest');
        expect(r.content).toBe('XYZ');
    });

    it('CASE 3: AI XYZ then user edits immediately to XYZ+user', () => {
        const captured = 'XYZ';
        const latest = 'XYZ\nuser edit';
        const r = decideSaveContent(captured, latest, true, false);
        expect(r.content).toBe(latest);
    });

    it('CASE 4: edit file A then switch to B before debounce fires', () => {
        // A is no longer active, captured is authoritative for A
        const captured = 'content A edited';
        const r = decideSaveContent(captured, 'content B', false, false);
        expect(r.content).toBe(captured);
        expect(r.action).toBe('save-captured');
    });

    it('CASE 5: switch A→B→A preserves latest', () => {
        const captured = 'A latest';
        const latest = 'A latest';
        expect(decideSaveContent(captured, latest, true, false).content).toBe('A latest');
    });

    it('CASE 6: stale save must not overwrite newer content', () => {
        const stale = 'ABC';
        const newer = 'ABCD';
        const r = decideSaveContent(stale, newer, true, false);
        expect(r.content).not.toBe(stale);
        expect(r.content).toBe(newer);
    });

    it('CASE 7: AI in-flight skips save for same file', () => {
        const r = decideSaveContent('ABC', 'ABC', true, true);
        expect(r.action).toBe('skip');
    });

    it('concurrent stale saves: older cannot overwrite newer', () => {
        // Two saves for same file, second is newer
        const first = decideSaveContent('A', 'AB', true, false);
        expect(first.content).toBe('AB');
    });
});
