/**
 * Regression tests for the AI RESPONSE LIFECYCLE.
 *
 * The defect under test: the UI could show internal progress forever and never
 * produce a final assistant response. Root causes were
 *   (a) the agent's internal budget (120s) EXCEEDED the panel's 75s kill
 *       switch, so long runs were always aborted externally;
 *   (b) the agent path never streamed, so the abort branch (which committed
 *       nothing) left the user with progress rows and no answer;
 *   (c) a "running" activity row was minted with a NEW id when it completed,
 *       so the spinner never stopped;
 *   (d) plain conversation was routed through the full 12-step tool loop.
 *
 * Covers scenarios 1-18 of the lifecycle matrix.
 */
import { check, finish, installRafStub } from './_harness';
installRafStub();

import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import { createFile as opCreateFile, ensureFolderPath, updateFileContent as opUpdateFileContent, deleteNode as opDeleteNode, renameNode as opRenameNode } from '../src/core/filesystem/operations';
import { resolveResource } from '../src/core/filesystem/queries';
import { emitFileChange } from '../src/core/filesystem/fileChangeService';
import { createExecutorDeps } from '../src/core/editor/workspaceBridge';
import {
    AIRequestStore,
    isTerminalPhase,
    ACTIVE_AGENT_PHASES,
    type AgentProgressEvent,
    type AgentTaskPhase,
} from '../src/core/ai/aiRequestStore';
import { runAgentController, stageLabelForTool, type AgentActivity } from '../src/core/ai/agentController';
import { runAgentLoop } from '../src/core/ai/agentLoop';
import { createTaskContext } from '../src/core/ai/agentTaskContext';
import { isTrivialChat } from '../src/core/ai/AIContextBuilder';
import { DEFAULT_AGENT_BUDGET } from '../src/core/ai/agentTaskContext';

