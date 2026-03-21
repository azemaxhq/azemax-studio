## AI Code Editor – Full Technical Documentation

This document consolidates and updates all major documentation for the AI Code Editor project. It reflects the current implementation in the repository, including frontend, backend, AI integration, and execution pipeline.

---

## 1. High‑Level Overview

### 1.1 Purpose

**AI Code Editor & Analyzer** is a browser‑based IDE that combines:

- **Monaco editor** for rich code editing.
- **Virtual file system** stored in the browser.
- **AI assistance** (chat, inline suggestions, smart `///` commands, explanations, refactors).
- **Integrated terminal & code execution** via a Node backend, local compilers/interpreters, and Wandbox fallback.
- **Static “code ageing” analysis** with metrics and recommendations.

### 1.2 Tech Stack

- **Frontend**
  - **React 19** + **TypeScript**.
  - **Vite 7** dev server/bundler.
  - **Monaco editor** via `@monaco-editor/react`.
  - **xterm.js** + addons for the terminal.
  - **Tailwind CSS** with a glassmorphism‑inspired UI.
  - **Framer Motion**, **Lucide React**, **react-markdown**, **remark-gfm**, **rehype-raw`.
- **Backend**
  - **Node.js + Express**.
  - **WebSocket** (`ws`) server for interactive code execution.
  - **Local runtimes/compilers** (python, node, gcc/g++, javac/java, etc.).
  - **Wandbox API** as fallback execution when a local runtime is missing.
- **AI**
  - **OpenRouter chat completion API** (multiple free models) on the backend.
  - **Groq SDK** on the frontend for editor‑ and ageing‑related tools (code generation, suggestions, fixes).

---

## 2. Project Structure

### 2.1 Top‑Level Layout

- **`src/`** – React frontend
  - `main.tsx`, `App.tsx`, `index.css`.
  - `components/` – UI and IDE components.
  - `context/` – global state (project, terminals).
  - `utils/` – AI, analysis, execution, storage, helpers.
  - `hooks/` – custom hooks (`useDebounce`).
- **`server/`** – backend runtime & AI proxy
  - `index.cjs` – Express + WebSocket, local execution + Wandbox, AI chat endpoint.
  - `find-compilers.cjs`, `print-cmd.cjs`, `test_langs.py`, `test_ws_conn.js` – auxiliary tools/tests.
- **`docs/`** – project documentation (architecture, components, services, contexts, server, and this file).
- **`test_cpp/`** – sample C++ program and compiled binary for execution testing.
- **Configs** – `package.json`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html`.

---

## 3. Frontend Architecture

### 3.1 Entry Points

#### `src/main.tsx`

- Bootstraps React and renders `App` into `#root`.
- Imports global styles (`index.css`) and initializes Tailwind.

#### `src/App.tsx`

- Wraps the app with:
  - **`ProjectProvider`** – virtual file system state.
  - **`TerminalProvider`** – terminal sessions & run pipeline.
- Renders the main shell: **`MainLayout`**.

---

## 4. State Management (Contexts)

Located in `src/context/`.

### 4.1 Project Context (`ProjectContext.tsx`)

**Responsibility**: Virtual project / file system and editor integration.

- **State**
  - `FileNode[]` tree – hierarchy of folders/files (initially seeded from `mockFileSystem.ts`).
  - Active file & selection (current file in the editor, selected folder in the explorer).
  - Flags for in‑progress creation/renaming, multi‑selection, and clipboard for cut/copy/paste.
  - Expanded/collapsed folder state.
- **Persistence**
  - Automatically saves file tree and file contents to `localStorage`.
  - Restores on page load.
- **Core Types**
  - **`FileNode`** – file or folder with:
    - `id`, `name`, `type: 'file' | 'folder'`, optional `content`, `children`, and metadata.
  - **`ProjectContextType`** – shape of the context (state + actions).
