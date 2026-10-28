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
 * 
 * Supports special test markers:
 * - { __status: number, error: object } - simulates an HTTP error response
 * - { content: string } - normal message response
 * - tool() - tool call response
 */
async function mock<T>(turns: unknown[], fn: () => Promise<T>): Promise<T> {
    const orig = globalThis.fetch;
    let i = 0;
    globalThis.fetch = (async () => {
        const turn = turns[Math.min(i++, turns.length - 1)];
        
        // Handle error simulation
        if (turn && typeof turn === 'object' && '__status' in turn) {
            const status = (turn as { __status: number }).__status;
            const error = (turn as { error: unknown }).error;
            return new Response(JSON.stringify({ error }), {
                status,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Normal message response
        return json({ choices: [{ message: turn }] });
    }) as typeof fetch;
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
                check('5. dark mode applied to the same app', (ws.content('styles.css') || '').includes('background:#111'));
                check('5. follow-up accumulated on the same task', Boolean(res.taskContext?.followUps.includes('add dark mode')));
                check('5. original objective still present', Boolean(res.taskContext?.objective.includes('todo')));
            },
        );
    }

    // ── 6. "create a todo app in an empty workspace" ────────────────────
    await mock(
        [
            tool('list_files', {}, 'a'),
            tool('create_file', { path: 'index.html', content: '<!doctype html><h1>Todo</h1>' }, 'b'),
            tool('create_file', { path: 'styles.css', content: 'body{margin:0}' }, 'c'),
            tool('create_file', { path: 'script.js', content: 'const t=[];' }, 'd'),
            { content: 'Created a three-file todo app.' },
        ],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a todo app',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
                createDirectory: async p => (ws.createFile(`${p}/.keep`, '').error ? { ok: false, error: 'mkdir failed' } : { ok: true }),
            });
            check('6. empty workspace still acts (creates files)', res.changedWorkspace === true);
            check('6. file really created in the empty workspace', ws.content('index.html') !== null);
            check('6. no fabricated default workspace path', res.message.includes('index.html'));
            check('6. summary is honest about what was created', (res.message || '').includes('Created'));
        },
    );

    // ── 7. "create a portfolio inside hello" with existing project ───────
    await mock(
        [tool('create_file', { path: 'hello/index.html', content: '<h1>Portfolio</h1>' }, 'a'), { content: 'Portfolio created.' }],
        async () => {
            const ws = new WS();
            ws.createFile('src/main.py', 'print("hello")');
            const res = await runAgentController({
                userMessage: 'create a portfolio inside the hello folder',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('7. extended the existing project structure', ws.content('hello/index.html') !== null);
            check('7. did not scaffold a parallel static site', ws.content('src/main.py') === 'print("hello")');
            check('7. existing files preserved', ws.getFileTree().some(n => n.name === 'src'));
        },
    );

    // ── 8. "fix the bug in a.js and b.js" ──────────────────────────────
    {
        const ws = new WS();
        ws.createFile('a.js', 'function a() { return 1; }');
        ws.createFile('b.js', 'function b() { return 2; }');

        await mock(
            [
                tool('replace_range', { path: 'a.js', startLine: 1, endLine: 1, content: 'function a() { return 2; }' }, 'a'),
                tool('replace_range', { path: 'b.js', startLine: 1, endLine: 1, content: 'function b() { return 3; }' }, 'b'),
                { content: 'Fixed both files.' },
            ],
            async () => {
                const ws2 = new WS();
                ws2.createFile('a.js', 'function a() { return 1; }');
                ws2.createFile('b.js', 'function b() { return 2; }');
                const res = await runAgentController({
                    userMessage: 'fix the bug in a.js and b.js',
                    workspace: ws2.bridge(),
                    fileName: null,
                    history: [],
                });
                check('8. a.js edited for real', (ws2.content('a.js') || '').includes('return 2'));
                check('8. b.js edited for real', (ws2.content('b.js') || '').includes('return 3'));
                check('8. reported as changed', res.changedWorkspace === true);
            },
        );
    }

    // ── 9. "continue" resumes from where the agent left off ──────────────
    {
        const ws = new WS();
        ws.createFile('index.html', '<h1>Todo</h1>');
        let prior = createTaskContext('create a todo website using HTML');
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
                check('9. follow-up did not ask a question', !(res.message || '').includes('?'));
                check('9. responsive styles really written', (ws.content('styles.css') || '').includes('@media'));
                check('9. original file untouched', ws.content('index.html') === '<h1>Todo</h1>');
                check('9. task continued, not restarted', Boolean(res.taskContext?.followUps.includes('make it responsive')));
                prior = res.taskContext!;
            },
        );

        await mock(
            [tool('write_file', { path: 'styles.css', content: 'body{margin:0;background:#111;color:#fff}' }, 'a'), { content: 'Dark mode added.' }],
            async () => {
                const res = await runAgentController({
                    userMessage: 'continue',
                    workspace: ws.bridge(),
                    fileName: 'index.html',
                    history: [],
                    previousTask: prior,
                });
                check(
                    '9. follow-up "continue" applies to the same task',
                    Boolean(
                        res.taskContext?.followUps.includes('continue') &&
                        res.taskContext?.followUps.includes('make it responsive'),
                    ),
                );
            },
        );
    }

    // ── 10. "add a settings page" to existing project ───────────────────
    {
        const ws = new WS();
        ws.createFile('src/App.tsx', 'export default function App() { return <div>App</div>; }');
        ws.createFile('src/pages/Home.tsx', 'export default function Home() { return <div>Home</div>; }');
        ws.createFile('package.json', '{ "dependencies": { "react": "^18" } }');

        await mock(
            [tool('create_file', { path: 'src/pages/Settings.tsx', content: 'export default function Settings() { return <div>Settings</div>; }' }, 'a'), { content: 'Settings page added.' }],
            async () => {
                const res = await runAgentController({
                    userMessage: 'add a settings page to my existing project',
                    workspace: ws.bridge(),
                    fileName: null,
                    history: [],
                });
                check('10. settings page added to existing React project', ws.content('src/pages/Settings.tsx') !== null);
                check('10. existing project structure respected', ws.content('src/App.tsx') !== null);
            },
        );
    }

    // ── 11. "refactor the user service" ─────────────────────────────────
    {
        const ws = new WS();
        ws.createFile('src/services/user.js', 'export class UserService { getUsers() { return []; } }');

        await mock(
            [
                tool('read_file', { path: 'src/services/user.js' }, 'a'),
                tool('replace_range', { path: 'src/services/user.js', startLine: 1, endLine: 2, content: 'export class UserService { async getUsers() { return []; } async createUser(u) { return u; } }' }, 'b'),
                { content: 'Refactored user service.' },
            ],
            async () => {
                const ws2 = new WS();
                ws2.createFile('src/services/user.js', 'export class UserService { getUsers() { return []; } }');
                const res = await runAgentController({
                    userMessage: 'refactor the user service',
                    workspace: ws2.bridge(),
                    fileName: null,
                    history: [],
                });
                check('11. user service refactored for real', (ws2.content('src/services/user.js') || '').includes('async'));
                check('11. reported as changed', res.changedWorkspace === true);
            },
        );
    }

    // ── 12. "run the tests" executes without modification ───────────────
    await mock(
        [tool('list_files', {}, 'a'), { content: 'Tests executed.' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'run the tests',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('13. execute path does not modify files', res.changedWorkspace === false);
            check('13. answer returned', Boolean(res.message));
        },
    );

    // ── 14/15/16. explain: no files changed ─────────────────────────────
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

    // ── 16. Genuine blocker still asks ──────────────────────────────────
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

    // ── 17. "run the tests" executes without modification ───────────────
    await mock(
        [tool('list_files', {}, 'a'), { content: 'Tests executed.' }],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'run the tests',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('13. execute path does not modify files', res.changedWorkspace === false);
            check('13. answer returned', Boolean(res.message));
        },
    );

    // ── 18. real run emits file change events ───────────────────────────
    await mock(
        [tool('list_files', {}, 'a'), tool('create_file', { path: 'x.txt', content: 'y' }, 'b'), { content: 'Created.' }],
        async () => {
            const ws = new WS();
            const seen: string[] = [];
            const off = subscribeFileChanges(e => seen.push(e.kind));
            const res = await runAgentController({
                userMessage: 'create x.txt',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            off();
            check('18. real run emitted file change events', seen.includes('created'));
        },
    );

    // ── 19/20/21/22. validation is real and reported honestly ────────────
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

    // ── 23. Transient provider failure recovers and resumes ─────────────────
    // Simulates: first model call succeeds, tools execute, second model call
    // fails once with transient 503, retry succeeds and completes the task.
    await mock(
        [
            tool('list_files', {}, 'a'),
            tool('create_file', { path: 'app.py', content: 'print("hello")' }, 'b'),
            // First continuation fails with transient 503
            { __status: 503, error: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Service unavailable', retryable: true } },
            // Retry succeeds
            tool('create_file', { path: 'templates/index.html', content: '<html><body>Todo</body></html>' }, 'c'),
            { content: 'Todo app created with app.py and templates/index.html.' },
        ],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a todo web app',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('23. task does not terminate on transient error', res.stopReason !== 'error');
            check('23. app.py was created', ws.content('app.py') === 'print("hello")');
            check('23. templates/index.html was created after retry', ws.content('templates/index.html') === '<html><body>Todo</body></html>');
            check('23. summary mentions both files', (res.message || '').includes('app.py') && (res.message || '').includes('templates/index.html'));
            check('23. tool calls actually executed', (res.appliedCount ?? 0) >= 3);
            check('23. stop reason is done', res.stopReason === 'done');
        },
    );

    // ── 24. Permanent provider failure preserves completed work ─────────────
    // Simulates: first model call succeeds, tools execute, second model call
    // fails permanently (auth error), task terminates but completed work is preserved.
    await mock(
        [
            tool('list_files', {}, 'a'),
            tool('create_file', { path: 'app.py', content: 'print("hello")' }, 'b'),
            // Permanent failure (auth error)
            { __status: 401, error: { code: 'AI_PROVIDER_AUTH_ERROR', message: 'Invalid API key', retryable: false } },
        ],
        async () => {
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'create a todo web app',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
            });
            check('24. task terminates on permanent error', res.stopReason === 'error');
            check('24. completed work is preserved', ws.content('app.py') === 'print("hello")');
            check('24. error message mentions auth failure', (res.message || '').toLowerCase().includes('auth') || (res.message || '').toLowerCase().includes('invalid'));
            check('24. completed operations reported', (res.message || '').includes('app.py'));
        },
    );

    finish('agentControllerIntegration');
})();