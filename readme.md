# Azemax — Fast, intelligent developer environment

A browser-based IDE with Monaco, AI streaming, code execution, and interactive terminal.

## Quick Start

### Prerequisites
- Node.js 22 LTS (see `.nvmrc`) — also works on 18+
- npm

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env and add at least one AI key (NVIDIA_API_KEY recommended)
npm run dev
```

This starts the API on **http://localhost:3001** and the UI on **http://localhost:5173** (Vite proxies `/api` → backend).

Open [http://localhost:5173](http://localhost:5173). The IDE lives at `/app`.

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + Vite together (concurrently + wait-on) |
| `npm run server` | API only (`node --watch server/index.cjs`) |
| `npm start` | Production API (`node server/index.cjs`) — respects `PORT`/`HOST` |
| `npm run build` | Typecheck + Vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | `vitest run` (jsdom) |
| `npx playwright test` | E2E (requires dev servers) |

## Environment Variables

### Public (Vite — safe for browser)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api` (dev) | Browser → API base. **Production:** set to `https://YOUR-BACKEND.onrender.com/api` |
| `VITE_USE_BACKEND_AI` | `true` | When `true`, AI goes via `/api/ai/*` (keys stay server-side) |
| `VITE_WS_URL` | *(derived)* | Override WebSocket URL. If omitted, derived from `VITE_API_URL` (`https`→`wss`) |
| `VITE_WS_PORT` | `3001` | Dev only |

> Do NOT set `VITE_GROQ_API_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_HF_TOKEN` in production — the server must hold provider keys.

### Server-only (never `VITE_`)

| Variable | Example | Description |
|----------|---------|-------------|
| `PORT` | `3001` dev / `10000` Render | Server listen port (`process.env.PORT` with fallback) |
| `HOST` | `0.0.0.0` prod | Bind host (defaults to `0.0.0.0` in production) |
| `NODE_ENV` | `production` | Set to `production` on Render |
| `CORS_ORIGIN` | `https://app.vercel.app` | Comma-separated allowed origins (no `*` with credentials) |
| `NVIDIA_API_KEY` | — | Primary AI provider |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | — |
| `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | — |
| `GROQ_API_KEY` | — | Fallback provider |
| `OPENROUTER_API_KEY` | — | Fallback provider |
| `HF_TOKEN` | — | Fallback provider |
| `KILO_API_KEY` | — | Fallback provider |
| `ALLOW_LOCAL_EXECUTION` | `false` in prod | When `false`, `/api/execute` uses Wandbox sandbox (no host execution) |
| `ALLOW_SHELL` | `false` in prod | When `false`, interactive shell `kind:shell` is disabled (code Run still works) |
| `MAX_CODE_BYTES` | `204800` | Max code payload (beta guard) |
| `MAX_STDIN_BYTES` | `32768` | Max stdin |
| `MAX_OUTPUT_BYTES` | `524288` | Max captured output |
| `MAX_WORKSPACE_BYTES` | `2097152` | Max project JSON |

See `.env.example` (development) and `.env.production.example` (hosting).

## Production Architecture

```
Browser (Vercel static: dist/)
  │  VITE_API_URL=https://<backend>/api  →  HTTPS
  │  WSS derived from VITE_API_URL
  ▼
