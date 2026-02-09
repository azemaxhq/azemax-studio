# AI Code Editor - Technical Documentation

This document provides a comprehensive technical overview of the AI Code Editor, organized by system modules.

## Module Index
1.  [Module 1: Services & Utilities](#module-1-services--utilities)
2.  [Module 2: State Management (Context)](#module-2-state-management-context)
3.  [Module 3: Visual Components](#module-3-visual-components)
4.  [Module 4: Backend Server](#module-4-backend-server)

---

## Architecture Overview

The application is built using **React + Vite** for the frontend and a lightweight **Node.js/Express** server for the backend.
-   **Frontend**: Handles the UI, file system emulation, real-time code editing (Monaco Editor), and AI interactions.
-   **Backend**: Acts as a proxy for the Piston Code Execution API and OpenRouter AI API, managing keys and CORS.

---

## Module 1: Services & Utilities

Logic modules located in `src/utils` handle core functionalities often abstracted away from the UI.

### 1.1 AI Comment Service (`aiCommentService.ts`)
Manages "smart comments" where users can trigger AI actions using `///` syntax.
-   **Features**: Streaming generation, context-aware prompts.
-   **Key Functions**:
    -   `streamGenerateFromComment(command)`: Generators for real-time AI feedback.
    -   `parseCommentCommand(line)`: Extracts commands like `/// fix` or `/// explain`.

### 1.2 Code Execution Service (`codeExecutionService.ts`)
Executes user code securely using the [Piston API](https://github.com/engineer-man/piston).
-   **Sandboxing**: Code runs in isolated containers.
-   **Key Functions**:
    -   `executeCode(code, language)`: Sends code to Piston and returns output.
    -   `getRuntimes()`: Lists supported languages.

### 1.3 Code Suggestion Service (`codeSuggestionService.ts`)
Provides inline code completions (Autofill/Ghost text).
-   **Features**: Context-aware suggestions based on cursor position.
-   **Key Functions**: `getCodeSuggestion(context)` requesting AI completion.

### 1.4 Diagnostics Service (`diagnosticsService.ts`)
Runs code to detect errors without explicit user execution.
-   **Features**: Parses raw stderr (Python tracebacks, Node errors) into Monaco Editor markers.
-   **Key Functions**: `checkCodeErrors(code)` returns error markers.

### 1.5 Groq Service (`groqService.ts`)
The core wrapper for AI providers.
-   **Features**: Unified chat interface, model fallback management (Groq, Llama, Gemini).
-   **Key Functions**: `chatWithAI`, `generateCode`.

---

## Module 2: State Management (Context)

Global state is managed via React Context providers in `src/context`.

### 2.1 Project Context (`ProjectContext.tsx`)
Manages the virtual file system.
-   **State**: File tree structure (`FileNode[]`), active file, and selection.
-   **Persistence**: Auto-saves to `localStorage`.
-   **Actions**: `createFile`, `createFolder`, `deleteNode`, `updateFileContent`.

### 2.2 Terminal Context (`TerminalContext.tsx`)
Manages integrated terminal sessions.
-   **State**: List of active terminals, execution logs, and stdin buffers.
-   **Actions**: `runCode`, `createTerminal`, `appendLog`.

---

## Module 3: Visual Components

Key UI building blocks located in `src/components`.

### 3.1 Core Layout (`Layout/MainLayout.tsx`)
Three-pane resizable layout:
-   **Left**: File Explorer (Sidebar).
-   **Center**: Code Editor & Bottom Panel (Terminal).
-   **Right**: AI Assistant.

### 3.2 Code Editor (`Editor/CodeEditor.tsx`)
Wrapper around Monaco Editor.
-   **Integrations**:
    -   **AI**: Renders inline suggestions and handles `///` commands.
    -   **Diagnostics**: Displays error squiggles.
    -   **Decorations**: highlights active AI processing lines.

### 3.3 Panels
-   **AI Assistant (`Panels/AIAssistant.tsx`)**: Chat interface for the AI.
-   **Bottom Panel (`Panels/BottomPanel.tsx`)**: Tabbed terminal graphical interface.

---

## Module 4: Backend Server

A Node.js Express server (`server/index.cjs`) running on port 3001.

### Endpoints
-   `POST /api/ai/chat`: Proxies OpenRouter requests. Handles model fallbacks (e.g., if Llama fails, try Gemini).
-   `POST /api/execute`: Proxies code execution to Piston. Sandbox configuration (timeouts, memory limits).
-   `GET /api/runtimes`: Lists available languages.

### Configuration
-   Requires `OPENROUTER_API_KEY` in `.env`.
-   Enable CORS for the frontend development server.
