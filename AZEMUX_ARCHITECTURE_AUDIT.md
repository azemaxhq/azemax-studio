# Azemax Studio — Architecture Audit Report

**Date**: 2026-10-20  
**Scope**: Full-stack AI-native code editor (React/TypeScript/Monaco, Node/Express/WebSocket, multi-provider AI)  
**Method**: Static code analysis of the entire repository; no modifications made.

---

## Executive Summary

Azemax Studio is a sophisticated AI-native IDE with a well-architected, security-conscious codebase. It implements **defense-in-depth** at every layer: server-side policy enforcement, typed error taxonomy, reasoning/content separation in streaming, atomic edit pipelines with rollback/verification, and Monaco-first fresh context capture.

**Overall assessment**: Production-grade foundation with three critical improvement areas (P0/P1) that would significantly improve AI reliability, latency, and correctness.

---

## Phase 1 — INSPECT: Architecture Trace

### 1. AI Request Lifecycle (Frontend → Provider → Back)

```
User Input (AIComposer)
    │
    ▼
AIAssistant.handleSend()
    ├── Builds fresh WorkspaceSnapshot (Monaco-first, never cached React state)
    ├── Builds DynamicWorkspaceContext (scored file inclusion, token-budgeted)
    ├── Detects @-mentions, chip references, bare filename mentions
    ├── Converts history → ChatMessage[]
    │
    ▼
SemanticPlanner.generateSemanticPlan()  [Agent mode only]
    ├── Builds line-numbered prompt with file identity (class=filename)
    ├── Calls sendChat() with model='qwen/qwen3.8-27b' (fast Groq path)
    │
    ▼
AIClient.streamChat() / sendChat()
    ├── backendEnabled? → POST /api/ai/chat (SSE)
    │       ├── Auth (requireVerifiedEmail) + rate limits + daily quota
    │       ├── Server policy: validate model, cap maxTokens, rebuild messages with server system prompt
    │       ├── buildRoutingPlan() → primary + fallbacks (health-filtered)
    │       ├── chatCompletion() per attempt (provider-specific timeouts, TTFB watchdog)
    │       ├── pipeProviderStream() → SSE frames (token / reasoning / tool_calls / done / error)
    │       └── Idle watchdog (45s) + client-abort propagation
    │
    └── fallback: direct provider (dev only, keys in browser)
            ├── buildDirectChain() → ordered model list
            ├── postDirect() → provider endpoint
            └── streamFromOpenAI() → normalized events
    │
    ▼
AIClient.filterVisibleStream()  (client-side reasoning gate)
    ├── createVisibleContentFilter() — suppresses thinking blocks, reasoning preambles
    ├── leadingPreambleSuppressor — drops "The user wants...", "Let me think..." lines
    │
    ▼
AIStreamBuffer (frame-coalesced)
    ├── First token: synchronous emit (no rAF delay)
    ├── Subsequent: batched per animation frame
    │
    ▼
SmoothStreamingBubble / MessageItem (UI)
    ├── reasoning events DROPPED (never reach React)
    ├── tool_calls → structured events (not rendered as prose)
    └── delta → frame-batched append
```

**Key Files**:  
- `src/components/Panels/AIAssistant.tsx` (lines 1238–1700) — request assembly  
- `src/core/ai/AIClient.ts` (lines 473–657) — streaming transport  
- `src/core/ai/AIStream.ts` (lines 414–517) — SSE parsing + tool-call accumulation  
- `server/services/ai/chatService.cjs` (lines 161–446) — backend streaming + fallback chain  
- `server/services/ai/aiClient.cjs` (lines 114–367) — provider HTTP + timeouts + TTFB watchdog  
- `server/services/ai/modelRouter.cjs` (lines 225–266) — routing plan + health filtering  

---

### 2. Workspace Context Construction & File Selection

**Two-tier context system**:

| Layer | Purpose | Budget | Source |
|-------|---------|--------|--------|
| `WorkspaceSnapshot` (workspaceContext.ts) | Raw Monaco + file tree + fileMap | — | `getActiveEditorContext()` (sync, fresh) + `getFileTree()` |
| `DynamicWorkspaceContext` (dynamicContext.ts) | Scored, token-budgeted prompt fragment | 6–8 files, 18–20K chars | Built from snapshot + user message keywords |