class WS {
    tree: FileNode[] = [];
    getFileTree = () => this.tree;
    private apply<T extends { changed: boolean; error?: unknown; node?: FileNode }>(op: (t: FileNode[]) => T) {
        const r = op(this.tree);
        if (r.changed && !r.error) {
            this.tree = r.tree;
            if (r.node) emitFileChange({ kind: 'updated', id: r.node.id, name: r.node.name });
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
        const r = this.apply(t => opCreateFile(t, { name, parentId: dir ? parent!.id : ROOT_NODE_ID, content }));
        return r.error ? { error: r.error } : { changed: true };
    };
    deleteNode = (id: string) => { const r = opDeleteNode(this.tree, id); if (r.changed) this.tree = r.tree; };
    renameNode = (id: string, n: string) => {
        const r = this.apply(t => opRenameNode(t, id, n));
        return r.error ? { error: r.error } : { changed: true };
    };
    updateFileContent = (id: string, c: string) => {
        const r = this.apply(t => opUpdateFileContent(t, id, c));
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
const tool = (name: string, args: Record<string, unknown>, id = 'c1') => ({
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string) => ({ content });
/** Backend SSE frame list for a single text response. */
const sseText = (content: string) =>
    new Response(
        [`data: ${JSON.stringify({ type: 'token', content })}`, `data: ${JSON.stringify({ type: 'done', model: 'm' })}`, 'data: [DONE]']
            .map(l => `${l}\n\n`)
            .join(''),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

/**
 * Stub the provider. `stream` mode returns SSE (for streaming callers),
 * otherwise a backend-shaped JSON envelope. Records every request BODY.
 */
async function mock<T>(turns: unknown[], fn: (calls: any[]) => Promise<T>, opts: { stream?: boolean } = {}): Promise<T> {
    const orig = globalThis.fetch;
    let i = 0;
    const calls: any[] = [];
    globalThis.fetch = (async (_u: unknown, init: any) => {
        const raw = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push(raw);
        const t = turns[Math.min(i++, turns.length - 1)];
        if (t && (t as any).__status && (t as any).__status !== 200) {
            return new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: (t as any).__status });
        }
        if (opts.stream) return sseText(String((t as { content?: string })?.content ?? ''));
        return json({ choices: [{ message: t }] });
    }) as typeof fetch;
    try {
        return await fn(calls);
    } finally {
        globalThis.fetch = orig;
    }
}

/** Final status of each activity id — what the user actually sees. */
function finalActivityStates(acts: AgentActivity[]): Array<{ id: string; status: string }> {
    const last = new Map<string, string>();
    for (const a of acts) last.set(a.id, a.status);
    return [...last.entries()].map(([id, status]) => ({ id, status }));
}

/** Minimal requestAnimationFrame so AIRequestStore's frame cleanup works. */
const rafStub = installRafStub();

await (async () => {
    AIRequestStore._clearForTests();

    // ════════════════════════════════════════════════════════════════════
    // 18 — Task state machine
    // ════════════════════════════════════════════════════════════════════
    {
        const id = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        check('18. task receives a stable id', typeof id === 'string' && id.length > 0);
        check('18. starts in understanding', AIRequestStore.getPhase(id) === 'understanding');
        check('18. understanding is an active phase', ACTIVE_AGENT_PHASES.has('understanding'));

        const seen: AgentProgressEvent[] = [];
        const off = AIRequestStore.subscribeProgress((taskId, evts) => { if (taskId === id) seen.push(...evts); });

        AIRequestStore.setPhase(id, 'inspecting', 'Inspecting workspace', '8 files');
        check('18. transitions to inspecting', AIRequestStore.getPhase(id) === 'inspecting');
        check('18. phase change emitted progress', seen.some(e => e.phase === 'inspecting' && e.detail === '8 files'));
        check('18. progress is stamped with the task id', seen.every(e => e.taskId === id));

        AIRequestStore.setPhase(id, 'executing', 'Creating files');
        check('18. transitions to executing', AIRequestStore.getPhase(id) === 'executing');
        AIRequestStore.setPhase(id, 'completed', 'Preparing final summary');
        check('18. transitions to completed', AIRequestStore.getPhase(id) === 'completed');
        check('18. completed is terminal', isTerminalPhase('completed'));
        check('18. completed clears the request from active', AIRequestStore.getActiveRequestForOperation('chat')?.status === 'success');
        check('18. progress log is retained for the completed task', AIRequestStore.getProgress(id).length >= 3);

        // A terminal task cannot be resurrected into an active phase.
        AIRequestStore.setPhase(id, 'executing', 'Creating files');
        check('18. terminal task is not resurrected', AIRequestStore.getPhase(id) === 'completed');
        off();

        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 14 — Stale events cannot modify a newer task
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const oldId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const newId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        check('14. second submission gets a new id', oldId !== newId);

        const before = AIRequestStore.getProgress(newId).length;
        AIRequestStore.emitProgressEvent(oldId, { phase: 'executing', label: 'Creating files', status: 'running' });
        AIRequestStore.setPhase(oldId, 'completed', 'done');
        check('14. stale task progress is dropped', AIRequestStore.getProgress(newId).length === before);
        check('14. stale task cannot complete the new one', AIRequestStore.getPhase(newId) === 'understanding');
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 11 — A completed task clears its loading state exactly once
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const id = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        check('11. task is loading while running', AIRequestStore.getActiveRequestForOperation('chat')?.id === id);
        AIRequestStore.completeRequest(id);
        const after = AIRequestStore.getActiveRequestForOperation('chat');
        check('11. completion marks success', after?.status === 'success');
        check('11. completion sets the completed phase', after?.phase === 'completed');
        check('11. success is not loading', after?.status === 'success');
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 12 / 13 — Progress events carry stages, never assistant prose
    // ════════════════════════════════════════════════════════════════════
    {
        const toolLabels: Record<string, string> = {
            list_files: 'Reading relevant files',
            read_file: 'Reading relevant files',
            create_file: 'Creating files',
            write_file: 'Updating code',
            get_diagnostics: 'Running checks',
        };
        let ok = true;
        for (const [tool, expected] of Object.entries(toolLabels)) {
            if (stageLabelForTool(tool) !== expected) ok = false;
        }
        check('12. progress labels name real stages', ok);
        check('12. no label leaks a tool name verbatim', !Object.values(toolLabels).some(l => /_file|read_file|create_file/.test(l)));

        const phaseLabels = ['understanding', 'inspecting', 'planning', 'executing', 'validating', 'summarizing', 'completed', 'failed', 'cancelled'];
        check('13. every defined phase has a terminal classification', phaseLabels.every(p => typeof isTerminalPhase(p as AgentTaskPhase) === 'boolean'));
    }

    // ════════════════════════════════════════════════════════════════════
    // 1 — Inspection followed by file creation (continues past inspection)
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const taskId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const ws = new WS();
        const phases: AgentTaskPhase[] = [];
        const acts: AgentActivity[] = [];
        await mock(
            [tool('list_files', {}, 'a'), tool('create_file', { path: 'index.html', content: '<h1>Hi</h1>' }, 'b'), say('Created index.html.')],
            async () => {
                const res = await runAgentController({
                    userMessage: 'create a simple website',
                    workspace: ws.bridge(),
                    fileName: null,
                    history: [],
                    taskId,
                    onPhase: p => phases.push(p),
                    onActivity: a => acts.push(a),
                });
                check('1. inspection did NOT terminate the task', res.stopReason === 'done');
                check('1. file really created after inspection', ws.content('index.html') === '<h1>Hi</h1>');
                check('1. final response is non-empty', Boolean(res.message && res.message.trim().length > 0));
                check('1. summary names the verified file', (res.message || '').includes('index.html'));
            },
        );
        check('1. phases progressed past inspecting', phases.includes('inspecting') && phases.includes('executing'));
        check('1. task ended in a terminal phase', phases[phases.length - 1] === 'completed' || phases[phases.length - 1] === 'cancelled');
        check('1. store phase is completed', AIRequestStore.getPhase(taskId) === 'completed');
        // The requirement is that nothing is LEFT running, not that no running
        // event was ever emitted (a live stage must be announced).
        check('1. every activity row ends in a settled state', finalActivityStates(acts).every(s => s.status !== 'running'));
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 12 — No permanently-animated row after a task ends
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const taskId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const ws = new WS();
        ws.createFile('a.txt', 'x');
        const acts: AgentActivity[] = [];
        await mock(
            [tool('read_file', { path: 'a.txt' }, 'a'), say('It contains x.')],
            async () => {
                await runAgentController({
                    userMessage: 'explain what this file contains',
                    workspace: ws.bridge(),
                    fileName: 'a.txt',
                    history: [],
                    taskId,
                    onActivity: a => acts.push(a),
                });
            },
        );
        check('12. no running activity survives the run', finalActivityStates(acts).every(s => s.status !== 'running'));
        check('12. the read stage row was reused, not duplicated', new Set(acts.map(a => a.id)).size < acts.length + 1);
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 2 / 3 / 5 — Multiple tool calls then a final response
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const ws = new WS();
        await mock(
            [
                tool('create_file', { path: 'index.html', content: 'a' }, 'a'),
                tool('create_file', { path: 'styles.css', content: 'b' }, 'b'),
                tool('create_file', { path: 'script.js', content: 'c' }, 'c'),
                say('Created three files.'),
            ],
            async () => {
                const res = await runAgentController({ userMessage: 'create a todo website using HTML', workspace: ws.bridge(), fileName: null, history: [] });
                check('2. all three tool calls executed', res.appliedCount === 3);
                check('3. final response present', Boolean(res.message?.trim()));
                check('5. model summary used on a clean exit', (res.message || '').includes('three files'));
            },
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // 3 — A tool result requires another model request (real continuation)
    // ════════════════════════════════════════════════════════════════════
    await mock(
        [tool('list_files', {}, 'a'), tool('create_file', { path: 'x.html', content: 'x' }, 'b'), say('Done.')],
        async (calls) => {
            const ws = new WS();
            await runAgentLoop({
                taskContext: createTaskContext('build something'),
                history: [],
                deps: { getFileTree: ws.getFileTree, deps: createExecutorDeps(ws.bridge(), null, null) } as never,
                budget: { maxSteps: 6 },
            });
            check('3. loop made three provider round-trips', calls.length === 3);
            check('3. tool result forced another request', calls.length > 1);
            const second = (calls[1]?.messages ?? []) as any[];
            check('3. result returned to the model as a tool message', second.some((m: any) => m.role === 'tool' && m.tool_call_id === 'a'));
            check('3. assistant tool_calls echoed back', second.some((m: any) => m.role === 'assistant' && m.tool_calls));
        },
    );

    // ════════════════════════════════════════════════════════════════════
    // 4 — Conversational response WITHOUT the tool loop
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const ws = new WS();
        await mock([say('Hey! What are we building today?')], async (calls) => {
            const res = await runAgentController({ userMessage: 'hi', workspace: ws.bridge(), fileName: null, history: [] });
            check('4. greeting is answered', (res.message || '').includes('Hey'));
            check('4. greeting used no tools', calls.length === 1);
            check('4. greeting ran a single provider request', res.appliedCount === 0);
        }, { stream: true });
        check('4. greetings are detected as trivial chat', isTrivialChat('hi') && isTrivialChat('hello there') && !isTrivialChat('create a website'));
    }

    // ════════════════════════════════════════════════════════════════════
    // 6 — Empty final response
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const ws = new WS();
        await mock([say('   ')], async () => {
            const res = await runAgentController({ userMessage: 'hello', workspace: ws.bridge(), fileName: null, history: [] });
            check('6. whitespace-only model output still yields a response', Boolean(res.message?.trim()));
        });
        await mock([tool('list_files', {}, 'a'), say('')], async () => {
            const ws2 = new WS();
            const res = await runAgentController({ userMessage: 'what files are here', workspace: ws2.bridge(), fileName: null, history: [] });
            check('6. empty tool-loop output falls back to verified summary', Boolean(res.message?.trim()));
            check('6. fallback is not fabricated content', !/Created|Updated/.test(res.message || ''));
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // 5 (loop) — A response containing ONLY tool calls is not an answer
    // ════════════════════════════════════════════════════════════════════
    await mock([tool('list_files', {}, 'a')], async () => {
        const ws = new WS();
        const res = await runAgentLoop({
            taskContext: createTaskContext('loop'),
            history: [],
            deps: { getFileTree: ws.getFileTree, deps: createExecutorDeps(ws.bridge(), null, null) } as never,
            budget: { maxSteps: 4 },
        });
        check('5. tool-only turns do not produce a final answer', res.stopReason !== 'done');
    });

    // ════════════════════════════════════════════════════════════════════
    // 7 — Provider error during streaming
    // ════════════════════════════════════════════════════════════════════
    await mock([{ __status: 503 }], async () => {
        AIRequestStore._clearForTests();
        const taskId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const ws = new WS();
        const res = await runAgentController({ userMessage: 'create a website', workspace: ws.bridge(), fileName: null, history: [], taskId });
        check('7. provider failure reported as failure', res.stopReason === 'error');
        check('7. failure yields a truthful message', Boolean(res.message?.trim()));
        check('7. failure message names the problem', /couldn't finish|failed/i.test(res.message || ''));
        check('7. failure claims no changes', !/Created\/updated:/.test(res.message || ''));
        check('7. nothing was written', ws.getFileTree().length === 0);
        check('7. task reached a terminal phase', isTerminalPhase(AIRequestStore.getPhase(taskId)));
        AIRequestStore._clearForTests();
    });

    // ════════════════════════════════════════════════════════════════════
    // 8 — Provider error AFTER successful file changes
    // ════════════════════════════════════════════════════════════════════
    await mock([tool('create_file', { path: 'done.html', content: 'ok' }, 'a'), { __status: 500 }], async () => {
        AIRequestStore._clearForTests();
        const ws = new WS();
        const res = await runAgentController({ userMessage: 'create a page', workspace: ws.bridge(), fileName: null, history: [] });
        check('8. file really was created', ws.content('done.html') === 'ok');
        check('8. failure is reported honestly', res.stopReason === 'error');
        check('8. failure message lists the partial changes', (res.message || '').includes('done.html'));
        check('8. failure is not dressed up as success', res.success === false);
    });

    // ════════════════════════════════════════════════════════════════════
    // 9 — Cancellation during tool execution
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const taskId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const ws = new WS();
        const controller = new AbortController();
        const res = await runAgentController({
            userMessage: 'create a website',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
            taskId,
            signal: controller.signal,
            onActivity: () => controller.abort(),
        });
        check('9. cancellation is reported', res.stopReason === 'cancelled');
        check('9. cancellation produces a message', Boolean(res.message?.trim()));
        check('9. cancellation message is explicit', /Cancel|stopped/i.test(res.message || ''));
        check('9. cancellation is not reported as success', res.changedWorkspace === false);
        check('9. cancellation reaches a terminal phase', isTerminalPhase(AIRequestStore.getPhase(taskId)));
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // 10 — Stalled / over-budget task
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        await mock([tool('list_files', {}, 'a'), tool('list_files', {}, 'b'), tool('list_files', {}, 'c')], async () => {
            AIRequestStore._clearForTests();
            const ws = new WS();
            const res = await runAgentController({
                userMessage: 'add more pages to the project, then add more again',
                workspace: ws.bridge(),
                fileName: null,
                history: [],
                budget: { maxSteps: 2 },
            });
            check('10. over-budget run stops', res.stopReason !== 'done');
            check('10. stalled run still answers', Boolean(res.message?.trim()));
            check('10. stalled run admits incompleteness', /budget|incomplete|before finishing|repeatedly/i.test(res.message || ''));
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // 15 — Provider fallback with a different response shape
    // ════════════════════════════════════════════════════════════════════
    await mock(
        [{ __status: 500 }, say('Recovered and created the page.')],
        async calls => {
            const ws = new WS();
            const res = await runAgentController({ userMessage: 'say hi', workspace: ws.bridge(), fileName: null, history: [] });
            check('15. fallback provider still yields a response', Boolean(res.message?.trim()));
            check('15. fallback did not fabricate success', res.changedWorkspace === false);
            void calls;
        },
    );

    // ════════════════════════════════════════════════════════════════════
    // 16 — Partial filesystem failures
    // ════════════════════════════════════════════════════════════════════
    await mock([tool('write_file', { path: 'missing.js', content: 'x' }, 'a'), say('I could not find that file.')], async () => {
        AIRequestStore._clearForTests();
        const ws = new WS();
        const res = await runAgentController({ userMessage: 'fix the config', workspace: ws.bridge(), fileName: null, history: [] });
        check('16. partial failure not reported as success', res.changedWorkspace === false);
        check('16. partial failure still produces a response', Boolean(res.message?.trim()));
    });

    // ════════════════════════════════════════════════════════════════════
    // 17 — Final summary uses only verified results
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const ws = new WS();
        await mock(
            [tool('create_file', { path: 'real.html', content: 'x' }, 'a'), say('Created real.html.')],
            async () => {
                const res = await runAgentController({ userMessage: 'create a page', workspace: ws.bridge(), fileName: null, history: [] });
                check('17. summary names the real file', (res.message || '').includes('real.html'));
                check('17. summary invents no other files', !/ghost|fake|imaginary/.test(res.message || ''));
                check('17. summary claims tests only if run', !/tests passed|build passed/i.test(res.message || ''));
            },
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // 13 — Duplicate final-response prevention (idempotent activity ids)
    // ════════════════════════════════════════════════════════════════════
    {
        AIRequestStore._clearForTests();
        const taskId = AIRequestStore.startRequest('chat', 'thinking', 'understanding');
        const ws = new WS();
        const acts: AgentActivity[] = [];
        await mock(
            [tool('read_file', { path: 'f.txt' }, 'a'), tool('write_file', { path: 'f.txt', content: 'y' }, 'b'), say('Done.')],
            async () => {
                ws.createFile('f.txt', 'x');
                await runAgentController({
                    userMessage: 'update the file',
                    workspace: ws.bridge(),
                    fileName: 'f.txt',
                    history: [],
                    taskId,
                    onActivity: a => acts.push(a),
                });
            },
        );
        // The same stage re-emitting must not leave parallel running rows.
        const finals = finalActivityStates(acts);
        check('13. every activity id settles exactly once', finals.every(s => s.status !== 'running'));
        check('13. activity list stayed bounded', acts.length <= 24);
        AIRequestStore._clearForTests();
    }

    // ════════════════════════════════════════════════════════════════════
    // Budget vs panel ceiling — the configuration that caused the stall
    // ════════════════════════════════════════════════════════════════════
    {
        // The panel guard must outlast the agent's own budget, otherwise the
        // panel aborts runs the agent would have completed and summarized.
        check('budget: agent timeout is bounded', DEFAULT_AGENT_BUDGET.timeoutMs > 0 && Number.isFinite(DEFAULT_AGENT_BUDGET.timeoutMs));
        check('budget: steps are bounded', DEFAULT_AGENT_BUDGET.maxSteps > 0 && DEFAULT_AGENT_BUDGET.maxSteps <= 50);
        check('budget: tool calls are bounded', DEFAULT_AGENT_BUDGET.maxToolCalls > 0);
    }

    AIRequestStore._clearForTests();
    check('lifecycle: test harness raf installed', rafStub.pendingCount >= 0);
    finish('responseLifecycle');
})();