# Server Documentation

The backend is a modular Node.js (Express + WebSocket) API in `server/`. It runs on port **3001** by default (`npm run server`).

## Architecture

```
server/
  index.cjs              # Entry: HTTP + WebSocket
  app.cjs                # Express app factory
  config/                # Environment & constants
  routes/                # REST API routers
  services/
    ai/                  # Groq, OpenRouter, HuggingFace proxy
    execution/           # Local + Wandbox code execution
    projects/            # Workspace persistence (data/workspaces/)
  websocket/             # Interactive code execution
  middleware/            # Error handling
```

## API Endpoints

### Public beta access (no login required)

Landing page → **Enter Azemax** → `/app` workspace immediately. Anonymous
visitors get a local-only guest workspace (files persist in browser
localStorage under the `beta-anon` namespace — clearing site data or
switching devices loses it). Sign-in/sign-up stay OPTIONAL (higher quotas).

| Surface | Anonymous | Authenticated |
|---------|-----------|---------------|
| Workspace (edit files, preview) | ✅ local browser | ✅ local browser |
| `POST /api/ai/chat`, `/api/ai/chat/legacy`, `GET /api/ai/models` | ✅ guest quota (`AI_ANON_REQUESTS_PER_DAY`, default 50/day) + per-minute + input/model policy | ✅ full quota (`AI_REQUESTS_PER_DAY`) |
| `POST /api/execute`, `GET /api/runtimes`, WS `code` sessions | ✅ guest quota (`EXEC_ANON_REQUESTS_PER_DAY`, default 60/day) + size/timeout caps | ✅ full quota |
| WS `shell` sessions | ❌ sign-in required | ✅ where `ALLOW_SHELL` |
| `/api/projects/*` (server workspaces) | ❌ 401 (stays login-required) | ✅ own data only |
| `/api/auth/*`, admin | unchanged | unchanged |

Guest identities are server-minted `anon:<ip>` ids (never client-supplied) —
they cannot collide with real user ids, so anonymous traffic is isolated from
private data by construction. Set `PUBLIC_BETA=false` (server) +
`VITE_PUBLIC_BETA=false` (frontend, redeploy) to restore a hard login wall.

### Health — `GET /api/health`

Returns service status and which AI providers are configured.

### AI — `/api/ai/*`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai/models` | List models available on the server |
| POST | `/api/ai/chat` | Chat completion (set `stream: true` for SSE) |

**Chat body:**

```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "model": "llama-3.3-70b-versatile",
  "temperature": 0.7,
  "responseLength": "medium",
  "stream": false
}
```

API keys stay on the server (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`). The frontend uses `/api/ai/chat` by default when `VITE_USE_BACKEND_AI=true`.

### Code execution — `/api/*`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/runtimes` | Locally detected language runtimes |
| POST | `/api/execute` | Run code (local compilers or Wandbox fallback) |

**Execute body:**

```json
{
  "language": "python",
  "files": [{ "content": "print('hello')" }],
  "stdin": ""
}
```

### Projects — `/api/projects/*`

Workspaces are stored as JSON under `data/workspaces/`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List workspaces |
| POST | `/api/projects` | Create workspace `{ name?, tree? }` |
| GET | `/api/projects/:id` | Get workspace |
| PUT | `/api/projects/:id` | Save `{ name?, tree? }` |
| DELETE | `/api/projects/:id` | Delete workspace |

### WebSocket — `ws://localhost:3001`

Interactive execution for the integrated terminal. Messages:

- `{ "action": "execute", "language", "files", "stdinInput?" }`
- `{ "action": "input", "data" }` — send stdin
- `{ "action": "kill" }` — stop process

## Configuration

Copy `.env.example` to `.env` and set API keys (server-side only; do not commit `.env`).

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP/WebSocket port (default `3001`) |
| `CORS_ORIGIN` | Allowed frontend origin |
| `GROQ_API_KEY` | Groq API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `HF_TOKEN` | HuggingFace token |

## Development

```bash
npm run dev   # Vite (5173) + server (3001); /api proxied to backend
```

Or run the server alone:

```bash
npm run server
```