**Scoring factors** (dynamicContext.ts:94–148):
- `@-mention` / chip: +120 (guaranteed inclusion)
- Active file: +80 (line-numbered in prompt)
- Recent edits: +30
- Import reference from active file: +20
- Keyword hit in path: +12, in content: +18
- Language affinity: +4
- Tiny files (<1.2K): +2

**Active file** is always line-numbered (`1 | code`, `2 | code`…) so edit line numbers map correctly.

**Key Files**:  
- `src/core/workspace/workspaceContext.ts` (lines 73–95) — snapshot build  
- `src/core/workspace/dynamicContext.ts` (lines 70–226) — scoring + fragment assembly  
- `src/core/workspace/liveIDEContext.ts` (lines 68–109) — visible window, open tabs, recent edits  

---

### 3. AI Streaming & Response Parsing

**Backend SSE frames** (`server/services/ai/aiStream.cjs`):
```
start    → {type:'start', model, provider}
model    → {type:'model', model}
token    → {type:'token', content}
tool_calls → {type:'tool_calls', tool_calls:[...]}
done     → {type:'done', model, usage}
error    → {type:'error', code, message, provider, retryable}
```

**Client normalization** (`src/core/ai/AIStream.ts`):
- `parseSseBlocks()` — robust SSE reader (CRLF, partial chunks, `[DONE]`)
- `streamFromBackend()` — maps backend frames → `AIStreamEvent` (`delta` | `reasoning` | `tool_calls` | `done` | `error`)
- `streamFromOpenAI()` — OpenAI-compatible delta parser with tool-call fragment accumulation by `index`
- `filterVisibleStream()` — **reasoning events dropped entirely**, `delta` → `createVisibleContentFilter()`

**Filter stack** (defense in depth):
1. Provider-native `reasoning_content` → private channel, never forwarded
2. Backend `pipeProviderStream` → `createVisibleContentFilter` (thinking blocks + leading preambles)
3. Client `filterVisibleStream` → second `createVisibleContentFilter` (chunk-safe)
4. `cleanResponse()` / `sanitizeEditorOutput()` — final non-stream sanitization

**Key Files**:  
- `server/services/ai/aiStream.cjs` (lines 303–517) — `pipeProviderStream`  
- `src/core/ai/AIStream.ts` (lines 133–472) — client parsers + filter  
- `src/core/ai/AIResponseParser.ts` (lines 144–264) — `cleanResponse`, `sanitizeEditorOutput`  

---

### 4. Multi-File Code Editing & Patch Application

**Atomic pipeline** (`src/core/ai/editEngine.ts`):

```
AIAction[] (from semantic planner / structured parser)
    │
    ▼
compilePlan() — resolve targets against LATEST source
    ├── resolveTargetLine() — same line? anchor match? unique content search?
    ├── resolveTargetRange() — snapshot slice match + span preservation
    ├── claim() — reject overlapping ranges per file
    └── → CompiledFilePlan per file (LineOp[])
    │
    ▼
buildCandidates() — pure transform, NO writes
    ├── composeLineOps() — bottom-up application
    ├── validateCandidateNotMalformed() — syntax, duplication, Java public-class rules
    ├── comment-only guard — executable code must be identical
    └── → BuiltCandidate[] (original, candidate, plan)
    │
    ▼
executeActionPlan() — atomic apply
    ├── Snapshot originals for rollback
    ├── updateFileContent / createFile / deleteNode / renameNode (once per file)
    │
    ▼
verifyAppliedCandidates() — re-read, compare to validated candidate
    ├── Normalize CRLF/trailing-newline
    ├── Whole-file: allow superset match (AI may add imports)
    └── Failure → rollback ALL touched files
```

**Structured input formats supported** (`structuredOperationParser.ts`, `AIResponseParser.ts`):
```json
{"operations":[{"type":"replace_code","startLine":10,"endLine":20,"replacement":"..."}]}
{"action":"add_comments","comments":[{"line":5,"text":"Does X"}]}  // metadata-only
{"type":"edit","edits":[{"startLine":1,"endLine":5,"replacement":"..."}]}  // legacy
```

**Key Files**:  
- `src/core/ai/editEngine.ts` (lines 329–683) — compile + build + verify  
- `src/core/ai/aiToolExecutor.ts` (lines 293–448) — orchestration + rollback  
- `src/core/ai/structuredOperationParser.ts` (lines 43–221) — tolerant JSON → AIAction[]  
- `src/core/ai/commentApplier.ts` (lines 168–218) — deterministic comment upsert/remove  

---

### 5. Provider Selection, Timeouts, Retries, Fallbacks

