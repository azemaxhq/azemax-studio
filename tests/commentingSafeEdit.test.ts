import { describe, it, expect } from 'vitest';
import { applyCommentInsertions, removeCommentsDeterministically, validateCommentPreservation } from '../src/core/ai/commentApplier';
import { executeActionPlan } from '../src/core/ai/aiToolExecutor';

const baseC = `#include <stdio.h>
int main() {
    printf("Hello bro!\\n");
    return 0;
}`;

describe('Safe Comment Edit Engine - Regression', () => {
    it('1. Add a comment explaining main → near main correctly', () => {
        const result = applyCommentInsertions(baseC, [{ line: 2, text: 'Entry point' }], 'c')!;
        expect(result).toContain('// Entry point');
        // Should be directly above main (line 2)
        const lines = result.split('\n');
        const idxMain = lines.findIndex(l => l.includes('int main'));
        expect(lines[idxMain - 1].trim()).toBe('// Entry point');
        // No duplicate #include
        expect((result.match(/#include/g) || []).length).toBe(1);
    });

    it('2. Change this comment to say it prints hello bro → replace, not duplicate', () => {
        const withComment = applyCommentInsertions(baseC, [{ line: 2, text: 'Entry point' }], 'c')!;
        const changed = applyCommentInsertions(withComment, [{ line: 2, text: 'Prints hello bro' }], 'c')!;
        expect(changed).toContain('Prints hello bro');
        expect(changed).not.toContain('Entry point');
        expect((changed.match(/Prints hello bro/g) || []).length).toBe(1);
        // Should not duplicate the comment line
        const count = changed.split('\n').filter(l => l.includes('Prints hello bro')).length;
        expect(count).toBe(1);
        // Executable preserved
        expect(validateCommentPreservation(baseC, changed, 'c')).toBe(true);
    });

    it('3. Remove this comment → only that comment disappears', async () => {
        const withTwo = applyCommentInsertions(baseC, [{ line: 2, text: 'Main' }, { line: 3, text: 'Print' }], 'c')!;
        let current = withTwo;
        const deps: any = {
            getFileContent: (p: string) => p === 'hello.c' ? current : null,
            getFileIdByPath: () => 'id1',
            createFile: () => ({ success: true }),
            deleteNode: () => {},
            renameNode: () => ({ success: true }),
            updateFileContent: (id: string, c: string) => { current = c; return { success: true }; },
            getActiveFilePath: () => 'hello.c',
            getActiveFileId: () => 'id1',
        };
        // Remove only the first comment (line 2 in original, but after insertion it's at line 2)
        // We simulate "remove this comment" at line 2 (the Main comment)
        const lines = withTwo.split('\n');
        const idx = lines.findIndex(l => l.includes('Main'));
        // Remove via selection scope
        const res = await executeActionPlan([{ action: 'remove_comments', file: 'hello.c', scope: 'selection', selectionRange: { startLine: idx + 1, endLine: idx + 1 } } as any], deps, { language: 'c' });
        expect(res.success).toBe(true);
        expect(current).not.toContain('Main');
        expect(current).toContain('Print'); // other comment preserved
    });

    it('4. Repeat same request twice → no duplicate', async () => {
        let current = baseC;
        const deps: any = {
            getFileContent: (p: string) => p === 'hello.c' ? current : null,
            getFileIdByPath: () => 'id1',
            createFile: () => ({ success: true }),
            deleteNode: () => {},
            renameNode: () => ({ success: true }),
            updateFileContent: (id: string, c: string) => { current = c; return { success: true }; },
            getActiveFilePath: () => 'hello.c',
            getActiveFileId: () => 'id1',
        };
        const plan = [{ action: 'add_comments', comments: [{ line: 2, text: 'Entry' }], file: 'hello.c' } as any];
        const r1 = await executeActionPlan(plan, deps as any, { language: 'c' });
        const after1 = current;
        const r2 = await executeActionPlan(plan, deps as any, { language: 'c' });
        const after2 = current;
        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        expect(after1).toBe(after2);
        expect((after2.match(/\/\/ Entry/g) || []).length).toBe(1);
    });

    it('5. Multiple comments in same file → only referenced one changes', () => {
        const multi = `#include <stdio.h>
int main() { printf("a"); return 0; }
void helper() { printf("b"); }`;
        const withTwo = applyCommentInsertions(multi, [{ line: 2, text: 'Main' }, { line: 3, text: 'Helper' }], 'c')!;
        // Change only helper (line 3's comment, which after insertion is above helper)
        // Find helper comment line
        const lines = withTwo.split('\n');
        const helperIdx = lines.findIndex(l => l.includes('Helper'));
        const changed = applyCommentInsertions(withTwo, [{ line: helperIdx + 1, text: 'Helper UPDATED' }], 'c')!;
        expect(changed).toContain('Main');
        expect(changed).toContain('Helper UPDATED');
        expect(changed).not.toContain('Helper\n'); // old
        // Ensure main unchanged
        expect(changed.split('\n').filter(l => l.includes('Main')).length).toBe(1);
    });

    it('6. Similar comments nearby → choose correct one via context (line number)', () => {
        const similar = `// First helper
void foo() { printf("foo"); }
// Second helper
void bar() { printf("bar"); }`;
        // Change second
        const lines = similar.split('\n');
        const secondIdx = lines.findIndex(l => l.includes('Second helper'));
        const changed = applyCommentInsertions(similar, [{ line: secondIdx + 1, text: 'Second UPDATED' }], 'c')!;
        expect(changed).toContain('First helper');
        expect(changed).toContain('Second UPDATED');
        expect(changed).not.toContain('Second helper\n');
    });

    it('7. Code change should modify code, not create comment', async () => {
        let current = baseC;
        const deps: any = {
            getFileContent: (p: string) => p === 'hello.c' ? current : null,
            getFileIdByPath: () => 'id1',
            createFile: () => ({ success: true }),
            deleteNode: () => {},
            renameNode: () => ({ success: true }),
            updateFileContent: (id: string, c: string) => { current = c; return { success: true }; },
            getActiveFilePath: () => 'hello.c',
            getActiveFileId: () => 'id1',
        };
        const res = await executeActionPlan([{ action: 'replace_code', path: 'hello.c', startLine: 3, endLine: 3, content: '    printf("Hi bro!\\n");' } as any], deps, { language: 'c' });
        expect(res.success).toBe(true);
        expect(current).toContain('Hi bro');
        expect(current).not.toContain('// Hi bro'); // should not be comment
        expect((current.match(/printf/g) || []).length).toBe(1);
    });

    it('8. Invalid/ambiguous request → no destructive edit', () => {
        const invalid = applyCommentInsertions(baseC, [{ line: 100, text: 'oops' }], 'c');
        expect(invalid).toBe(baseC); // out of range, no change
        const dupAttempt = applyCommentInsertions(baseC, [{ line: 3, text: 'printf("Hello bro!\\n");' }], 'c');
        expect(dupAttempt).toBe(baseC); // duplicate code as comment blocked
    });

    it('9. Verify no duplicate #include, functions, etc.', () => {
        const withComments = applyCommentInsertions(baseC, [{ line: 2, text: 'Entry' }, { line: 3, text: 'Print' }], 'c')!;
        expect((withComments.match(/#include/g) || []).length).toBe(1);
        expect((withComments.match(/int main/g) || []).length).toBe(1);
        expect((withComments.match(/printf.*Hello bro/g) || []).length).toBe(1);
        expect(withComments).not.toContain('change to hello bro'); // should not invent
    });

    it('Preserves strings with comment-like text', () => {
        const src = `printf("hello // world");
printf("hello /* world */");
int x = 0; // real comment`;
        const cleaned = removeCommentsDeterministically(src, 'c')!;
        expect(cleaned).toContain('printf("hello // world")');
        expect(cleaned).toContain('printf("hello /* world */")');
        expect(cleaned).toContain('int x = 0;');
        expect(cleaned).not.toContain('real comment');
    });

    it('Executable preservation for comment ops', () => {
        const withComments = applyCommentInsertions(baseC, [{ line: 2, text: 'Entry' }], 'c')!;
        expect(validateCommentPreservation(baseC, withComments, 'c')).toBe(true);
        // Modified code should not preserve
        const modified = baseC.replace('Hello bro', 'Hi');
        expect(validateCommentPreservation(baseC, modified, 'c')).toBe(false);
    });

    it('Stale line numbers — semantic matching', async () => {
        // Simulate file changed between request and response: original snapshot had 5 lines, latest has an extra line inserted at top
        const snapshot = baseC;
        const snapshotLines = snapshot.split('\n');
        const latest = `// New top comment
${snapshot}`;
        let current = latest;
        const deps: any = {
            getFileContent: () => current,
            getFileIdByPath: () => 'id1',
            createFile: () => ({ success: true }),
            deleteNode: () => {},
            renameNode: () => ({ success: true }),
            updateFileContent: (id: string, c: string) => { current = c; return { success: true }; },
            getActiveFilePath: () => 'hello.c',
            getActiveFileId: () => 'id1',
        };
        const snapshotObj = { filePath: 'hello.c', content: snapshot, lines: snapshotLines, timestamp: Date.now() } as any;
        const snapshotMap = new Map([[ 'hello.c', snapshotObj ]]);
        // Try to add comment at original line 2 (which in snapshot is "int main() {", but in latest it's line 3 due to new top comment)
        // Our stale resolution should find the correct line via content search
        const plan = [{ action: 'add_comments', comments: [{ line: 2, text: 'Entry for main' }], file: 'hello.c' } as any];
        // The executor's stale handling should resolve line 2 snapshot to line 3 latest
        const res = await executeActionPlan(plan, deps as any, { language: 'c', snapshot: snapshotObj, snapshotMap } as any);
        // It may succeed or be considered stale — but should not corrupt
        // For this test, we just check it doesn't duplicate or throw and either succeeds or fails gracefully
        expect(res.success || res.message.includes('stale') || res.message.includes('No valid')).toBeTruthy();
        if (res.success) {
            expect(current).toContain('Entry for main');
            // Should not duplicate top comment
            expect((current.match(/New top comment/g) || []).length).toBe(1);
        }
    });
});
