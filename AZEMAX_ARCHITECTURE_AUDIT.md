# Azemax Architecture Audit

**Date:** 2026-09-05
**Version:** 0.0.0 (audited commit: HEAD Sep 02 2026)
**Auditor:** Muse Spark (OpenCode) — evidence-based, no speculation
**Scope:** Complete repository — `src/`, `server/`, `vite.config.ts`, `package.json`, `tests/`, build & runtime
**Method:** Direct file reads + grep + parallel sub-agent deep dives. Every finding cites `file:line` + symbol.

---

## 1. Executive Summary

### 1.1 What Azemax actually is

Azemax is **not** a fork of VS Code. Despite the brief describing it as "built on top of the open-source VS Code architecture", the repository is a **greenfield web IDE**: `React 19 + Vite 7 + Monaco Editor (via @monaco-editor/react) + xterm.js + Express + node-pty + WebSockets`. There is **zero** VS Code workbench source, no Electron main/renderer split, no VS Code extension host, no VS Code service injection (`IInstantiationService`), no VS Code `URI`/`FileService`/`TextModel` stack beyond what `monaco-editor` itself provides.

This is the single most important architectural fact: any guidance to "prefer existing VS Code abstractions" is moot — there are none to prefer. The correct reference is **Monaco + React + Express**, not VS Code.

### 1.2 Health assessment

| Dimension | Grade | One-line verdict |
|-----------|-------|------------------|
| Repository structure | B+ | Clean Vite split, manualChunks well-designed; `src/core/` consolidation in progress |
| Application lifecycle | B | Vite proxy + `concurrently` + `lifecycle.cjs` lockfile is solid; portability gaps (lsof/ps) |
| Editor lifecycle | C+ | Single-model Monaco correctly, but 1981-line `CodeEditor.tsx` god-component, leaked disposables, double-writer race |
| State architecture | C | 6+ SOTs, manual sync (`activeEditorStore` ↔ `ProjectContext` ↔ `SettingsContext`); stale-closure merge in `SettingsContext` |
| AI architecture | C+ | Well-isolated `src/core/ai/` + strong reasoning-filter pipeline, but triple-duplicated provider routing, triple abort registries, stale-guard timing gaps |
| Diagnostics | C | Unified `checkDiagnosticsEx` good; Monaco isolated-model leak window, line-truncation offset drift, silent truncation of AI diagnostics |
| Filesystem / Workspace | C- | `workspaceStore.cjs` does sync `readFileSync/writeFileSync` + read-modify-write race; `mockFileSystem` ID collisions; `safeTree.ts` is exemplary |
| IPC / Events | C+ | `EventBus.ts` + `TerminalSessionController` are correct patterns mis-wired (PerformanceContext dead loop, global `window` coupling) |
| Error handling | B | 78 catch sites mostly hardened; AI typed `AIError` excellent; a few swallowed execution + diagnostic errors |
| Performance | B- | `localStorageDebounce`, `fuzzySearch`, `safeTree` exemplary; `PerformanceContext` dead rAF loop, `AIComposer` 700ms poll, icon duplication |
| Memory / Resources | C | Unbounded Maps (`diagnosticStore`, `analysisCache`, `providerHealth`), leaked intervals, Monaco model window |
| Dependencies | B+ | Well-split chunks, strict `tsconfig`; `rehype-raw` dead dep, `@types/jszip` miscategorised, `react-icons`+`lucide-react` duplication |
| Testing | B | 20 test suites `tests/*.test.ts`; harness in `tests/_harness.ts`; no E2E, no perf regression |
| Security | B | `skipHtml:true` + no `rehype-raw` correct; `sanitizeEditorOutput` central; still `dangerouslySetInnerHTML` path via Prism without HTML sanitise |

### 1.3 Top 10 findings (priority ordered)

1.  **P0 — `server/services/projects/workspaceStore.cjs:42-58` sync FS + no lock** — concurrent saves lose updates; blocks event loop. Correctness risk.
2.  **P0 — `src/core/editor/activeEditorStore.ts` ↔ `ProjectContext.tsx:395-406` dual SOT race** — `getActiveEditorContext()` can return `null` even when file is open; AI reads stale context.
3.  **P1 — `server/services/ai/modelRouter.cjs:230` forced `minimax-m3:free` hijack** — ignores `requestedModel` + `allowFallback:false`; billing / behaviour violation.
4.  **P1 — `src/core/ai/editEngine.ts:680-685` lenient verify** — `candidate.slice(0,100).includes(actual.slice(0,100))` passes truncated writes as success.
5.  **P1 — `src/components/Editor/CodeEditor.tsx:546,803,994` window listener accumulation + `_codeEditorDisposables:1500` leak** — StrictMode remount leaks Monaco listeners.
6.  **P1 — `server/services/ai/aiClient.cjs:27-103` + `modelRouter.cjs:79-105` duplicated `inferProvider`/`GROQ_MODEL_IDS`** — already diverged (`nvidia/` vs `/`).
7.  **P1 — `src/context/ExplanationContext.tsx:94-111` dual registry `aiRequestManager` + `AIRequestStore` unsynced** — stale spinner, store entry leaks.
8.  **P2 — `src/core/runtime/PerformanceContext.tsx:40-53` dead rAF loop** — `startLoop` emits one frame then stops forever; demand loop never restarts.
9.  **P2 — `src/components/Panels/AIAssistant.tsx:181,116` `dangerouslySetInnerHTML` via Prism** — model-supplied `<svg onload>` can bypass sanitiser.
10. **P2 — `src/utils/codeExecutionService.ts:84` `getRuntimes()` per `executeCode()`** — adds 100-300ms RTT; no cache, no abort.

### 1.4 Audit rule compliance

* No refactors performed. No dependencies added. No files invented. Every "Unable to determine" is explicit.
* Evidence threshold: every P0/P1 cites a concrete `file:line` + symbol read in this session.

---

## 2. Repository Architecture

### 2.1 Directory map

```
/
├── index.html                  # Vite entry, 4 Google Fonts, <div id="root">
├── vite.config.ts              # alias @→src, proxy /api→3001+Sse headers, manualChunks
├── tsconfig.json → tsconfig.app.json / tsconfig.node.json
├── tailwind.config.js + postcss.config.js + eslint.config.js
├── public/                     # static assets (vite publicDir)
├── src/
│   ├── main.tsx                # createRoot(<StrictMode><App/>)
│   ├── App.tsx                 # composeProviders + lazy(MainLayout|PlanetHero)
│   ├── index.css               # Tailwind + --az-* design tokens
│   ├── core/                   # NEW: consolidated architecture (in-progress)
│   │   ├── composeProviders.tsx
│   │   ├── branding.ts
│   │   ├── editor/  activeEditorStore.ts, workspaceBridge.ts
│   │   ├── runtime/ DisposableStore, CancellationToken, SingleFlight, EventBus, cursorPositionStore
│   │   ├── ai/      38 files (see §7)
│   │   ├── diagnostics/ diagnosticStore.ts
│   │   └── shell/   inBrowserShell.ts
│   ├── components/
│   │   ├── Layout/MainLayout.tsx (541 lines)
│   │   ├── Editor/CodeEditor.tsx (1981), AICommentIndicator.tsx
│   │   ├── Sidebar/ FileExplorer, Sidebar, SettingsSidebar, ExplanationSidebar
│   │   ├── Panels/ AIAssistant (2199), AIComposer, BottomPanel, ProblemsPanel,
│   │   │           TerminalPanel, ShellTerminal, ExplanationPanel, MarkdownRenderer, …
│   │   ├── AI/ AILoadingIndicator, SmoothStreamingBubble, aiActivityLabel
│   │   ├── Settings/ SettingsPanel, SettingsCard, KeyboardShortcuts, …
│   │   ├── UI/ ErrorBoundary, DialogProvider, dialogService, ContextMenu, AzemaxLogo
│   │   ├── Planet/ PlanetHero/Scene/Reveal (isolated preview via ?planet)
│   │   └── PerformanceBudgetMonitor.tsx
│   ├── context/
│   │   ├── ProjectContext.tsx (922)  — file tree, open/close/save, workspace persist
│   │   ├── TerminalContext.tsx       — EventTarget bus, TerminalSessionController
│   │   ├── ExplanationContext.tsx (306)
│   │   ├── SettingsContext.tsx
│   │   └── PerformanceContext.tsx    — (dead rAF loop, see §11.6)
│   ├── settings/
│   │   ├── settingsStore.ts, settingsPersistence.ts, settingsSchema.ts,
│   │   │   settingsTypes.ts, settingsValidation.ts, settingsDefaults.ts
│   │   └── (consumed via useSettingsStore / getSettings())
│   ├── hooks/
│   │   ├── useTheme.ts, useSettingsApplier.ts, useMediaQuery.ts,
│   │   │   useDebounce.ts, useAILoading.ts, usePerformanceMonitor.ts
│   │   └── (best-practice shared rAF in usePerformanceMonitor)
│   ├── utils/
│   │   ├── apiClient.ts, mockFileSystem.ts, safeTree.ts (exemplary), explorerSort.ts
│   │   ├── language.ts, cn.ts, fuzzySearch.ts
│   │   ├── diagnosticsService.ts (1045), diagnosticsTypes.ts, codeAnalysisEngine.ts
│   │   ├── ageing/detectors.ts (464) + helpers.ts
│   │   ├── groqService.ts (417, facade), codeSuggestionService.ts (548)
│   │   ├── codeExecutionService.ts (121), prismLoader.ts, chatStorage.ts,
│   │   │   localStorageDebounce.ts, performanceService.ts, performanceAlerts.ts,
│   │   │   aiSanitizer.ts (shim), analysisHistory.ts
│   │   └── ...
│   ├── types/  (project, terminal, editor types)
│   └── assets/ azemax_logo_wbg.png
├── server/
│   ├── index.cjs               # listenWithRetry + attachExecutionWebSocket + graceful shutdown
│   ├── app.cjs                 # express + cors + rate limiter (setInterval unref'd)
│   ├── lifecycle.cjs           # file lock (data/.azemax.lock), isOurServerProcess (ps/lsof), kill pid
│   ├── config/index.cjs        # env (GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN, port 3001)
│   ├── middleware/errorHandler.cjs
│   ├── lib/asyncHandler.cjs
│   ├── routes/ index.cjs, ai.cjs (64), execute.cjs (17), projects.cjs, health.cjs
│   ├── services/
│   │   ├── ai/ aiClient.cjs (377), chatService.cjs (425), aiError.cjs (236),
│   │   │     aiRequestManager.cjs (79), aiStream.cjs (400), modelRouter.cjs (327),
│   │   │     providerHealth.cjs (79), aiContext.cjs (114), taskConfig.cjs (119)
│   │   ├── execution/ languageConfig.cjs, runtimeDetection.cjs, localExecutor.cjs,
│   │   │             httpExecutor.cjs, wandboxExecutor.cjs, fileNaming.cjs, constants.cjs
│   │   ├── projects/workspaceStore.cjs
│   │   └── terminal/ terminalManager.cjs (26443 lines incl. logic), ptyRelay.py
│   ├── websocket/executionHandler.cjs
│   └── test_langs.py
├── tests/ 20 suites (*.test.ts) + _harness.ts
├── data/ (.azemax.lock, workspace JSON)
├── dist/ (vite build output)
├── scripts/ ensure-backend.cjs
└── docs/ 8 markdown files (SERVICES, CONTEXT, COMPONENTS, SERVER, …)
```

### 2.2 Entry points

* **Client:** `index.html:11` → `src/main.tsx:6` → `src/App.tsx:89` (`RootErrorFallback` + `composeProviders`) → `src/components/Layout/MainLayout.tsx:29`
* **Server:** `server/index.cjs:17` (`createApp` → `createServer` → `attachExecutionWebSocket` → `installGracefulShutdown` → `acquireLock` → `listenWithRetry`). `npm run dev` (`package.json:7-11`) runs `concurrently` server+client, client `wait-on http-get://127.0.0.1:3001/api/health` before `vite`.