- **Key Methods**
  - **CRUD**
    - `createFile(pathOrParentId, content?)`.
    - `createFolder(pathOrParentId)`.
    - `deleteNode(id)`.
    - `renameNode(id, newName)`.
    - `updateFileContent(fileId, content)`.
  - **Selection / Navigation**
    - `setActiveFile(id)`.
    - `setSelectedFolder(id)`.
    - `toggleFolderExpanded(id)`.
  - **Clipboard & Multi‑Select**
    - `copyNodes(ids)`, `cutNodes(ids)`, `pasteNodes(targetFolderId)`.
  - **Creation Flow**
    - `startCreating(type, parentId)`.
    - `cancelCreating()`, `confirmCreating(name)`.
- **Usage**
  - **Sidebar/FileExplorer** uses it to display and manipulate the tree.
  - **CodeEditor** uses `activeFile` and `updateFileContent` for editing.
  - AI tools and analysis read/update file contents through this API.

### 4.2 Terminal Context (`TerminalContext.tsx`)

**Responsibility**: Logical terminal sessions and execution control.

- **State**
  - `TerminalSession[]` – one per terminal tab:
    - `id`, `name`, log data, status (`idle`, `running`, `error`), language, etc.
  - `activeSessionId` – which tab is focused.
  - `isRunning` – whether any code is currently executing.
  - An `EventTarget` (or equivalent) for dispatching terminal commands.
- **Core Types**
  - **`LogEntry`** – each output line or event:
    - `type: 'stdout' | 'stderr' | 'system'`, `content`, timestamp.
  - **`TerminalSession`** – logical representation of a terminal tab.
- **Key Methods**
  - **Lifecycle**
    - `createTerminal()` – opens a new session.
    - `setActiveTerminal(id)`.
    - `clearTerminal(id)`.
  - **Output / Logging**
    - `appendLog(id, type, content)`.
  - **Execution**
    - `runCode({ language, code, filename, stdin? })`:
      - Dispatches a `runData` or similar custom event consumed by `ShellTerminal`.
      - Sets `isRunning` and updates session metadata.
  - **Control**
    - `stopProcess()` – signals the active shell/child process to terminate.
- **Usage**
  - **TerminalPanel** renders tabs and controls using this context.
  - **ShellTerminal** listens for events and streams logs back.
  - **CodeEditor** can trigger `runCode` for the currently open file.

---

## 5. Visual Components (`src/components/`)

### 5.1 Layout (`Layout/MainLayout.tsx`)

**Role**: Top‑level shell for the entire UI.

- **Layout**
  - **Left**: `Sidebar` (File Explorer + activity bar, if present).
  - **Center**: `CodeEditor` and `BottomPanel` (terminal/explanation/analysis).
  - **Right**: `AIAssistant` panel.
- **Features**
  - **Resizable panes**: Drag handles to resize left/right/bottom panels.
  - **Visibility toggles**: Show/hide right/bottom panels.
  - **State persistence**: Panel sizes and visibility stored in `localStorage`.
  - **Global shortcuts**: Keyboard handling for focus, panel toggling, and context menus.

### 5.2 Sidebar (`Sidebar/Sidebar.tsx`, `Sidebar/FileExplorer.tsx`)

**Role**: Visual representation and control of the virtual file system.

- **Features**
  - Renders the `FileNode` tree as nested folders/files.
  - Expand/collapse folders.
  - Indicate active/modified files.
  - Contextual actions:
    - New file/folder.
    - Rename.
    - Duplicate.
    - Delete.
    - Cut/Copy/Paste.
  - Supports multi‑selection and drag‑to‑move (where implemented).
- **Integration**
  - Uses `ProjectContext` APIs for all mutations.
  - Selection updates drive the active file in `CodeEditor`.

### 5.3 Editor (`Editor/CodeEditor.tsx`)

**Role**: The heart of the IDE — wraps Monaco and orchestrates AI, diagnostics, and execution.

- **Core Editor**
  - Monaco editor instance with:
    - Syntax highlighting, minimap, and word wrap.
    - Language mode set from file extension (`.ts`, `.py`, `.cpp`, etc.).
- **User Preferences**
  - Persists editor preferences (e.g., font size, minimap visibility, word wrap, theme) via `localStorage`.
