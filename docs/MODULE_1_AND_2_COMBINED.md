# Modules 1 & 2: Services and State Management

This document combines the technical details for **Module 1: Services & Utilities** and **Module 2: State Management (Context)**.

---

# Module 1: Services & Utilities

Logic modules located in `src/utils` handle core functionalities often abstracted away from the UI.

## 1.1 AI Comment Service (`aiCommentService.ts`)
Manages "smart comments" where users can trigger AI actions using `///` syntax.
-   **Features**: Streaming generation, context-aware prompts.
-   **Key Functions**:
    -   `streamGenerateFromComment(command)`: Generators for real-time AI feedback.
    -   `parseCommentCommand(line)`: Extracts commands like `/// fix` or `/// explain`.

## 1.2 Code Execution Service (`codeExecutionService.ts`)
Executes user code securely using the [Piston API](https://github.com/engineer-man/piston).
-   **Sandboxing**: Code runs in isolated containers.
-   **Key Functions**:
    -   `executeCode(code, language)`: Sends code to Piston and returns output.
    -   `getRuntimes()`: Lists supported languages.

## 1.3 Code Suggestion Service (`codeSuggestionService.ts`)
Provides inline code completions (Autofill/Ghost text).
-   **Features**: Context-aware suggestions based on cursor position.
-   **Key Functions**: `getCodeSuggestion(context)` requesting AI completion.

## 1.4 Diagnostics Service (`diagnosticsService.ts`)
Runs code to detect errors without explicit user execution.
-   **Features**: Parses raw stderr (Python tracebacks, Node errors) into Monaco Editor markers.
-   **Key Functions**: `checkCodeErrors(code)` returns error markers.

## 1.5 Groq Service (`groqService.ts`)
The core wrapper for AI providers.
-   **Features**: Unified chat interface, model fallback management (Groq, Llama, Gemini).
-   **Key Functions**: `chatWithAI`, `generateCode`.

---

# Module 2: State Management (Context)

Global state is managed via React Context providers in `src/context`.

## 2.1 Project Context (`ProjectContext.tsx`)
Manages the virtual file system.
-   **State**: File tree structure (`FileNode[]`), active file, and selection.
-   **Persistence**: Auto-saves to `localStorage`.
-   **Actions**: `createFile`, `createFolder`, `deleteNode`, `updateFileContent`.

## 2.2 Terminal Context (`TerminalContext.tsx`)
Manages integrated terminal sessions.
-   **State**: List of active terminals, execution logs, and stdin buffers.
-   **Actions**: `runCode`, `createTerminal`, `appendLog`.
