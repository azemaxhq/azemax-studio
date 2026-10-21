# Mission 06 — Root Cause Analysis: Agent False-Success & Premature Termination

Working notes for the implementation. Confirmed empirically via probe
(`tests/_scratch_probe.test.ts`) and by reading the actual code paths.

## Confirmed root causes

### RC-1 — `delete_file` can NEVER succeed (executor verification bug)

`src/core/ai/aiToolExecutor.ts:392-395`

```ts
let verifyFail = verifyAppliedCandidates(
    candidates.filter(c => !c.plan.actions.some(a => ['create_file', 'rename_file'].includes(a.action))),
    readLatest,
);
```

`delete_file` candidates are NOT filtered out, so they reach
`verifyAppliedCandidates` (`editEngine.ts:654-684`). That function does:

```ts
const actual = readLatest(c.filePath);
if (actual === null) return { filePath: c.filePath, reason: 'File disappeared during apply' };
```

After a successful delete the file is GONE, so `readLatest` returns `null` and
verification FAILS. The executor then throws, rolls back, and reports
`"Verification failed for old.txt: File disappeared during apply"`.

**Evidence:** probe DELETE → `success:false`, message
`"Edit failed and was fully rolled back … (Verification failed for old.txt: File disappeared during apply)"`,
tree after = `[]` (the delete HAPPENED, then the rollback could not restore it
because the content was never captured for a deleted node).

The `delete_file` branch inside `verifyAppliedCandidates` (which expects
`normalize(actual) === ''`) is DEAD CODE — it can never be reached because the
`actual === null` check above it returns first.

**Impact:** every agent-driven delete reports failure, and the file is deleted
anyway (rollback does not restore deleted nodes — `rollback` map is only
populated for `update_file` paths, and for delete the content is captured but
the node is already gone).

### RC-2 — `rename_file` verification is broken by the last commit (7db6b796)

`src/core/ai/aiToolExecutor.ts:413-435` (added by commit 7db6b796)

```ts
const expectedContent = String((renameAction as any).content ?? '');
if (normalize(newActual) !== normalize(expectedContent)) {
    verifyFail = { filePath: newPath, reason: 'Renamed file content does not match expected' };
```

A `rename_file` action carries NO `content` field (see
`structuredOperationParser.ts:157-160` and `editEngine.ts:493-500`), so
`expectedContent` is `''`. The renamed file's actual content is
`"hello world"` → mismatch → verification fails.

The `create_file`/`rename_file` verification block ALSO reads the DESTINATION
path (`newPath`) but `deps.renameNode(fileId, newName)` only renames within the
SAME parent — it never moves the file to a different directory. So
`readLatest(newPath)` for `sub/b.txt` returns `null` even for a correct rename.

**Evidence:** probe RENAME (same dir) → succeeds only because the
`deps.getFileTree` fallback at `aiToolExecutor.ts:440-461` re-runs verification
against the tree and CLEARS `verifyFail`. That fallback is what masks the bug.
For a rename into a DIFFERENT directory, `readLatest('sub/b.txt')` is `null`
in both readers, so the fallback ALSO fails.

**Impact:** rename verification is unreliable and depends on an accidental
fallback; a cross-directory rename is reported as a failure.

### RC-3 — `create_file` over an existing path leaves a DUPLICATE file

`src/core/ai/aiToolExecutor.ts:352` calls `deps.createFile(path, content)`.
`opCreateFile` (`operations.ts:132`) calls `uniqueNameIn(...)` which RENAMES a
colliding file to `a (1).txt` rather than failing. The result: the original
`a.txt` still exists AND a new `a (1).txt` is created.

**Evidence:** probe CREATE-EXISTING → tree after:
`[{name:'a.txt',content:'old'}, {name:'a.txt',content:'new content'}]` — two
files with the same name, one holding the OLD content. Verification then
compares the content at `c.filePath` = `a.txt` (the OLD file) against the
expected new content → mismatch → but again masked by the tree fallback.

**Impact:** the agent "created" a file that the user cannot find; the old
stale file remains and still wins content lookups.

### RC-4 — `update_file` reports success when the write did nothing

`src/core/ai/aiToolExecutor.ts:386-388`

```ts
const res = deps.updateFileContent(fileId, c.candidate);
if (!res.success) throw new Error(...);
```

`updateFileContent` returns `{success:true}` even when the underlying store
no-ops (`opUpdateFileContent` returns `noopResult` when `node.content ===
content`, and the bridge's `updateFileContent` reports `success: !res.error`
where `res.error` is undefined for a no-op).

**Evidence:** probe UPDATE-NOOP → `success:true`,
message `"Updated `a.txt` with the new content."` but tree content is still
`'old'`. The agent told the user the file was updated; it was not.

