# Services & Utilities Documentation

This document describes the core services and utility modules located in `src/utils`. These modules handle AI interactions, code execution, analysis, and other backend-like functionality within the frontend.

## 1. AI Comment Service (`aiCommentService.ts`)
Manages "smart comments" where users can trigger AI actions using `///` syntax.

### Key Features
- **Streaming Generation**: Supports streaming responses for real-time feedback.
- **Command Parsing**: Detects commands like `/// generate`, `/// explain`, `/// fix`.
- **Context Awareness**: Includes surrounding code context in AI prompts.

### Key Functions
- `parseCommentCommand(line, language)`: Extracts instructions from comment lines.
- `streamGenerateFromComment(command, callbacks)`: Generator function for streaming AI responses.
- `generateFromComment(command)`: Non-streaming version for simple requests.

---

## 2. Code Analysis Engine (`codeAnalysisEngine.ts`)
Performs static analysis on code to provide quality metrics.

### Key Metrics
- **Cyclomatic Complexity**: Estimates code complexity based on branching.
- **Maintainability Index**: Score (0-100) indicating how hard the code is to support.
- **Code Smells**: Detects issues like deep nesting, large files, and legacy syntax (`var`).

### Key Functions
- `analyzeCode(code)`: Returns an `AnalysisResult` object containing health score, smells, and complexity ratings.

---

## 3. Code Execution Service (`codeExecutionService.ts`)
Executes user code securely using the [Piston API](https://github.com/engineer-man/piston).

### Key Features
- **Multi-language Support**: Maps file extensions to Piston-supported runtimes (JS, TS, Python, etc.).
- **Sandboxed Execution**: Code runs in a remote containerized environment.

### Key Functions
- `executeCode(code, language, stdin)`: Sends code to Piston and returns stdout/stderr.
- `getRuntimes()`: Fetches available languages from the API.

---

## 4. Code Suggestion Service (`codeSuggestionService.ts`)
Provides inline code completions (autocomplete) using AI.

### Key Features
- **Context-Aware**: Uses cursor position and surrounding code to generate relevant snippets.
- **Cancellation**: Handles aborting requests when the user keeps typing.
- **Inline Modification**: specialized for `///` commands on the same line.

### Key Functions
- `getCodeSuggestion(context)`: Main entry point for requesting suggestions.
- `cancelPendingRequest()`: Aborts ongoing AI calls.

---

## 5. Diagnostics Service (`diagnosticsService.ts`)
Runs code to detect runtime and compilation errors using the Execution Service.

### Key Features
- **Error Parsing**: Parses raw stderr output from Python, Node.js, etc., into Monaco Editor markers.
- **Severity Mapping**: Maps errors to editor severity levels (Error, Warning).

### Key Functions
- `checkCodeErrors(code, fileName)`: Executes code and returns a list of `Monaco.editor.IMarkerData`.

---

## 6. Groq Service (`groqService.ts`)
The core AI provider wrapper using the Groq SDK.

### Key Features
- **Chat Interface**: Unified generic chat methods (`sendChatRequest`, `streamChatRequest`).
- **File System Operations**: System prompt includes instructions for creating/modifying files via JSON actions.
- **Model Management**: Manages API keys and model selection (default: `llama-3.3-70b-versatile`).

### Key Functions
- `chatWithAI(message, history, ...)`: Main chat method.
- `generateCode(prompt, language, ...)`: Specialized for code generation.
- `fixCode`, `explainCode`, `refactorCode`: Helper wrappers for specific tasks.

---

## 7. Mock File System (`mockFileSystem.ts`)
Defines the structure for the virtual file system used in the IDE.

### types
- `FileNode`: Recursive structure for files and folders.