### 2.3 Module classification

| Class | Members | Evidence |
|-------|---------|----------|
| **VS Code inherited** | **None.** Only `monaco-editor` (the editor extracted from VS Code) via `@monaco-editor/react`. No workbench. | `package.json:20`, `vite.config.ts:85` excludes `@monaco-editor/react` from optimizeDeps |
| **Azemax modified** | N/A (no VS Code base to modify) | — |
| **Azemax newly introduced** | Everything in `src/` + `server/` | `src/core/ai/` 38 files, `src/utils/*`, `src/context/*`, `server/services/*` |
| **Third-party / integrated** | `monaco-editor`, `@xterm/xterm` + addons, `ws`, `node-pty`, `express`, `groq-sdk`/`openai`/`@openrouter/sdk`, `react-markdown`+`remark-gfm`, `prismjs`, `framer-motion` | `package.json:19-48`, `vite.config.ts:53-59` manualChunks |
| **Shared infra** | `src/core/runtime/*`, `src/utils/safeTree.ts`, `src/utils/localStorageDebounce.ts` | `src/core/runtime/index.ts` re-exports |

### 2.4 Mental dependency map

```
index.html → main.tsx → App.tsx → composeProviders(Dialog, Performance, Project, Terminal, Explanation, Settings)
                              → MainLayout
                                  ├── Sidebar (FileExplorer → safeTree → mockFileSystem)
                                  ├── CodeEditor (Monaco + diagnosticsService + codeSuggestionService → groqService → AIClient → server /api/ai/*)
                                  ├── BottomPanel (ProblemsPanel ← diagnosticStore, TerminalPanel ← TerminalContext ← TerminalManager)
                                  └── AIAssistant (AIComposer + MarkdownRenderer ← AIRequestStore ← AIClient, chatStorage)
ProjectContext (file tree SOT) ↔ activeEditorStore (Monaco model handle) ↔ workspaceBridge (AI executor deps)
SettingsContext ↔ settingsStore (module var current) ↔ settingsPersistence (localStorage)
Server: app.cjs → routes/* → services/ai/* (modelRouter → aiClient → aiStream → providerHealth) 
              → services/execution/* , services/projects/workspaceStore, services/terminal/terminalManager
              → websocket/executionHandler
```

---

## 3. VS Code vs Azemax Architecture

### 3.1 Claim vs reality

| Claim (brief) | Reality | Risk |
|---------------|---------|------|
| "Built on top of open-source VS Code architecture" | Greenfield React/Vite web app that **embeds Monaco** (the editor extracted from VS Code). No VS Code `src/vs/*`. | Misleads architectural decisions: reviewers look for VS Code patterns (`IInstantiationService`, `IFileService`, workbench contributions) that do not exist. |
| "Which parts originate from VS Code" | Answer: only `monaco-editor` via npm (`@monaco-editor/react:4.7.0`). No other VS Code code is vendored. | Low maintenance risk, but Monaco theming/API must be tracked separately. |
| "Prefer existing VS Code abstractions" | There are none. The correct reuse target is `monaco-editor` APIs + Azemax's own `src/core/runtime/*`. | Creating "VS Code alignment" work is wasted; instead align to `src/core/*` already being consolidated. |
| "How extensions are handled" | No extension host. No VS Code extensions. `src/core/ai/toolRegistry.ts` is an internal tool registry, not an extension API. | Feature request to "run VS Code extensions" would require new subsystem, not a migration. |
| "Main process / renderer architecture if applicable" | No Electron. Single browser renderer (Vite dev) + Node Express backend. `server/index.cjs` is not Electron main. | IPC is HTTP+WS, not Electron IPC. |
| "Workers" | No Web Workers. Diagnostics runs on main thread (Monaco markers + `diagnosticsService.ts`). `js`/`ts` check via Monaco isolated model. | Large-file diagnostics blocks UI — opportunity for worker migration (Phase D). |

### 3.2 Architectural divergence — justified or not?