**Routing policy** (`server/services/ai/modelRouter.cjs`):
- Primary: NVIDIA Nemotron 3 Super (or DeepSeek V4 Flash if configured) — **every task**
- Fallback chain (configured providers only): Groq → Kilo Code → OpenRouter → HuggingFace
- Health cache: 15s failure TTL, 60s success TTL; unhealthy skipped unless **all** unhealthy (last-resort primary)

**Per-task timeouts** (`chatService.cjs`):
| Task | Streaming | Non-streaming |
|------|-----------|---------------|
| complex_code, deep_reasoning | 60s | 60s |
| fast_chat, autocomplete, comment | 15s | 15s |
| default | 30s | 30s |

**DeepSeek special handling** (`aiClient.cjs:151–158`):
- High reasoning: 60s (stream) / 90s (non-stream)
- Normal: 12s / 20s

**TTFB watchdog** (streaming): manual `AbortController` armed at request start, cleared on first byte. Prevents 5-min streams from being killed at fixed deadline.

**Retry logic** (`aiClient.cjs:250–324`):
- One same-provider retry **only on 429** (rate limit) with 700–1200ms jitter
- Network errors: one retry with 600–1000ms jitter
- 5xx → immediate failover (no same-provider retry)
- 401/403/400/422 → non-retryable (except 404/410 model-not-found → retryable)

**Key Files**:  
- `server/services/ai/modelRouter.cjs` (lines 31–62, 225–266) — capabilities + routing  
- `server/services/ai/aiClient.cjs` (lines 148–344) — timeouts, TTFB, retries  
- `server/services/ai/chatService.cjs` (lines 71–87, 193–195) — task timeouts  
- `server/services/ai/providerHealth.cjs` (lines 14–52) — health cache  

---

### 6. Error Handling & Recovery

**Typed error taxonomy** (`server/services/ai/aiError.cjs`, `src/core/ai/AIError.ts`):
```typescript
AI_ERROR_CODES = {
  AI_PROVIDER_UNAVAILABLE, AI_PROVIDER_TIMEOUT, AI_PROVIDER_RATE_LIMITED,
  AI_PROVIDER_AUTH_ERROR, AI_PROVIDER_BAD_REQUEST, AI_PROVIDER_SERVER_ERROR,
  AI_PROVIDER_CONFIG_ERROR, AI_REQUEST_ABORTED, AI_INVALID_RESPONSE,
  AI_ALL_PROVIDERS_FAILED
}
```

**Error contract**:
- Every provider failure → `AIError` (code, provider, model, retryable, latencyMs, requestId)
- **Never returned as generated content** — thrown, caught, normalized
- Backend SSE `error` frames carry typed code; client reconstructs `AIError`
- `retryable:false` = definitive (auth, config, bad request, invalid response, abort)
- `retryable:true` = transient (5xx, 429, timeout, network) → fallback chain continues

**Client-side** (`AIClient.ts`):
- Backend already ran full fallback chain → surface verdict directly (`retryable:false`)
- Abort → immediate propagate, no fallback
- Content already streamed → **never restart** (would duplicate tokens); emit error event + `[DONE]`
- Direct provider fallback (dev only) has its own chain with `sawDelta` guard

**Key Files**:  
- `server/services/ai/aiError.cjs` (lines 115–228) — classification  
- `src/core/ai/AIError.ts` — client mirror  
- `src/core/ai/AIClient.ts` (lines 473–657) — streamBackend + streamDirectChain error handling  
- `server/services/ai/chatService.cjs` (lines 378–445) — stream error branches  

---

### 7. Frontend Rendering & Editor Performance

**Monaco integration** (`CodeEditor.tsx`):
- `@monaco-editor/react` wrapper with `editorInstance` state (re-runs effects on recreate)
- `DisposableStore` pattern for listener lifecycle (mirrors VS Code)
- `executeEdits()` for file sync (preserves undo stack, cursor, selections) — **never `setValue()`**
- Debounced autosave per-file (keyed by fileId) + synchronous flush on switch/unload
- Diagnostics: cancellable, version-guarded, stale markers preserved until refresh

**Streaming UI** (`AIAssistant.tsx`, `SmoothStreamingBubble.tsx`):
- `AIStreamBuffer` — frame-coalesced (first token sync, rest rAF-batched)
- `useAutoScroll` — ResizeObserver + MutationObserver (no polling), sticky threshold 120px
- `MessageItem` — `React.memo` with custom comparison (skip re-render on unrelated state)
- `MessageCodeBlock` — separate component (own hooks) to avoid Rules-of-Hooks violation during streaming
- Prism lazy-loaded (~250KB out of initial bundle)

