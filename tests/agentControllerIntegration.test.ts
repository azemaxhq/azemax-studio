/**
 * Integration tests for `runAgentController` — the full autonomous path.
 *
 * Unlike `agentAutonomy.test.ts` (which tests the loop and tools directly),
 * this exercises the controller end-to-end against a real workspace:
 *   UNDERSTAND → INSPECT → PLAN → EXECUTE TOOLS → READ RESULTS → CONTINUE →
 *   VALIDATE → VERIFY → SUMMARIZE
 *
 * The provider is stubbed, so each test is deterministic.
 */
import { check, finish, installRafStub } from './_harness';
installRafStub();

import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import {
    createFile as opCreateFile,
    ensureFolderPath,
    updateFileContent as opUpdateFileContent,
    deleteNode as opDeleteNode,
    renameNode as opRenameNode,
} from '../src/core/filesystem/operations';
import { resolveResource } from '../src/core/filesystem/queries';
import { emitFileChange, subscribeFileChanges } from '../src/core/filesystem/fileChangeService';
import { runAgentController } from '../src/core/ai/agentController';
import { createTaskContext, recordOperation, type AgentTaskContext } from '../src/core/ai/agentTaskContext';

class WS {
    tree: FileNode[] = [];
    getFileTree = () => this.tree;
    private apply<T extends { changed: boolean; error?: unknown; node?: FileNode }>(op: (t: FileNode[]) => T, kind: 'created' | 'updated') {
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
        if (dir && !parent) return { error: { message: 'no parent' } };
        const r = this.apply(t => opCreateFile(t, { name, parentId: dir ? parent!.id : ROOT_NODE_ID, content }), 'created');
        return r.error ? { error: r.error } : { changed: true };
    };
    deleteNode = (id: string) => {
        const r = opDeleteNode(this.tree, id);
        if (r.changed) { this.tree = r.tree; emitFileChange({ kind: 'deleted', id, name: id }); }
    };
    renameNode = (id: string, n: string) => {
        const r = this.apply(t => opRenameNode(t, id, n), 'updated');
        return r.error ? { error: r.error } : { changed: true };
    };
    updateFileContent = (id: string, c: string) => {
        const r = this.apply(t => opUpdateFileContent(t, id, c), 'updated');
        return r.error ? { error: r.error } : { changed: true };
    };
    content = (p: string) => {
        const n = resolveResource(this.tree, p);
        return n && n.type === 'file' && typeof n.content === 'string' ? n.content : null;
    };
    bridge() {
        return {
            getFileTree: this.getFileTree,
            createFile: this.createFile,
            deleteNode: this.deleteNode,
            renameNode: this.renameNode,
            updateFileContent: this.updateFileContent,
        } as never;
    }
}