- **AI Integration**
  - **Inline completions (“ghost text”)**:
    - Uses `codeSuggestionService.getInlineCompletion` and/or `getCodeSuggestion`.
    - Registered as a Monaco completion or inline provider.
    - Cancelled via ESC or continued typing (`cancelPendingRequest`).
  - **Smart `///` Comment Commands**:
    - Recognizes lines like `/// fix`, `/// explain`, `/// generate`, etc.
    - Delegates to `aiCommentService` for parsing and generation.
    - Can auto‑replace selected code or the current function with AI‑generated versions.
  - Visual decorations for “AI thinking” and in‑progress modifications.
- **Diagnostics**
  - Calls `diagnosticsService.checkCodeErrors` (using the backend) to run code and detect errors.
  - Sets Monaco markers for errors/warnings with squiggles and messages.
- **Toolbar & Actions**
  - Run current file/project (calls `TerminalContext.runCode`).
  - Format document, toggle word wrap, toggle minimap, and other editor options.
- **Persistence**
  - Uses `ProjectContext.updateFileContent` on debounced editor changes (via `useDebounce`).

### 5.4 Panels (`Panels/*`)

#### 5.4.1 `AIAssistant.tsx`

**Role**: Right‑hand AI chat panel.

- **Features**
  - Chat‑style UI with message list and input box.
  - Uses `groqService` (and/or backend `/api/ai/chat`) for responses.
  - Prompts can be conditioned on:
    - Current file content.
    - Current selection.
    - Project tree metadata.
  - Supports tasks like:
    - Explain code.
    - Refactor functions.
    - Generate tests.
    - Multi‑file planning or edits.

#### 5.4.2 `BottomPanel.tsx`

**Role**: Multi‑tab container at the bottom of the screen.

- **Tabs**
  - **Terminal** – interactive shell & program output (`TerminalPanel` + `ShellTerminal`).
  - **Code Ageing / Analysis** – uses `codeAnalysisEngine` to show:
    - Ageing score and grade.
    - Complexity metrics.
    - Hotspots and code smells.
    - Health indicators (length, complexity, duplication, etc.).
  - **Explanation** – AI‑generated explanation view (backed by `ExplanationPanel` and `groqService`).
  - Optional or experimental tabs such as a “Performance” placeholder.
- **Features**
  - Routes tab clicks into sub‑components:
    - `TerminalPanel`.
    - `ExplanationPanel`.
    - Analysis UI using `codeAnalysisEngine`.
  - Some recommendations can be auto‑applied:
    - For simple suggestions (e.g., rename variable, add comments, extract helper), it uses deterministic transforms or AI calls.
    - Writes back changes via `ProjectContext.updateFileContent`.

#### 5.4.3 `TerminalPanel.tsx`

**Role**: Logical terminal tab set above `ShellTerminal` instances.

- **Features**
  - Multiple terminal tabs using `TerminalContext`.
  - For each tab:
    - Show log scrollback.
    - Display run status (running, idle, error).
    - Provide an input box for sending stdin to running programs.
  - Controls:
    - Run/Stop (via `TerminalContext.runCode` / `stopProcess`).
    - Clear logs.
  - Binds the active editor file to terminal execution (filename, language, code).

#### 5.4.4 `ShellTerminal.tsx`

**Role**: xterm.js powered terminal emulator + shell & execution bridge.

- **Terminal Rendering**
  - Uses `xterm` with:
    - `@xterm/addon-fit` (auto resize).
    - `@xterm/addon-webgl` (hardware acceleration).
    - `@xterm/addon-web-links` (link detection).
    - `@xterm/addon-search` (search in buffer).
- **Shell Behavior**
  - Implements a lightweight in‑browser pseudo‑shell over `mockFileSystem`:
    - Commands: `ls`, `cd`, `pwd`, `cat`, `touch`, `mkdir`, `rm`, `clear`, `help`, etc.
    - Tracks current directory in the virtual FS.
  - Handles:
    - Input buffering and command history.
    - Basic line editing.
    - Distinguishing between local shell commands and code execution.
