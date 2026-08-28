import { describe, it, expect } from 'vitest';
import {
    sanitizeEditorOutputWithPolicy,
    isCommentingIntent,
    isDocumentingIntent,
    applyCommentSyntax,
    getCommentSyntax,
    validateCommentSyntax,
    stripInvalidCommentSyntax,
} from '../src/core/ai';

describe('AI Commenting', () => {
    describe('isCommentingIntent', () => {
        it('should detect explicit comment requests', () => {
            expect(isCommentingIntent('add a comment')).toBe(true);
            expect(isCommentingIntent('write comments')).toBe(true);
            expect(isCommentingIntent('comment this function')).toBe(true);
            expect(isCommentingIntent('add comments to this code')).toBe(true);
            expect(isCommentingIntent('/// comment: explain this')).toBe(true);
        });

        it('should not detect non-comment requests', () => {
            expect(isCommentingIntent('fix this bug')).toBe(false);
            expect(isCommentingIntent('refactor this code')).toBe(false);
            expect(isCommentingIntent('explain this')).toBe(false);
        });
    });

    describe('isDocumentingIntent', () => {
        it('should detect documentation requests', () => {
            expect(isDocumentingIntent('add documentation')).toBe(true);
            expect(isDocumentingIntent('write docstrings')).toBe(true);
            expect(isDocumentingIntent('document this function')).toBe(true);
            expect(isDocumentingIntent('javadoc this')).toBe(true);
        });

        it('should not detect non-documentation requests', () => {
            expect(isDocumentingIntent('add a comment')).toBe(false);
            expect(isDocumentingIntent('fix this')).toBe(false);
        });
    });

    describe('applyCommentSyntax', () => {
        it('should apply Python comment syntax', () => {
            const result = applyCommentSyntax('This is a comment', 'python');
            expect(result).toBe('# This is a comment');
        });

        it('should apply JavaScript/TypeScript comment syntax', () => {
            const result = applyCommentSyntax('This is a comment', 'typescript');
            expect(result).toBe('// This is a comment');
        });

        it('should apply Java/C/C++/C# comment syntax', () => {
            expect(applyCommentSyntax('Comment', 'java')).toBe('// Comment');
            expect(applyCommentSyntax('Comment', 'c')).toBe('// Comment');
            expect(applyCommentSyntax('Comment', 'cpp')).toBe('// Comment');
            expect(applyCommentSyntax('Comment', 'csharp')).toBe('// Comment');
        });

        it('should apply CSS comment syntax', () => {
            const result = applyCommentSyntax('Comment', 'css');
            expect(result).toBe('/* Comment */');
        });

        it('should strip markdown fences and wrappers', () => {
            const result = applyCommentSyntax('```python\n# Comment\n```', 'python');
            expect(result).toBe('# Comment');
        });

        it('should strip "Here is the comment:" prefix', () => {
            const result = applyCommentSyntax('Here is the comment:\nThis is it', 'python');
            expect(result).toBe('# This is it');
        });

        it('should handle multi-line comments', () => {
            const result = applyCommentSyntax('Line 1\nLine 2', 'python');
            expect(result).toBe('# Line 1\n# Line 2');
        });
    });

    describe('getCommentSyntax', () => {
        it('should return correct syntax for Python', () => {
            const syntax = getCommentSyntax('python');
            expect(syntax?.line).toBe('#');
            expect(syntax?.blockStart).toBe('"""');
            expect(syntax?.supported).toBe(true);
        });

        it('should return correct syntax for TypeScript', () => {
            const syntax = getCommentSyntax('typescript');
            expect(syntax?.line).toBe('//');
            expect(syntax?.blockStart).toBe('/*');
            expect(syntax?.supported).toBe(true);
        });

        it('should return correct syntax for Java', () => {
            const syntax = getCommentSyntax('java');
            expect(syntax?.line).toBe('//');
            expect(syntax?.supported).toBe(true);
        });

        it('should return correct syntax for CSS', () => {
            const syntax = getCommentSyntax('css');
            expect(syntax?.blockStart).toBe('/*');
            expect(syntax?.blockEnd).toBe('*/');
            expect(syntax?.supported).toBe(true);
        });
    });

    describe('validateCommentSyntax', () => {
        it('should validate Python comments', () => {
            expect(validateCommentSyntax('# Valid comment', 'python')).toBe(true);
            expect(validateCommentSyntax('"""Docstring"""', 'python')).toBe(true);
        });

        it('should reject invalid syntax for language', () => {
            expect(validateCommentSyntax('// Invalid in Python', 'python')).toBe(false);
            expect(validateCommentSyntax('# Invalid in JS', 'typescript')).toBe(false);
        });

        it('should accept code without comments', () => {
            expect(validateCommentSyntax('def foo(): return 1', 'python')).toBe(true);
            expect(validateCommentSyntax('function foo() { return 1; }', 'typescript')).toBe(true);
        });
    });

    describe('stripInvalidCommentSyntax', () => {
        it('should remove invalid comment lines', () => {
            const input = '# Valid Python\n// Invalid in Python\ndef foo(): pass';
            const result = stripInvalidCommentSyntax(input, 'python');
            expect(result).toContain('# Valid Python');
            expect(result).not.toContain('// Invalid in Python');
        });
    });

    describe('sanitizeEditorOutputWithPolicy (comment mode)', () => {
        it('should produce valid Python comment', () => {
            const result = sanitizeEditorOutputWithPolicy('Here is the comment:\nCalculates factorial', {
                task: 'comment',
                language: 'python',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('# Calculates factorial');
        });

        it('should produce valid TypeScript comment', () => {
            const result = sanitizeEditorOutputWithPolicy('Here is the comment:\nCalculates sum', {
                task: 'comment',
                language: 'typescript',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('// Calculates sum');
        });

        it('should produce valid Java comment', () => {
            const result = sanitizeEditorOutputWithPolicy('Here is the comment:\nCalculates sum', {
                task: 'comment',
                language: 'java',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('// Calculates sum');
        });

        it('should produce valid CSS comment', () => {
            const result = sanitizeEditorOutputWithPolicy('Here is the comment:\nStyles for header', {
                task: 'comment',
                language: 'css',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('/* Styles for header */');
        });

        it('should strip reasoning from comment output', () => {
            const result = sanitizeEditorOutputWithPolicy('Self-Correction: something\nHere is the comment:\nActual comment', {
                task: 'comment',
                language: 'python',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('# Actual comment');
        });

        it('should strip markdown fences from comment output', () => {
            const result = sanitizeEditorOutputWithPolicy('```python\n# Comment\n```', {
                task: 'comment',
                language: 'python',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).toBe('# Comment');
        });

        it('should not add filler text', () => {
            const result = sanitizeEditorOutputWithPolicy('Sure, here is the comment:\n# Comment', {
                task: 'comment',
                language: 'python',
                userInstruction: 'add a comment',
                outputMode: 'comment',
            });
            expect(result).not.toContain('Sure');
            expect(result).not.toContain('here is');
        });
    });

    describe('sanitizeEditorOutputWithPolicy (non-comment mode)', () => {
        it('should strip comments when not in comment mode', () => {
            const result = sanitizeEditorOutputWithPolicy('// This is a comment\ndef foo(): pass', {
                task: 'code-gen',
                language: 'typescript',
                userInstruction: 'generate code',
                outputMode: 'generate',
            });
            expect(result).not.toContain('// This is a comment');
        });

        it('should preserve existing comments in preserve context', () => {
            // The preserve context protects comments that appear in BOTH the AI output
            // and the original file. If the AI output includes a preserved comment, it's kept.
            const result = sanitizeEditorOutputWithPolicy('// Existing comment\ndef foo(): pass', {
                task: 'edit',
                language: 'typescript',
                userInstruction: 'modify code',
                outputMode: 'edit',
                preserve: '// Existing comment\ndef foo(): pass',
            });
            expect(result).toContain('// Existing comment');
        });
    });
});