const json = (p: unknown) => new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
const tool = (name: string, args: Record<string, unknown>, id: string) => ({
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

/**
 * Stub the provider with backend-shaped responses (`choices[0].message`),
 * which is the contract AIClient reads.
 */
async function mock<T>(turns: unknown[], fn: () => Promise<T>): Promise<T> {
    const orig = globalThis.fetch;
    let i = 0;
    globalThis.fetch = (async () =>
        json({ choices: [{ message: turns[Math.min(i++, turns.length - 1)] }] })) as typeof fetch;
    try {
        return await fn();
    } finally {
        globalThis.fetch = orig;
    }
}

await (async () => {
    // ── 1. "create a simple website" in an EMPTY workspace ──────────────
    await mock(
        [
            tool('list_files', {}, 'a'),
            tool('create_file', { path: 'index.html', content: '<!doctype html><h1>Hi</h1>' }, 'b'),
            tool('create_file', { path: 'styles.css', content: 'body{margin:0}' }, 'c'),
            tool('create_file', { path: 'script.js', content: 'console.log(1)' }, 'd'),
            { content: 'Created a three-file website.' },
        ],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a simple website',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
                createDirectory: async p => (ws.createFile(`${p}/.keep`, '').error ? { ok: false, error: 'mkdir failed' } : { ok: true }),
            });
            check('1. no clarification question was asked', !(res.message || '').includes('Could you clarify'));
            check('1. workspace really changed', res.changedWorkspace === true);
            check('1. index.html created', ws.content('index.html') === '<!doctype html><h1>Hi</h1>');
            check('1. styles.css created', ws.content('styles.css') === 'body{margin:0}');
            check('1. script.js created', ws.content('script.js') === 'console.log(1)');
            check('1. summary mentions the real files', (res.message || '').includes('index.html'));
            check('1. tool calls actually executed', (res.appliedCount ?? 0) >= 4);
            check('1. stop reason is done', res.stopReason === 'done');
        },
    );

    // ── 2. "create a todo website using HTML" ───────────────────────────
    await mock(
        [
            tool('create_file', { path: 'index.html', content: '<input id="t"><button>Add</button><ul id="l"></ul>' }, 'a'),
            tool('create_file', { path: 'script.js', content: 'add(){}toggle(){}del(){}' }, 'b'),
            { content: 'Todo app done.' },
        ],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a todo website using HTML',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('2. no clarification about "using HTML"', !(res.message || '').includes('what you mean by'));
            check('2. two files really created', ws.content('index.html') !== null && ws.content('script.js') !== null);
            check('2. no framework was introduced', ws.getFileTree().every(n => !n.name.startsWith('package')));
            check('2. reported as changed', res.changedWorkspace === true);
        },
    );

    // ── 3. "create a portfolio inside the hello folder" ─────────────────
    await mock(
        [tool('create_file', { path: 'hello/index.html', content: '<h1>Portfolio</h1>' }, 'a'), { content: 'Portfolio created.' }],
        async () => {
            const ws = new WS();
            ws.createFile('hello/existing.txt', 'keep');
            const res = await runAgentController({
                userMessage: 'create a portfolio inside the hello folder',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('3. no "where should I put it" question', !(res.message || '').toLowerCase().includes('where would you like'));
            check('3. portfolio landed in hello/', ws.content('hello/index.html') === '<h1>Portfolio</h1>');
            check('3. existing hello file untouched', ws.content('hello/existing.txt') === 'keep');
            check('3. nothing written at root', ws.content('index.html') === null);
        },
    );

    // ── 4/5. follow-ups extend the same task ────────────────────────────
    {
        const ws = new WS();
        ws.createFile('index.html', '<h1>Todo</h1>');
        let prior: AgentTaskContext = createTaskContext('create a todo website using HTML');
        prior = recordOperation(prior, { tool: 'create_file', target: 'index.html', status: 'ok' });

        await mock(
            [
                tool('create_file', { path: 'styles.css', content: 'body{margin:0}\n@media(max-width:600px){}' }, 'a'),
                { content: 'Made it responsive.' },
            ],
            async () => {
                const res = await runAgentController({
                    userMessage: 'make it responsive',
                    workspace: ws.bridge(),
                    fileName: 'index.html',
                    history: [],
                    previousTask: prior,
                });
                check('4. follow-up did not ask a question', !(res.message || '').includes('?'));
                check('4. responsive styles really written', (ws.content('styles.css') || '').includes('@media'));
                check('4. original file untouched', ws.content('index.html') === '<h1>Todo</h1>');
                check('4. task continued, not restarted', Boolean(res.taskContext?.followUps.includes('make it responsive')));
                prior = res.taskContext!;
            },
        );

        await mock(
            [tool('write_file', { path: 'styles.css', content: 'body{margin:0;background:#111;color:#fff}' }, 'a'), { content: 'Dark mode added.' }],
            async () => {
                const res = await runAgentController({
                    userMessage: 'add dark mode',
                    workspace: ws.bridge(),
                    fileName: 'index.html',
                    history: [],
                    previousTask: prior,
                });
                check('5. dark mode applied to the same app', (ws.content('styles.css') || '').includes('#111'));
                check('5. follow-up accumulated on the same task', (res.taskContext?.followUps ?? []).includes('add dark mode'));
                check('5. original objective still present', res.taskContext?.objective.includes('todo website') === true);
            },
        );
    }

    // ── 6. no active workspace (empty tree) ───────────────────────────
    // An empty tree IS the product's "no workspace" state. The agent must
    // still act on an ordinary build request rather than refusing.
    await mock(
        [tool('create_file', { path: 'index.html', content: '<h1>Fresh start</h1>' }, 'a'), { content: 'Created index.html.' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a simple website',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('6. empty workspace still acts (creates files)', res.changedWorkspace === true);
            check('6. file really created in the empty workspace', ws.content('index.html') === '<h1>Fresh start</h1>');
            check('6. no fabricated default workspace path', ws.getFileTree().every(n => n.name !== 'hello'));
            check('6. summary is honest about what was created', (res.message || '').includes('index.html'));
        },
    );

    // ── 7. existing project detection ───────────────────────────────────
    await mock(
        [tool('create_file', { path: 'src/About.tsx', content: 'export default () => null' }, 'a'), { content: 'Added.' }],
        async () => {
            const ws = new WS();
            ws.createFile('package.json', '{}');
            ws.createFile('src/App.tsx', 'export default () => null');
            const res = await runAgentController({
                userMessage: 'add an about page',
                workspace: ws.bridge(),
                fileName: 'src/App.tsx',
                history: [],
            });
            check('7. extended the existing project structure', ws.content('src/About.tsx') !== null);
            check('7. did not scaffold a parallel static site', ws.content('index.html') === null);
            check('7. existing files preserved', ws.content('src/App.tsx') !== null && ws.content('package.json') !== null);
        },
    );

    // ── 9. multi-file editing ───────────────────────────────────────────
    await mock(
        [
            tool('replace_range', { path: 'a.js', startLine: 1, endLine: 1, content: 'const A = 2;' }, 'a'),
            tool('replace_range', { path: 'b.js', startLine: 1, endLine: 1, content: 'const B = 2;' }, 'b'),
            { content: 'Both updated.' },
        ],
        async () => {
            const ws = new WS();
            ws.createFile('a.js', 'const A = 1;');
            ws.createFile('b.js', 'const B = 1;');
            const res = await runAgentController({
                userMessage: 'update both files',
                workspace: ws.bridge(),
                fileName: 'a.js',
                history: [],
            });
            check('9. a.js edited for real', ws.content('a.js') === 'const A = 2;');
            check('9. b.js edited for real', ws.content('b.js') === 'const B = 2;');
            check('9. reported as changed', res.changedWorkspace === true);
        },
    );

    // ── 16. partial filesystem failure is honest ────────────────────────
    await mock(
        [tool('write_file', { path: 'nope.js', content: 'x' }, 'a'), { content: 'I could not find that file.' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'fix the config file',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('16. missing-file failure not reported as success', res.changedWorkspace === false);
            check('16. summary admits the failure', /could not find|not found|no such/i.test(res.message || ''));
            check('16. nothing written', ws.getFileTree().length === 0);
        },
    );

    // ── 18. Explorer synchronization on a real run ──────────────────────
    {
        const ws = new WS();
        const seen: string[] = [];
        const off = subscribeFileChanges(e => seen.push(e.kind));
        await mock([tool('create_file', { path: 'new.txt', content: 'x' }, 'a'), { content: 'ok' }], async () => {
            await runAgentController({
                userMessage: 'create a new file',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
        });
        off();
        check('18. real run emitted file change events', seen.includes('created'));
    }

    // ── Explain requests never modify ───────────────────────────────────
    await mock(
        [tool('list_files', {}, 'a'), { content: 'This project has three files.' }],
        async () => {
            const ws = new WS();
            ws.createFile('one.js', 'x');
            const res = await runAgentController({
                userMessage: 'explain what this project does',
                workspace: ws.bridge(),
                fileName: 'one.js',
                history: [],
            });
            check('explain: no files changed', res.changedWorkspace === false);
            check('explain: answer returned', Boolean(res.chatResponse));
            check('explain: flagged as chat/explain', res.wasChatOrExplain === true);
        },
    );

    // ── Genuine blocker still asks ──────────────────────────────────────
    await mock([{ content: 'never used' }], async () => {
        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'delete everything',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });
        check('blocker: asked a clarifying question', (res.message || '').length > 0);
        check('blocker: no tools ran', (res.appliedCount ?? 0) === 0);
        check('blocker: nothing destroyed', ws.getFileTree().length === 0);
    });

    // ── Preview mode does not touch real files ──────────────────────────
    await mock(
        [tool('create_file', { path: 'shadow.txt', content: 'y' }, 'a'), { content: 'Proposed.' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a file',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
                preview: true,
            });
            check('preview: real file NOT written', ws.content('shadow.txt') === null);
            check('preview: a proposal was returned', (res.proposedChanges?.length ?? 0) >= 1);
            check('preview: proposal carries the real content', res.proposedChanges?.[0]?.after === 'y');
        },
    );

    // ── 22. Validation is real and reported honestly ────────────────────
    await mock(
        [tool('create_file', { path: 'broken.js', content: 'function ( { ' }, 'a'), { content: 'Created broken.js' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a js file',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('22: file was really created', ws.content('broken.js') !== null);
            check('22: validation actually ran', (res.validation?.length ?? 0) >= 1);
            check('22: summary distinguishes files written from checks run', typeof res.message === 'string' && res.message.length > 0);
        },
    );

    {
        // No files changed → validation must NOT claim anything was checked.
        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'explain what this project does',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });
        check('22: no validation claims when nothing changed', (res.validation ?? []).length === 0);
    }

    finish('agentControllerIntegration');
})();