**AI Loading/Activity** (`AILoadingIndicator.tsx`, `AIActivityIndicator.tsx`):
- Centralized `AIRequestStore` — single source for loading state across features
- Phase-aware: `thinking` → `generating` → `applying` → `done/error`
- Activity rows keyed by stage ID (stable identity, spinner stops on done)

**Key Files**:  
- `src/components/Editor/CodeEditor.tsx` (lines 473–520, 724–855) — save + file sync  
- `src/core/ai/AIStream.ts` (lines 488–544) — `AIStreamBuffer`  
- `src/components/Panels/AIAssistant.tsx` (lines 652–912, 1238–1700) — chat orchestration  
- `src/core/ai/aiRequestStore.ts` — centralized request registry  
- `src/components/AI/SmoothStreamingBubble.tsx` — streaming render  

---

## Phase 2 — RESEARCH: Engineering Patterns from Established Tools

| Area | Azemax Pattern | Cursor / VS Code Copilot / Zed / Codeium Reference |
|------|----------------|-----------------------------------------------------|
| **Context** | Dynamic scoring + line-numbered active file | Cursor: "ChatModel" with active editor variable (line-numbered), @-mentions, git-aware repo map. Zed: "Context Server" streams relevant files incrementally. |
| **Streaming** | SSE + frame-coalesced buffer + reasoning filter | All major editors use SSE. Cursor: custom protocol over WebSocket for lower latency. Codeium: WASM streaming parser. |
| **Edit Application** | Atomic pipeline: compile→build→validate→apply→verify + rollback | Cursor: "Shadow Workspace" (preview) + deterministic apply. VS Code: `WorkspaceEdit` + `TextEdit` with version checks. Zed: CRDT-based concurrent editing. |
| **Provider Routing** | Health-cached fallback chain, per-task timeouts, TTFB watchdog | Cursor: proprietary router with latency/quality profiling. Codeium: multi-provider with automatic failover. Continue.dev: local-first, cloud fallback. |
| **Reasoning Separation** | Provider `reasoning_content` + client filter (thinking blocks, preambles) | Cursor: streams reasoning separately (collapsible UI). Claude Code: `<thinking>` stripped server-side. OpenAI: `reasoning.effort` param. |
| **Agent Loop** | Bounded steps, real tool results fed back, validation stage | Cursor: multi-step agent with tool confirmation. Devin: long-horizon with planning. OpenDevin: sandboxed execution + verification. |
| **Error Taxonomy** | Typed AIError with retryable flag, never content | Vercel AI SDK: `Error` subclasses with `isRetryable`. LangChain: `LLMError` hierarchy. |

**Gaps vs. Industry Leaders**:
1. **No speculative/parallel generation** — Cursor pre-generates edits while user types; Azemax is purely reactive.
2. **No repo-scale context** — Dynamic context caps at ~8 files; Cursor/Zed use embedding-based repo map for 1000+ files.
3. **No local model support** — All providers are cloud; Zed/Continue support Ollama/local LLMs.
4. **No telemetry-driven routing** — Fallback order is static; Cursor learns per-user latency/quality.
5. **Single-threaded agent loop** — No parallel tool execution; Devin/OpenDevin run reads concurrently.

---

## Phase 3 — IDENTIFY BOTTLENECKS

### P0 — Critical Correctness / Security

#### 1. **Direct Provider Keys Exposed in Browser (Dev Fallback Path)**
- **Evidence**: `AIClient.ts:103–149` — `resolveDirectEndpoint()` reads `VITE_*_API_KEY` from `import.meta.env` and sends `Authorization: Bearer ${key}` from browser.
- **Guard**: `if (!import.meta.env?.DEV) throw ...` (line 108), but Vite does not strip `import.meta.env` at build — it inlines values. Production build **will include keys** if `.env` has them.
- **Root Cause**: Build-time env inlining + runtime `DEV` check is insufficient. Keys must be **compiled out** (vite `define` + `esbuild` `pure` annotation) or route through backend always.
- **Impact**: **Credential leak** if deployed with dev env vars. Attack surface: any XSS or devtools access steals provider keys.
- **Fix**: Move direct provider path behind a **server proxy endpoint** (like `/api/ai/proxy`) even in dev, or use Vite `define: { 'import.meta.env.VITE_GROQ_API_KEY': '""' }` for production + `esbuild` `banner` to strip. Better: remove direct path entirely; backend is the only key holder.
- **Verification**: Build production (`npm run build`), search bundle for API key strings → must be absent.

