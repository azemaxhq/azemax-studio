# Server Documentation

The backend server (`server/index.cjs`) is a lightweight Node.js/Express application that acts as a proxy and orchestrator for external APIs. It runs on port 3001 by default.

## API Endpoints

### 1. AI Chat (`POST /api/ai/chat`)
Handles chat completion requests using OpenRouter (with fallback to free models).

-   **Request Body**:
    ```json
    {
      "messages": [{ "role": "user", "content": "..." }],
      "model": "optional-model-id"
    }
    ```
-   **Features**:
    -   **Model Fallback**: Automatically tries a list of free models (Gemini 2.0 Flash, Llama 3.3, etc.) if the primary one fails.
    -   **Proxy**: Hides API keys and manages headers for OpenRouter.

### 2. Code Execution (`POST /api/execute`)
Proxies code execution requests to the [Piston API](https://github.com/engineer-man/piston).

-   **Request Body**:
    ```json
    {
      "language": "python",
      "version": "*",
      "files": [{ "content": "print('hello')" }],
      "stdin": "",
      "run_timeout": 3000
    }
    ```
-   **Security**: Runs code in isolated Piston containers (if hosted correctly).

### 3. Runtimes (`GET /api/runtimes`)
Fetches the list of supported languages and versions from Piston.

## Configuration
-   **Port**: 3001
-   **CORS**: Enabled for all origins (development mode).
-   **Environment Variables**:
    -   `OPENROUTER_API_KEY`: Required for AI features.