- **WebSocket Integration**
  - Connects to `ws://<host>:3001` (matching the backend server) on mount.
  - On **execute**:
    - Sends message `{ action: 'execute', language, files, stdinInput? }`.
    - Streams back:
      - `{ type: 'stdout' | 'stderr' | 'error' }` → writes to xterm and logs.
      - `{ type: 'exit', code }` → updates `TerminalContext` & UI.
      - `{ type: 'stdin-prompt' }` → prompts user for stdin before Wandbox execution.
  - Supports:
    - `{ action: 'input' }` (stdin to running process).
    - `{ action: 'kill' }` (terminate process).
- **Event Handling**
  - Subscribes to `TerminalContext` `EventTarget` for commands like `runData` and `kill`.
  - Converts keystrokes into shell/WS messages.
  - Integrates with `ContextMenu` for copy/paste/clear/kill actions.

#### 5.4.5 `ExplanationPanel.tsx`

**Role**: Dedicated view for code explanations and ageing‑related insights.

- **Features**
  - Presents AI‑generated natural language explanations of:
    - Current file.
    - Selected range/function.
  - Styled as a polished glassmorphism panel with headings and sections.
  - Uses `groqService` to generate explanations based on the current editor state.

### 5.5 UI Elements and Icons

- **`UI/ContextMenu.tsx`**
  - Generic context menu component used in:
    - Terminal (copy/paste/clear/kill).
    - Potentially file explorer or editor for rename/delete actions.
- **`Icons/ModernAILogo.tsx`**
  - Custom SVG icon for the AI assistant and branding.

---

## 6. Services & Utilities (`src/utils/`)

### 6.1 AI Comment Service (`aiCommentService.ts`)

**Purpose**: Handle “smart comments” with `///` commands inside code.

- **Key Features**
  - Detects commands like:
    - `/// generate ...`.
    - `/// fix`.
    - `/// explain`.
    - `/// refactor`.
  - Collects surrounding code context:
    - Current line, nearby lines, file metadata.
  - Supports streaming generation for responsive UI.
- **Core Functions**
  - `parseCommentCommand(line, language)` – parse a comment into an internal command object.
  - `streamGenerateFromComment(command, callbacks)` – triggers streaming AI; uses callbacks like `onToken`, `onDone`.
  - `generateFromComment(command)` – non‑streaming, single response for simple scenarios.

### 6.2 Code Analysis Engine (`codeAnalysisEngine.ts`)

**Purpose**: Local static analysis and “code ageing” scoring.

- **Metrics**
  - **Cyclomatic complexity**.
  - **Maintainability index**.
  - **Code smells** (deep nesting, very long functions/files, legacy `var` usage, etc.).
  - Optionally **Halstead metrics** where appropriate.
- **Outputs**
  - **Health score** (0–100) and grade (e.g., A/B/C).
  - **Hotspots** (lines/functions that are particularly problematic).
  - **Suggestions**, such as:
    - Breaking large functions.
    - Reducing nesting.
    - Renaming ambiguous variables.
    - Introducing helper functions.
- **Key Function**
  - `analyzeCode(code)` → `AnalysisResult`:
    - `score`, `grade`, `smells[]`, `complexity`, `hotspots[]`, and explanation text.

### 6.3 Code Execution Service (`codeExecutionService.ts`)

**Purpose**: Frontend wrapper for execution, bridging to the backend.

- **Responsibilities**
  - Build payloads for:
    - HTTP `POST /execute` (non‑interactive checks/diagnostics).
    - WebSocket `execute` messages (interactive runs via `ShellTerminal`).
  - Map editor language / file extension to backend `language` strings.
- **Key Functions**
  - `executeCode(code, language, stdin?)` – uses HTTP `/execute` to run code and returns `{ stdout, stderr, code }`.
  - `getRuntimes()` – calls `GET /api/runtimes` to list locally available runtimes.

### 6.4 Code Suggestion Service (`codeSuggestionService.ts`)

**Purpose**: AI inline completions and suggestion orchestration.

