# AI Code Editor

A modern, web-based IDE with integrated AI capabilities, real-time code execution, and smart suggestions.

## Documentation
Detailed documentation for the project's modules can be found in the `docs` directory:

-   **[Services & Utilities](docs/SERVICES.md)**: AI integration, code execution, and analysis logic.
-   **[Context & State](docs/CONTEXT.md)**: Global state management (File System, Terminal).
-   **[Components](docs/COMPONENTS.md)**: UI component architecture (Editor, Layout, Panels).
-   **[Server](docs/SERVER.md)**: Backend proxy for AI and Code Execution APIs.

## Features
-   **Smart AI Parsing**: Use `/// generate` or `/// fix` directly in comments.
-   **Inline Suggestions**: Ghost text autocompletion using specialized AI models.
-   **Code Execution**: Run code securely in sandboxed containers (JS, Python, C++, etc.).
-   **Diagnostics**: Real-time error detection and linting.
-   **File System**: Virtual file system with create/edit/delete capabilities.

## Setup

### Prerequisites
-   Node.js (v18+)
-   NPM or Yarn

### Installation

1.  Install dependencies for frontend:
    ```bash
    npm install
    ```

2.  Install dependencies for backend:
    ```bash
    cd server
    npm install
    cd ..
    ```

3.  Configure Environment:
    -   Create `.env` in the root (see `.env.example` if available).
    -   Add `VITE_GROQ_API_KEY` and `OPENROUTER_API_KEY`.

### Running the App

1.  Start the Backend Server (Terminals/Execution):
    ```bash
    node server/index.cjs
    ```

2.  Start the Frontend:
    ```bash
    npm run dev
    ```

3.  Open [http://localhost:5173](http://localhost:5173) in your browser.
