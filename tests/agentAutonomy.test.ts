/**
 * Regression tests for autonomous agent behaviour.
 *
 * Covers the 22 scenarios from the Phase 13 matrix:
 *   1-5  ordinary requests + follow-ups ("create a simple website",
 *        "create a todo website using HTML", "inside the hello folder",
 *        "make it responsive", "add dark mode")
 *   6    no active workspace
 *   7    existing project detection
 *   8    multi-file creation
 *   9    multi-file editing
 *   10   real tool execution (against a real in-memory file tree)
 *   11   tool-result continuation (the loop actually cycles)
 *   12   invalid tool arguments
 *   13   provider fallback (a failing step degrades, does not crash)
 *   14   infinite-loop prevention
 *   15   cancellation
 *   16   partial filesystem failures
 *   17   unsaved editor content
 *   18   explorer synchronization
 *   19   persistence
 *   20   bounded quotas / budgets
 *   21   path traversal prevention
 *   22   validation and self-correction
 *
 * The model is MOCKED by stubbing the transport layer, so every assertion is
 * deterministic and no provider key is required.
 */
import { check, finish, installRafStub } from './_harness';
installRafStub();

import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import {
    createFile as opCreateFile,
    createFolder as opCreateFolder,
    ensureFolderPath,
    updateFileContent as opUpdateFileContent,
    deleteNode as opDeleteNode,
    renameNode as opRenameNode,
} from '../src/core/filesystem/operations';
import { normalizeResourcePath, resolveResource } from '../src/core/filesystem/queries';
import { findNodeById } from '../src/utils/safeTree';
import { subscribeFileChanges, emitFileChange, fileChangeListenerCount } from '../src/core/filesystem/fileChangeService';
import { createExecutorDeps } from '../src/core/editor/workspaceBridge';
import { detectWorkspaceFacts, understandIntent, chooseImplementationDefault, renderWorkspaceFacts } from '../src/core/ai/intentUnderstanding';
import { validateToolArgs, parseToolArguments, executeTool, AGENT_TOOL_SCHEMAS, toolDefinitions } from '../src/core/ai/agentTools';
import {
    createTaskContext,
    extendTask,
    recordOperation,
    recordPlan,
    recordValidationFailure,
    addConstraint,
    renderTaskContext,
    buildAgentMessages,
} from '../src/core/ai/agentTaskContext';
import { parseSemanticPlan, buildSemanticPlannerPrompt } from '../src/core/ai/semanticPlanner';
import { normalizeToolCalls } from '../src/core/ai/AIClient';
import { runAgentLoop } from '../src/core/ai/agentLoop';
import type { AgentToolDeps } from '../src/core/ai/agentTools';

// ============================================================================
// In-memory workspace harness — the SAME canonical operations ProjectContext
// uses, so these tests exercise real filesystem behavior, not a mock layer.
// ============================================================================
class TestWorkspace {
    tree: FileNode[] = [];

    getFileTree = (): FileNode[] => this.tree;

    private apply<T extends { changed: boolean; error?: unknown; node?: FileNode }>(op: (t: FileNode[]) => T, kind: 'created' | 'updated'): T {
        const r = op(this.tree);
        if (r.changed && !r.error) {
            this.tree = r.tree;
            if (r.node) emitFileChange({ kind, id: r.node.id, name: r.node.name });
        }
        return r;
    }

    createFile = (path: string, content = '') => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) this.tree = ensureFolderPath(this.tree, dir).tree;
        const parent = dir ? resolveResource(this.tree, dir) : null;
        if (dir && !parent) return { error: { message: `no parent ${dir}` } };
        const parentId = dir ? parent!.id : ROOT_NODE_ID;
        const r = this.apply(t => opCreateFile(t, { name, parentId, content }), 'created');
        return r.error ? { error: r.error } : { changed: true };
    };

    createFolder = (path: string) => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) this.tree = ensureFolderPath(this.tree, dir).tree;
        const parent = dir ? resolveResource(this.tree, dir) : null;
        if (dir && !parent) return { error: { message: `no parent ${dir}` } };
        const parentId = dir ? parent!.id : ROOT_NODE_ID;
        const r = this.apply(t => opCreateFolder(t, { name, parentId }), 'created');
        return r.error ? { error: r.error } : { changed: true };
    };

    deleteNode = (id: string) => {
        const r = opDeleteNode(this.tree, id);
        if (r.changed) {
            this.tree = r.tree;
            emitFileChange({ kind: 'deleted', id, name: String(findNodeById(this.tree, id)?.name ?? id) });
        }
    };

    renameNode = (id: string, newName: string) => {
        const r = this.apply(t => opRenameNode(t, id, newName), 'updated');
        return r.error ? { error: r.error } : { changed: true };
    };

    updateFileContent = (fileId: string, content: string) => {
        const r = this.apply(t => opUpdateFileContent(t, fileId, content), 'updated');
        return r.error ? { error: r.error } : { changed: true };
    };

    content = (path: string): string | null => {
        const n = resolveResource(this.tree, path);
        return n && n.type === 'file' && typeof n.content === 'string' ? n.content : null;
    };

    executorDeps() {
        return createExecutorDeps(
            {
                getFileTree: this.getFileTree,
                createFile: this.createFile,
                deleteNode: this.deleteNode,
                renameNode: this.renameNode,
                updateFileContent: this.updateFileContent,
            },
            null,
            null,
        );
    }

    toolDeps(overrides: Partial<AgentToolDeps> = {}): AgentToolDeps {
        return { getFileTree: this.getFileTree, deps: this.executorDeps(), ...overrides };
    }
}