- **Features**
  - Context‑aware suggestions based on:
    - Current line, surrounding code.
    - File path and language.
  - Supports cancellation when:
    - User continues typing.
    - Cursor position changes significantly.
  - Provides completions tuned for `///` comment lines and immediate follow‑ups.
- **Key Functions**
  - `getCodeSuggestion(context)` – single suggestion request (e.g., for a button or keybinding).
  - `getInlineCompletion(monacoContext)` – inline provider logic for `CodeEditor`.
  - `cancelPendingRequest()` – aborts fetch/stream in flight.

### 6.5 Diagnostics Service (`diagnosticsService.ts`)

**Purpose**: Run code to detect errors and translate to editor diagnostics.

- **Features**
  - Uses backend `POST /execute` to run code quickly.
  - Parses stderr and exit code into Monaco markers:
    - File + line + column.
    - Message text.
    - Severity (error/warning).
  - Supports multiple languages (Python, JS/TS, C/C++, Java, etc.).
- **Key Function**
  - `checkCodeErrors(code, fileName)` → `Monaco.editor.IMarkerData[]`.

### 6.6 Groq Service (`groqService.ts`)

**Purpose**: Frontend AI client for rich editor & assistant features, using **Groq SDK**.

- **Key Features**
  - **Chat helpers**:
    - `chatWithAI(message, history, options?)`.
    - `streamChatRequest(...)` for streaming UIs.
  - **Code helpers**:
    - `generateCode(prompt, language, options?)`.
    - `fixCode(code, language, description?)`.
    - `explainCode(code, language?)`.
    - `refactorCode(code, goals?)`.
  - **Model management**:
    - Default model: `llama-3.3-70b-versatile` (configurable).
    - Proper key management via `VITE_GROQ_API_KEY`.
  - **System prompts**:
    - Rich instructions about editing code, multi‑file reasoning, and preferred patterns.
- **Environment**
  - `VITE_GROQ_API_KEY` must be set in `.env` for frontend Groq calls.

### 6.7 Mock File System (`mockFileSystem.ts`)

**Purpose**: Define the initial in‑browser file/folder tree.

- **Contents**
  - A starter set of files (e.g., main files for common languages) and folders.
  - Useful for demos and base state.
- **Type**
  - `FileNode` (used by `ProjectContext`, `Sidebar`, and the terminal mock shell).

### 6.8 Chat Storage (`chatStorage.ts`)

**Purpose**: Persist and retrieve AI chat histories.

- **Features**
  - Uses `localStorage` to store:
    - Conversations per workspace or per “session ID”.
    - Potentially pinned messages or last model choice.
- **API**
  - Helpers such as:
    - `loadChats()`, `saveChats(chats)`, `clearChats()`.
    - Functions to append/remove individual messages.

### 6.9 Utility Helpers

- **`cn.ts`**
  - Tailwind/React class name merge helper (similar to `clsx` + `tailwind-merge`).
  - Ensures deduplicated classes and conditional styling.

---

## 7. Custom Hooks

### 7.1 `hooks/useDebounce.ts`

**Purpose**: Debounce expensive operations.

- **Behavior**
  - Accepts a callback and delay.
  - Returns a debounced function that:
    - Waits for the delay after the last call before executing.
- **Usage**
  - Debounce editor → `updateFileContent`.
  - Debounce analysis or AI suggestion triggers.

---

## 8. Backend Server (`server/index.cjs`)

### 8.1 Overview

- **Express app** with JSON parsing and CORS.
- **HTTP** server wrapping Express.
- **WebSocket** server (`ws`) attached to the HTTP server.
- **Local runtime detection** using `which` via `execSync`.
- **Language → config** mapping table for:
  - `python`, `javascript`, `typescript`, `c`, `cpp`, `java`, `ruby`, `php`, `perl`, `rust`, `go`, `swift`, `bash/shell/zsh`, `csharp`, `scala`, `r`, `lua`.
- **Fallback to Wandbox** for languages or configurations not supported locally.

### 8.2 Language Runtime Detection

- **`findCommand(commands: string[])`**
  - Returns the first executable found by `which`.