Express API (Render: node server/index.cjs)
  ├─ GET  /api/health              (no secrets, no paths)
  ├─ POST /api/ai/chat (SSE)       (server holds provider keys, streams with fallback)
  ├─ POST /api/execute / GET /api/runtimes   (Wandbox sandbox in prod)
  ├─ /api/projects/*               (size-limited, path-traversal guarded)
  └─ WebSocket (ws) — code execution sessions + shell (shell disabled in prod)
         └─ Wandbox (remote sandbox) when ALLOW_LOCAL_EXECUTION=false
```

**Build/deploy separation:** frontend is a static Vite build (`dist/`); backend is a persistent Node process. They are deployed separately.

## Deploy Frontend → Vercel

1. Push to GitHub.
2. Import project in Vercel → Framework: **Vite** → Build: `npm run build` → Output: `dist`.
3. Set Environment Variables (Production):
   - `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api`
   - `VITE_USE_BACKEND_AI=true`
   - Do NOT add any `VITE_*_API_KEY` keys.
4. Deploy. `vercel.json` handles SPA fallback (`/app` → `index.html`) and asset caching.

## Deploy Backend → Render

`render.yaml` is included for one-click deploy. Or manually:

1. Create **Web Service** → Connect GitHub repo → Runtime **Node** → Region near users.
2. Build: `npm ci`   Start: `npm start`   Health check: `/api/health`
3. Environment:
   - `NODE_ENV=production`, `PORT=10000` (Render assigns), `HOST=0.0.0.0`
   - `CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app` (exact origin, comma-separate if needed)
   - `NVIDIA_API_KEY` (and optionally `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `KILO_API_KEY`)
   - `ALLOW_LOCAL_EXECUTION=false`, `ALLOW_SHELL=false`
4. Deploy. Render proxies HTTPS → your `0.0.0.0:10000` and WSS → same.

## Public Beta Without Login

To remove the login page completely for public beta testing (reversible):

1. **Render (backend) dashboard → Environment**, set **both** and redeploy:
   - `DISABLE_AUTH=true`
   - `ALLOW_PUBLIC_BYPASS=true` (explicit acknowledgement — without it the server refuses to boot in production)
2. **Vercel (frontend) → Environment Variables**, set and redeploy:
   - `VITE_DISABLE_AUTH=true` (build-time flag — requires redeploy)
   - `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api` (must point at the live backend, or AI/execution fail)
3. Open `/app` — the workspace loads immediately with no login UI.

> **Warning:** every visitor shares ONE identity (`local-dev`). All projects, AI quota, and execution are shared; anyone can read, overwrite, or delete anything. Free-tier disks also wipe on redeploy. Use only for a throwaway beta.
>
> **Restore login:** unset `DISABLE_AUTH` + `ALLOW_PUBLIC_BYPASS` on Render and `VITE_DISABLE_AUTH` on Vercel, redeploy both. Real accounts in `data/azemax.db` and auth code are untouched.

## WebSocket Configuration

- Dev: `ws://localhost:3001` (Vite proxies `/api`, direct WS to backend)
- Prod: `wss://<backend-host>` — derived automatically from `VITE_API_URL` (`https`→`wss`, host reused, no extra port needed)
- Override: set `VITE_WS_URL=wss://custom-host` if backend WS is on a different domain.

## AI Provider Configuration

At least one server key must be set or `/api/ai/chat` returns `AI_PROVIDER_CONFIG_ERROR` (frontend shows setup hint).

| Priority | Provider | Env var | Model example |
|----------|----------|---------|---------------|
| 1 (primary) | NVIDIA | `NVIDIA_API_KEY` | `nvidia/nemotron-3-super-120b-a12b` |
| 2 | Groq | `GROQ_API_KEY` | `qwen/qwen3.8-27b` |
| 3 | OpenRouter | `OPENROUTER_API_KEY` | `nvidia/nemotron-3-super-120b-a12b:free` |
| 4 | HuggingFace | `HF_TOKEN` | `deepseek-ai/DeepSeek-R1:novita` |
| 5 | Kilo Code | `KILO_API_KEY` | `nemotron-3-super` |

Abuse protection: ≤50 messages, ≤20k chars/message, ≤100k total, `1mb` JSON limit, rate-limited (200/15 min), per-attempt timeouts (15–60 s), fallback → controlled error (no crash), abort drains upstream.

## Code Execution Security (Beta)

- **Production:** `ALLOW_LOCAL_EXECUTION=false` → all `/api/execute` and terminal code runs go through **Wandbox sandbox** (no host `spawn`). Host `localExecutor` is skipped even if runtimes exist.
- **Interactive shell** (`kind:shell`, PTY via `ptyRelay.py`) is **disabled in production by default** — returns a clean "shell unavailable, Run still works" message. Set `ALLOW_SHELL=true` only if your host supports persistent PTY.
- **Local dev:** full local execution + PTY (Node/Python/C++/Java/… via `runtimeDetection.cjs`).
- Limits: `MAX_CODE_BYTES` 200 KB, `MAX_STDIN_BYTES` 32 KB, `MAX_OUTPUT_BYTES` 512 KB, `EXECUTION_TIMEOUT_MS` 60 s, `COMPILE_TIMEOUT_MS` 30 s, 50 concurrent terminal sessions, GC every 30 s, SIGKILL on timeout, temp dirs cleaned up, path-traversal guards, minimal env (`PATH`, `HOME`, `TERM`, etc.).

## Free Beta Limitations

Be honest with testers:

- **Ephemeral filesystem:** `data/workspaces/` lives on the Render instance disk and is lost on redeploy/restart. Browser `localStorage` is primary; server persistence is best-effort.
- **Cold starts:** Render free tier sleeps after inactivity (~30–60 s spin-up).
- **CPU/RAM:** Limited; large compiles may time out. Output truncated at 512 KB.
- **Terminal:** interactive shell disabled in beta; `Run` (Wandbox) is the execution path.
- **WebSocket:** Render supports WSS on free tier (persistent Node), but long-idle sockets may be pruned by the proxy.
- **AI quotas:** provider rate limits apply; health-gated fallback may skip sick providers briefly.
- **Wandbox:** third-party sandbox; occasional latency/availability variance.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login/signup stuck or `Login failed` on Vercel beta | Checklist: 1) Render backend deployed & awake (free tier cold-starts ~60s — open `<backend>/api/health`, expect `{"status":"ok"}`). 2) Vercel env `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api` set **at build time** (redeploy after changing — Vite bakes it in). The app now says `API misconfigured` outright when the API returns a page instead of JSON. |
| `Cannot reach the API server` on login | Backend asleep, wrong `VITE_API_URL`, or CORS blocked. Set Render `CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app` (exact origin, no trailing `/`). |
| Logged out after every reload (Safari/Brave) | Third-party-cookie blocking drops the session cookie. The app now falls back to a Bearer token automatically (stored in `localStorage`, revocable via logout). If it persists, allow cookies for the backend host or use Chrome/Edge. |
| `Invalid email or password` right after a Render redeploy | Expected on free tier: `data/azemax.db` lives on the instance disk and is wiped on redeploy/restart. Recreate the account via `Create an account`. Browser `localStorage` caches are per-user and survive. |
| `VITE_ provider keys detected in production … ignoring` | Remove `VITE_*` keys from Render env; set `GROQ_API_KEY` etc. |
| CORS error `Access-Control-Allow-Origin` | Ensure `CORS_ORIGIN` exactly matches your Vercel URL (no trailing `/`), comma-no-space. |
| `ws` fails in production | Check `VITE_API_URL` is `https://.../api` (not `http`) and backend `HOST=0.0.0.0 PORT=10000`. |
| `AI_PROVIDER_CONFIG_ERROR` | Set at least one `*_API_KEY` on Render and redeploy. |
| `shell unavailable` message | Expected in beta (`ALLOW_SHELL=false`). Use `Run` or set `ALLOW_SHELL=true` on a host with PTY. |
| `Workspace too large` 413 | Reduce project tree or raise `MAX_WORKSPACE_BYTES`. |
| Health shows `localExecution:false` | Expected in production; execution still works via Wandbox. |
| Port `3001` in use locally | `lsof -iTCP:3001 -sTCP:LISTEN` → `kill <pid>` or let `lifecycle.cjs` reclaim on restart. |

## Documentation

- [Services & Utilities](docs/SERVICES.md) — AI, execution, analysis
- [Context & State](docs/CONTEXT.md) — Store + context
- [Components](docs/COMPONENTS.md) — Editor, layout, panels
- [Server](docs/SERVER.md) — Backend routes + WebSocket