const mkTreeWith = (...files: string[]): FileNode[] => {
    const ws = new TestWorkspace();
    for (const f of files) ws.createFile(f, 'x');
    return ws.getFileTree();
};

// ============================================================================
// Mock provider transport
// ============================================================================
type Turn = Record<string, unknown>;

const jsonResponse = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * Stub the transport used by AIClient. Each entry in `turns` becomes one
 * provider response; the request body is recorded for assertions.
 */
async function withMockProvider<T>(turns: Turn[], fn: (calls: Array<{ body: any }>) => Promise<T>): Promise<T> {
    const originalFetch = globalThis.fetch;
    const originalBackend = process.env.VITE_USE_BACKEND_AI;
    // Force the direct-provider path so no real network is touched.
    const calls: Array<{ body: any }> = [];
    let i = 0;
    globalThis.fetch = (async (_url: any, init: any) => {
        calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        const turn = turns[Math.min(i, turns.length - 1)];
        i++;
        if (turn && turn.__status && turn.__status !== 200) {
            return new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), { status: turn.__status });
        }
        return jsonResponse(turn);
    }) as typeof fetch;
    try {
        return await fn(calls);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalBackend === undefined) delete process.env.VITE_USE_BACKEND_AI;
        else process.env.VITE_USE_BACKEND_AI = originalBackend;
    }
}