- Cached runtime commands on startup:
  - `PYTHON_CMD`, `NODE_CMD`, `GCC_CMD`, `GPP_CMD`, `JAVAC_CMD`, `JAVA_CMD`,
    `RUBY_CMD`, `PHP_CMD`, `PERL_CMD`, `RUSTC_CMD`, `GO_CMD`, `SWIFT_CMD`,
    `BASH_CMD`, `ZSH_CMD`, `TSC_CMD` (via `npx`).

### 8.3 Language Config (`getLanguageConfig`)

Maps `language` to:

- File extension (`ext`).
- Interpreter command (`cmd`).
- Argument builder (`args`).
- Optional compilation step (`compile`):
  - `cmd` (compiler).
  - `args(filePath)`.

Examples:

- **Python**
  - `ext: '.py'`, `cmd: PYTHON_CMD`, `args(f) => [f]`.
- **C**
  - `ext: '.c'`.
  - Compile: `GCC_CMD`, `args(f) => [f, '-o', outputBinary, '-lm']`.
  - Run: compiled binary.
- **C++**
  - Similar to C, using `GPP_CMD`.
- **Java**
  - `ext: '.java'`.
  - Compile with `javac`, run with `java -cp tmpDir ClassName`.

### 8.4 Filename Resolution (`resolveFileName`)

Ensures proper filenames per language:

- `java` – uses class name extracted from `public class X` or `class X`.
- `kotlin` – `X.kt` for `class X`, else `main.kt`.
- `go` – uses `main.go` and checks for `package main`.
- `rust` – `main.rs`.
- `swift` – `main.swift`.
- `c` – `main.c`.
- `cpp` – `main.cpp`.
- `python` – `main.py`.
- `typescript` – `main.ts`.
- `javascript` – `main.js`.
- `ruby` – `main.rb`.
- `php` – `main.php`.
- `perl` – `main.pl`.
- `bash` / `shell` / `zsh` – `main.sh`.
- `csharp` – `Program.cs`.
- `scala` – `Main.scala`.
- `r` – `main.r`.
- Default – `main` plus extension from config, if available.

### 8.5 Stdin Detection (`codeNeedsStdin`)

Regex‑based heuristics per language to decide if code likely expects stdin:

- `python` – `input(`, etc.
- `csharp` – `Console.ReadLine`, `Read`, `ReadKey`.
- `java` – `Scanner`, `System.in`, `BufferedReader`.
- `c/cpp` – `scanf`, `gets`, `getchar`, `fgets`, `cin >>`, `getline(cin, ...)`.
- `ruby` – `gets`, `readline`, `STDIN`.
- `go` – `fmt.Scan`, `bufio.NewReader(os.Stdin)`.
- `rust` – `std::io::stdin`, `io::stdin`.
- `php` – `fgets(STDIN)`, `readline`.
- `perl` – `<STDIN>`.
- `swift` – `readLine(`.
- `bash` – `read`.
- `scala` – `scala.io.StdIn`, `readLine`.
- `r` – `readline(`, `scan(`.
- `lua` – `io.read(`.

Used to decide:

- Whether to prompt the frontend for stdin before executing via Wandbox.

### 8.6 WebSocket Execution Engine

- **Server setup**
  - `const server = http.createServer(app);`
  - `const wss = new WebSocket.Server({ server });`

- **Connection Lifecycle**
  - On connection:
    - `activeProcess`, `tmpDir`, `pendingWandbox` are initialized.
  - On **message**:
    - Parse JSON `data`.
    - **Actions**:
      - `kill`:
        - Kills `activeProcess` if running.
      - `input` / `terminal:data`:
        - Writes `data` to `activeProcess`’s stdin (or PTY write).
      - `stdin-ready`:
        - When frontend has collected stdin for Wandbox; triggers pending execution.
      - `execute`:
        - Handles main execution pipeline (see below).

