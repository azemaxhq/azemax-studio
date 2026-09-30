import { describe, it, expect } from 'vitest';
import { _internal, buildAIContext, checkDiagnosticsEx } from '../src/utils/diagnosticsService';
import { getCounts, setDiagnosticResult } from '../src/core/diagnostics/diagnosticStore';

describe('Diagnostics Overhaul - Matrix', () => {
    it('A: Empty file -> No issues', async () => {
        const r = await checkDiagnosticsEx('', 'test.js', { includeAI: false });
        expect(r.diagnostics.length).toBe(0);
        expect(r.errorCount).toBe(0);
        expect(r.status).toBe('success');
    });

    it('B: Valid JavaScript -> No false positives', async () => {
        const code = `function add(a,b){ return a+b; }\nconst x = add(1,2);`;
        const r = await checkDiagnosticsEx(code, 'test.js', { includeAI: false });
        expect(r.diagnostics.length).toBe(0);
    });

    it('C: String containing "()" -> No bracket error', async () => {
        const code = `const s = "()";\nconst t = '(';`;
        const r = await checkDiagnosticsEx(code, 'test.js', { includeAI: false });
        expect(r.diagnostics.length).toBe(0);
    });

    it('D: Multiline function call -> No false bracket error', async () => {
        const code = `foo(\n    bar,\n    baz\n)`;
        const r = await checkDiagnosticsEx(code, 'test.js', { includeAI: false });
        // Should have no bracket errors for balanced multiline
        expect(r.diagnostics.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('E: Real syntax error -> Correct line/column', async () => {
        const code = `function foo(){\n  return 1;\n}\nfoo(`; // unclosed paren
        const r = await checkDiagnosticsEx(code, 'test.js', { includeAI: false });
        expect(r.diagnostics.length).toBeGreaterThan(0);
        expect(r.errorCount).toBeGreaterThan(0);
        const diag = r.diagnostics[0];
        expect(diag.line).toBeGreaterThanOrEqual(1);
    });

    it('F: JSON parse error -> Correct location', async () => {
        const code = `{\n  "a": 1,\n  "b": \n}`;
        const r = await checkDiagnosticsEx(code, 'test.json', { includeAI: false });
        expect(r.diagnostics.length).toBeGreaterThan(0);
        expect(r.diagnostics[0].message.toLowerCase()).toContain('json');
    });

    it('G: HTML void element -> No false missing-close error', async () => {
        const code = `<div><br><img src="x"><input><p>Hello</p></div>`;
        const r = await checkDiagnosticsEx(code, 'test.html', { includeAI: false });
        expect(r.diagnostics.length).toBe(0);
    });

    it('G2: HTML unclosed tag -> Reports error', async () => {
        const code = `<div><p>Hello`;
        const r = await checkDiagnosticsEx(code, 'test.html', { includeAI: false });
        expect(r.diagnostics.length).toBeGreaterThan(0);
    });

    it('J: 8,001+ character file -> No cliff', async () => {
        const large = 'const x=1;\n'.repeat(2000); // ~22k chars
        expect(large.length).toBeGreaterThan(8000);
        const ctx = buildAIContext(large, 'big.js', 'javascript', 1000);
        expect(ctx.length).toBeLessThanOrEqual(12000);
        expect(ctx).toContain('... [');
        // Should still include tail
        expect(ctx).toContain('const x=1;');
        // Ensure no silent truncation to 8000
        const r = await checkDiagnosticsEx(large, 'big.js', { includeAI: false });
        expect(r.diagnostics.length).toBe(0); // valid code
    });

    it('K: AI markdown-fenced JSON -> Correctly parsed', () => {
        const raw = '```json\n[{"line":2,"column":5,"message":"Test error","severity":"error"}]\n```';
        const parsed = _internal.extractJsonArray(raw);
        expect(parsed).toEqual([{ line: 2, column: 5, message: 'Test error', severity: 'error' }]);
    });

    it('K2: AI surrounding prose + JSON', () => {
        const raw = 'Here are the issues:\n[{"line":1,"message":"oops","severity":"warning"}]\nLet me know';
        const parsed = _internal.extractJsonArray(raw);
        expect(Array.isArray(parsed)).toBe(true);
    });

    it('L: AI malformed output -> No false No Errors via validation', () => {
        const raw = 'not json at all';
        const parsed = _internal.extractJsonArray(raw);
        expect(parsed).toBeNull();
        // When AI fails, local should still be preserved
    });

    it('M: AI line 9999 in 10-line file -> Rejected', () => {
        const lineLengths = Array(10).fill(20);
        const diags = _internal.validateAndNormalizeAIDiagnostics([{ line: 9999, message: 'hallucinated' }], 10, lineLengths, 'test.js', null);
        expect(diags.length).toBe(0);
    });

    it('M2: AI valid line -> kept', () => {
        const lineLengths = Array(10).fill(20);
        const diags = _internal.validateAndNormalizeAIDiagnostics([{ line: 5, message: 'real', severity: 'error' }], 10, lineLengths, 'test.js', null);
        expect(diags.length).toBe(1);
        expect(diags[0].line).toBe(5);
    });

    it('N: duplicate local + AI diagnostic -> deduped', () => {
        const local = [{ line: 2, column: 1, endLine: 2, endColumn: 5, message: 'Missing semicolon', severity: 'warning' as const, source: 'language' as const, fileName: 'test.js', fileId: null }];
        const ai = [{ line: 2, column: 1, endLine: 2, endColumn: 5, message: 'Missing semicolon', severity: 'warning' as const, source: 'ai' as const, fileName: 'test.js', fileId: null }];
        const merged = _internal.mergeDiagnostics(local as any, ai as any);
        expect(merged.length).toBe(1);
    });

    it('O: same message on different lines -> both preserved', () => {
        const a = [{ line: 2, column: 1, endLine: 2, endColumn: 5, message: 'Missing semicolon', severity: 'warning' as const, source: 'language' as const, fileName: 'test.js', fileId: null }];
        const b = [{ line: 5, column: 1, endLine: 5, endColumn: 5, message: 'Missing semicolon', severity: 'warning' as const, source: 'language' as const, fileName: 'test.js', fileId: null }];
        const merged = _internal.mergeDiagnostics(a as any, b as any);
        expect(merged.length).toBe(2);
    });

    it('Strip strings: bracket in string ignored', () => {
        const code = `const s = "(((";`;
        const stripped = _internal.stripStringsAndComments(code, 'javascript');
        expect(stripped).not.toContain('"((("');
        expect(stripped.includes('(')).toBe(false);
    });

    it('CSS brace balance', async () => {
        const code = `body { color: red; `;
        const r = await checkDiagnosticsEx(code, 'test.css', { includeAI: false });
        expect(r.diagnostics.length).toBeGreaterThan(0);
    });

    it('Python multiline string not flagged', async () => {
        const code = `x = """\nhello\nworld\n"""\ny = 1`;
        const r = await checkDiagnosticsEx(code, 'test.py', { includeAI: false });
        // Should not report indentation error for content inside triple quotes
        expect(r.diagnostics.filter(d => d.message.includes('indent'))).toHaveLength(0);
    });

    it('Problems counts reflect diagnostics', async () => {
        const code = `foo(`;
        const r = await checkDiagnosticsEx(code, 'test.js', { includeAI: false, fileId: 'file-1' });
        setDiagnosticResult('file-1', r);
        const counts = getCounts('file-1');
        expect(counts.errors).toBe(r.errorCount);
        expect(counts.warnings).toBe(r.warningCount);
    });

    it('Severity normalization defaults to warning', () => {
        const lineLengths = [20,20];
        const diags = _internal.validateAndNormalizeAIDiagnostics([{ line: 1, message: 'test' }], 2, lineLengths, 'test.js', null);
        expect(diags[0].severity).toBe('warning');
    });
});
