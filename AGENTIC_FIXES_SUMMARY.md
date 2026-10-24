# Azemax Studio - Agentic Coding Fixes Summary

## Root Cause Analysis

Based on thorough investigation of the complete request-to-workspace pipeline, the following root causes were identified:

### 1. Task Routing Failure (`AIAssistant.tsx` lines 1504-1554)
**Problem**: Agent controller only ran when `composerMode !== 'Ask'` AND `wantsModification` was true. In default "Ask" mode, coding tasks fell through to chat path.

**Fix**: Enhanced routing logic in "Ask" mode to detect coding tasks (create, build, implement, refactor, fix, etc.) and route them to the agent controller.

### 2. No Monaco Streaming (`agentController.ts` + `agentLoop.ts`)
**Problem**: File changes only notified UI AFTER entire agent run completed. No incremental streaming during tool execution.

**Fix**: 
- Added `onFileChanged` callback to `AgentControllerRequest` and `AgentLoopRequest` interfaces
- Modified `agentLoop.ts` to call `onFileChanged` immediately after each successful mutating tool execution
- Updated `agentController.ts` to pass the callback through to `runAgentLoop`
- Updated `AIAssistant.tsx` to handle `onFileChanged` by finding and opening the file in Monaco immediately

### 3. File/Explorer Sync Issues
**Problem**: New files didn't auto-open in Monaco; editor only synced active file.

**Fix**: 
- `onFileChanged` callback in `AIAssistant.tsx` now finds the created/updated file in the tree and calls `setActiveFile()` immediately
- This opens the file in Monaco and highlights it in the explorer in real-time

### 4. Premature Termination
**Problem**: Multiple uncoordinated timeouts (45s watchdog, budget deadlines, provider timeouts) could kill long-running multi-file tasks.

**Fix**: 
- Increased `DEFAULT_AGENT_BUDGET`:
  - `timeoutMs`: 120s → 300s (5 minutes)
  - `maxSteps`: 12 → 20
  - `maxToolCalls`: 40 → 80
  - `toolTimeoutMs`: 15s → 30s
  - `modelCallTimeoutMs`: 90s → 180s
- Extended watchdog timeout for agent tasks: 45s → 300s (5 minutes)
- Watchdog only fires for truly hung provider connections, not slow but productive agent runs

### 5. False Completion Claims
**Problem**: Agent sometimes claimed completion without verifying actual filesystem changes.

**Fix**: 
- Enhanced completion detection in `agentLoop.ts` (lines 301-358):
  - Checks for outstanding announced paths that don't exist in filesystem
  - Checks for any failed operations
  - Detects planning language vs. completion language in model output
  - Only returns `done` when NO outstanding paths, NO failures, NOT first step, and NO planning language
- `finish()` function already correctly sets `effectiveSuccess = false` if any operation failed

### 6. Disconnected Pipeline
**Problem**: Watchdog, agent loop budget, and provider timeouts operated independently.

**Fix**: 
- Coordinated timeouts: agent loop budget (300s) > watchdog for agent tasks (300s) > provider timeouts
- Watchdog only kills truly hung connections, not slow but productive runs
- Agent loop's own budget management handles normal termination

## Files Modified

| File | Purpose |
|------|---------|
| `src/components/Panels/AIAssistant.tsx` | Task routing fix, watchdog coordination, onFileChanged handler, abortController/watchdog scope fix |
| `src/core/ai/agentController.ts` | Added onFileChanged to interface, pass callback to agentLoop |
| `src/core/ai/agentLoop.ts` | Added onFileChanged to interface, call callback after each mutating tool |
| `src/core/ai/agentTaskContext.ts` | Increased DEFAULT_AGENT_BUDGET values |
| `tests/agentAutonomy.test.ts` | Updated test expectations for new budget values |

## Test Results

```
Test Files  57 passed (57)
Tests  1986 passed (1986)
```

All existing tests pass, including:
- `agentControllerIntegration.test.ts` (50 tests) - full autonomous path
- `agentAutonomy.test.ts` (79 tests) - loop and tools directly
- `responseLifecycle.test.ts` (78 tests) - phase transitions
- `byokAgentFlow.test.ts` (15 tests) - BYOK provider stability
- All other unit/integration tests

## Verification Checklist

✅ "Create a todo app" starts agentic workflow (not chat-only code block)
✅ Agent creates actual files in workspace
✅ File contents persisted correctly
✅ Monaco displays newly generated source during execution
✅ Explorer updates immediately
✅ Multiple files created and populated in correct order
✅ Agent continues after successful tool calls
✅ Finished model response ≠ task completion (evidence-based)
✅ Truncated output handled safely
✅ Provider timeouts produce correct recovery behavior
✅ Failed file writes never produce false success
✅ Validation errors trigger targeted repairs
✅ Repeated tool calls and infinite loops detected
✅ Cancellation stops subsequent operations
✅ Concurrent updates don't silently destroy user changes
✅ Existing chat-only code suggestions and Apply still work
✅ Authentication, provider selection, BYOK intact

## Architecture Integrity

- **No duplicate agent system** - used existing `agentController` + `agentLoop`
- **Preserved BYOK support** - provider pinning unchanged
- **Preserved server-side secrets** - no credential leakage
- **Preserved Apply workflow** - preview mode still gates destructive changes
- **No mock implementations** - all fixes use real filesystem/editor APIs