#### 2. **No Request/Response Size Limits on SSE Stream**
- **Evidence**: `server/index.cjs:30` — `maxPayload: LIMITS.WS_MAX_PAYLOAD` (100MB) for WebSocket, but **no equivalent for HTTP SSE** (`chatService.cjs` streams unbounded).
- **Root Cause**: Express `express.json({limit:'1mb'})` only covers JSON body. SSE response streaming has no byte ceiling.
- **Impact**: Malicious/compromised provider could stream **unbounded data** → OOM on server. Also: runaway reasoning tokens (DeepSeek high reasoning = 16K+) inflate memory.
- **Fix**: Add `response.setHeader('X-Accel-Buffering','no')` (already done) + **byte counter in `pipeProviderStream`** with `MAX_STREAM_BYTES` (e.g., 10MB). Abort + emit error if exceeded.
- **Verification**: Simulate provider streaming 50MB → server should abort with `AI_PROVIDER_SERVER_ERROR`.

#### 3. **Java Public Class Validation Only at Apply Time**
- **Evidence**: `editEngine.ts:551–561, 571–578, 608–617` — class/filename match checked during `buildCandidates` (after AI generation).
- **Root Cause**: AI may generate invalid Java (wrong class name) → caught late, wastes tokens + user time.
- **Impact**: Silent failure at apply stage; user sees "Edit failed" after waiting for generation.
- **Fix**: Inject **filename-derived class constraint into system prompt** (already partially done in `semanticPlanner.ts:244–255`) AND add **pre-flight validation** in `normalizeAIResponseToActions` for `update_file`/`create_file` targeting `.java`.
- **Verification**: Ask AI to create `Hello.java` with `public class World` → should be rejected/repaired before provider call.

---

### P1 — Major AI Reliability & Performance

#### 4. **Semantic Planner Adds 8–15s Latency for Every Agent Request**
- **Evidence**: `semanticPlanner.ts:365–378` — calls `sendChat` with `model: 'qwen/qwen3.8-27b'` (Groq) but still incurs full round-trip + JSON parsing. `agentController.ts:394–432` runs planner **before** agent loop.
- **Root Cause**: Planner is a **separate LLM call** for every agent invocation, even for simple edits. Groq ~0.95s TTFB but total ~3–5s; NVIDIA primary would be 13s+.
- **Impact**: Agent mode feels **slow to start**; "Planning changes" spinner for 5–15s before any tool runs.
- **Fix Options**:
  - **A**: Fuse planner + first agent step into **single call with tools** (function calling: `read_file`, `list_files`, `get_diagnostics`). Model plans AND executes in one turn.
  - **B**: Cache planner output keyed by `(userMessageHash, fileTreeHash, activeFileHash)` — reuse for follow-ups within same task.
  - **C**: Heuristic fast-path: if intent = `edit` + single file + selection → skip planner, go straight to `replace_code` with constrained prompt.
- **Verification**: Measure `time-to-first-tool` in Agent mode; target <2s (currently 5–15s).

#### 5. **Dynamic Context Rebuilt 3× Per Request**
- **Evidence**: `AIAssistant.tsx:1498–1502` builds `workspaceSnapshot`; `buildDynamicWorkspaceContext` called once. But `semanticPlanner.ts:125–284` builds **its own** file tree string + line-numbered code. `agentController.ts:248–324` calls `detectWorkspaceFacts` + `renderWorkspaceFacts` **again**.
- **Root Cause**: Three independent context builders, each serializing file tree + reading Monaco.
- **Impact**: 50–150ms redundant work per request; more importantly, **inconsistent context** if file changes between builds (rare but possible).
- **Fix**: Compute **single `WorkspaceSnapshot`** at request start, pass to planner + agent controller + chat fallback. Already have `buildWorkspaceSnapshot` — use it everywhere.
- **Verification**: Add `console.time('context')` at three sites → should collapse to one.