- **Execution Pipeline (`execute` action)**
  1. Validate `language` and `files`.
  2. Create a temp directory (`fs.mkdtempSync`).
  3. Get `initialConfig` from `getLanguageConfig`.
  4. Define `cleanup()` to delete the temp directory.
  5. Define `runViaWandbox(stdinData?)`:
     - Uses `WANDBOX_LANGUAGES[language]` to select compiler.
     - POST to `https://wandbox.org/api/compile.ndjson`.
     - Stream NDJSON events:
       - `StdOut` → `ws.send({ type: 'stdout', data })`.
       - `StdErr` → `ws.send({ type: 'stderr', data })`.
       - `CompilerMessageS` / `CompilerMessageE`, `ExitCode`, `Signal`, etc.
     - On end → send `{ type: 'exit', code }` and `cleanup()`.
  6. If no local command/compile is available:
     - If `stdinInput` already provided → immediate `runViaWandbox(stdinInput)`.
     - Else if `codeNeedsStdin` → set `pendingWandbox` and send `{ type: 'stdin-prompt' }`.
     - Else → `runViaWandbox()`.
  7. Otherwise:
     - Determine `fileName` via `resolveFileName`.
     - Write `code` to the temp file.
     - Recompute `config` with the exact `filePath`.
     - Define `runWithSpawn()`:
       - **Compile step** (if `config.compile` exists):
         - Spawn compiler.
         - Stream its stdout/stderr to WS.
         - Kill on timeout (30s).
       - **Run step**:
         - Determine `runCmd` and `runArgs`.
         - For Python, add `-u` for unbuffered output.
         - Use **Python PTY fallback**:
           - If `PYTHON_CMD` exists, wrap the run command with:
             - `python -c "import pty, sys; sys.exit(pty.spawn([runCmd, ...args]))"`.
           - Ensures interactive echo and line‑buffered output for all languages.
         - Spawn `activeProcess`, attach `stdout`/`stderr` → WS.
         - Apply `stdinInput` if present.
         - Set 60‑second timeout; on close, send `{ type: 'exit', code }`, cleanup, and null out `activeProcess`.
     - Call `runWithSpawn()`.

- **Connection Cleanup**
  - On `close`:
    - Kill `activeProcess` if running.
    - Delete `tmpDir`.
  - On `error`:
    - Log WebSocket errors.

### 8.7 HTTP API Endpoints

#### 8.7.1 AI Chat – `POST /api/ai/chat`

- **Config**
  - `OPENROUTER_API` = `https://openrouter.ai/api/v1/chat/completions`.
  - `OPENROUTER_API_KEY` from `process.env.OPENROUTER_API_KEY` (default hard‑coded dev key present in code; should be overridden in production).
  - `AI_MODELS` – ordered list of free models:
    - `google/gemini-2.0-flash-exp:free`.
    - `meta-llama/llama-3.3-70b-instruct:free`.
    - `nvidia/nemotron-nano-9b-v2:free`.
    - `liquid/lfm-2.5-1.2b-instruct:free`.
    - `mistralai/mistral-small-3.1-24b-instruct:free`.
    - `qwen/qwen3-coder:free`.
- **Request Body**
  - `{ "messages": [{ "role": string, "content": string }...], "model"?: string }`.
- **Behavior**
  - Builds a list of models to try (user‑provided model or default list).
  - For each model:
    - Sends a POST request with:
      - `Authorization: Bearer <OPENROUTER_API_KEY>`.
      - `HTTP-Referer` and `X-Title` headers for OpenRouter metadata.
    - On success (`response.ok`) → returns JSON immediately.
    - On failure → logs and moves to the next model.
  - If all models fail:
    - Returns HTTP 500 with:
      - `{ error: 'All AI models failed', details: <last error text> }`.

#### 8.7.2 Runtimes – `GET /api/runtimes`

- Outputs a list of **locally detected language runtimes**:
  - Each entry: `{ language, runtime, version: '*' }`.
- Uses cached detection results (e.g., `python`, `javascript`, `typescript`, `c`, `cpp`, `java`, `ruby`, `php`, `perl`, `rust`, `go`, `swift`, `bash`, `csharp`, `scala`, `r`, `lua`).

