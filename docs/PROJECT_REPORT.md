# Title
**AI Code Editor & Analyzer **

# Abstract
The AI Code Editor is a next-generation, browser-based Integrated Development Environment (IDE) designed to democratize coding assistance. By integrating advanced Large Language Models (LLMs) directly into the editing workflow, it offers real-time code suggestions, intelligent debugging, and automated refactoring. Unlike traditional text editors, this system understands the context of the user's project, enabling features like "Chat with Codebase" and "Smart Comments" (e.g., `/// fix this function`). The platform includes a secure, sandboxed execution environment that supports multiple programming languages, allowing users to write, run, and test code instantly without local setup.

# Domain
**Software Engineering / Artificial Intelligence**
The project sits at the intersection of Developer Tools (DevTools) and Generative AI, focusing on improving developer productivity and reducing the barrier to entry for coding.

# Front End
The user interface is built as a high-performance Single Page Application (SPA).
-   **Framework**: React (v18) with TypeScript for type-safe, component-based architecture.
-   **Build Tool**: Vite for lightning-fast development server and bundling.
-   **Core Editor**: Monaco Editor (the engine powering VS Code) for a professional coding experience including syntax highlighting and minimaps.
-   **Styling**: Tailwind CSS for responsive, modern UI design with a glassmorphism aesthetic.
-   **Icons**: Lucide React.
-   **State Management**: React Context API for managing the virtual file system and terminal sessions.

# Back End
The backend acts as an orchestrator and proxy layer.
-   **Server Runtime**: Node.js.
-   **Web Framework**: Express.js.
-   **Code Execution Engine**: Piston API (Running in isolated Docker containers) for executing user code safely.
-   **AI Integration**: OpenRouter API configures LLM access (Llama 3, Gemini, etc.) and handles API key security, preventing exposure to the client.

# Output Paper Work
The final output of this project includes:
1.  **Functional Web Application**: A strictly typed, deployable web app accessible via browser.
2.  **Integrated Terminal**: A working simulation of a command-line interface that outputs execution results.
3.  **Documentation Suite**: Comprehensive technical documentation covering architecture, API endpoints, and component hierarchy.
4.  **Virtual File System**: A persistent emulation of a file tree allowing file creation, deletion, and editing within the browser storage.

# Modules List
The system is divided into four primary modules:

1.  **Module 1: Services & Utilities**
    -   AI Comment Service (Smart `///` commands)
    -   Code Execution Service (Piston integration)
    -   Diagnostics Service (Error detection)

2.  **Module 2: State Management**
    -   Project Context (File System state)
    -   Terminal Context (Session state)

3.  **Module 3: Visual Components**
    -   Main Layout & Sidebar
    -   Code Editor (Monaco wrapper)
    -   AI Assistant Panel & Terminal Panel

4.  **Module 4: Backend Server**
    -   Express Proxy
    -   AI Chat Endpoint
    -   Code Execution Endpoint