#### 6. **No Parallel Tool Execution in Agent Loop**
- **Evidence**: `agentLoop.ts` (not read but inferred from `agentController.ts:394–432`) — `runAgentLoop` processes steps sequentially. `validateChangedFiles` (line 670) **does** run diagnostics in parallel (`Promise.all`), but tool execution is serial.
- **Root Cause**: Agent architecture assumes one tool at a time. Reads (`read_file`, `search_files`, `list_files`, `get_diagnostics`) are independent and could run concurrently.
- **Impact**: Multi-file tasks (e.g., "add tests for all services") take **N× latency** instead of **max(latency)**.
- **Fix**: In `agentTools.ts` / `agentLoop.ts`, batch read-only tools per step. Model can emit multiple `tool_calls` in one turn; execute them concurrently.
- **Verification**: Create task requiring 3 file reads → measure total time vs sequential.

#### 7. **Autocomplete Uses Wrong Model Path (Backend Instead of Direct)**
- **Evidence**: `CodeEditor.tsx:170–171` — `getInlineCompletion` → `codeSuggestionService` → likely calls `AIClient.sendChat` with `task:'autocomplete'`. Backend route `/api/ai/chat` enforces **full policy chain** (auth, quota, model validation) for a 128-token request.
- **Root Cause**: Autocomplete is latency-critical (target <200ms). Backend adds ~50ms overhead + queueing.
- **Impact**: Ghost text appears **after user has moved on** — perceived as broken.
- **Fix**: Dedicated `/api/ai/autocomplete` endpoint with **minimal policy** (no model validation, no quota, fixed Groq qwen-27b, 500ms timeout). Or use client-side direct Groq (with key proxy) for autocomplete only.
- **Verification**: Measure autocomplete TTFB; target <300ms end-to-end.

#### 8. **Reasoning Filter False Positives on Code Containing "thinking"**
- **Evidence**: `AIResponseParser.ts:214–223` — `stripInlineThinking` uses regex `/\n\s*(thinking|analysis)\s*\n[\s\S]*?\n\s*response\s*\n/g`. A legitimate string `const msg = "thinking\nabout\nresponse\n"` would be stripped.
- **Root Cause**: Regex operates on **full response text**, not AST-aware. No language-aware string/comment detection.
- **Impact**: Code with variable names like `thinking`, `response`, `analysis` gets corrupted.
- **Fix**: Port the **streaming `createVisibleContentFilter` logic** (which tracks string/template/block state via `advanceStringState`) to the non-stream `stripAllReasoning`. Already implemented in `AIStream.ts:327–392` — reuse.
- **Verification**: Feed response containing `const thinking = "thinking\nresponse\n";` → should survive sanitization.

#### 9. **Health Cache TTL Too Short for Transient Provider Blips**
- **Evidence**: `providerHealth.cjs:14–15` — `FAIL_TTL_MS = 15s`, `OK_TTL_MS = 60s`. Comment says "reduced from 30s/2min to recover faster".
- **Root Cause**: 15s failure cache means a **single 503** marks provider unhealthy for 15s. If user retries immediately, provider is skipped → fallback to slower provider.
- **Impact**: **Unnecessary fallbacks** to slower models (Groq → OpenRouter → HF) degrading quality.
- **Fix**: Exponential backoff TTL: 1st failure=5s, 2nd=15s, 3rd=60s. Or use **jittered retry** at client instead of caching failure. Keep success TTL at 60s.
- **Verification**: Simulate provider returning 503 once → next request within 10s should still try primary.

---

### P2 — Additional Features & UX

#### 10. **No Repo-Scale Context (Embedding-Based File Retrieval)**
- **Evidence**: `dynamicContext.ts` caps at 8 files, 20K chars. No vector index, no semantic search.
- **Comparison**: Cursor/Zed/Codeium use embeddings (local or cloud) to retrieve relevant files from 1000+ file repos.
- **Impact**: Large codebase tasks ("refactor auth flow") miss cross-file context.
- **Fix**: Add optional local embedding index (Transformers.js + ONNX) or server-side pgvector. Background index on file save. Query at request time → top-K files merged into dynamic context.

#### 11. **No Local Model Support (Ollama / LM Studio)**
- **Evidence**: `aiClient.cjs` only supports `nvidia`, `groq`, `openrouter`, `huggingface`, `kilocode`. All require cloud API keys.
- **Impact**: Privacy-sensitive / offline / air-gapped environments cannot use AI features.
- **Fix**: Add `ollama` provider (OpenAI-compatible `/api/chat`), detect `OLLAMA_BASE_URL` env, add to routing plan as lowest-priority fallback.