#### 8.7.3 HTTP Execution – `POST /execute`

- **Purpose**
  - Non‑interactive execution used for diagnostics or simple runs (no streaming).
- **Request Body**
  - `{ language, files: [{ content }], stdin? }`.
- **Behavior**
  - Very similar to the WebSocket pipeline but:
    - Aggregates stdout/stderr.
    - Returns once execution completes (or times out).
    - Supports both local execution and Wandbox fallback.
  - Returns:
    - `{ run: { stdout, stderr, code } }`.

### 8.8 Server Startup

- Listens on **port 3001**:
  - Both HTTP endpoints and WebSocket server share this port.
- Logs a message when ready:
  - `🚀 Code execution WebSocket & API server running on port 3001`.

---

## 9. Configuration & Environment

### 9.1 `package.json`

- **Scripts**
  - `dev` – `concurrently "npm run server" "vite"`.
  - `server` – `node server/index.cjs`.
  - `build` – `tsc -b && vite build`.
  - `lint` – `eslint .`.
  - `preview` – `vite preview`.
- **Key Dependencies**
  - Frontend:
    - `react`, `react-dom`, `@monaco-editor/react`, `xterm`, xterm addons.
    - `tailwind-merge`, `framer-motion`, `lucide-react`.
    - `react-markdown`, `remark-gfm`, `rehype-raw`, `clsx`.
    - `groq-sdk`.
  - Backend:
    - `express`, `cors`, `ws`.
    - `node-pty` is present but the main execution path uses child processes plus Python PTY for better buffering.
  - Tooling:
    - `vite`, `typescript`, `eslint` + plugins.
    - `tailwindcss`, `postcss`, `autoprefixer`.
    - `concurrently`.

### 9.2 Environment Variables

- **Frontend**
  - `VITE_GROQ_API_KEY` – Groq API key for `groqService`.
- **Backend**
  - `OPENROUTER_API_KEY` – OpenRouter key for `/api/ai/chat`.
- **System**
  - Standard OS‑level compilers/interpreters (python, node, gcc, g++, javac, etc.) should be available in `PATH` to enable local execution.

---

## 10. Running the Project

### 10.1 Development

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Set environment variables**

   Create a `.env` file with at least:

   ```bash
   OPENROUTER_API_KEY=your_openrouter_key_here
   VITE_GROQ_API_KEY=your_groq_key_here
   ```

3. **Start dev server**

   ```bash
   npm run dev
   ```

   - Runs:
     - Backend on `http://localhost:3001` (Express + WebSocket).
     - Vite dev server on `http://localhost:5173`.

4. **Open the app**

   - Navigate to `http://localhost:5173` in your browser.

### 10.2 Build & Preview

```bash
npm run build
npm run preview
```

---

## 11. Feature Summary

- **Virtual File System**
  - Tree view with full CRUD, multi‑select, rename, duplicate, cut/copy/paste.
  - Persistent across sessions via `localStorage`.
- **Monaco Editor**
  - Syntax highlighting, diagnostics, code formatting.
  - AI‑powered inline completions.
  - `///` smart commands for `fix`, `explain`, `generate`, and more.
  - Integrated “Run” button bound to the terminal.
- **AI Assistant**
  - Chat interface (right panel) with context‑aware responses.
  - Powered by Groq (frontend tools) and OpenRouter (backend proxy).
- **Terminal & Execution**
  - xterm.js terminal with mock shell + real code execution.
  - WebSocket pipeline to `server/index.cjs`.
  - Supports multiple languages locally; falls back to Wandbox when needed.
  - Stdin collection for interactive programs.
- **Code Ageing & Analysis**
  - Static analysis (complexity, maintainability, smells, hotspots).
  - Ageing score & grade with visualizations and actionable recommendations.
  - Some auto‑fixes via deterministic transforms or AI calls.
- **Persistence**
  - File tree, file contents, layout preferences, and chat history are persisted locally.

---

This `FULL_DOCUMENTATION.md` is intended as the canonical, up‑to‑date reference for developers working on or integrating with the AI Code Editor project.

