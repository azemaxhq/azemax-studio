import { describe, it, expect } from 'vitest';
import {
    stripAllReasoning,
    cleanResponse,
    sanitizeEditorOutput,
    createVisibleContentFilter,
    createLeadingPreambleSuppressor,
} from '../src/core/ai/AIResponseParser';

describe('AI Reasoning Filter', () => {
    describe('stripAllReasoning', () => {
        it('should remove Qwen-style thinking blocks', () => {
            const input = ' thinking\n This is reasoning \n response\n Hello world!';
            const result = stripAllReasoning(input);
            expect(result).toBe('Hello world!');
        });

        it('should remove XML-style thinking blocks', () => {
            const input = '<thinking>Internal reasoning</thinking>Visible answer';
            const result = stripAllReasoning(input);
            expect(result).toBe('Visible answer');
        });

        it('should remove unclosed XML thinking blocks at end', () => {
            const input = 'Hello <thinking>Unclosed reasoning';
            const result = stripAllReasoning(input);
            expect(result).toBe('Hello');
        });

        it('should remove leading reasoning preamble lines', () => {
            const input = 'The user wants a hello world\nI need to think about this\n\nHello!';
            const result = stripAllReasoning(input);
            expect(result).toBe('Hello!');
        });

        it('should remove "Self-Correction" lines', () => {
            const input = 'Self-Correction/Refinement during thought: Fixed something\nActual answer';
            const result = stripAllReasoning(input);
            expect(result).toBe('Actual answer');
        });

        it('should remove "All constraints checked" lines', () => {
            const input = 'All constraints checked: true\nHere is the answer';
            const result = stripAllReasoning(input);
            expect(result).toBe('Here is the answer');
        });

        it('should remove "Result:" prefix', () => {
            const input = 'Result: 42';
            const result = stripAllReasoning(input);
            expect(result).toBe('42');
        });

        it('should preserve legitimate code content', () => {
            const input = 'def hello():\n    print("Hello")\n    # This is a comment\n    return "done"';
            const result = stripAllReasoning(input);
            expect(result).toContain('def hello():');
            expect(result).toContain('print("Hello")');
            expect(result).toContain('# This is a comment');
        });
    });

    describe('cleanResponse', () => {
        it('should strip reasoning and code fences', () => {
            const input = '```python\nprint("hello")\n```';
            const result = cleanResponse(input);
            expect(result).toBe('print("hello")');
        });

        it('should remove reasoning then fences', () => {
            const input = '<thinking>thinking</thinking>\n```python\nprint("hello")\n```';
            const result = cleanResponse(input);
            expect(result).toBe('print("hello")');
        });

        it('should handle empty response', () => {
            expect(cleanResponse('')).toBe('');
            expect(cleanResponse('   ')).toBe('');
        });
    });

    describe('sanitizeEditorOutput', () => {
        it('should remove thinking blocks from code', () => {
            const input = '<thinking>reasoning</thinking>\ndef foo():\n    return 1';
            const result = sanitizeEditorOutput(input);
            expect(result).toBe('def foo():\n    return 1');
        });

        it('should remove Qwen-style inline thinking', () => {
            const input = ' thinking\n reason \n response\n def foo():\n    return 1';
            const result = sanitizeEditorOutput(input);
            expect(result).toBe('def foo():\n    return 1');
        });

        it('should remove conversational wrapper lines', () => {
            const input = 'Here is the code:\ndef foo():\n    return 1\nDone!';
            const result = sanitizeEditorOutput(input);
            expect(result).toBe('def foo():\n    return 1');
        });

        it('should preserve legitimate code with strings containing "thinking"', () => {
            const input = 'def foo():\n    return "thinking about it"';
            const result = sanitizeEditorOutput(input);
            expect(result).toContain('thinking about it');
        });
    });

    describe('createVisibleContentFilter (streaming)', () => {
        it('should filter out thinking blocks', () => {
            const filter = createVisibleContentFilter();
            // Push a complete thinking block
            filter.push(' thinking\n reason \n response\n');
            // After thinking block, visible content should pass through
            const result = filter.push('Visible content');
            // The filter may include a leading newline from the thinking block closure
            expect(result).toContain('Visible content');
        });

        it('should pass through visible content immediately when no thinking', () => {
            const filter = createVisibleContentFilter();
            const result = filter.push('Hello ');
            expect(result).toBe('Hello ');
        });

        it('should handle mixed thinking and content across chunks', () => {
            const filter = createVisibleContentFilter();
            // First chunk has thinking start
            filter.push(' thinking\n reason');
            // Second chunk closes thinking and has content
            const result = filter.push(' response\nVisible content');
            // The filter may include content from the closing of thinking block
            expect(result).toContain('Visible content');
        });

        it('should drop unclosed thinking at stream end', () => {
            const filter = createVisibleContentFilter();
            filter.push(' thinking\n reason');
            const result = filter.end();
            // Unclosed thinking is dropped
            expect(result).toBe('');
        });

        it('should release normal content at stream end', () => {
            const filter = createVisibleContentFilter();
            // Push content that doesn't look like thinking
            const pushResult = filter.push('Hello world');
            // Content is released incrementally during push()
            expect(pushResult).toContain('Hello');
            // end() returns any remaining buffered content
            const endResult = filter.end();
            // Combined should have the full content
            expect(pushResult + endResult).toContain('Hello');
        });
    });

    describe('createLeadingPreambleSuppressor', () => {
        it('should suppress leading reasoning preambles', () => {
            const suppressor = createLeadingPreambleSuppressor();
            // These are held because they look like reasoning preambles
            const r1 = suppressor.feed('The user wants a hello world\n');
            console.log('r1:', JSON.stringify(r1));
            const r2 = suppressor.feed('I need to think\n');
            console.log('r2:', JSON.stringify(r2));
            expect(r1).toBe('');
            expect(r2).toBe('');
            // This is the first non-reasoning line - everything flushes
            // The reasoning preambles are DROPPED (not released) - only the real content passes through
            const result = suppressor.feed('Hello world!\n');
            console.log('result:', JSON.stringify(result));
            expect(result).toContain('Hello world!');
            // The reasoning preambles are dropped, not released
            expect(result).not.toContain('The user wants a hello world');
            expect(result).not.toContain('I need to think');
        });

        it('should not suppress legitimate content after preamble', () => {
            const suppressor = createLeadingPreambleSuppressor();
            suppressor.feed('The user wants...\n');
            const result = suppressor.feed('Here is the actual answer.');
            expect(result).toContain('Here is the actual answer.');
        });
    });

    describe('Defense-in-depth: common reasoning leakage patterns', () => {
        const patterns = [
            'Self-Correction/Refinement during thought: something',
            'Self-Correction/Refinement during thought',
            'The prompt says to do X',
            'Wait, the prompt says Y',
            'All constraints checked: true',
            'All constraints satisfied',
            'All constraints met',
            'I need to analyze this',
            'Let me think about this',
            'Let\'s check the code',
            'Final check: everything looks good',
            'The user wants a function',
            'The user asked for code',
            'The user needs a solution',
            'Internal verification complete',
            'Chain of thought: first...',
            '[Done]',
            'Output matches response',
            'Proceed.',
        ];

        patterns.forEach(pattern => {
            it(`should filter "${pattern}"`, () => {
                const result = stripAllReasoning(pattern + '\nActual answer');
                expect(result).not.toContain(pattern);
                expect(result).toBe('Actual answer');
            });
        });
    });
});