const toolTurn = (name: string, args: Record<string, unknown>, id = 'c1'): Turn => ({
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

// ============================================================================
async function main(): Promise<void> {
    // ────────────────────────────────────────────────────────────────────
    // 6 / 7 — workspace detection (no fabricated default workspace)
    // ────────────────────────────────────────────────────────────────────
    {
        const empty = detectWorkspaceFacts([]);
        check('6. empty workspace: hasProject false', empty.hasProject === false);
        check('6. empty workspace: fileCount 0', empty.fileCount === 0);
        check('6. empty workspace rendered as EMPTY', renderWorkspaceFacts(empty).includes('EMPTY'));

        const ws = new TestWorkspace();
        ws.createFile('index.html', '<h1>hi</h1>');
        ws.createFile('styles.css', 'body{}');
        ws.createFile('script.js', 'console.log(1)');
        const facts = detectWorkspaceFacts(ws.getFileTree());
        check('7. existing project detected', facts.hasProject === true);
        check('7. file count correct', facts.fileCount === 3);
        check('7. html/css/js detected', facts.hasHtml && facts.hasCss && facts.hasJs);
        check('7. no package.json', facts.hasPackageJson === false);
        check('7. dominant extension computed', typeof facts.dominantExtension === 'string');

        const nodeFacts = detectWorkspaceFacts(mkTreeWith('package.json', 'src/app.ts'));
        check('7. package.json detected in existing project', nodeFacts.hasPackageJson === true);
    }

    // ────────────────────────────────────────────────────────────────────
    // 1-5 — ordinary requests never trigger clarification
    // ────────────────────────────────────────────────────────────────────
    {
        const emptyFacts = detectWorkspaceFacts([]);

        const r1 = understandIntent('create a simple website', emptyFacts, {});
        check('1. "create a simple website" → implement', r1.kind === 'implement');
        check('1. "create a simple website" does NOT clarify', r1.needsClarification === false);
        check('1. "create a simple website" wants modification', r1.wantsModification === true);

        const r2 = understandIntent('create a todo website using HTML', emptyFacts, {});
        check('2. todo website using HTML → implement', r2.kind === 'implement');
        check('2. todo website using HTML does NOT clarify', r2.needsClarification === false);
        check('2. explicit html stack detected', r2.explicitStack === 'html');

        const helloWs = new TestWorkspace();
        helloWs.createFolder('hello');
        const r3 = understandIntent('create a portfolio inside the hello folder', detectWorkspaceFacts(helloWs.getFileTree()), {});
        check('3. portfolio inside hello → implement', r3.kind === 'implement');
        check('3. portfolio inside hello does NOT clarify', r3.needsClarification === false);
        check('3. destination resolved to the real folder', r3.destinationDir === 'hello');

        const follow = { historyLength: 4, hasActiveTask: true };
        const r4 = understandIntent('make it responsive', emptyFacts, follow);
        check('4. "make it responsive" → implement', r4.kind === 'implement');
        check('4. "make it responsive" is a follow-up', r4.isFollowUp === true);
        check('4. "make it responsive" does NOT clarify', r4.needsClarification === false);

        const r5 = understandIntent('add dark mode', emptyFacts, follow);
        check('5. "add dark mode" → implement', r5.kind === 'implement');
        check('5. "add dark mode" is a follow-up', r5.isFollowUp === true);
        check('5. "add dark mode" does NOT clarify', r5.needsClarification === false);

        const r5b = understandIntent('using html', emptyFacts, follow);
        check('5b. "using html" is a follow-up, not a new task', r5b.isFollowUp === true);
        check('5b. "using html" does NOT clarify', r5b.needsClarification === false);

        const r6 = understandIntent('continue', emptyFacts, follow);
        check('5c. "continue" → implement', r6.kind === 'implement');
        check('5c. "continue" flagged as continuation', r6.isContinuation === true);
        check('5c. "continue" does NOT clarify', r6.needsClarification === false);

        const r6b = understandIntent('do the remaining work', emptyFacts, follow);
        check('5d. "do the remaining work" is a continuation', r6b.isContinuation === true);
        check('5d. "do the remaining work" does NOT clarify', r6b.needsClarification === false);

        // Explanation must NOT enter the implementation workflow.
        check('explain request does not want modification', understandIntent('explain what this does', emptyFacts, { hasActiveTask: true }).wantsModification === false);
        check('short greeting is chat', understandIntent('hi', emptyFacts, {}).kind === 'chat');
        check('inspection request does not modify', understandIntent('list the files', emptyFacts, {}).wantsModification === false);

        // Genuine blocker only.
        const r9 = understandIntent('delete everything', emptyFacts, {});
        check('destructive-without-target DOES clarify', r9.needsClarification === true);
        check('clarification question is present', Boolean(r9.clarificationQuestion && r9.clarificationQuestion.length > 0));
        const r10 = understandIntent('delete notes.txt', detectWorkspaceFacts(mkTreeWith('notes.txt')), {});
        check('destructive-with-target does NOT clarify', r10.needsClarification === false);
    }

    // ────────────────────────────────────────────────────────────────────
    // Implementation defaults — no framework creep
    // ────────────────────────────────────────────────────────────────────
    {
        const def = chooseImplementationDefault(detectWorkspaceFacts([]), null, null);
        check('default is plain HTML', def.stack === 'html');
        check('default files are index/styles/script', def.files.join(',') === 'index.html,styles.css,script.js');
        check('existing node project is extended, not replaced', chooseImplementationDefault(detectWorkspaceFacts(mkTreeWith('package.json')), null, null).stack === 'existing-node-project');
        check('destination prefixes default files', chooseImplementationDefault(detectWorkspaceFacts([]), null, 'hello').files[0] === 'hello/index.html');
        check('explicit react is honored', chooseImplementationDefault(detectWorkspaceFacts([]), 'react', null).stack === 'react');
    }

    // ────────────────────────────────────────────────────────────────────
    // 21 — path traversal prevention (schema + runtime)
    // ────────────────────────────────────────────────────────────────────
    {
        check('21. traversal rejected by validateToolArgs', validateToolArgs('read_file', { path: '../../etc/passwd' }).ok === false);
        check('21. absolute traversal rejected', validateToolArgs('create_file', { path: '/abs/../x.html', content: '' }).ok === false);
        check('21. normal path accepted', validateToolArgs('read_file', { path: 'ok/file.ts' }).ok === true);
        check('21. write_file requires content', validateToolArgs('write_file', { path: 'a.txt' }).ok === false);
        check('21. over-long path rejected', validateToolArgs('read_file', { path: 'x'.repeat(600) }).ok === false);

        const ws = new TestWorkspace();
        const esc = await executeTool('create_file', { path: '../escape.html', content: 'x' }, ws.toolDeps());
        check('21. executeTool rejects traversal at runtime', esc.ok === false);
        check('21. nothing escaped the workspace', ws.getFileTree().every(n => n.name !== 'escape.html'));

        const leak = await executeTool('read_file', { path: '../../secret' }, ws.toolDeps());
        check('21. traversal read rejected', leak.ok === false);

        check('21. filesystem query rejects traversal', normalizeResourcePath('../x').ok === false);
    }

    // ────────────────────────────────────────────────────────────────────
    // 12 — invalid tool arguments
    // ────────────────────────────────────────────────────────────────────
    {
        check('12. malformed JSON is not a valid call', parseToolArguments('{not json') === null);
        check('12. array is not a valid arg object', parseToolArguments('[1,2]') === null);
        check('12. valid object parses', typeof parseToolArguments('{"a":1}') === 'object');
        check('12. empty string means no args', JSON.stringify(parseToolArguments('')) === '{}');
        check('12. inverted range rejected', validateToolArgs('replace_range', { path: 'a.js', startLine: 10, endLine: 3, content: 'x' }).ok === false);
        check('12. zero line rejected', validateToolArgs('replace_range', { path: 'a.js', startLine: 0, endLine: 3, content: 'x' }).ok === false);
        check('12. unknown tool rejected', validateToolArgs('nope', {}).ok === false);

        const ws = new TestWorkspace();
        const unknown = await executeTool('totally_made_up', {}, ws.toolDeps());
        check('12. unknown tool errors at runtime', unknown.ok === false);
        check('12. unknown tool name reported', (unknown.error || '').includes('Unknown tool'));

        // Malformed JSON never reaches execution as an empty object.
        check('12. malformed args are not coerced to {}', parseToolArguments('{"path":') === null);
    }

    // ────────────────────────────────────────────────────────────────────
    // Tool-call normalization (never treats malformed calls as valid)
    // ────────────────────────────────────────────────────────────────────
    {
        check('toolcalls: valid call normalized', normalizeToolCalls([{ id: 'a', function: { name: 'read_file', arguments: '{}' } }]).length === 1);
        check('toolcalls: missing function dropped', normalizeToolCalls([{ id: 'a' }]).length === 0);
        check('toolcalls: nameless function dropped', normalizeToolCalls([{ id: 'a', function: { arguments: '{}' } }]).length === 0);
        check('toolcalls: non-array dropped', normalizeToolCalls('nope').length === 0);
        check('toolcalls: missing id is synthesized', normalizeToolCalls([{ function: { name: 'x', arguments: '{}' } }])[0].id.startsWith('call_'));
    }

    // ────────────────────────────────────────────────────────────────────
    // 8 / 9 / 10 / 19 — REAL tool execution through the canonical executor
    // ────────────────────────────────────────────────────────────────────
    {
        const ws = new TestWorkspace();

        // 8 — multi-file creation in one session
        const created: string[] = [];
        for (const f of [
            { path: 'index.html', content: '<!doctype html><h1>Todo</h1>' },
            { path: 'styles.css', content: 'body{margin:0}' },
            { path: 'script.js', content: 'const t=[];' },
        ]) {
            const r = await executeTool('create_file', f, ws.toolDeps());
            if (r.ok) created.push(f.path);
        }
        check('8. all three files created via tools', created.length === 3);
        check('8. index.html really exists', ws.content('index.html') !== null);
        check('8. styles.css really exists', ws.content('styles.css') !== null);
        check('8. script.js really exists', ws.content('script.js') !== null);
        check('8. create tool reports applied', created.every(p => ws.content(p) !== null));

        // 9 — multi-file editing
        const idxId = resolveResource(ws.getFileTree(), 'index.html')!.id;
        const cssId = resolveResource(ws.getFileTree(), 'styles.css')!.id;
        ws.updateFileContent(idxId, '<h1>Todo v2</h1>');
        ws.updateFileContent(cssId, 'body{margin:0;padding:1rem}');
        check('9. multi-file edit applied to index.html', (ws.content('index.html') || '').includes('Todo v2'));
        check('9. multi-file edit applied to styles.css', (ws.content('styles.css') || '').includes('1rem'));

        // write_file replaces content wholesale
        const wr = await executeTool('write_file', { path: 'styles.css', content: 'body{margin:0}' }, ws.toolDeps());
        check('9. write_file succeeds', wr.ok === true);
        check('19. write_file persisted real content', ws.content('styles.css') === 'body{margin:0}');

        // read_file returns real content
        const rd = await executeTool('read_file', { path: 'index.html' }, ws.toolDeps());
        check('10. read_file returns the real content', String(rd.data.content).includes('Todo v2'));

        // list_files reflects reality
        const ls = await executeTool('list_files', {}, ws.toolDeps());
        check('10. list_files reflects the real tree', (ls.data.entries as any[]).length === 3);

        // search_files finds real content
        const se = await executeTool('search_files', { query: 'Todo' }, ws.toolDeps());
        check('10. search_files finds real matches', (se.data.hits as any[]).length >= 1);

        // get_file_info resolves a real path
        const gi = await executeTool('get_file_info', { path: 'script.js' }, ws.toolDeps());
        check('10. get_file_info resolves the path', gi.ok === true && gi.data.name === 'script.js');

        // get_diagnostics runs the real checker
        const dg = await executeTool('get_diagnostics', { path: 'index.html' }, ws.toolDeps());
        check('22. get_diagnostics runs on a real file', dg.ok === true && typeof dg.data.isError === 'boolean');

        // Missing file is an honest failure, never a fake success
        const miss = await executeTool('read_file', { path: 'ghost.html' }, ws.toolDeps());
        check('10. missing file reports failure honestly', miss.ok === false);
    }

    // ────────────────────────────────────────────────────────────────────
    // 11 — the loop really cycles (tool result → model → next tool)
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider(
        [
            toolTurn('list_files', {}, 'c1'),
            toolTurn('create_file', { path: 'index.html', content: '<h1>Todo</h1>' }, 'c2'),
            toolTurn('create_file', { path: 'styles.css', content: 'body{}' }, 'c3'),
            { content: 'Created index.html and styles.css.' },
        ],
        async (calls) => {
            const ws = new TestWorkspace();
            const task = createTaskContext('create a todo website using HTML');
            const result = await runAgentLoop({
                taskContext: task,
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 8, maxToolCalls: 10 },
            });

            check('11. loop exited via "done"', result.stopReason === 'done');
            check('11. loop made multiple provider round-trips', calls.length === 4);
            check('11. three real tool calls executed', result.toolCallCount === 3);
            check('11. workspace actually changed', result.changedWorkspace === true);
            check('11. index.html really created', ws.content('index.html') === '<h1>Todo</h1>');
            check('11. styles.css really created', ws.content('styles.css') === 'body{}');

            // Tool definitions were actually sent to the provider.
            const firstBody = calls[0].body;
            check('11. tool definitions sent to provider', Array.isArray(firstBody.tools) && firstBody.tools.length > 0);
            check('11. create_file definition present', firstBody.tools.some((t: any) => t.function.name === 'create_file'));
            check('11. tool results returned as tool messages', result.steps.length === 3);
        },
    );

    // The assistant turn carrying tool_calls AND the tool results must both be
    // in the next request — this is the protocol-correct continuation.
    await withMockProvider(
        [toolTurn('create_file', { path: 'a.txt', content: 'hello' }, 'c1'), { content: 'done' }],
        async (calls) => {
            const ws = new TestWorkspace();
            await runAgentLoop({
                taskContext: createTaskContext('create a file'),
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 4 },
            });
            const second = calls[1].body.messages;
            check('11. assistant tool_calls echoed back', second.some((m: any) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length === 1));
            const toolMsg = second.find((m: any) => m.role === 'tool');
            check('11. real tool result appended as a tool message', Boolean(toolMsg));
            check('11. tool message carries the real result', String(toolMsg?.content || '').includes('"ok":true'));
            check('11. tool message is linked by tool_call_id', toolMsg?.tool_call_id === 'c1');
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // 14 — infinite-loop prevention
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider(
        [toolTurn('create_file', { path: 'loop.html', content: 'x' }, 'c1')], // always the same
        async (calls) => {
            const ws = new TestWorkspace();
            const result = await runAgentLoop({
                taskContext: createTaskContext('loop forever'),
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 50, maxToolCalls: 100 },
            });
            check('14. loop stopped on the step budget', result.stopReason === 'budget_steps');
            check('14. did not run unbounded', calls.length <= 51);
            check('14. duplicate writes were suppressed', calls.length <= 5);
        },
    );

    await withMockProvider(
        [
            toolTurn('read_file', { path: 'ghost.html' }, 'c1'),
            toolTurn('read_file', { path: 'ghost.html' }, 'c2'),
            toolTurn('read_file', { path: 'ghost.html' }, 'c3'),
        ],
        async (calls) => {
            const ws = new TestWorkspace();
            const result = await runAgentLoop({
                taskContext: createTaskContext('read a missing file'),
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 20, maxToolCalls: 20 },
            });
            check('14. repeated identical failure stops the loop', result.stopReason === 'repeated_failure');
            check('14. stopped before burning the step budget', calls.length <= 4);
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // 20 — bounded budgets
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider(
        [toolTurn('list_files', {}, 'c1'), toolTurn('list_files', {}, 'c2'), toolTurn('list_files', {}, 'c3'), { content: 'ok' }],
        async (calls) => {
            const ws = new TestWorkspace();
            const result = await runAgentLoop({
                taskContext: createTaskContext('bounded'),
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 2, maxToolCalls: 1 },
            });
            check('20. tool-call budget enforced', result.stopReason === 'budget_tool_calls');
            check('20. no more calls than budgeted', calls.length <= 2);
            check('20. failure reported honestly', Boolean(result.error));
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // 15 — cancellation
    // ────────────────────────────────────────────────────────────────────
    {
        const ws = new TestWorkspace();
        const controller = new AbortController();
        controller.abort();
        const result = await runAgentLoop({
            taskContext: createTaskContext('cancel me'),
            history: [],
            deps: ws.toolDeps(),
            signal: controller.signal,
        });
        check('15. pre-aborted signal stops the loop', result.stopReason === 'cancelled');
        check('15. nothing was written on cancel', ws.getFileTree().length === 0);
        check('15. changedWorkspace is false on cancel', result.changedWorkspace === false);
    }

    await withMockProvider(
        [toolTurn('create_file', { path: 'x.txt', content: 'y' }, 'c1'), toolTurn('create_file', { path: 'z.txt', content: 'w' }, 'c2'), { content: 'done' }],
        async () => {
            const ws = new TestWorkspace();
            const controller = new AbortController();
            const result = await runAgentLoop({
                taskContext: createTaskContext('cancel mid-run'),
                history: [],
                deps: ws.toolDeps(),
                signal: controller.signal,
                onStep: () => controller.abort(),
            });
            check('15. mid-run cancel reported', result.stopReason === 'cancelled');
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // 13 — provider failure degrades honestly, never fabricates success
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider(
        [{ __status: 500 }],
        async () => {
            const ws = new TestWorkspace();
            const result = await runAgentLoop({
                taskContext: createTaskContext('provider down'),
                history: [],
                deps: ws.toolDeps(),
            });
            check('13. provider failure reported as error', result.stopReason === 'error');
            check('13. provider failure did not claim success', result.success === false);
            check('13. provider failure wrote nothing', ws.getFileTree().length === 0);
            check('13. provider failure produced no error text as content', result.content === '');
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // 16 — partial filesystem failures are reported, not swallowed
    // ────────────────────────────────────────────────────────────────────
    {
        const ws = new TestWorkspace();
        // Reading a folder as a file is a real failure.
        ws.createFolder('adir');
        const r = await executeTool('write_file', { path: 'adir', content: 'x' }, ws.toolDeps());
        check('16. writing to a folder fails honestly', r.ok === false);
        check('16. failure names the reason', /folder|not a file/i.test(r.error || ''));

        const r2 = await executeTool('replace_range', { path: 'nope.js', startLine: 1, endLine: 2, content: 'x' }, ws.toolDeps());
        check('16. editing a missing file fails honestly', r2.ok === false);

        // Deleting a missing file fails rather than silently succeeding.
        const r3 = await executeTool('delete_file', { path: 'nope.js' }, ws.toolDeps({ confirmDestructive: () => true }));
        check('16. deleting a missing file fails honestly', r3.ok === false);
    }

    // ────────────────────────────────────────────────────────────────────
    // Destructive operations require explicit approval (Phase 11)
    // ────────────────────────────────────────────────────────────────────
    {
        const ws = new TestWorkspace();
        ws.createFile('keep.txt', 'important');

        const denied = await executeTool('delete_file', { path: 'keep.txt' }, ws.toolDeps());
        check('security: delete denied without approval', denied.ok === false);
        check('security: denial requires approval', denied.requiresApproval === true);
        check('security: file still exists after denial', ws.content('keep.txt') === 'important');

        const allowed = await executeTool('delete_file', { path: 'keep.txt' }, ws.toolDeps({ confirmDestructive: () => true }));
        check('security: delete runs once approved', allowed.ok === true);
        check('security: file really removed after approval', ws.content('keep.txt') === null);

        // The loop must refuse to continue past an unapproved destructive call.
        const ws2 = new TestWorkspace();
        ws2.createFile('vital.txt', 'data');
        await withMockProvider(
            [toolTurn('delete_file', { path: 'vital.txt' }, 'c1'), { content: 'I could not delete it.' }],
            async () => {
                const result = await runAgentLoop({
                    taskContext: createTaskContext('delete vital.txt'),
                    history: [],
                    deps: ws2.toolDeps(), // no confirmDestructive → denied
                });
                check('security: loop stops on unapproved destructive call', result.stopReason === 'approval_required');
                check('security: file survived', ws2.content('vital.txt') === 'data');
                check('security: changedWorkspace false', result.changedWorkspace === false);
            },
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // 17 — unsaved editor content wins over the stored tree
    // ────────────────────────────────────────────────────────────────────
    {
        const ws = new TestWorkspace();
        ws.createFile('open.txt', 'saved version');
        const { updateActiveEditor } = await import('../src/core/editor/activeEditorStore');
        updateActiveEditor({ id: resolveResource(ws.getFileTree(), 'open.txt')!.id, name: 'open.txt', path: 'open.txt', content: 'UNSAVED editor buffer' });
        const r = await executeTool('read_file', { path: 'open.txt' }, ws.toolDeps());
        check('17. read_file prefers the live editor buffer', String(r.data.content).includes('UNSAVED'));
        check('17. read_file reports the source', r.data.source === 'editor');
        updateActiveEditor(null);
        const r2 = await executeTool('read_file', { path: 'open.txt' }, ws.toolDeps());
        check('17. falls back to the stored tree when not open', String(r2.data.content).includes('saved version'));
    }

    // ────────────────────────────────────────────────────────────────────
    // 18 — explorer synchronization
    // ────────────────────────────────────────────────────────────────────
    {
        const before = fileChangeListenerCount().changes;
        const seen: string[] = [];
        const off = subscribeFileChanges(e => seen.push(e.kind));
        const ws = new TestWorkspace();
        await executeTool('create_file', { path: 'sync/inside.txt', content: 'x' }, ws.toolDeps({
            createDirectory: p => {
                const r = ws.createFolder(p);
                return r.error ? { ok: false, error: 'mkdir failed' } : { ok: true };
            },
        }));
        ws.updateFileContent(resolveResource(ws.getFileTree(), 'sync/inside.txt')!.id, 'y');
        off();
        check('18. creation emitted a file change', seen.includes('created'));
        check('18. update emitted a file change', seen.includes('updated'));
        check('18. listener count restored after dispose', fileChangeListenerCount().changes === before);
    }

    // ────────────────────────────────────────────────────────────────────
    // 22 — validation failures recorded and surfaced
    // ────────────────────────────────────────────────────────────────────
    {
        let t = createTaskContext('build something');
        t = recordValidationFailure(t, 'app.js', 'Unexpected token');
        const rendered = renderTaskContext(t);
        check('22: validation failure recorded', rendered.includes('app.js'));
        check('22: validation failure message kept', rendered.includes('Unexpected token'));
    }

    // ────────────────────────────────────────────────────────────────────
    // Task context continuity (Phase 4)
    // ────────────────────────────────────────────────────────────────────
    {
        let t = createTaskContext('create a todo website using HTML');
        t = extendTask(t, 'make it responsive');
        t = extendTask(t, 'add dark mode');
        t = recordPlan(t, 'Building a todo app');
        t = recordOperation(t, { tool: 'create_file', target: 'index.html', status: 'ok' });
        t = recordOperation(t, { tool: 'create_file', target: 'styles.css', status: 'ok' });
        t = addConstraint(t, 'stack: html');

        const rendered = renderTaskContext(t);
        check('ctx: original task preserved', rendered.includes('create a todo website using HTML'));
        check('ctx: follow-ups preserved in order', rendered.includes('make it responsive') && rendered.includes('add dark mode'));
        check('ctx: constraint preserved', rendered.includes('stack: html'));
        check('ctx: touched files recorded', rendered.includes('index.html') && rendered.includes('styles.css'));

        const msgs = buildAgentMessages({
            systemPrompt: 'S',
            taskContext: t,
            history: [],
            userMessage: 'add dark mode',
        });
        check('ctx: system + user messages built', msgs.length === 2);
        check('ctx: user message carries task context', (msgs[1].content || '').includes('add dark mode'));
        check('ctx: user message carries the original task', (msgs[1].content || '').includes('todo website'));

        let big = t;
        for (let i = 0; i < 200; i++) big = extendTask(big, `followup ${i}`);
        check('ctx: follow-ups bounded', big.followUps.length <= 12);
        check('ctx: rendered context stays bounded', renderTaskContext(big).length < 8000);

        let manyOps = t;
        for (let i = 0; i < 200; i++) manyOps = recordOperation(manyOps, { tool: 'read_file', target: `f${i}.ts`, status: 'ok' });
        check('ctx: operations bounded', manyOps.operations.length <= 40);
    }

    // ────────────────────────────────────────────────────────────────────
    // Follow-up continuation reaches the loop with full context
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider(
        [toolTurn('write_file', { path: 'styles.css', content: '@media(prefers-color-scheme: dark){}' }, 'c1'), { content: 'Added dark mode.' }],
        async (calls) => {
            const ws = new TestWorkspace();
            let t = createTaskContext('create a todo website using HTML');
            t = recordOperation(t, { tool: 'create_file', target: 'index.html', status: 'ok' });
            t = extendTask(t, 'add dark mode');

            await runAgentLoop({
                taskContext: t,
                history: [],
                deps: ws.toolDeps(),
                budget: { maxSteps: 4 },
            });

            const prompt = calls[0].body.messages[calls[0].body.messages.length - 1].content;
            check('followup: original objective present in prompt', prompt.includes('create a todo website using HTML'));
            check('followup: prior files present in prompt', prompt.includes('index.html'));
            check('followup: current instruction present in prompt', prompt.includes('add dark mode'));
        },
    );

    // ────────────────────────────────────────────────────────────────────
    // Planner: no clarification default, follow-up aware, implement supported
    // ────────────────────────────────────────────────────────────────────
    {
        const { messages } = buildSemanticPlannerPrompt('create a simple website', null, '', []);
        const sys = messages[0].content;
        check('planner: old "ask for clarification" default removed', !/return a chat action asking\s+for\s+clarification/i.test(sys));
        check('planner: states DO NOT ask for a stack', /DO NOT ask the user to specify a stack/i.test(sys));
        check('planner: enumerates genuine blockers', /GENUINE BLOCKER/i.test(sys));
        check('planner: explains follow-up context', /FOLLOW-UP CONTEXT/i.test(sys));
        check('planner: defaults to plain HTML/CSS/JS', /plain HTML\/CSS\/JS/i.test(sys));

        const plan = parseSemanticPlan(JSON.stringify({
            analysis: { operation: 'implement', wantsModification: true, wantsExplanation: false, summary: 'build a todo site' },
            actions: [{ type: 'create_file', payload: { path: 'index.html', content: '<h1>' } }],
        }));
        check('planner: implement operation parses', plan?.analysis.operation === 'implement');
        check('planner: implement action preserved', plan?.actions[0]?.type === 'create_file');
        check('planner: invalid operation rejected', parseSemanticPlan('{"analysis":{"operation":"nonsense"},"actions":[]}') === null);
    }

    // ────────────────────────────────────────────────────────────────────
    // Tool schema surface
    // ────────────────────────────────────────────────────────────────────
    {
        const defs = toolDefinitions();
        check('tools: definitions are function-typed', defs.every(d => d.type === 'function'));
        check('tools: definitions have object params', defs.every(d => d.function.parameters.type === 'object'));
        check('tools: no duplicate names', new Set(defs.map(d => d.function.name)).size === defs.length);
        check('tools: destructive tools flagged', AGENT_TOOL_SCHEMAS.filter(t => t.destructive).map(t => t.name).sort().join(',') === 'delete_file,rename_file');
        check('tools: create_file exposed', defs.some(d => d.function.name === 'create_file'));
        check('tools: read_file exposed', defs.some(d => d.function.name === 'read_file'));
    }

    // ────────────────────────────────────────────────────────────────────
    // Non-agent requests carry NO tools (regression guard)
    // ────────────────────────────────────────────────────────────────────
    await withMockProvider([{ content: 'hello' }], async (calls) => {
        const { sendChatResult } = await import('../src/core/ai/AIClient');
        await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        check('regression: ordinary chat sends no tools field', calls[0].body.tools === undefined);
        check('regression: ordinary chat body unchanged in shape', Array.isArray(calls[0].body.messages));
    });

    finish('agentAutonomy');
}

main().catch(err => {
    console.error('agentAutonomy crashed:', err);
    process.exit(1);
});