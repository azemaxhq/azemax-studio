# Azemax

A modern, fast web-based IDE with integrated AI capabilities, real-time code execution, and smart suggestions.

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

2.  Configure environment:
    ```bash
    cp .env.example .env
    ```
    Set server-side keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN` (see [Server docs](docs/SERVER.md)).

### Running the App

```bash
npm run dev
```

This starts the API on **http://localhost:3001** and the UI on **http://localhost:5173** (Vite proxies `/api` to the backend).

Open [http://localhost:5173](http://localhost:5173) in your browser.

API-only:

```bash
npm run server
```
