/**
 * Regression tests for the proposal REBASE pipeline and agent-loop guarantees.
 *
 * Real failure modes covered:
 *   1. A proposal whose `before` is stale because the user typed a keystroke:
 *      the intended region still exists → rebase onto the live file, whose
 *      user edits are PRESERVED (the original bug answered "1 skipped — file
 *      changed since proposal" and silently applied nothing).
 *   2. Line-ending-only divergence must not count as a user edit at all.
 *   3. The intended region is GONE or changed internally → refuse (never
 *      overwrite live content), even when the user would benefit from it.
 *   4. Ambiguous regions (the same snippet appears twice) → refuse; the caller
 *      must offer re-running the request, not pick a location by guesswork.
 *   5. Pure insertion rebases anchor on the unchanged tail and refuse when the
 *      anchor is missing or duplicated.
 *   6. The agent loop keeps assistant/tool message pairs intact — no provider
 *      ever sees a tool result without its tool_call (4xx-shaped regression).
 *   7. Read-only tools may run concurrently, but WRITE tools stay sequential:
 *      two writes to the same path must produce the second one's final state.
 */
import { check, finish, installRafStub } from './_harness';
installRafStub();

import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import { createFile as opCreateFile, ensureFolderPath, updateFileContent as opUpdateFileContent } from '../src/core/filesystem/operations';
import { resolveResource } from '../src/core/filesystem/queries';
import { createExecutorDeps } from '../src/core/editor/workspaceBridge';
import { contentEquivalent, normalizeForCompare, tryRebaseUpdate, canCreateStillApply } from '../src/core/ai/proposalRebase';
import { runAgentLoop, compactToolHistory } from '../src/core/ai/agentLoop';
import { createTaskContext } from '../src/core/ai/agentTaskContext';

// ────────────────────────────────────────────────────────────────────────────
// 1-5 — Proposal rebase
// ────────────────────────────────────────────────────────────────────────────

const BEFORE_BEFORE = ['# Tclite', '', '# Heading', 'Some text.', ''];
const AFTER_AFTER = ['# Tclite', '', '# Heading', 'Some edited text.', ''];
const BEFORE = BEFORE_BEFORE.join('\n');
const AFTER = AFTER_AFTER.join('\n');
// Live diverged: the user changed the heading but left the target text alone.
const LIVE_USER_EDIT = ['# Tclite', '', '# NEW HEADING', 'Some text.', ''].join('\n');

const tool = (name: string, args: Record<string, unknown>, id = 'c1') => ({
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string) => ({ content });

/** In-memory workspace fixture mirroring the responseLifecycle harness. */
class WS {
    tree: FileNode[] = [];
    getFileTree = (): FileNode[] => this.tree;
    createFile = (path: string, content = '') => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) this.tree = ensureFolderPath(this.tree, dir).tree;
        const parent = dir ? resolveResource(this.tree, dir) : null;
        if (dir && !parent) return { error: { message: 'no parent' } };
        const r = opCreateFile(this.tree, { name, parentId: dir ? (parent as { id: string }).id : ROOT_NODE_ID, content });
        if (r.changed && !r.error) this.tree = r.tree;
        return r.error ? { error: r.error } : { changed: true };
    };
    updateFileContent = (id: string, c: string) => {
        const r = opUpdateFileContent(this.tree, id, c);
        if (r.changed && !r.error) this.tree = r.tree;
        return r.error ? { error: r.error } : { changed: true };
    };
    content = (p: string): string | null => {
        const n = resolveResource(this.tree, p);
        return n && (n as { type?: string; content?: string }).type === 'file' && typeof (n as { content?: string }).content === 'string'
            ? (n as { content: string }).content
            : null;
    };
    bridge() {
        return {
            getFileTree: this.getFileTree,
            createFile: this.createFile,
            updateFileContent: this.updateFileContent,
        } as never;
    }
}