**Impact:** the classic "AI claims it changed the file but nothing changed"
symptom.

### RC-5 — Premature termination: the loop stops on ANY text-only turn

`src/core/ai/agentLoop.ts:270-276`

```ts
if (toolCalls.length === 0) {
    messages.push({ role: 'assistant', content });
    return finish('done', true);
}
```

The loop treats "the model produced text and no tool calls" as task
completion. But the model routinely emits an INTERMEDIATE message ("Now let me
create the CSS file…") with no tool calls in the same turn, especially with
providers that split a turn. The loop exits, `buildFinalResponse`
(`agentController.ts:737-739`) uses the model's own text as the summary, and
`success: true` is reported even though the task required 3 files and only 1
was created.

**Impact:** the "create a web app" request stops after the first file. This is
the user's reported symptom #2.

### RC-6 — `buildFinalResponse` trusts the model's narrative for the headline

`src/core/ai/agentController.ts:736-739`

```ts
const modelSummary = loop.content?.trim();
if (loop.stopReason === 'done' && modelSummary) {
    parts.push(modelSummary);
}
```

The model's text is pushed FIRST, and it may claim files that were never
created. The verified file list is appended after, but a model sentence like
"Created index.html, styles.css and script.js" is presented as fact.

**Impact:** the false-success report reaches the user.

### RC-7 — Failed tool results are returned to the model, but the loop can
still exit 'done' right after

`agentLoop.ts:487-508` records the failure and returns it to the model
(correct). But if the model's NEXT turn is text-only, `toolCalls.length === 0`
→ `finish('done', true)` — the failure is reported as a SUCCESSFUL completion.
`taskContext.operations` still contains the error, and `buildFinalResponse`
appends `"N operation(s) failed"`, but `success: true` and the model's
"all done" text are both surfaced.

**Impact:** a failed operation silently becomes a successful final response.

### RC-8 — No plan → completion linkage

`chooseImplementationDefault` (`intentUnderstanding.ts:405-459`) computes
`files: ['index.html','styles.css','script.js']` for an empty workspace, and
this list is injected into the prompt as "Suggested starting files". Nothing
checks afterwards whether those files actually exist. There is no typed
"planned / completed / failed / remaining" state, so the agent cannot know it
stopped early.

**Impact:** the agent has no way to know the task is incomplete.

## Where the fixes go

| Defect | Fix location |
|---|---|
| RC-1 | `aiToolExecutor.ts` — verify delete by ABSENCE, not by content |
| RC-2 | `aiToolExecutor.ts` — verify rename against the real new path; drop the bogus content check |
| RC-3 | `aiToolExecutor.ts` — reject create over an existing path before writing |
| RC-4 | `aiToolExecutor.ts` — re-read after write and compare, not just trust the return value |
| RC-5 | `agentLoop.ts` — a text-only turn is NOT completion when the task is a modification task with outstanding work |
| RC-6 | `agentController.ts` — build the headline from verified state |
| RC-7 | `agentLoop.ts` + `agentController.ts` — a run with failed operations is not `success: true` |
| RC-8 | new typed task-state in `agentTaskContext.ts` |

## Live-sync findings (Phase 5)

- `ProjectContext` mutations are SYNCHRONOUS against `latestTreeRef`
  (`useTreeMutation`, `ProjectContext.tsx:339-354`) — the ref is updated before
  `setFileTree`. So `getFileTree()` returns the fresh tree immediately after a
  mutation. This is why the executor's tree fallback works, and it means NO
  `setTimeout` is needed for correctness.
- `emitFileChange` fires for create/update/delete/rename/move
  (`ProjectContext.tsx:803, 822, 830, 846, 855, 886, 1063, 1083, 1109, 1117`).
- `createFile` calls `setActiveFile(result.node)` — the newly created file
  becomes the active file. This means creating 3 files leaves the LAST one
  active. The Explorer still shows all three (it renders the tree).
- `renameNode` only renames within the parent folder (`opRenameNode`,
  `operations.ts:259-290`). A `newPath` with a different directory is NOT
  honoured — the executor passes only `newPath.split('/').pop()`. So a
  cross-directory rename silently becomes a same-directory rename. The
  verification then checks the wrong path.
- `workspaceBridge.updateFileContent` pushes the new content into the Monaco
  model for the active file (`workspaceBridge.ts:139-171`), so the open editor
  DOES reflect agent writes.

## Test infrastructure notes

- `tests/_harness.ts` provides `check()`/`finish()` that work both under vitest
  and standalone via `tsx`.
- `tests/agentControllerIntegration.test.ts` already has a `WS` fake workspace
  and a `mock()` provider stub — the new regression tests follow that pattern.
- The provider stub returns backend-shaped `{choices:[{message}]}` responses.