| Divergence | Why it exists | Justified | Maintenance risk |
|------------|---------------|-----------|------------------|
| React functional components + Context instead of VS Code's AMD `InstantiationService` | Greenfield web app, React idiomatic | Yes | None — but Context proliferation (6 providers) creates prop-drilling alternative; use `src/core/runtime/EventBus` more |
| File system is in-memory `ProjectContext` + `safeTree` + `workspaceStore.cjs` JSON, not `IFileService` + `vscode.workspace.fs` | Web-first, no native FS; `node-pty` + `workspaceStore` suffice for demo | Partially — sync FS + race (P0) must be fixed; consider `fs/promises` + lock |
| No extension host | Scope — Azemax is AI-native IDE, not VS Code compatible | Yes for now | Document explicitly; don't imply compatibility |
| Monaco via `@monaco-editor/react` rather than VS Code's `editor` contribution | Lightweight, Vite-friendly | Yes | Pin `monaco-editor` version; watch breaking `loader` API |
| `src/core/` consolidation (DisposableStore, EventBus, CancellationToken, SingleFlight) mirrors VS Code patterns without importing them | Author rebuilt VS Code primitives idiomatically | Yes | Converge on these; delete duplicates (e.g., `PerformanceContext`'s ad-hoc bus) |

### 3.3 Recommendation

Stop framing Azemax as "VS Code architecture". Reframe docs (`readme.md`, `docs/FULL_DOCUMENTATION.md`) as "Monaco-based web IDE with Azemax `src/core/` runtime". This avoids chasing phantom VS Code alignment work and focuses effort on hardening `src/core/runtime` + `src/core/ai` already underway.

---

## 4. Application Lifecycle

### 4.1 Startup sequence

1. `npm run dev` → `scripts/ensure-backend.cjs` → `concurrently` launches `node --watch server/index.cjs` + `wait-on http-get://127.0.0.1:3001/api/health && vite`.
2. `server/index.cjs:17-32` — `createApp()` (`server/app.cjs` express + cors + `server/middleware/errorHandler.cjs` + `server/lib/asyncHandler.cjs`) → `createServer` → `attachExecutionWebSocket(wss)` (`server/websocket/executionHandler.cjs:33` returns `TerminalManager`) → `installGracefulShutdown({server,wss,terminalManager})` (`server/lifecycle.cjs:212` handles SIGINT/SIGTERM, `aiRequestManager.abortAll()`, `wss.close`, `terminalManager.destroy()`, `pidListeningOn`/`writeLock`/`releaseLock`) → `listenWithRetry` (retries port if `EADDRINUSE` by `isOurServerProcess` ps check).
3. Client `vite.config.ts:26` proxies `/api` → `localhost:3001` with SSE headers (`Cache-Control:no-cache`, `X-Accel-Buffering:no`, `Content-Encoding:identity`).
4. `src/main.tsx:6` `createRoot(...).render(<StrictMode><App/></StrictMode>)` → `src/App.tsx:62` `composeProviders` (order: `DialogProvider, PerformanceProvider, ProjectProvider, TerminalProvider, ExplanationProvider, SettingsProvider`) → `src/App.tsx:32` `AppContent` (`PlanetHero` if `?planet`, else `MainLayout`).
5. `MainLayout` mounts `Sidebar` + `CodeEditor` + `BottomPanel` + `AIAssistant`; each subscribes to contexts.

### 4.2 Shutdown

`server/lifecycle.cjs:212-260` — `graceful` sequence: `abortAll` inflight AI, close WS clients, `_garbageCollect` intervals cleared, lockfile released, `process.exit`. Client: `beforeunload/pagehide/visibilitychange:hidden` in `src/utils/localStorageDebounce.ts:64-69` flushes pending writes.

### 4.3 Issues

* `server/lifecycle.cjs:45-54` `isOurServerProcess` uses `ps -o command=` and `server/lifecycle.cjs:116` `pidListeningOn` uses `lsof` — **Linux/macOS only, breaks on Windows** (`package.json engines` not set; `server/config/index.cjs` does not gate). Windows startup retries port incorrectly.
* `server/lifecycle.cjs:writeLock` does `fs.writeFileSync` without `O_EXCL` → TOCTOU when two processes start simultaneously; `acquireLock:31` happens after `installGracefulShutdown`, so SIGINT during `listenWithRetry` triggers `beforeClose` even though server never started.
* `server/app.cjs:10` `setInterval` for rate limiter `hits` Map is `unref()`'d but never `clearInterval` — leaks per `createApp()` call; test harness calling `createApp()` per test leaks intervals.
* `src/App.tsx:62` `composeProviders` order: `ProjectProvider` mounts before `SettingsProvider`, so `ProjectContext.tsx:365` `getSettings().privacy.saveWorkspaceState` reads stale defaults until `SettingsProvider` hydrates. Same for `TerminalContext.tsx:213` reading `getSettings().terminal.autoOpenTerminal`.
* `src/main.tsx:7` `StrictMode` causes double-mount in dev — correct, but `CodeEditor.tsx:149` `githubDarkThemeDefined` module-global + `_codeEditorDisposables:1500` array on editor instance must handle remount without leaking (currently leaks, see §5).

---

## 5. Editor Lifecycle

### 5.1 Creation → Disposal trace

* **Creation:** `MainLayout.tsx:474` `<CodeEditor isAiOpen onToggleAi>` mounts → `src/components/Editor/CodeEditor.tsx:1469` `handleEditorMount(editor, monaco)` — `monaco.editor.defineTheme`, `editor.onDidBlur:1483`, `onDidChangeCursorPosition:1483`, `onDidChangeCursorSelection:1484` pushed to `(editor)._codeEditorDisposables:1500` (custom array, not `DisposableStore`).
* **Init:** `useEffect:940` attaches `onDidChangeModelContent` for debounce save; `useEffect:682` registers `activeFile` in `activeEditorStore.ts:652,678`; `useEffect:740` restores Monaco markers for current file.
* **Open:** `ProjectContext.tsx:activateFile` → `setActiveFile` → `syncActiveEditor:404` / `updateActiveFileMeta:406`.
* **Modify:** `onDidChangeModelContent` → `scheduleLocalCheck:479` (600ms) + `debouncedSave:448` (reads `editorRef.current?.getValue()` at fire time) + `activeEditorStore` sync.
* **Save:** `debouncedSave` + `Ctrl+S:565` handler + `workspaceBridge.ts:138` `updateFileContent` via `editor.executeEdits('file-sync')`.
* **Close:** `ProjectContext.tsx:closeFile` → `clearDiagnostics` (`src/core/diagnostics/diagnosticStore.ts:clearDiagnostics` fabricates `idle` result) + `activeEditorStore` clear.
* **Dispose:** `CodeEditor` unmount → `useEffect` cleanups remove `window` listeners (`546,565,994,1014,803,809`) + `monaco` model dispose in `finally:710` (if not null). Editor instance `dispose()` handled by `@monaco-editor/react`.

### 5.2 Findings

* **Leaked Monaco disposables:** `handleEditorMount:1500` pushes to `editor._codeEditorDisposables` but only disposes on next `handleEditorMount` call, not on `activeFile?.id` change or component unmount. `useEffect:940` re-attaches `onDidChangeModelContent` per `editorInstance` change without disposing old listener if `editorInstance` identity unchanged but model changed.
* **Double writer:** `workspaceBridge.ts:138` `updateFileContent` does `editor.executeEdits` directly, while `CodeEditor.tsx:654` `executeEdits('file-sync')` also writes. No `monaco.editor.ITextModel.getVersionId()` ordering; `CodeEditor.tsx:624` `pendingSyncRef` queue may apply out-of-order if AI + user edit same tick (`useEffect:656` flushes on next render without deps).
* **Global window coupling:** `CodeEditor.tsx:44` dispatches `run-button-clicked`, `BottomPanel.tsx:414` listens; `FileExplorer.tsx:820-842` dispatches `azemax-sort-changed` / `explorer-refresh`; `CodeEditor.tsx:809` listens `problems-navigate`. Implicit event names, no typing, no cleanup if consumer unmounts first.
* **Debounce drop:** `scheduleLocalCheck:479` uses `isChecking` guard — if user types during `isChecking=true`, local diagnostic check is silently dropped and `markStale:532` leaves decorations stale until next explicit trigger.
* **Inline completion promise leak:** `CodeEditor.tsx:1149` `fetchSuggestion` + `pendingInlineResolveRef:161` — `provideInlineCompletions:1288` resolves old pending with `{items:[]}` but `debounceTimerRef:159` timer only cleared on unmount (`590`), not on file switch; stale suggestion may resolve after `activeFile?.id` change (`isStale:1165` checks version, not fileId).
* **Save race vs AI:** `debouncedSave:463` guard `if (latestEditorValue !== content) return` drops save entirely instead of retrying with live model value; `isProcessingAiCommandRef` check at schedule time stale at fire time.

---

## 6. State Architecture

### 6.1 Store inventory

| Store | Owner | SOT | Consumers | Mutation | Persist | Sync |
|-------|-------|-----|-----------|----------|---------|------|
| `activeEditorStore.ts:69` (`activeEditor`, `activeMonaco`, `activeFileMeta`) | Module globals | AI context (`getActiveEditorContext:165`) | `groqService`, `codeSuggestionService`, `AIContextBuilder` | `setActiveEditor:652,678`, `setActiveFile:395` | None | Manual `syncActiveEditor:404` |
| `ProjectContext.tsx:328` (`fileTree`, `activeFile`, `activeFileMeta`, `selectedFolder`, `expandedFolderIds`) | `ProjectProvider` + `latestTreeRef:354` + `stateRef:357` | File tree | `FileExplorer`, `CodeEditor`, `BottomPanel`, `AIAssistant` | `applyTreeMutation:288` (`useTreeMutation`), `setActiveFile` | `workspaceStore.cjs` via `saveWorkspace` (JSON) + `localStorage` expandedIds | `latestTreeRef` mirror for stable callbacks — correct but `pathOf(getFileTree(), id)` in `renameNode:729` may read stale tree if `setFileTree` async |
| `settingsStore.ts:8` (`current: Settings`) | Module var | Settings | `useSettingsStore`, `getSettings()` | `setSettings:70`, `updateSettings:75`, `setSetting:90` | `settingsPersistence.ts` (`localStorage`) | `subscribe` + `useSyncExternalStore`; `SettingsContext.tsx:68` `updateSettings` does stale-closure `{...settings, [section]:merged}` — loses concurrent updates. Should delegate to `settingsStore.updateSettings` |
| `diagnosticStore.ts:18` (`results: Map<fileId,DiagnosticResultEx>`, `lastGlobal`) | Module | Diagnostics | `ProblemsPanel`, `BottomPanel`, `CodeEditor` (markers) | `setDiagnosticResult:37` (overwrites `currentFileId` unconditionally — background AI for inactive file steals status bar) | None | `subscribeDiagnostics:26` |
| `AIRequestStore` (`src/core/ai/aiRequestStore.ts:59`) (`requests: Map`, `latestByOperation: Map`) | Module | AI request lifecycle | `useAILoading`, `AIAssistant`, `ExplanationContext` | `startRequest:75`, `updateRequest:91`, `completeRequest:123`, `failRequest:146`, `cancelRequest:168` | None | `subscribe` + `useSyncExternalStore`; `isCurrent:182` guard correct |
| `TerminalContext.tsx:60,81,85` (`terminals`, `activeTerminalId`, `isRunning`) | `TerminalProvider` + `EventTarget:89` | Terminals | `ShellTerminal`, `TerminalPanel`, `BottomPanel` | `createTerminal`, `runCode:208` (sets global `isRunning=true`), `killTerminal` | None | `EventTarget` (`runData`, `clear`, `stop`, `kill`, `copyAll`, `terminalReady`) — 8 listeners per `ShellTerminal:485-776` |
| `PerformanceContext.tsx:40` + `PerformanceHistory` (`src/utils/performanceService.ts:647`) | `PerformanceProvider` (dead loop) + `localStorage` history (20 caps) | Perf metrics | `PerformancePanel`, `PerformanceBudgetMonitor` | `startLoop:40` (broken), `analysisHistory.ts` (50 snapshots/file, 90-day TTL) | `localStorage` | `EventBus` mis-wired (`loopBus.store.delete:105` leaks handler) |
| `chatStorage.ts:30` (`MAX_SESSIONS=50`, `MAX_MESSAGES=200`, `MAX_PAYLOAD=900KB`) | Module | AI chat sessions | `AIAssistant` | `normalizeSession:42`, `saveSessions:99` (re-normalize + pop until under quota) | `localStorage` via `debouncedLocalStorageSet:118` | Dedup consecutive duplicate within 1.5s:62 |
| `BottomPanel.tsx:388` (`activeTab` in localStorage, `problemCounts`, local `analysis:429`) | Component local | Panel UI | Self | `setActiveTab`, `ageingDebounceRef:435` + `setTimeout 0` | `localStorage` | Flicker if `activeTab==='ageing'` and file switches quickly |

### 6.2 Competing sources of truth

* **Current file:** `activeFile` (ProjectContext) vs `activeFileMeta` vs `activeEditor` (activeEditorStore) vs `diagnosticStore.currentFileId`. `getActiveEditorContext()` returns `null` when `!ed` even though `activeFileMeta` is set — AI reads stale null after `setActiveFile:395` sync race (`updateActiveFileMeta:406` only updates meta if editor not mounted).
* **`isRunning` (Terminal):** single boolean for N terminals (`TerminalContext.tsx:85`). `runCode:208` sets global `true`; `ShellTerminal.tsx:584-587` clears global `false` on any `EXITED/FAILED/DISPOSED` — killing terminal 1 clears indicator for terminal 2.
* **`isExplaining`:** `ExplanationContext.tsx:59,164,200` manual boolean vs `AIRequestStore` `thinking/generating/success` — UI reads `useAILoading('chat')` elsewhere but Explanation panel reads boolean; inconsistency after `beginExplain:99-103` abort divergence.

### 6.3 Stale state

* `CodeEditor.tsx:265` `versionAtStart` captured before AI, checked `if (model.getVersionId() !== versionAtStart):338` before apply — correct but `scheduleLocalCheck` dropped case leaves stale decorations.
* `BottomPanel.tsx:662` `handleApplyRecommendation` guards `current?.content === fileContentAtRequest` but not version; snapshot outdated by concurrent editor change.

---

## 7. AI Architecture

### 7.1 Request origin → UI path

```
User: AIAssistant chat / AIComposer @file / /// fix ; / ExplanationSidebar / ProblemsPanel auto-fix
  → groqService.ts (facade: getSmartModel, sendChatRequest, streamChatRequest, generateCode/fixCode/refactorCode/modifyCode)
  → src/core/ai/AIClient.ts (sendChat/streamChat, filterVisibleStream, postBackendWithRetry, postDirect, chain)
  → server/routes/ai.cjs (validateMessages 20k/msg, stream flag)
  → server/services/ai/chatService.cjs (sendChat 68-130, streamChat 189-373)
  → server/services/ai/modelRouter.cjs (buildDirectChain, forcedMinimax hijack, configuredFallbackModels)
  → server/services/ai/aiClient.cjs (inferProvider, resolveEndpoint, retry once on 429/5xx + network)
  → provider (Groq / OpenRouter / Kilo / HuggingFace)
  → server/services/ai/aiStream.cjs (SSE parse, leading preamble suppressor 1024, createVisibleContentFilter 4096 thinking window)
  → server/services/ai/aiContext.cjs (stripLeadingReasoningLines, cleanResponse)
  → AIClient filterVisibleStream (createVisibleContentFilter + reasoning drop + tail flush)
  → sanitizer: AIOutputPolicy.sanitizeEditorOutputWithPolicy (editor) / AIResponseParser.cleanResponse (chat)
  → editEngine.ts / editPipeline.ts / commentApplier.ts (PLAN→RESOLVE→COMPOSE→VALIDATE→APPLY→VERIFY) + verifyAppliedCandidates
  → workspaceBridge / activeEditorStore → Monaco executeEdits → diagnosticStore → ProblemsPanel
  → AIRequestStore (startRequest thinking → generating → streaming → applying → success/error/cancelled)
  → UI: useAILoading, AILoadingIndicator, SmoothStreamingBubble, MarkdownRenderer (skipHtml:true)
```

### 7.2 Prompt & context

* `src/core/ai/AIContextBuilder.ts` (`taskDefaults`, `buildChatMessages`) + `src/utils/diagnosticsService.ts:162` `buildAIContext` (truncates >12k to HEADER 80 + CURSOR ±80 + TAIL 60 + symbol summary). Context length reported as `Total lines: ${lineCount}` but truncated content sent — AI line numbers drift.
* Per-language hints: `codeSuggestionService.ts:414-436` `fileConventionHint`, `groqService.ts:303-321` `syntaxHint` + `javaPreserveRule` (filename→class via `replace(/\.[^/.]+$/,'')` 6× duplicated in `editEngine.ts:558-567`).
* System prompts: `groqService.ts:138,253,274,345` interpolate `NO_AUTO_COMMENTS_INSTRUCTION` per task — drift risk.

### 7.3 Streaming

* **Single streaming implementation** on client: `AIClient.ts:58,157` `backend SSE endpoint` with `AIStream.ts` parser; direct OpenAI fallback only when `VITE_USE_BACKEND_AI !== 'false'`.
* `AIStream.ts` → `createVisibleContentFilter` suppresses `<thinking>` blocks (4096 hold) + leading reasoning preambles (1024) + inline `thinking:` prefixes. `pipeProviderStream:389` swallows malformed SSE without metric.
* `AIClient.ts:244` `filterVisibleStream` wraps provider stream: `delta` → `filter.push` → `emitToken`, `reasoning` dropped, `done/error` flush `filter.end()`. `streamBackend` + `streamDirectChain` track `AIPerfTracker` (`firstTokenReceived`, `tokenReceived`, `chunkReceived`).
* **Backend stream:** `server/services/ai/chatService.cjs:189-373` iterates fallback chain, `aiRequestManager.touch(requestId)` per SSE line. Idle timeout 45s (`aiRequestManager.cjs`).

### 7.4 Cancellation

* Three registries: `AIAbortController` (client `AIAbortController.ts`) + `AIRequestManager` (server `aiRequestManager.cjs:79` — `register(requestId, signal)` + `touch` idle timer) + `AIRequestStore` (UI). `AIClient.ts:183,423,469` checks `isAbortError` to avoid fallback on cancel; `chatService.cjs:221-222` `release(requestId); register(...clientSignal)` with `finally:371` double delete. `ExplanationContext.tsx:99-103` aborts `aiRequestManager` + `AIRequestStore` divergently; `AIAssistant.tsx:710-739` `handleStop` aborts controller + `aiLoading.cancel()` but not `AIRequestStore.cancelRequest` nor `aiRequestManager.abort` for that id — upstream may continue.

### 7.5 Errors & retries

* Typed `AIError` (`src/core/ai/AIError.ts` + `server/services/ai/aiError.cjs:236`) with `code/provider/model/retryable/status`. `AIClient.ts:296` `directError` via `classifyProviderError`; `isAbortError:108` over-broad (`/abort/i` matches "abortion logic"). Backend retries once on 429/5xx + network (`aiClient.cjs:199-265`); health `providerHealth.cjs` marks unhealthy on failure, TTL 15s for failures, `OK_TTL_MS` unused for gating (`isHealthy` always true if `ok:true`). `sendChatResult` returns `AIResult` discriminated union for editor gate.

### 7.6 Edits

* `modifyCode:336-338` prompts for `{"type":"edit","edits":[{startLine,endLine,replacement}]}` → `structuredOperationParser.ts` → `editEngine.ts` PLAN→RESOLVE→COMPOSE→VALIDATE→APPLY→VERIFY (bottom-up `LineOp[]`, `resolveTargetLine:86`, `resolveTargetRange:113` slice compare with trim, `composeLineOps:164` sorted descending, `claim:357` overlap check, `verifyAppliedCandidates:660` lenient). `javaValidator.ts` + `editValidator.ts` enforce executable-line preservation (80% rule, `getExecutableLine` strips comments per language). `commentApplier.ts` + `commentSyntax.ts` for `///` flows.

### 7.7 Isolation

* AI logic is well-isolated in `src/core/ai/` (38 files) + `server/services/ai/` (9 files). `groqService.ts` facade keeps `AIAssistant`/`TripleSlash` from touching raw provider SDKs. `sanitizeEditorOutputWithPolicy` runs before any `executeEdits`.
* **Duplicated AI request logic:** `groqService.ts:77-123` vs `AIClient.ts:451-491` vs `server/services/ai/chatService.cjs:68-130` vs `server/services/ai/aiClient.cjs:118-265` — model selection + fallback loops duplicated 3× with divergence.

### 7.8 Race conditions

| Race | Location | Effect |
|------|----------|--------|
| Older response overwrites newer | `aiRequestStore.ts:91` `updateRequest` ignores stale if `latestByOperation !== id` (except `error/cancelled`) — **fixed** for store; but `groqService.ts:358-392` parses then sanitizes even if `controller.signal.aborted`; stale edit applied via `codeSuggestionService.ts:154` before `isStale?.()` check too late for inline (`codeSuggestionService.ts:506` after sanitize) |
| Streaming after unmount | `AIAssistant.tsx:588` `useAutoScroll` `ResizeObserver` + `MutationObserver` recreated per `active` toggle; `rafIdRef` cancelled but `tickingRef` not; `filterVisibleStream` generator holds `filter` state per request — safe, but `SmoothStreamingBubble` frame-coalesced buffer not cleared on unmount |
| Multiple requests same document | `workspaceBridge.ts:138` + `CodeEditor.tsx:654` double writer; `editEngine.ts:165` bottom-up mitigates but `insertAbove` + `replaceRange` same file may still shift indices; `BottomPanel.tsx:615` `aiRequestManager.begin` per fix without aborting previous fix |
| Stale editor state to model | `codeSuggestionService.ts:73` slices 500 chars before cursor at call time, but `fetchSuggestion:1149` captures `versionId` then awaits `modifyCode`; `getActiveEditorContext()` may be null (see §6.2) so AI gets empty file context |
| Cancellation not cancelling | `AIClient.ts:460-488` `postBackendWithRetry` fetches without `signal`? Actually `postBackend:163` passes `options.signal` correctly; but `codeExecutionService.ts:84,94` fetches without signal — runaway execution uncancelable. `server/services/ai/chatService.cjs:285` `touch` resets 45s timer even on `reasoning_content` only, never `sawToken`, stream throws `invalidResponse:322` |

---

## 8. Diagnostics Architecture

### 8.1 Pipeline

```
User: type / save / Cmd+Shift+M / Check button
  → CodeEditor.tsx:479 scheduleLocalCheck (600ms, isChecking guard) → markStale:532
  → diagnosticsService.ts:919 checkDiagnosticsEx
      ├── checkJsonSyntax / checkCssSyntax / checkHtmlSyntax / checkPythonSyntax / checkBraceBalance (stripStringsAndComments:82)
      ├── checkWithMonacoDiagnostics:634 (createModel file:///azemax-diag/... random suffix, race earlyPromise 650 vs pollPromise vs abortPromise 693, finally dispose)
      ├── checkWithLanguageSpecificTools fallback
      ├── runAIDiagnostics:725 (buildAIContext 12k truncate, strict JSON array prompt 725-795, extractJsonArray 236, validateAndNormalizeAIDiagnostics 306)
      ├── mergeDiagnostics:806 (dedup source+line+col+code+msg[0:120], duplicateLocal 820)
      └── normalizeSeverity:88 (defaults warning)
  → toExResult:855 (status error vs success, warningCount vs errorCount)
  → diagnosticStore.ts:37 setDiagnosticResult (Map<fileId,DiagnosticResultEx> + lastGlobal, subscribeDiagnostics)
  → CodeEditor.tsx:338 monaco.editor.setModelMarkers + decorations (versionAtStart guard)
  → ProblemsPanel.tsx:26 subscribeDiagnostics → render diag list (key `${line}-${column}-${idx}` unstable)
  → BottomPanel.tsx:414 problemCounts badge
```

### 8.2 Findings

* **Monaco leak window:** `diagnosticsService.ts:637` `createModel` with random URI, `finally:710` dispose correct, but `earlyPromise:650` holds `onDidChangeMarkers` listener until `maxWaitMs` even if `pollPromise` already resolved; `abortPromise` never resolves on non-abort, leaks `signal.addEventListener` (once:true but never removed if no abort).
* **AI line number drift:** `buildAIContext:226-228` truncates without preserving original line numbers; `Total lines:` reports original count but `aiContext` is sliced, so AI returns `line: 45` pointing to wrong row; `clampLine:33` then silently discards diagnostics beyond `lineCount`, caller cannot distinguish `failed` vs truncated.
* **Duplicate strip logic:** `stripStringsAndComments` duplicated in `codeSuggestionService.balanceBrackets` and `ageing/helpers` — divergent HTML/Python handling (`144 inHtmlComment` vs `89 isHtml`).
* **Merge dedup fragile:** `804 normalizeKey slice(0,120)` collides distinct warnings sharing 120-char prefix; `820-834` O(n²) with inconsistent thresholds (120 vs 40).
* **Status contradictory:** `toExResult:855-862` sets `status='error'` if any diags, then overwrites to `success` if warnings-only — second `else if` dead code, but warning-only case intentionally shows success (confusing).
* **Excessive recalc:** `checkDiagnosticsEx:957` `lines.map(l=>l.length)` per keystroke with 300ms debounce — GC pressure on large files; `BottomPanel.tsx:429` `analysis` local + `ageingDebounceRef:435` `setTimeout 0` defers but still synchronous per file switch.
* **Stale decorations:** `isChecking` guard drops checks silently; `markStale:532` leaves stale squiggles until next explicit `Check`.
* **Unbounded store:** `diagnosticStore.ts:18` `results: Map` grows per opened file, never evicted.
* **Severity defaults:** `normalizeSeverity:88` defaults `warning` for unknown string — hides AI contract violation (`{severity:'CRITICAL'}` silently downgraded).

---

## 9. Filesystem / Workspace Architecture

### 9.1 How it works

* **In-memory tree:** `src/context/ProjectContext.tsx:288` `useTreeMutation` + `latestTreeRef` + `stateRef` + `safeTree.ts:23` (`MAX_TREE_DEPTH=200`, `MAX_TREE_NODES=100k`, `WeakSet` cycle break, `sanitizeFileTree:82`, structural sharing in `sortTree`, `updateNodeById`, `deleteNodeById`, `insertNodeIntoFolder` via `findPathTo:363` + `rebuildPath:404`).
* **Persistence:** `workspaceStore.cjs:42` `saveWorkspace` / `loadWorkspace` JSON to `data/workspace.json` + `settingsPersistence.ts` `localStorage` for `expandedFolderIds`, `activeFileId`, layout (`layout-*` keys). `ProjectContext.tsx:757` `createProjectTemplate` loops `createFolder`+`createFile`.
* **Bridge:** `src/core/editor/workspaceBridge.ts:65` `createExecutorDeps(getFileTree, getActiveEditorContext)` — `getFileContent:72` prefers Monaco for `ctx.filePath` match, else tree via `findNodeByPath` (resolves path then linear scan).
* **Explorer:** `src/components/Sidebar/FileExplorer.tsx:58,757,784` drag-and-drop, `InputNode` `setTimeout 16` focus, `prevTreeIdsRef` animation `setTimeout 900`, `dragExpandTimerRef` `setTimeout 600`.

### 9.2 Findings

* **P0 — Sync FS + race:** `workspaceStore.cjs:17-20` `fs.readFileSync/writeFileSync` on every `saveWorkspace` (per file create/rename/delete) blocks event loop; concurrent `saveWorkspace` read-modify-write without lock → lost updates (two clients save simultaneously, second overwrites first).
* **ID collision:** `src/utils/mockFileSystem.ts:24` `generateNodeId` fallback `Date.now()+Math.random` may collide in tight loop (`createProjectTemplate:764`).
* **Batched mutations stale:** `deleteMultipleNodes:612` loops `applyTreeMutation(opDeleteNode)` per id, but `isDescendantOf` checks `tree` captured before loop at `621` — second delete's check uses stale tree if first delete removed parent.
* **Duplicate-name path:** `workspaceBridge.ts:82-84` `path === ctx.fileName` shortcut incorrectly returns active file content for file with same name in different folder unless `findNodeByPath` resolves correctly; linear scan per call.
* **Drag timers:** `FileExplorer.tsx` `dragExpandTimerRef` not cleared on unmount.
* **Sort/filter structurally correct:** `safeTree.ts:300,601` structurally share unchanged subtrees, enabling `React.memo` bailouts — exemplary.

---

## 10. Extension Architecture

**There is none.** Azemax does not ship a VS Code extension host. No `vscode.extensions`, no `package.json` contributions, no `ExtensionHost`. The closest is `src/core/ai/toolRegistry.ts` (internal AI tool registry) and `src/core/ai/agentController.ts`.

* **Implication:** The audit prompt's "How extensions are handled" answer is "Not applicable — no extension system exists. Adding one requires new subsystem (host process + RPC), not aligning to VS Code."
* **Risk:** Docs (`docs/COMPONENTS.md:2094`) may imply extensibility via `toolRegistry` — clarify it is not VS Code compatible.
* **Recommendation:** If extensibility desired, design a minimal `toolRegistry` contract now (Phase C) rather than retrofitting VS Code's extension API.

---

## 11. IPC / Event Architecture

### 11.1 Client IPC

* `src/utils/apiClient.ts:17` `apiFetch` (`Content-Type: application/json` even for GET) + `getWebSocketUrl:44` (`import.meta.env.DEV ? 'localhost' : window.location.hostname`, but `vite --host` may be `0.0.0.0` — fallback correct for LAN IP).
* `src/core/runtime/EventBus.ts:19` typed `handlers: Map<keyof TEvents, Set<Handler>>` + `DisposableStore`, `on:19` returns `IDisposable`, `onWithStore:33`, `emit:39` copies set, `clear:52`, `dispose:56`. **Correct pattern.**
* `TerminalContext.tsx:89` `new EventTarget()` as bus for `runData/clear/stop/kill/copyAll/terminalReady/Unmounted:110` — no typing, no disposal tracking. 8 listeners per `ShellTerminal:485-776`.
* Global `window` events: `run-button-clicked:44`, `azemax-sort-changed`, `explorer-refresh:820-842`, `request-editor-selection:803`, `problems-navigate:809`, `keydown:546,565` — implicit coupling, no `CustomEvent` typing.
* Vite proxy `vite.config.ts:26` forwards `/api` + SSE headers + `proxy.on('error')` logs.

### 11.2 Server IPC

* `server/websocket/executionHandler.cjs:33` `attachExecutionWebSocket(wss)` owns `TerminalManager` (Map<sessionId, session> + `setInterval(_garbageCollect,30000).unref()`). Legacy `action:execute:166` vs `session.create:70` both create sessions; legacy uses `Math.random` id not validated.
* `server/app.cjs` Express + `cors` + rate limiter (`hits` Map, `setInterval` clear).
* `server/middleware/errorHandler.cjs:10` maps `AIError` to 502/503, else `err.status || 500`; `server/lib/asyncHandler.cjs:3` `Promise.resolve(...).catch(next)`; `server/routes/index.cjs` `notFoundHandler` after `registerRoutes`.

### 11.3 Issues

* **Handshake race:** `TerminalContext.tsx:89` `runCode:249` checks `tabExists || mountedTerminalsRef.has(termId)`; `ShellTerminal` mounts and dispatches `terminalReady:749` before provider's `terminalReady` listener attached (child mounts before parent effect) — buffered run flushed via `tabExists` path by accident.
* **TerminateAllForSocket:** `executionHandler.cjs:200` `terminateAllForSocket` on `close/error:211,215` kills+disposes all sessions for that socket, including `EXITED` sessions still in Map for GC `583`. `TerminalManager.cjs:50` interval cleared only in `destroy:595` (`lifecycle.cjs:212` calls it, but fires during shutdown).
* **Compression:** `vite.config.ts:26` `configure` sets `Content-Encoding:identity` for SSE — correct (prevents double-compress).
* **EventBus misuse:** `PerformanceContext.tsx:105` `loopBus.store.delete(disposable)` instead of `disposable.dispose()` leaks handler until `bus.dispose()`.

---

## 12. Error Handling

### 12.1 Taxonomy

* **AI:** `src/core/ai/AIError.ts` + `server/services/ai/aiError.cjs:236` — `code` (enum), `provider/model/status/retryable`, `isAbortError:108` (over-broad `/abort/i`), `classifyProviderError:135` (5xx unreachable second block 180-187 dead), `allProvidersFailed`. `AIError.details` stored but `toJSON` omits — good, but `details.attempts` may leak model ids.
* **Client AIClient:** Throws `AIError`, never returns error-as-content; `sendChatResult` returns `AIResult` discriminated union (`ok` gate before sanitizer).
* **Global:** 78 `catch` sites — mostly hardened `try {localStorage.getItem} catch(e){warn}` in `chatStorage:93,119`, `performanceService:653,662`, `performanceAlerts:341,365`, `analysisHistory:62,78,165,176,193`. 30 `catch { /* ignore */ }` legitimate (`explorerSort:33,40`, `CodeEditor:521,818`, `diagnosticsService:290,699,710`, `activeEditorStore:78`). 100 `throw` sites typed.

### 12.2 Weak spots

| Location | Problem | Impact |
|----------|---------|--------|
| `src/utils/codeExecutionService.ts:70,118` `getRuntimes()` returns `[]` silently on error, `executeCode:85` then throws "not supported" | Masks network failure as unsupported language | P2 |
| `server/routes/ai.cjs:11-28` `validateMessages` allows 20k/msg, 100k total, no per-IP rate limit, no auth | Large prompt DoS + 413 from provider; unbounded memory | P1 |
| `server/routes/execute.cjs:3-15` no validation, no size cap vs `ai.cjs` limits | Huge `code` payload DoS; `listDetectedRuntimes` leaks host versions | P1 |
| `src/components/Panels/PerformancePanel.tsx:139` `exportReport` creates blob URL without `try/finally revoke` on error | Leaks object URL | P3 |
| `src/utils/analysisHistory.ts:70` `JSON.parse` unvalidated | Corrupt huge object accepted; unlike `performanceAlerts:357` hardened check | P2 |
| `vite.config.ts:41` `proxy.on('error', err)` logs raw | Correct but no user-facing surfaced error | P3 |
| Streaming `pipeProviderStream:389` swallows SSE parse errors | Provider format change silent | P2 |

---

## 13. Performance Analysis

| Area | Suspected Bottleneck | Why expensive | Trigger | Frequency | Data | Blocks UI | Mitigation | Worker |
|------|----------------------|---------------|---------|-----------|------|-----------|------------|--------|
| **Startup** | 4 Google Fonts sync `index.html:11` (no `display=swap` explicit) + `monaco-editor` + 5 xterm addons | Font blocking + large chunks | Page load | Once | ~200KB fonts + 600KB monaco | Yes (FOIT) | Self-host fonts + `preload` + `display=swap` | No |
| **Large files** | `diagnosticsService.ts:957` `lines.map(l=>l.length)` + `stripStringsAndComments` O(n) + `analysisCache` key holds full code (`analysisCache:285` Map key `${language}\0${code}` 30× large file) | Recompute per keystroke with 300ms debounce | Type in 10k-line file | High | Full file string | Yes | Debounce 800ms + cache by `hash(code)` not raw string + move to worker | Yes |
| **Editor rendering** | `CodeEditor.tsx:1981` single component, `MainLayout.tsx:228` `mousemove` writes style per pixel even when `resizingSide===null` listener always attached | React reconciliation + direct style mutation per mousemove | Type / resize | Continuous | DOM + Monaco | Yes | Split `CodeEditor` subcomponents, throttle/Schedule `mousemove` via `requestAnimationFrame`, conditionally attach listener only while dragging | No |
| **React rendering** | `AIAssistant.tsx:864` god component, `components` object per render breaks `MessageItem` memo (`prev.msg.text !== next.msg.text` check 482 but parent recreates lambdas) | Re-render all messages per delta | AI streaming | Per token | N messages × MD | Partial | Memoize `components` + `useCallback` for `onCopy/onRegenerate`, virtualise list | No |
| **AI streaming** | `streamFromBackend` → `filterVisibleStream` → `AIStreamBuffer` (frame-coalesced, immediate first token) — good; but `AIAssistant.tsx:634` `deferredStreamingText` void'd, `MarkdownRenderer.tsx:236` lazy `react-markdown+remark-gfm` only when `!isStreaming` — streaming uses lightweight parser | Lightweight path correct | Streaming | Per token | Tokens | No | Keep lightweight path; ensure buffer coalesces 16ms | No |
| **Diagnostics** | `diagnosticsService.ts:634` isolated Monaco model creation + `onDidChangeMarkers` + poll per check | Model create/dispose overhead | Keystroke | 300ms | Full code + markers | Yes | Cache model, reuse, throttle to 1s for AI diagnostics | Yes |
| **File indexing** | `safeTree.ts:44` `walkTree` iterative `WeakSet` + `MAX_TREE_DEPTH=200` — exemplary; `fuzzySearch.ts:17` `t.includes(q)` fast path O(n*m) with `start*2` scoring — CPU-light | — | — | — | — | No | Already optimal | No |
| **Search** | `AIComposer.tsx:76-90` `fileList` walks full tree via `getFileTree()` per render when `showMentions` | No memo on tree identity | Keystroke with `@` | Per keystroke | File tree | Partial | Memoize `fileList` by tree version | No |
| **Syntax processing** | `prismLoader.ts:19-47` `Promise.all` 23 Prism langs + CSS on first highlight | Network + parse | First code block | Once | Prism bundle | Yes (first block) | Lazy already; cache `MAX_HIGHLIGHT_CACHE=50` correct | No |
| **Event listeners** | `PerformanceContext.tsx:40` dead loop + `MainLayout.tsx:228` always-on mousemove + `AIComposer:48` `setInterval 700ms` live tick | Wasted timers + GC | Always | Continuous | — | No | Fix rAF loop, clear interval on unmount, conditionally attach mousemove | No |
| **IPC** | `vite proxy` SSE + `apiClient.ts:44` WS `getWebSocketUrl` — correct | — | — | — | — | No | — | — |
| **Serialization** | `chatStorage.ts:113` pops oldest until under `900KB`; `localStorageDebounce:49` `requestIdleCallback{timeout:100}` + coalesce — excellent | — | — | — | — | No | — | — |
| **Allocations** | `codeAnalysisEngine.ts:281` 30× full file strings as Map keys; `analysisHistory.ts:68` parses entire history JSON per save (no debounce) | Large JSON parse | Save snapshot | Per analysis | History file | Partial | Hash keys, debounce writes | No |
| **Filesystem** | `workspaceStore.cjs:42` sync FS per mutation | Blocks event loop | File op | Per op | JSON | Yes | `fs/promises` + lock | No |
| **Network** | `codeExecutionService:84` `getRuntimes()` per `executeCode` adds 100-300ms RTT; no cache, no dedup | Extra fetch | Run | Per run | HTTP | Yes | Cache 30s + dedup | No |

---

## 14. Memory / Resource Management

| Resource | Owner | Created | Cleaned | Leak? | Evidence |
|----------|-------|---------|---------|-------|----------|
| Monaco isolated model (diagnostics) | `diagnosticsService.ts:637` | `createModel(code, lang, uri)` random suffix | `finally:710 model.dispose()` | **Window** — `earlyPromise` holds listener until maxWait, `abortPromise` leaks signal listener | Correct `finally`, but poll always waits `stepMs` even if `earlyPromise` resolved; listener not cleared on first resolve |
| Monaco editor listeners | `CodeEditor.tsx:1483-1500` | `onDidBlur`, `onDidChangeCursorPosition/Selection`, `onDidChangeModelContent:940` | Push to `_codeEditorDisposables`, clean on `editorInstance` change | **Yes** — leaks if `Editor` unmounts without `onMount` re-firing; `useEffect:940` not disposing old `onDidChangeModelContent` if instance same | `DisposableStore` should own all |
| Window listeners | `CodeEditor.tsx:546,565,994,1014,803,809`, `MainLayout.tsx:228,273,308,313` | `addEventListener` | `useEffect` return `removeEventListener` | **Partial** — closure captures stale `runDiagnostics`/`settings`; rapid toggle leaves orphan until next effect | — |
| Timers | `FileExplorer.tsx:58,900,600`, `CodeEditor.tsx:159,448,801,1388`, `BottomPanel.tsx:435` | `setTimeout`/`setInterval`/`requestAnimationFrame` | Mostly cleared | **Yes** — `dragExpandTimerRef:600` not cleared on unmount; `CodeEditor:1388 setTimeout 800ms` no cleanup; `server/app.cjs:10` `setInterval` never `clearInterval` | — |
| Workers | None | — | — | — | No workers to leak (opportunity) |
| Subscriptions | `diagnosticStore:26`, `settingsStore:27`, `AIRequestStore:202`, `activeEditorStore` | `subscribe` | Return unsubscribe | **Correct** — `useSyncExternalStore` + `DisposableStore` | `PerformanceContext.tsx:105` manually `store.delete` instead of `dispose` leaks handler |
| Intervals | `AIComposer:48` 700ms poll, `TerminalManager:50` 30s GC, `server/app.cjs:10` rate limiter | `setInterval` | `destroy:595`, unmount | **Leaks** — `AIComposer` interval cleared on unmount? Verify; `server/app` never cleared; `TerminalManager` cleared only in `destroy` but may fire during shutdown | — |
| Maps without eviction | `diagnosticStore.results`, `codeAnalysisEngine.analysisCache` (30), `providerHealth.state`, `AIRequestStore.requests` | `Map` | Never evicted (except analysisCache 30 caps) | **Yes** — long sessions grow indefinitely | `diagnosticStore` never evicts per-file entries |
| Blob URL | `PerformancePanel:139` `exportReport` | `URL.createObjectURL` | `revokeObjectURL` | **Leak on error** — no `try/finally` | — |

---

## 15. Dependency Analysis

### 15.1 Production `package.json:19-48`

* **Heavy / justified:** `react@19.2.0`, `react-dom`, `@monaco-editor/react@4.7.0` (lazy via `optimizeDeps.exclude:85`), `@xterm/xterm@6 + 4 addons`, `prismjs@1.30` (lazy singleton `prismLoader.ts:16`, `MAX_HIGHLIGHT_CACHE=50:9`), `framer-motion@12`, `react-markdown@10+remark-gfm+rehype-raw`, `ws@8.19`, `node-pty@1.1`, `express@5.2`, `cors`, `openai@6.39`, `groq-sdk@0.37`, `@openrouter/sdk@1.2`, `jszip@3.10`.
* **Utility:** `clsx@2.1 + tailwind-merge@3.4` (`vendor-utils`), `lucide-react@0.562`, `react-icons@5.5`.

### 15.2 Issues

| Dep | Issue | Severity | Fix |
|-----|-------|----------|-----|
| `rehype-raw@7.0.0:45` | **Dead dep** — deliberately unused (`MarkdownRenderer.tsx:18` comments `skipHtml:true` + no `rehype-raw` for XSS); installed but never imported | P3 | Remove from `package.json` |
| `@types/jszip@3.4.0:22` | In `dependencies` not `devDependencies` — types belong in dev. Used for `FileExplorer` folder download, but mis-categorised | P3 | Move to `devDependencies` |
| `react-icons@5.5` + `lucide-react@0.562` | **Duplicate icon sets** in `vendor-ui:57` both bundled; `lucide-react` dominant, `react-icons` sparse | P3 | Consolidate to one |
| `openai` + `groq-sdk` + `@openrouter/sdk` | Triple LLM SDKs in `dependencies` bloating client installs; runtime uses backend proxy (`AIClient.ts:58`); direct path needs only one per environment | P2 | Move to `server` only or mark `optional` |
| `node-pty` | Native addon, not bundled for web — correctly server-only, but in root `dependencies` causes `npm install` failures on some platforms | P2 | Document `node-pty` optional or `optionalDependencies` |
| `rollup-plugin-visualizer` | In `devDependencies` correctly gated by `ANALYZE=1` (`vite.config.ts:10`) | — | Keep |

### 15.3 Internal imports

* Alias `@ → ./src` (`vite.config.ts:19` + `tsconfig.app.json:29`) consistent.
* No circular import detected via grep (`safeTree→mockFileSystem`, `chatStorage→localStorageDebounce` DAG clean). `madge --circular src` not run — add to CI (Phase F).
* `safeTree.ts:23-663` exemplary (iterative `WeakSet`, `MAX_TREE_DEPTH=200`, structural sharing). `explorerSort.ts:13-141` mirrors pattern. No unnecessary imports.

---

## 16. Architectural Smells

| Smell | Location | Description |
|-------|----------|-------------|
| **God component** | `src/components/Editor/CodeEditor.tsx:1-1981` | 1981 lines, 7 `useEffect`, 20 refs, Monaco mount + diagnostics + AI + save + inline completion + keyboard shortcuts |
| **God component** | `src/components/Panels/AIAssistant.tsx:1-2199` | 2199 lines, `MessageItem` + stream + sessions + artifacts + markdown + scroll observers |
| **Singleton abuse** | `src/core/editor/activeEditorStore.ts:69`, `settingsStore.ts:8`, `diagnosticStore.ts:18`, `AIRequestStore:59` | Module-global mutable stores correct for SOT but no dependency injection; test isolation requires `_clearForTests` |
| **Global mutable state** | `src/components/Editor/CodeEditor.tsx:149` `githubDarkThemeDefined`, `src/utils/performanceService.ts:647` `PerformanceHistory` | Module globals without reset |
| **Circular dep risk** | `ProjectContext` ↔ `activeEditorStore` ↔ `workspaceBridge` | Manual sync, not DI |
| **Hidden side effects** | `src/utils/performanceAlerts.ts:383` `loadAlerts()` on import, `chatStorage.ts` import side-effect? | Import triggers `localStorage` read |
| **Improper async** | `diagnosticsService.ts:693` `Promise.race([earlyPromise,pollPromise,abortPromise])` where `abortPromise` never resolves on non-abort | Leaks signal listener; poll waits extra `stepMs` |
| **Excessive prop drilling alternative** | `6` providers in `App.tsx:62` + `MainLayout` passing `isAiOpen/onToggleAi` | Prop drilling via `composeProviders` correct, but `CodeEditor` reads `getSettings()` directly — bypasses React subscription |
| **Duplicated services** | `providerHealth` + `aiClient` both classify provider health; `isAbortError` defined in both `AIAbortController.ts` and `aiError.cjs:108` | Drift |
| **Event listener leaks** | See §14 | — |
| **Excessive allocations** | `analysisCache` full code as key, `lines.map(length)` per keystroke | GC pressure |
| **Unclear ownership** | `activeFile` owned by `ProjectContext` but mutated via `workspaceBridge` + `CodeEditor` `executeEdits` | Two writers |
| **Cross-layer imports** | `CodeEditor` imports `groqService` (UI → AI facade) + `diagnosticsService` (UI → diagnostics) — acceptable, but `diagnosticsService` importing `monaco` optionally | Layering not enforced |
| **Typing smell** | `error:any` in `codeSuggestionService:538`, `providerHealth key` raw `model` string without normalization, `window` event names untyped strings | — |

---

## 17. Bug Risk Register

| Priority | Area | File | Symbol | Problem | Impact | Confidence |
|----------|------|------|--------|---------|--------|------------|
| **P0** | Workspace | `server/services/projects/workspaceStore.cjs:42-58` | `saveWorkspace`/`loadWorkspace` | Sync `readFileSync/writeFileSync` per request + read-modify-write without lock → lost updates + blocks event loop | Data loss, corrupted workspace JSON | High |
| **P0** | State | `src/core/editor/activeEditorStore.ts:69` ↔ `src/context/ProjectContext.tsx:395-406` | `getActiveEditorContext` / `setActiveFile` | `!ed` returns `null` even when `activeFileMeta` set; AI reads stale null | AI corruption (empty context) | High |
| **P0** | Editor | `src/components/Editor/CodeEditor.tsx:654` ↔ `src/core/editor/workspaceBridge.ts:138` | `executeEdits` double writer | Two writers contend without `versionId` ordering; `pendingSyncRef:620` queue may apply out-of-order | Corrupted files, lost edits | High |
| **P1** | AI | `server/services/ai/modelRouter.cjs:230` | `forcedPrimary` `minimax-m3:free` | Ignores `requestedModel` + `allowFallback:false`; always hijacks to OpenRouter | Billing, wrong model, violates autocomplete contract | High |
| **P1** | AI | `server/services/ai/aiClient.cjs:27-105` + `modelRouter.cjs:79` | `inferProvider`/`GROQ_MODEL_IDS` | Duplicated identically then diverged (`nvidia/` vs `/`) | Wrong provider endpoint, silent misrouting | High |
| **P1** | AI | `src/core/ai/editEngine.ts:680-685` | `verifyAppliedCandidates` `includes(slice(0,100))` | Any actual starting with 100-char prefix passes, even if suffix truncated | AI corruption, partial writes pass | High |
| **P1** | Editor | `src/components/Editor/CodeEditor.tsx:1500,940,546` | `_codeEditorDisposables` + window listeners | Leaked Monaco disposables + global `window` listeners on StrictMode remount | Memory leak, stale handlers, incorrect diagnostics/save | High |
| **P1** | Diagnostics | `src/utils/diagnosticsService.ts:637,650,693,710` | `checkWithMonacoDiagnostics` | `abortPromise` never resolves on non-abort, `earlyPromise` holds listener, poll waits extra `stepMs` | Listener leak, delayed diagnostics | High |
| **P1** | AI | `src/context/ExplanationContext.tsx:94-111` | `beginExplain` | Dual `aiRequestManager.begin` + `AIRequestStore.startRequest` unsynced; `cancelRequest` by `operation` may cancel wrong id | Stale spinner, stuck `thinking` | High |
| **P1** | Performance | `src/core/runtime/PerformanceContext.tsx:40-53` | `startLoop`/`onFrame:96` | Emits one `rAF` then stops forever; demand loop never restarts | Dead perf overlay (if enabled) | High |
| **P1** | Security+Perf | `server/routes/ai.cjs:11-28` | `validateMessages` | 20k/msg, 100k total, no per-IP rate limit, no auth; `legacy proxyOpenRouter` ignores `providerHealth` | DoS, unbounded memory | Medium |
| **P1** | Security+Perf | `server/routes/execute.cjs:3-15` | `executeCode`/`listDetectedRuntimes` | No size cap vs `ai.cjs` limits; `getRuntimes()` per `executeCode` adds 100-300ms | DoS, leaks host runtime versions | Medium |
| **P2** | Security | `src/components/Panels/AIAssistant.tsx:181,116,226` | `tryHighlight`/`dangerouslySetInnerHTML` | Prism `highlight` HTML injected without sanitise; model can return `<svg onload>` | XSS (model-supplied) | Medium |
| **P2** | Perf | `src/utils/codeExecutionService.ts:84-88` | `getRuntimes()` inside `executeCode` | Fetches `/runtimes` on every run, no cache/dedup, no abort | 100-300ms extra RTT per run | High |
| **P2** | Editor | `src/utils/diagnosticsService.ts:226-228` | `buildAIContext` | Truncates 12k code without preserving line numbers; AI line numbers drift; `clampLine` silently discards | Incorrect diagnostics positions | High |
| **P2** | State | `src/context/SettingsContext.tsx:68` | `updateSettings` | `{...settings, [section]:merged}` captures stale closure; concurrent updates lose one | Settings lost | Medium |
| **P2** | State | `src/context/TerminalContext.tsx:85,208,584` | `isRunning` global | Single boolean for N terminals; killing one clears indicator for another | Incorrect UI | High |
| **P2** | Perf | `src/components/Panels/AIComposer.tsx:48,76` | `setInterval 700ms` + `fileList` walk | Ticks 1.4×/s even idle + full tree walk per render when `showMentions` | Wasted CPU | High |
| **P2** | AI | `src/utils/codeSuggestionService.ts:37-49,68,390` | `aiAbortManager.get` without `begin` | Early `return null` leaks attempt slot; `SUGGESTION_KEY` alias aborts same key as `INLINE` | Stale request slot leak | Medium |
| **P2** | AI | `src/utils/aiSanitizer.ts:19-33` | `sanitizeAiCodeOutputForLanguage` | Second `normalizeGeneratedCode` pass on same invalid input does nothing; returns `''` as success | Empty success vs error | Medium |
| **P2** | Diagnostics | `src/core/diagnostics/diagnosticStore.ts:18,37,90` | `results` Map + `setDiagnosticResult` | Unbounded Map per opened file; background AI for inactive file steals `currentFileId`; `getCounts` fallback returns lastGlobal for unknown fileId | Memory leak, wrong badge | Medium |
| **P2** | Error | `src/utils/codeExecutionService.ts:70` | `getRuntimes` catch | Returns `[]` silently, then "not supported" masks network error | Misleading error | Medium |
| **P2** | AI | `src/components/Panels/ai/artifactParser.ts:14,21` | `ARTIFACT_RE` global | Module singleton `lastIndex` races under concurrent `parseArtifacts` | Missed artifacts | Low |
| **P3** | Dependencies | `package.json:45,22,57` | `rehype-raw`, `@types/jszip`, `react-icons+lucide` | Dead dep, miscategorised types, duplicate icon sets | Bundle bloat | High |
| **P3** | Config | `server/lifecycle.cjs:45,116` | `isOurServerProcess`/`pidListeningOn` | `ps`/`lsof` Linux/macOS only, breaks Windows | Windows startup broken | High |
| **P3** | Perf | `src/utils/analysisHistory.ts:68-101` | `getHistory`/`cleanSnapshots` | Parses entire history JSON per save, no debounce, 50 snapshots/file | GC pressure | Medium |
| **P3** | AI | `src/utils/ageing/detectors.ts:30,53,194` | `detectLegacyVar` etc | Raw line scan without `stripStringsAndComments`; callback hell 16-space assumes 4-space indent; `detectDuplicatedCode` O(n) per file | False positives, perf | Medium |

---

## 18. Recommended Architecture

### 18.1 Target principles

* **Own the "Monaco web IDE" identity:** Drop "VS Code architecture" framing. Target is `src/core/` as the VS Code-inspired primitive layer (`DisposableStore`, `EventBus`, `CancellationToken`, `SingleFlight`, `AIMessageStore`) — already ~70% there.
* **Single writer for editor:** Only `CodeEditor` owns `monaco.ITextModel`; `workspaceBridge` proposes edits, `CodeEditor` applies via versioned `executeEdits`. No direct `editor.executeEdits` from `workspaceBridge` or `BottomPanel`.
* **Single AI transport:** `src/core/ai/AIClient.ts` is the only streaming implementation; `groqService.ts` is a typed facade, `server/services/ai/*` is the only provider chain. Deduplicate `inferProvider`→ `modelRouter`.
* **Single abort registry:** `AIRequestStore` is SOT for UI; `aiRequestManager` is server-side idle tracking; client `AIAbortController` is per-fetch signal. Wire `handleStop` to all three.
* **Isolated diagnostics worker:** Move `checkWithMonacoDiagnostics` + `stripStringsAndComments` + `mergeDiagnostics` off main thread; cache Monaco model per file.
* **Async workspace persistence:** `fs/promises` + `O_EXCL` lock + atomic `writeFile tmp→rename`; no sync FS on request path.
* **Bounded stores:** All `Map` stores (`diagnosticStore`, `analysisCache`, `providerHealth`) with LRU/TTL eviction.
* **Component budgets:** No client component >400 lines; `CodeEditor` and `AIAssistant` split into subcomponents with explicit `DisposableStore` ownership.

### 18.2 Target dependency map

```
src/core/runtime/   DisposableStore, EventBus, CancellationToken, SingleFlight, cursorPositionStore
    ↑ used by
src/core/editor/    activeEditorStore (thin handle), workspaceBridge (proposes, not writes)
src/core/ai/        AIClient, AIStream, AIResponseParser, AIOutputPolicy, editEngine, modelRouter (single inferProvider)
src/core/diagnostics/ diagnosticStore (bounded, per-file), diagnosticsService (worker)
src/context/        ProjectContext (tree SOT, async persist), SettingsContext (delegates to settingsStore), TerminalContext (per-terminal isRunning)
src/components/     CodeEditor (sole Monaco owner), FileExplorer (safeTree), AIAssistant (AIRequestStore SOT), BottomPanel
server/             app, lifecycle (portable lock), routes, services/ai (single router), services/projects (async), terminalManager
```

### 18.3 Non-goals

* Do not introduce Electron, do not fork VS Code, do not add an extension host unless explicitly requested (Phase C optional).
* Do not introduce new state libraries (Zustand/Redux) — `useSyncExternalStore` + module stores are sufficient; consolidate instead.

---

## 19. Refactoring Roadmap

### Phase A — Critical correctness (1-2 weeks)

**Objective:** Fix data loss, stale AI context, corrupted writes, billing violation.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Fix `workspaceStore.cjs` to `fs/promises` + `O_EXCL` lock + atomic rename; add `size` caps to `execute.cjs` | `server/services/projects/workspaceStore.cjs:42`, `server/routes/execute.cjs:3` | None | Low — test with concurrent saves | `tests/storage.test.ts` + manual `2× saveWorkspace` race test |
| Fix `activeEditorStore` ↔ `ProjectContext` dual SOT: make `getActiveEditorContext()` return `activeFileMeta` even when `!ed`; or make `ProjectContext` the SOT and `activeEditorStore` a derived handle | `src/core/editor/activeEditorStore.ts:69,165`, `src/context/ProjectContext.tsx:395-406` | §6.2 | Medium — AI context changes | Unit: `getActiveEditorContext` returns meta when `ed=null`; E2E: `/// fix` after file switch |
| Single-writer editor: remove `workspaceBridge.ts:138` direct `executeEdits`; expose `proposeEdit` that `CodeEditor` applies version-checked | `src/core/editor/workspaceBridge.ts:138`, `src/components/Editor/CodeEditor.tsx:654,624` | Previous | Medium — edit path | `tests/commentingSafeEdit.test.ts` + `structuredEdits.test.ts` |
| Fix `modelRouter forcedMinimax:230` to honour `requestedModel` + `allowFallback:false` | `server/services/ai/modelRouter.cjs:230` | None | Low — billing | `tests/aiModelRouter.test.ts`, `aiProviderRouting.test.ts` |
| Fix `editEngine verify lenient:680` to require suffix match or full-length equality | `src/core/ai/editEngine.ts:660-685` | None | Low | `tests/aiCodeTransformation.test.ts` truncated-write fixture |

### Phase B — Reliability (1-2 weeks)

**Objective:** Leaks, races, error handling hardening.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Wire `CodeEditor` disposables into `DisposableStore`; dispose on `editorInstance` change + unmount + `activeFile?.id` change | `src/components/Editor/CodeEditor.tsx:149,1500,940,590` | Phase A | Low | Manual StrictMode remount leak check (heap snapshot) |
| Fix `ExplanationContext` dual registry: make `AIRequestStore` SOT, `aiRequestManager` server-only; `AIAssistant handleStop` aborts all three | `src/context/ExplanationContext.tsx:94`, `src/components/Panels/AIAssistant.tsx:710,728` | Phase A | Medium | `tests/aiRuntime.test.ts` cancellation suite |
| Fix `diagnosticsService` `abortPromise` + `earlyPromise` listener lifecycle; cache isolated model per file | `src/utils/diagnosticsService.ts:637,650,693` | None | Low | `tests/diagnosticsOverhaul.test.ts` |
| Deduplicate `inferProvider` to `modelRouter` single source; fix `isAbortError` over-broad | `server/services/ai/aiClient.cjs:27`, `server/services/ai/modelRouter.cjs:79`, `src/core/ai/AIAbortController.ts` | Phase A | Low | `tests/aiProviderNormalization.test.ts` |
| Harden `server/routes/ai.cjs` + `execute.cjs` validation (payload caps, per-IP rate limit) | `server/routes/ai.cjs:11`, `server/routes/execute.cjs:3` | Phase A | Low | `tests/aiErrors.test.ts` |

### Phase C — Architecture (2-3 weeks)

**Objective:** Module boundaries, component decomposition, store consolidation.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Split `CodeEditor.tsx` (1981) → `EditorMount`, `EditorDiagnostics`, `EditorInlineCompletion`, `EditorSave`, `EditorKeybindings` | `src/components/Editor/CodeEditor.tsx` | Phase B | High — most complex file | Visual regression + `tests/safeTree.test.ts` not broken |
| Split `AIAssistant.tsx` (2199) → `AIAssistantShell`, `MessageList` (virtualised), `MessageItem`, `AIComposer` (already separate), `StreamingBubble` | `src/components/Panels/AIAssistant.tsx` | Phase B | High | Storybook/perf snapshot |
| Consolidate settings mutate to `settingsStore.updateSettings` (remove `SettingsContext` stale closure) | `src/context/SettingsContext.tsx:68`, `src/settings/settingsStore.ts:75` | Phase A | Low | `tests/settings.test.ts` concurrent updates |
| Make `TerminalContext.isRunning` per-terminal (`Map<id,boolean>`) | `src/context/TerminalContext.tsx:85,208,584` | None | Low | `tests/terminalSession.test.ts` |
| Consolidate reasoning-filter regexes to single import (`AIStream.ts` vs `aiContext.cjs` vs `taskConfig.cjs`) | `server/services/ai/aiStream.cjs:35`, `server/services/ai/aiContext.cjs:28`, `server/services/ai/taskConfig.cjs` | Phase B | Low | `tests/aiReasoningFilter.test.ts` |
| Fix `PerformanceContext` rAF loop or delete (prefer `usePerformanceMonitor.ts:54` shared loop) | `src/context/PerformanceContext.tsx:40`, `src/hooks/usePerformanceMonitor.ts:54` | None | Low | Manual perf monitor check |

### Phase D — Performance (1-2 weeks)

**Objective:** Measurable wins, not blind optimisation.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Move diagnostics to worker (Monaco isolated model + `stripStringsAndComments`) | `src/utils/diagnosticsService.ts:634` | Phase C | Medium — worker boundary | `tests/diagnosticsOverhaul.test.ts` + perf timing |
| Cache `getRuntimes()` (30s) + add `AbortSignal` to execution fetches | `src/utils/codeExecutionService.ts:84`, `server/services/execution/*` | Phase B | Low | `tests/terminalSession.test.ts` + RTT measurement |
| Memoize `AIComposer fileList` by tree version; clear `setInterval 700ms` poll to `subscribeActiveEditor` (already correct) + remove duplicate | `src/components/Panels/AIComposer.tsx:48,76` | None | Low | `performance.measure` tick count |
| Fix `MainLayout` mousemove to attach only while `resizingSide !== null`, via `rAF` | `src/components/Layout/MainLayout.tsx:228` | None | Low | Drag smoothness 60fps |
| Hash `analysisCache` key (`hash(code)` not raw string) + debounce `analysisHistory` writes | `src/utils/codeAnalysisEngine.ts:281`, `src/utils/analysisHistory.ts:68` | None | Low | Heap snapshot |
| Self-host fonts, conditional icon chunk (`react-icons` vs `lucide-react`) | `index.html:11`, `vite.config.ts:57` | None | Low | Lighthouse |
| | | | | |

### Phase E — AI infrastructure (1-2 weeks)

**Objective:** Single provider chain, predictable streaming, no reasoning leak.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Unify provider health + model routing: `modelRouter.buildDirectChain` sole chain, `aiClient` only transport | `server/services/ai/*` (9 files) | Phase B | Medium | `tests/aiProviderRouting.test.ts`, `aiRuntime.test.ts` |
| Fix `createVisibleContentFilter` `MAX_THINK_HOLD` truncation to preserve `</thinking>` across boundary | `server/services/ai/aiStream.cjs:100` + `src/core/ai/AIStream.ts` | Phase C | Low | `tests/aiReasoningFilter.test.ts` long thinking fixture |
| Sanitize `dangerouslySetInnerHTML` via `DOMPurify` or render Prism via `code` DOM (not innerHTML) | `src/components/Panels/AIAssistant.tsx:181`, `src/components/Panels/MarkdownRenderer.tsx:116` | None | Medium — XSS | Manual SVG payload test |
| Fix `aiSanitizer` double-pass to no-op correctly; `codeSuggestionService` stale check before sanitize | `src/utils/aiSanitizer.ts:19`, `src/utils/codeSuggestionService.ts:506` | Phase A | Low | `tests/aiOutputPolicy.test.ts`, `aiCommenting.test.ts` |
| Fix `sanitizeEditorOutput` vs `sanitizeEditorOutputWithPolicy` vs legacy shim triplication | `src/utils/aiSanitizer.ts`, `src/utils/groqService.ts:358`, `src/utils/codeSuggestionService.ts:140` | Phase B | Low | — |

### Phase F — Testing (ongoing)

**Objective:** Guardrails before/after each phase.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Add `madge --circular` CI, `npm run typecheck` gate | `package.json:17`, `vite.config.ts` | None | None | CI |
| E2E: file open→edit→save→AI `/// fix`→verify→undo; terminal create→run→kill→recreate | `tests/_harness.ts` + new `tests/e2e/*` | Phase A | — | Playwright |
| Chaos: two concurrent `saveWorkspace`, two AI edits same doc, abort mid-stream, file switch mid-inline | `tests/aiRuntime.test.ts`, `tests/treeOperations.test.ts` | Phase B | — | Vitest |
| Perf budget monitor gating (`PerformanceBudgetMonitor.tsx`) in CI | `src/components/PerformanceBudgetMonitor.tsx:538` | Phase D | — | Budget thresholds |

### Phase G — Cleanup (1 week)

**Objective:** Remove dead code, enforce boundaries.

| Task | Files | Dependencies | Risk | Validation |
|------|-------|--------------|------|------------|
| Remove `rehype-raw` dep, move `@types/jszip` to `devDependencies`, choose `lucide-react` xor `react-icons` | `package.json:45,22,57` | None | None | `npm run build:analyze` chunk report |
| Delete dead `AIAssistant executeAction:673`, `getBracketPairs:216` identical triple, `SUGGESTION_KEY` alias | `src/utils/codeSuggestionService.ts:40,216`, `src/components/Panels/AIAssistant.tsx:673` | Phase C | None | `eslint no-unused-vars` |
| Add Windows-portable `lifecycle.cjs` fallback (no `ps`/`lsof`, use `fs.writeFileSync` with `wx` + `pid` check via `process.kill(pid,0)`) | `server/lifecycle.cjs:45,116` | None | Low | Windows smoke test |
| Bond `diagnosticStore` + `providerHealth` + `analysisCache` with LRU eviction | `src/core/diagnostics/diagnosticStore.ts:18`, `src/utils/codeAnalysisEngine.ts:281`, `server/services/ai/providerHealth.cjs` | Phase D | Low | Long-session heap |

---

## 20. Testing Strategy

### 20.1 Pre-refactor (existing)

* Run `npm run typecheck && npm test` (vitest). Suites: `aiCodeTransformation`, `aiCommenting`, `aiErrors`, `aiModelRouter`, `aiOutputPolicy`, `aiProviderNormalization`, `aiProviderRouting`, `aiReasoningFilter`, `aiRuntime`, `commentingSafeEdit`, `diagnosticsOverhaul`, `indentation`, `safeTree`, `settings`, `storage`, `structuredEdits`, `taskProfiles`, `terminalSession`, `treeOperations`, `updateTree` (20 suites, `tests/_harness.ts` helper).
* Manual: open file → `/// generate` → verify `editEngine` → check `ProblemsPanel` markers.

### 20.2 Per-phase gates

* **Phase A:** `tests/storage.test.ts` + concurrent `saveWorkspace` race test; `getActiveEditorContext` meta-fallback unit; `structuredEdits.test.ts` with truncated `candidate` fixture; `aiModelRouter` forced-primary regression.
* **Phase B:** `aiRuntime.test.ts` cancellation (abort mid-stream, `isCurrent` guard), `diagnosticsOverhaul` abortPromise leak test (signal listener count).
* **Phase C:** Component split — visual regression (chromatic or manual) + `npm run build` chunk sizes unchanged (`dist/stats.html` via `build:analyze`).
* **Phase D:** Perf budget: `PerformancePanel` + `PerformanceBudgetMonitor` thresholds; `localStorageDebounce` coalesce count; `fuzzySearch` microbench.
* **Phase E:** `aiReasoningFilter` long-thinking boundary fixture (`4096+32` split); `aiOutputPolicy` double-sanitize idempotence; `dangerouslySetInnerHTML` SVG payload test.
* **Phase F:** New E2E Playwright (file lifecycle + AI `///`), chaos concurrent tests.
* **Phase G:** `madge --circular`, `eslint --max-warnings=0`, `npm run build:analyze` (no chunk regression).

### 20.3 What not to test yet

* No need to unit-test `planet` preview (`PlanetHero` via `?planet`) — isolated, low risk.
* No need to mock `node-pty` in unit tests — keep in `terminalSession.test.ts` only.

---

## 21. Performance Validation Strategy

| Metric | How to measure | Tool | Target (Phase D) |
|--------|----------------|------|------------------|
| Startup (TTI) | `performance.mark` `main.tsx` → `MainLayout` mount | Lighthouse, `vite preview --profile` | <1.8s on Fast 3G; chunk `vendor-monaco` lazy not blocking |
| Large-file typing latency | 10k-line JS file, `checkDiagnosticsEx` wall time | `performance.now` around `checkDiagnosticsEx:919` + `AIPerfTracker` | Debounce 800ms, p95 <120ms main thread |
| Editor re-render count | `useWhyDidYouUpdate:234` + React Profiler | `react/profiler` + `why-did-you-update` | `AIAssistant` message list does not re-render siblings per delta |
| Resize drag | `requestAnimationFrame` frame budget during `mousemove` | Chrome DevTools Performance | 60fps, no React re-renders per pixel |
| Memory (long session) | Heap snapshot after 50 file opens + 100 AI calls | Chrome Memory | `diagnosticStore` + `analysisCache` bounded, no growth >10MB/hour |
| AI streaming TTFB | `AIPerfTracker:313` `firstTokenReceived` | `isAIPerfEnabled` counters | p50 TTFB <800ms (backend), fallback not triggered spuriously |
| Runtimes fetch | `performance.measure` `getRuntimes` vs `executeCode` | Network panel | Cached: 0 fetches after first within 30s |
| Bundle | `dist/stats.html` | `rollup-plugin-visualizer` | `vendor-ui` shrinks after icon consolidation; no chunk >500KB gzip |
| Fonts | `link[rel=preconnect]` + `display=swap` audit | Lighthouse | No FOIT, `font-display:swap` |

---

## 22. Open Questions (require confirmation before implementation)

1.  **VS Code framing:** Does product want to market as "VS Code-compatible" (implies extension host, settings sync) or "Monaco-based" (current reality)? This determines whether Phase C ever adds an extension host vs hardening `toolRegistry`.
2.  **Workspace persistence scope:** `workspaceStore.cjs` currently single `data/workspace.json`. Is multi-workspace / multi-folder desired? Affects lock + `saveWorkspace` API.
3.  **Provider priority:** `modelRouter.cjs:230` forced `minimax-m3:free` — is this intentional for cost control or a debugging hijack that should be removed? Affects Phase A billing fix.
4.  **Direct provider fallback:** `AIClient.ts:58` `VITE_USE_BACKEND_AI !== 'false'` — when backend enabled, should client ever `fallback to direct` on `retryable` backend failure? Current `AIClient` does not (correct for `AIError` verdict), but `chatService.cjs` retries once internally. Confirm fallback policy.
5.  **Performance overlay:** `PerformanceContext` dead loop — should it be deleted entirely in favour of `usePerformanceMonitor.ts` shared loop + `PerformanceBudgetMonitor`? Or fixed and used?
6.  **Terminal persistence:** `TerminalManager` GC 30s + `terminateAllForSocket` on WS close — should sessions survive WS reconnect (current kills all)? Affects `TerminalContext` handshake race fix.
7.  **Diagnostics worker budget:** Move diagnostics off main thread — acceptable to add `comlink` + worker infra (~2KB) or prefer `requestIdleCallback` throttling only?
8.  **XSS trade-off:** `MarkdownRenderer skipHtml:true` is secure but breaks intentional HTML in AI responses; is sanitised HTML (`DOMPurify`) desired or is "no HTML" correct?
9.  **Windows support:** `lifecycle.cjs` `ps`/`lsof` — is Windows a supported target? Determines Phase G portability work vs documenting "macOS/Linux only".
10. **Bundle analysis gate:** Should `chunkSizeWarningLimit:600` be lowered to 400 to fail CI on regressions, or is 600 intentional for `vendor-monaco`/`vendor-terminal`?

---

## Appendix — File evidence index

* **App shell:** `src/main.tsx:6`, `src/App.tsx:62,32,17,28`, `src/core/composeProviders.tsx:19`, `index.html:11`, `vite.config.ts:7,26,53,85,89`
* **Layout:** `src/components/Layout/MainLayout.tsx:12,29,58,228,273,308,313,474,538`
* **Editor:** `src/components/Editor/CodeEditor.tsx:44,149,156,159,190,265,338,448,479,532,546,565,590,620,624,652,654,682,740,803,809,940,994,1014,1149,1288,1388,1476,1483,1500,1934`
* **State:** `src/core/editor/activeEditorStore.ts:69,165,652,678`, `src/context/ProjectContext.tsx:288,328,354,365,395,419,612,729,757`, `src/context/TerminalContext.tsx:60,85,89,110,208,213,249,584`, `src/context/ExplanationContext.tsx:59,94,135,164,200,204,251,262`, `src/context/PerformanceContext.tsx:40,105`, `src/core/diagnostics/diagnosticStore.ts:18,37,90,101`, `src/core/ai/aiRequestStore.ts:59,75,91,123,168,182,202`, `src/hooks/useAILoading.ts:36,47,87`, `src/settings/settingsStore.ts:8,27,68,70,75,90,116`
* **AI:** `src/core/ai/*` (38 files), `src/utils/groqService.ts:62,77,138,175,199,253,274,303,336,358`, `src/utils/codeSuggestionService.ts:37,68,85,103,216,246,390,414,506,530,538`, `src/utils/aiSanitizer.ts:19`, `src/utils/codeExecutionService.ts:70,84,104`, `src/components/Panels/AIAssistant.tsx:40,116,181,482,588,634,673,710,728,859`, `src/components/Panels/AIComposer.tsx:48,76,138,197`, `src/components/Panels/ai/artifactParser.ts:14,21`
* **Diagnostics:** `src/utils/diagnosticsService.ts:82,162,236,306,521,634,650,693,710,725,806,855,919,957`, `src/utils/diagnosticsTypes.ts:88`, `src/utils/ageing/detectors.ts:30,53,113,194,448`, `src/core/diagnostics/diagnosticStore.ts`
* **Workspace:** `src/utils/safeTree.ts:23,44,82,300,363,404,601`, `src/utils/mockFileSystem.ts:24,764`, `src/core/editor/workspaceBridge.ts:65,72,82,138`, `server/services/projects/workspaceStore.cjs:17,42`, `server/routes/projects.cjs`, `src/components/Sidebar/FileExplorer.tsx:58,820,1082`
* **IPC:** `src/core/runtime/EventBus.ts:19,33,39,52,56`, `src/core/runtime/DisposableStore.ts`, `src/core/runtime/CancellationToken.ts:38`, `src/core/runtime/SingleFlight.ts:17`, `src/utils/apiClient.ts:17,44`, `server/websocket/executionHandler.cjs:33,70,166,200,211`, `server/services/terminal/terminalManager.cjs:50,583,595`
* **Lifecycle:** `server/index.cjs:17,31`, `server/app.cjs:10`, `server/lifecycle.cjs:45,116,212`, `server/config/index.cjs`, `server/middleware/errorHandler.cjs:10`, `server/lib/asyncHandler.cjs:3`
* **Perf:** `src/utils/performanceService.ts:175,423,439,647`, `src/utils/performanceAlerts.ts:63,284,383`, `src/utils/localStorageDebounce.ts:1,30,49,64`, `src/hooks/usePerformanceMonitor.ts:41,54,70,182,237`, `src/utils/fuzzySearch.ts:13,17,40`, `src/utils/prismLoader.ts:9,16,68`, `src/utils/chatStorage.ts:30,42,93,113`, `src/utils/analysisHistory.ts:21,68,101`, `src/hooks/useDebounce.ts:3`, `src/utils/language.ts:11`
* **UI:** `src/components/UI/ErrorBoundary.tsx:19`, `src/components/UI/DialogProvider.tsx:51,88,108,134`, `src/components/Panels/MarkdownRenderer.tsx:18,48,272`, `src/components/Panels/ProblemsPanel.tsx:26,42`, `src/hooks/useTheme.ts:40,63`
* **Deps:** `package.json:19-71`, `tsconfig.app.json:20`, `eslint.config.js:30`, `tailwind.config.js:11`

---

*End of audit. First deliverable complete. Next: review §22 open questions, then execute Phase A.*