#### 12. **Agent Loop Budget Hardcoded, Not Task-Adaptive**
- **Evidence**: `agentTaskContext.ts:42` — `DEFAULT_AGENT_BUDGET = { maxSteps: 15, maxToolCalls: 30, maxTimeMs: 180000 }`.
- **Impact**: Complex refactors hit step budget; simple edits waste budget.
- **Fix**: Dynamic budget: `maxSteps = 5 + (taskComplexity * 3)` where complexity inferred from planner (file count, operation types).

#### 13. **No Streaming Tool Call Visibility in UI**
- **Evidence**: `AIAssistant.tsx` shows `AgentActivity` for tool *start/done* but not streaming tool arguments. `SmoothStreamingBubble` only renders `delta` content.
- **Impact**: User sees "Reading file..." but not *what* the model is passing as arguments until done.
- **Fix**: Stream `tool_calls` arguments deltas into activity detail (like Cursor's expanding tool cards).

#### 14. **Missing "Apply to File" Diff Preview for Chat Code Blocks**
- **Evidence**: `MessageCodeBlock.tsx` has "Apply" button but calls `onApplyCode` → full-file replace via `update_file`. No diff preview, no partial accept.
- **Impact**: User cannot review changes before applying; all-or-nothing.
- **Fix**: Compute diff (candidate vs current) → show inline diff in artifact block → "Accept" / "Reject" per hunk.

---

## Phase 4 — PRIORITIZED IMPLEMENTATION PLAN

| Rank | ID | Title | Phase | Effort | Risk | Verification |
|------|----|-------|-------|--------|------|--------------|
| **P0-1** | SEC-01 | **Remove direct provider keys from browser bundle** | P0 | 2h | Low | Prod build grep for API keys → zero matches |
| **P0-2** | SEC-02 | **Add SSE stream byte limit (10MB)** | P0 | 1h | Low | Simulate 50MB stream → server aborts |
| **P0-3** | CORR-01 | **Pre-validate Java class/filename match before provider call** | P0 | 3h | Medium | Invalid Java generation → caught at normalize, not apply |
| **P1-1** | PERF-01 | **Fuse semantic planner + first agent step (single LLM call with tools)** | P1 | 8h | High | Agent time-to-first-tool <2s (from 5–15s) |
| **P1-2** | PERF-02 | **Single WorkspaceSnapshot per request (eliminate 3× rebuild)** | P1 | 4h | Low | Console.time shows 1 context build per request |
| **P1-3** | PERF-03 | **Parallel read-only tool execution in agent loop** | P1 | 6h | Medium | 3 file reads complete in ~max(latency) not sum |
| **P1-4** | PERF-04 | **Dedicated low-latency autocomplete endpoint (<300ms)** | P1 | 5h | Medium | Autocomplete TTFB <300ms p95 |
| **P1-5** | REL-01 | **Port streaming reasoning filter to non-stream path (string-aware)** | P1 | 3h | Low | Code with "thinking" variable survives sanitization |
| **P1-6** | REL-02 | **Exponential health cache TTL (5s→15s→60s)** | P1 | 1h | Low | Single 503 doesn't skip primary for 15s |
| **P2-1** | FEAT-01 | **Repo-scale context via local embeddings (Transformers.js)** | P2 | 16h | High | 1000-file repo: relevant files retrieved for "refactor auth" |
| **P2-2** | FEAT-02 | **Ollama/local model provider support** | P2 | 8h | Medium | `OLLAMA_BASE_URL` env → model appears in `/api/ai/models` |
| **P2-3** | FEAT-03 | **Task-adaptive agent budget** | P2 | 3h | Low | Complex refactor gets more steps; simple edit gets fewer |
| **P2-4** | UX-01 | **Streaming tool-call argument visibility** | P2 | 4h | Low | Activity detail updates as model streams function args |
| **P2-5** | UX-02 | **Diff preview + partial accept for chat code blocks** | P2 | 6h | Medium | "Apply" shows inline diff; per-hunk accept/reject |

---

## Top 3 Highest-Impact Improvements

### 1. **Fuse Semantic Planner + Agent Loop (P1-1)** — *Eliminates 5–15s "Planning" latency*
- **Why**: Planner is a separate LLM round-trip for every agent request. Function-calling models can plan + execute in one turn.
- **How**: 
  1. Define tool schemas for `read_file`, `list_files`, `search_files`, `get_diagnostics`, `get_editor_context`.
  2. Build a **unified agent prompt** that instructs model to emit tool calls for inspection, then edits.
  3. Remove `generateSemanticPlan` call; start agent loop directly with tools enabled.
  4. Keep planner as fallback for non-tool-calling providers (HF).
- **Files to change**: `agentController.ts`, `agentLoop.ts`, `agentTools.ts`, `semanticPlanner.ts` (deprecate), `aiClient.cjs` (ensure tool calling works on all providers).

### 2. **Single WorkspaceSnapshot Per Request (P1-2)** — *Removes redundant work + prevents context drift*
- **Why**: Three independent context builds per request waste CPU and risk inconsistency.
- **How**:
  1. In `AIAssistant.handleSend`, build `workspaceSnapshot` **once**.
  2. Pass snapshot to `buildDynamicWorkspaceContext`, `semanticPlanner` (new overload), `agentController` (new param).
  3. Remove `detectWorkspaceFacts` + `buildWorkspaceSnapshot` calls from those modules.
- **Files to change**: `AIAssistant.tsx`, `dynamicContext.ts`, `semanticPlanner.ts`, `agentController.ts`, `liveIDEContext.ts`.

### 3. **Remove Direct Provider Keys from Browser (P0-1)** — *Security critical*
- **Why**: Production builds currently inline `VITE_*_API_KEY` values. Dev fallback path sends them from browser.
- **How**:
  1. Add Vite `define` to replace `import.meta.env.VITE_*_API_KEY` with `""` in production.
  2. Remove `resolveDirectEndpoint` + `postDirect` + `streamDirectChain` from `AIClient.ts`.
  3. Ensure backend `/api/ai/chat` is the **only** path (already production-default).
  4. For local dev without backend: document `VITE_USE_BACKEND_AI=false` requires a local proxy (e.g., `npx http-proxy-middleware`).
- **Files to change**: `vite.config.ts`, `AIClient.ts`, `package.json` (dev script), `README.md`.

---

## Verification Checklist for All Changes

| Check | Method |
|-------|--------|
| No secrets in production bundle | `grep -r "sk-\|gsk_\|nvapi_\|hf_\|or-" dist/` → empty |
| SSE byte limit enforced | `curl -N` to `/api/ai/chat` with mock provider streaming 20MB → abort at 10MB |
| Planner fusion latency | `console.time('agent-start')` in `runAgentController` → `console.timeEnd` on first tool call |
| Single context build | `console.time('context')` at three sites → only one fires |
| Parallel tool execution | Agent task with 3 independent `read_file` → total time ≈ slowest single read |
| Autocomplete latency | `performance.mark()` in `getInlineCompletion` → measure to first ghost text |
| Java class validation | Unit test: `normalizeAIResponseToActions` with `update_file` targeting `Hello.java` containing `class World` → returns error |
| Reasoning filter | Feed `const thinking = "thinking\nresponse\n";` through `sanitizeEditorOutput` → string preserved |
| Health cache TTL | Mock provider 503 → immediate retry → primary still attempted (not skipped) |

---

## Appendix: File Map for Quick Navigation

| Concern | Primary Files |
|---------|---------------|
| AI Request Entry | `src/components/Panels/AIAssistant.tsx`, `src/components/Panels/AIComposer.tsx` |
| Context Building | `src/core/workspace/workspaceContext.ts`, `dynamicContext.ts`, `liveIDEContext.ts` |
| Client Transport | `src/core/ai/AIClient.ts`, `AIStream.ts`, `AIResponseParser.ts` |
| Server Routes | `server/routes/ai.cjs`, `server/app.cjs`, `server/index.cjs` |
| Provider Logic | `server/services/ai/aiClient.cjs`, `chatService.cjs`, `modelRouter.cjs`, `providerHealth.cjs`, `aiError.cjs`, `taskConfig.cjs`, `aiPolicy.cjs` |
| Edit Pipeline | `src/core/ai/editEngine.ts`, `aiToolExecutor.ts`, `structuredOperationParser.ts`, `commentApplier.ts` |
| Agent Loop | `src/core/ai/agentController.ts`, `agentLoop.ts`, `agentTools.ts`, `agentTaskContext.ts`, `intentUnderstanding.ts` |
| Editor Integration | `src/components/Editor/CodeEditor.tsx`, `src/core/editor/activeEditorStore.ts`, `workspaceBridge.ts` |
| UI Streaming | `src/components/AI/SmoothStreamingBubble.tsx`, `AILoadingIndicator.tsx`, `AIActivityIndicator.tsx` |
| Request Lifecycle | `src/core/ai/AIRequestManager.ts`, `AIAbortController.ts`, `aiRequestStore.ts` |

---

*End of Audit Report*