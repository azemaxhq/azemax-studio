import { describe, it, expect } from 'vitest';
import {
    parseStructuredEdits,
    applyStructuredEdits,
    sanitizeEditorOutputWithPolicy,
    sanitizeAndNormalizeEditorOutput,
} from '../src/core/ai';

describe('AI Code Transformation', () => {
    describe('parseStructuredEdits', () => {
        it('should parse valid single-line edit', () => {
            const result = parseStructuredEdits(
                JSON.stringify({ type: 'edit', edits: [{ startLine: 1, endLine: 1, replacement: 'const x = 2;' }] })
            );
            expect(result).not.toBeNull();
            expect(result!.edits.length).toBe(1);
            expect(result!.edits[0].replacement).toBe('const x = 2;');
        });

        it('should parse valid multi-line replacement', () => {
            const result = parseStructuredEdits(
                JSON.stringify({ 
                    type: 'edit', 
                    edits: [{ startLine: 1, endLine: 3, replacement: 'function hello() {\n    console.log("hello");\n}\n\nhello();' }] 
                })
            );
            expect(result).not.toBeNull();
            expect(result!.edits.length).toBe(1);
            expect(result!.edits[0].startLine).toBe(1);
            expect(result!.edits[0].endLine).toBe(3);
            expect(result!.edits[0].replacement).toContain('function hello()');
        });

        it('should parse fenced JSON payload', () => {
            const result = parseStructuredEdits('```json\n{"type":"edit","edits":[{"startLine":1,"endLine":1,"replacement":"x"}]}\n```');
            expect(result).not.toBeNull();
        });

it('should parse XML-style reasoning-wrapped payload', () => {
            const result = parseStructuredEdits('<thinking>reasoning</thinking>\n{"type":"edit","edits":[{"startLine":1,"endLine":1,"replacement":"x"}]}');
            expect(result).not.toBeNull();
        });

        it('should return null for non-edit JSON', () => {
            expect(parseStructuredEdits('{"foo":1}')).toBeNull();
        });

        it('should return null for garbage', () => {
            expect(parseStructuredEdits('not json at all')).toBeNull();
        });

        it('should return null for invalid edit shape', () => {
            expect(parseStructuredEdits('{"type":"edit","edits":[{"nope":1}]}')).toBeNull();
        });

        it('should handle insert at start (endLine=1)', () => {
            const result = parseStructuredEdits(
                JSON.stringify({ 
                    type: 'edit', 
                    edits: [{ startLine: 1, endLine: 1, replacement: '// Header\n' }] 
                })
            );
            expect(result).not.toBeNull();
            expect(result!.edits[0].endLine).toBe(1);
        });

        it('should handle deletion (empty replacement)', () => {
            const result = parseStructuredEdits(
                JSON.stringify({ 
                    type: 'edit', 
                    edits: [{ startLine: 2, endLine: 3, replacement: '' }] 
                })
            );
            expect(result).not.toBeNull();
            expect(result!.edits[0].replacement).toBe('');
        });
    });

    describe('applyStructuredEdits', () => {
        const code = ['const x = 1;', 'const y = 2;', 'const z = 3;', 'const w = 4;'].join('\n');

        it('should apply single-line replacement', () => {
            const applied = applyStructuredEdits(code, [{ startLine: 2, endLine: 2, replacement: 'const y = 20;' }]);
            expect(applied).toBe(['const x = 1;', 'const y = 20;', 'const z = 3;', 'const w = 4;'].join('\n'));
        });

        it('should apply multi-line replacement', () => {
            const applied = applyStructuredEdits(code, [{ startLine: 1, endLine: 2, replacement: 'const a = 1;\nconst b = 2;' }]);
            expect(applied).toBe(['const a = 1;', 'const b = 2;', 'const z = 3;', 'const w = 4;'].join('\n'));
        });

        it('should apply full-file replacement (wrap in function)', () => {
            const originalCode = 'console.log("hello world");';
            const applied = applyStructuredEdits(originalCode, [{ 
                startLine: 1, 
                endLine: 1, 
                replacement: 'function hello() {\n    console.log("hello world");\n}\n\nhello();' 
            }]);
            expect(applied).toBe('function hello() {\n    console.log("hello world");\n}\n\nhello();');
        });

        it('should apply insertion at start (endLine=1 inserts before line 1)', () => {
            const applied = applyStructuredEdits(code, [{ startLine: 1, endLine: 1, replacement: '// Header' }]);
            // Insertion at start: replace line 1 with new content, pushing old content down
            expect(applied).toBe(['// Header', 'const y = 2;', 'const z = 3;', 'const w = 4;'].join('\n'));
        });

        it('should apply deletion (empty replacement)', () => {
            const applied = applyStructuredEdits(code, [{ startLine: 2, endLine: 3, replacement: '' }]);
            // Deletion removes lines 2-3, leaving line 1 and 4 (with blank line between)
            expect(applied).toBe('const x = 1;\n\nconst w = 4;');
        });

        it('should reject out-of-range start', () => {
            expect(applyStructuredEdits(code, [{ startLine: 99, endLine: 99, replacement: 'x' }])).toBeNull();
        });

        it('should reject start > end', () => {
            expect(applyStructuredEdits(code, [{ startLine: 3, endLine: 2, replacement: 'x' }])).toBeNull();
        });

        it('should reject empty edits', () => {
            expect(applyStructuredEdits(code, [])).toBeNull();
        });

        it('should handle multi-line replacement with proper indentation', () => {
            const applied = applyStructuredEdits(code, [{ 
                startLine: 2, 
                endLine: 3, 
                replacement: 'function test() {\n    return 42;\n}' 
            }]);
            expect(applied).toContain('function test()');
            expect(applied).toContain('return 42;');
        });
    });

    describe('sanitizeEditorOutputWithPolicy (code transformation)', () => {
        it('should strip reasoning from code transformation output', () => {
            const result = sanitizeEditorOutputWithPolicy(
                'Self-Correction: need to wrap\nfunction hello() {\n    console.log("hello world");\n}\n\nhello();',
                { task: 'code-gen', language: 'typescript', userInstruction: 'create a function to call it', outputMode: 'edit' }
            );
            expect(result).not.toContain('Self-Correction');
            expect(result).toContain('function hello()');
            expect(result).toContain('console.log("hello world")');
            expect(result).toContain('hello();');
        });

        it('should strip markdown fences from transformation', () => {
            const result = sanitizeEditorOutputWithPolicy(
                '```typescript\nfunction hello() {\n    console.log("hello");\n}\n```',
                { task: 'code-gen', language: 'typescript', userInstruction: 'create function', outputMode: 'edit' }
            );
            expect(result).toBe('function hello() {\n    console.log("hello");\n}');
        });

        it('should strip filler text', () => {
            const result = sanitizeEditorOutputWithPolicy(
                'Sure, here is the code:\nfunction hello() { return 1; }',
                { task: 'code-gen', language: 'typescript', userInstruction: 'create function', outputMode: 'edit' }
            );
            expect(result).not.toContain('Sure');
            expect(result).not.toContain('here is');
            expect(result).toContain('function hello()');
        });
    });

    describe('sanitizeAndNormalizeEditorOutput', () => {
        it('should strip fences and normalize', () => {
            const result = sanitizeAndNormalizeEditorOutput('```ts\nconst x = 1;\n```');
            expect(result).toBe('const x = 1;');
        });

        it('should handle CRLF line endings', () => {
            const result = sanitizeAndNormalizeEditorOutput('const x = 1;\r\nconst y = 2;\r\n');
            expect(result).toBe('const x = 1;\nconst y = 2;');
        });

        it('should handle reasoning blocks', () => {
            const result = sanitizeAndNormalizeEditorOutput('<thinking>reasoning</thinking>\nconst x = 1;');
            expect(result).toBe('const x = 1;');
        });
    });

    describe('Function wrap transformation (regression test)', () => {
        it('should transform console.log to wrapped function + call', () => {
            const originalCode = 'console.log("hello world");';
            const _instruction = 'create a function to call it';
            
            // Simulate what the AI should return as a structured edit
            const edits = [{ 
                startLine: 1, 
                endLine: 1, 
                replacement: 'function hello() {\n    console.log("hello world");\n}\n\nhello();' 
            }];
            
            const applied = applyStructuredEdits(originalCode, edits);
            
            expect(applied).not.toBeNull();
            expect(applied).toContain('function hello()');
            expect(applied).toContain('console.log("hello world")');
            expect(applied).toContain('hello();');
            // Should NOT just append - the original line should be transformed
            expect(applied).not.toBe('console.log("hello world");\nfunction hello() {\n    console.log("hello world");\n}\n\nhello();');
        });

        it('should wrap existing code in function and add call', () => {
            const originalCode = 'const result = a + b;';
            const edits = [{ 
                startLine: 1, 
                endLine: 1, 
                replacement: 'function add() {\n    const result = a + b;\n    return result;\n}\n\nadd();' 
            }];
            
            const applied = applyStructuredEdits(originalCode, edits);
            
            expect(applied).not.toBeNull();
            expect(applied).toContain('function add()');
            expect(applied).toContain('const result = a + b;');
            expect(applied).toContain('return result;');
            expect(applied).toContain('add();');
        });
    });});