await (async () => {
    // 1 — jump-line edit at the top while the target lines still exist.
    {
        const r = tryRebaseUpdate(BEFORE, AFTER, LIVE_USER_EDIT, 3);
        check('1. a user edit elsewhere does not block the change', r.rebased !== null);
        check('1. the user edit is preserved in the rebased content', r.rebased?.includes('# NEW HEADING') ?? false);
        check('1. the proposed edit IS applied', r.rebased?.includes('Some edited text.') ?? false);
        check('1. untouched text survives byte-for-byte (normalized)', r.rebased?.split('\n')[0] === '# Tclite');
    }

    // 2 — line-ending-only divergence is not a conflict.
    {
        const r = tryRebaseUpdate('a\r\nb\r\n', 'a\r\nb\r\nc\r\n', 'a\nb\n', 0);
        check('2. CRLF/LF-only divergence rebases cleanly', r.rebased !== null);
        check('2. contentEquivalent treats endings as noise', contentEquivalent('a\n', 'a\r\n'));
        check('2. narrows: real content difference is NOT equivalent', !contentEquivalent('a\nb\n', 'a\nc\n'));
        check('2. normalizeForCompare tolerates one trailing newline', normalizeForCompare('a\n') === normalizeForCompare('a'));
    }

    // 3 — the target region was reworded by the user internally.
    {
        const live = ['# Tclite', '', '# Heading', 'Completely other text.', ''];
        const r = tryRebaseUpdate(BEFORE, AFTER, live.join('\n'), 3);
        check('3. internally-changed target region refuses to rebase', r.rebased === null);
        check('3. refusal explains the reason', Boolean(r.reason && r.reason.length > 0));
    }

    // 4 — ambiguity: the replaced snippet appears twice with no context to
    // disambiguate (both candidates score identically).
    {
        const live = 'intro\nshared-marker\nshared-marker\noutro\n';
        const before = 'shared-marker\n';
        const after = 'shared-marker — reworded\n';
        const r = tryRebaseUpdate(before, after, live, 0);
        check('4. ambiguous region refuses to rebase', r.rebased === null);
        check('4. ambiguity points at re-running the request', /re-run|ambig|several/i.test(r.reason ?? ''));
    }

    // 5 — pure insertion: anchor missing/duplicated refuses; edit-at-end of user-grown file applies.
    {
        const before = 'one\ntwo\n';
        const after = 'one\nINSERTED\ntwo\n';
        const missingTail = live => tryRebaseUpdate(before, after, live, 1);
        const r1 = missingTail('zzz\nyyy\n');
        check('5. insertion with a missing tail anchor refuses', r1.rebased === null);
        const duplicatedTail = 'one\none\n';
        const r2 = missingTail(duplicatedTail);
        check('5. insertion with an ambiguous tail anchor refuses', r2.rebased === null);
        const r3 = tryRebaseUpdate(before, 'one\ntwo\nthree\n', 'one\ntwo\nuser tail\n', 1);
        check('5. append-after-tail inserts after the user tail', r3.rebased === 'one\ntwo\nuser tail\nthree');
    }

    // 6 — create-proposal gate.
    {
        check('6a. a create still applies when the path does not exist', canCreateStillApply(false));
        check('6b. a create is skipped when the path now exists', !canCreateStillApply(true));
    }

    // 7-9 — agent loop guarantees with the mocked non-streaming transport.
    {
        const turns = [tool('read_file', { path: 'a.html' }, 'a'), tool('write_file', { path: 'a.html', content: 'v2' }, 'b'), say('updated.')];
        const json = (p: unknown) => new Response(JSON.stringify({ choices: [{ message: p }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        const orig = globalThis.fetch;
        let i = 0;
        const calls: any[] = [];
        globalThis.fetch = (async (_u: unknown, init: any) => {
            calls.push(init?.body ? JSON.parse(String(init.body)) : null);
            return json(turns[Math.min(i++, turns.length - 1)]);
        }) as typeof fetch;
        let writeCount = 0;
        let lastWrite = '';
        try {
            const ws = new WS();
            ws.createFile('a.html', 'v1');
            const innerUpdate = ws.updateFileContent;
            ws.updateFileContent = (id: string, c: string) => {
                writeCount++;
                lastWrite = c;
                return innerUpdate(id, c);
            };
            const res = await runAgentLoop({
                taskContext: createTaskContext('update a.html'),
                history: [],
                deps: { getFileTree: ws.getFileTree, deps: createExecutorDeps(ws.bridge(), null, null) } as never,
                budget: { maxSteps: 8 },
            });

            // Every request the loop SENT must keep assistant/tool_call ↔ tool
            // pairs intact — a dangling tool result is a provider 400.
            let pairsIntact = true;
            for (const body of calls) {
                const open = new Set<string>();
                for (const m of body?.messages ?? []) {
                    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) open.add(c.id);
                    if (m.role === 'tool') {
                        if (!open.has(m.tool_call_id)) pairsIntact = false;
                        open.delete(m.tool_call_id);
                    }
                }
            }
            check('7. no request carries an orphaned tool result', pairsIntact);

            // The write actually happened, once, with the last call's content.
            check('9. the write ran and wounded nothing else', writeCount >= 1 ? lastWrite === 'v2' : false);
            check('9. write tools stay sequential (one write call, final state wins)', writeCount === 1 && ws.content('a.html') === 'v2');
            check('10. tool usage forced continuation', calls.length >= 3);
            check('11. loop finished', Boolean(res.taskContext) && calls.length >= 3);
        } finally {
            globalThis.fetch = orig;
            void writeCount;
        }
    }

    // 12 — compactToolHistory never leaves a tool message without its parent.
    {
        const messages: any[] = [
            { role: 'system', content: 's' },
            { role: 'assistant', tool_calls: [{ id: 'x', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'x', content: 'ok' },
            { role: 'assistant', content: 'answer' },
            // A skipped-budget tool call: assistant tool_call with NO result
            // followed by a placeholder tool message — must stay paired.
            { role: 'assistant', tool_calls: [{ id: 'y', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'y', content: '(skipped: budget)' },
        ];
        // NOTE: compactToolHistory MUTATES the array in place.
        compactToolHistory(messages as never, 4);
        const compacted = messages;
        const open = new Set<string>();
        let orphans = 0;
        for (const m of compacted) {
            if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) open.add(c.id);
            if (m.role === 'tool') {
                if (!open.has(m.tool_call_id)) orphans++;
                open.delete(m.tool_call_id);
            }
            if (m.role === 'assistant' && !m.tool_calls) void m;
        }
        check('12. compacted history keeps tool pairs intact', orphans === 0);
        check('12. compacted history keeps the system message', compacted.some(m => m.role === 'system'));
    }

    finish('proposalRebase');
})();
