# Azemax — Fast, intelligent developer environment

A browser-based IDE with Monaco, AI streaming, code execution, and interactive terminal.
Signed-in accounts sync their workspace, settings, and AI chat history across devices.

## Quick Start

### Prerequisites
- Node.js 22 LTS (see `.nvmrc`) — also works on 18+
- npm
- A Firebase project with **Email/Password** and (optionally) **Google** sign-in enabled

### Local Development

```bash
npm install
cp .env.example .env
# 1. Add at least one AI key (NVIDIA_API_KEY recommended)
# 2. Add the Firebase Admin service-account values and the Firebase Web SDK config
npm run dev
```

This starts the API on **http://localhost:3001** and the UI on **http://localhost:5173** (Vite proxies `/api` → backend).

Open [http://localhost:5173](http://localhost:5173). The IDE lives at `/app` and requires sign-in.

> The app fails closed. If Firebase is not configured, the sign-in screen still
> renders but no account can be created or used, and the workspace stays locked.
> There is no guest mode or auth-bypass flag.

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + Vite together (concurrently + wait-on) |
| `npm run server` | API only (`node --watch server/index.cjs`) |
| `npm start` | Production API (`node server/index.cjs`) — respects `PORT`/`HOST` |
| `npm run build` | Typecheck + Vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | `vitest run` (jsdom) |
| `npm run test:e2e:auth` | Fail-closed auth E2E (no live Firebase needed) |
| `npx playwright test` | Editor E2E (authenticated specs skip without real credentials) |

## Firebase Setup

Firebase Authentication is the **only** identity provider. The app does not
store passwords, issue session cookies, or mint its own tokens.

1. Create a Firebase project.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains**: add `localhost` and every
   production domain (for example `your-frontend.vercel.app`). Email actions use
   `<origin>/login` as the continue URL, so the origin must be authorized.
4. **Project settings → Your apps → Web app**: copy the `firebaseConfig` values
   into the `VITE_FIREBASE_*` variables.
5. **Project settings → Service accounts → Generate new private key**: copy
   `project_id`, `client_email`, and `private_key` into the backend variables.

The `VITE_FIREBASE_*` web config is public by design. The service-account
values are server-only secrets and must never be prefixed with `VITE_`.

## Environment Variables

### Public (Vite — safe for browser)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api` (dev) | Browser → API base. **Production:** set to `https://YOUR-BACKEND.onrender.com/api` |
| `VITE_USE_BACKEND_AI` | `true` | When `true`, AI goes via `/api/ai/*` (keys stay server-side) |
| `VITE_WS_URL` | *(derived)* | Override WebSocket URL. If omitted, derived from `VITE_API_URL` (`https`→`wss`) |
| `VITE_WS_PORT` | `3001` | Dev only |
| `VITE_FIREBASE_API_KEY` | — | Firebase Web SDK API key (required for sign-in) |
| `VITE_FIREBASE_AUTH_DOMAIN` | — | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | — | Firebase project ID (required for sign-in) |
| `VITE_FIREBASE_APP_ID` | — | Firebase web app ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | — | Optional |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | — | Optional |

> Do NOT set `VITE_GROQ_API_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_HF_TOKEN` in production — the server must hold provider keys.

### Server-only (never `VITE_`)

| Variable | Example | Description |
|----------|---------|-------------|
| `PORT` | `3001` dev / `10000` Render | Server listen port (`process.env.PORT` with fallback) |
| `HOST` | `0.0.0.0` prod | Bind host (defaults to `0.0.0.0` in production) |
| `NODE_ENV` | `production` | Set to `production` on Render |
| `CORS_ORIGIN` | `https://app.vercel.app` | Comma-separated allowed origins (no `*` with credentials) |
| `FIREBASE_PROJECT_ID` | `azemax-1234` | Firebase project ID — **required in production** |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-…@…iam.gserviceaccount.com` | Service-account email — **required in production** |
| `FIREBASE_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\n…"` | Service-account key with `\n` escapes — **required in production** |
| `NVIDIA_API_KEY` | — | Primary AI provider |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | — |
| `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | — |
| `GROQ_API_KEY` | — | Fallback provider |
| `OPENROUTER_API_KEY` | — | Fallback provider |
| `HF_TOKEN` | — | Fallback provider |
| `KILO_API_KEY` | — | Fallback provider |
| `ADMIN_EMAILS` | `you@example.com` | Comma-separated admin allowlist |
| `ALLOW_LOCAL_EXECUTION` | `false` in prod | When `false`, `/api/execute` uses Wandbox sandbox (no host execution). `true` is fatal in production. |
| `ALLOW_SHELL` | `false` in prod | When `false`, interactive shell `kind:shell` is disabled (code Run still works). `true` is fatal in production. |
| `MAX_CODE_BYTES` | `204800` | Max code payload |
| `MAX_STDIN_BYTES` | `32768` | Max stdin |
| `MAX_OUTPUT_BYTES` | `524288` | Max captured output |
| `MAX_WORKSPACE_BYTES` | `2097152` | Max project JSON |

See `.env.example` (development) and `.env.production.example` (hosting).

## Production Architecture

```
Browser (Vercel static: dist/)
  │  Firebase Web SDK → ID token (in memory)
  │  Authorization: Bearer <idToken>
  │  VITE_API_URL=https://<backend>/api  →  HTTPS
  │  WSS derived from VITE_API_URL (?token=<idToken>)
  ▼
Express API (Render: node server/index.cjs)
  ├─ verifies the Firebase ID token on every protected request (Admin SDK)
  ├─ GET  /api/health              (public, no secrets)
  ├─ POST /api/auth/sync           (verify token, upsert app user)
  ├─ POST /api/ai/chat (SSE)       (verified email; server holds provider keys)
  ├─ POST /api/execute / GET /api/runtimes   (verified email; Wandbox in prod)
  ├─ /api/projects/*               (verified email; ownership-scoped workspace sync)
  ├─ /api/account/state/*          (verified email; settings + AI chat sync)
  └─ WebSocket (ws) — token at handshake; code sessions + shell (shell off in prod)
         └─ Wandbox (remote sandbox) when ALLOW_LOCAL_EXECUTION=false
```

**Build/deploy separation:** frontend is a static Vite build (`dist/`); backend is a persistent Node process. They are deployed separately.

## Deploy Frontend → Vercel

1. Push to GitHub.
2. Import project in Vercel → Framework: **Vite** → Build: `npm run build` → Output: `dist`.
3. Set Environment Variables (Production):
   - `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api`
   - `VITE_USE_BACKEND_AI=true`
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
   - Do NOT add any `VITE_*_API_KEY` provider keys or Firebase service-account values.
4. Deploy. `vercel.json` handles SPA fallback (`/app` → `index.html`) and asset caching.

Vite inlines `VITE_*` values at build time — changing them requires a redeploy.
Add the Vercel domain to Firebase → Authentication → Settings → Authorized domains.

## Deploy Backend → Render

`render.yaml` is included for one-click deploy. Or manually:

1. Create **Web Service** → Connect GitHub repo → Runtime **Node** → Region near users.
2. Build: `npm ci`   Start: `npm start`   Health check: `/api/health`
3. Environment:
   - `NODE_ENV=production`, `PORT=10000` (Render assigns), `HOST=0.0.0.0`
   - `CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app` (exact origin, comma-separate if needed)
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — **required**
   - `NVIDIA_API_KEY` (and optionally `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `KILO_API_KEY`)
   - `ALLOW_LOCAL_EXECUTION=false`, `ALLOW_SHELL=false`
4. Deploy. Render proxies HTTPS → your `0.0.0.0:10000` and WSS → same.

> **Fail-closed:** Render will exit at startup if Firebase Admin cannot be
> configured. This is intentional — the API must never serve product routes
> without a verifiable identity provider. Check the deploy logs for
> `[FATAL] Refusing to start: Firebase Admin is not configured`.

## Authentication Behavior

- `/app` and every product API require a signed-in user whose email Firebase
  reports as verified.
- Email/password sign-ups receive a Firebase verification email. Until the
  address is verified, the user sees the verification pane; AI, execution,
  projects, and terminal sessions return 403.
- Google sign-ins are treated as verified because Google asserts the address.
- Sign-in state survives reloads through Firebase's own persistence. The ID
  token is held in memory and refreshed by the SDK; it is never written to
  localStorage or a cookie.
- Sign-out calls Firebase `signOut()` and clears the in-memory credential. The
  server holds no session, so `/api/auth/logout` is only an acknowledgement.
- There is no guest mode, anonymous access, shared beta identity, or
  `DISABLE_AUTH` / `PUBLIC_BETA` switch.

## WebSocket Configuration

- Dev: `ws://localhost:3001` (Vite proxies `/api`, direct WS to backend)
- Prod: `wss://<backend-host>` — derived automatically from `VITE_API_URL` (`https`→`wss`, host reused, no extra port needed)
- Override: set `VITE_WS_URL=wss://custom-host` if backend WS is on a different domain.
- The client appends `?token=<idToken>`; the server rejects unauthenticated
  (4401) and unverified (4403) handshakes.

## AI Provider Configuration

At least one server key must be set or `/api/ai/chat` returns `AI_PROVIDER_CONFIG_ERROR` (frontend shows setup hint).

| Priority | Provider | Env var | Model example |
|----------|----------|---------|---------------|
| 1 (primary) | NVIDIA | `NVIDIA_API_KEY` | `nvidia/nemotron-3-super-120b-a12b` |
| 2 | Groq | `GROQ_API_KEY` | `qwen/qwen3.8-27b` |
| 3 | OpenRouter | `OPENROUTER_API_KEY` | `nvidia/nemotron-3-super-120b-a12b:free` |
| 4 | HuggingFace | `HF_TOKEN` | `deepseek-ai/DeepSeek-R1:novita` |
| 5 | Kilo Code | `KILO_API_KEY` | `nemotron-3-super` |

Abuse protection: authentication required, ≤50 messages, ≤20k chars/message, ≤100k total, `1mb` JSON limit, rate-limited per user, per-attempt timeouts (15–60 s), fallback → controlled error (no crash), abort drains upstream.

## Code Execution Security

- **Production:** `ALLOW_LOCAL_EXECUTION=false` → all `/api/execute` and terminal code runs go through **Wandbox sandbox** (no host `spawn`). Host `localExecutor` is skipped even if runtimes exist.
- **Interactive shell** (`kind:shell`, PTY via `ptyRelay.py`) is **disabled in production by default** — returns a clean "shell unavailable, Run still works" message. Set `ALLOW_SHELL=true` only if your host supports persistent PTY.
- **Local dev:** full local execution + PTY (Node/Python/C++/Java/… via `runtimeDetection.cjs`).
- Limits: `MAX_CODE_BYTES` 200 KB, `MAX_STDIN_BYTES` 32 KB, `MAX_OUTPUT_BYTES` 512 KB, `EXECUTION_TIMEOUT_MS` 60 s, `COMPILE_TIMEOUT_MS` 30 s, per-user session caps, heartbeat/idle reaping, SIGKILL on timeout, temp dirs cleaned up, path-traversal guards, minimal env (`PATH`, `HOME`, `TERM`, etc.).

## Free Tier Limitations

Be honest with testers:

- **Ephemeral filesystem:** `data/workspaces/` lives on the Render instance disk and is lost on redeploy/restart. Server persistence is best-effort; export/keep local copies of important work.
- **Cold starts:** Render free tier sleeps after inactivity (~30–60 s spin-up).
- **CPU/RAM:** Limited; large compiles may time out. Output truncated at 512 KB.
- **Terminal:** interactive shell disabled in production; `Run` (Wandbox) is the execution path.
- **WebSocket:** Render supports WSS on free tier (persistent Node), but long-idle sockets may be pruned by the proxy.
- **AI quotas:** provider rate limits apply; health-gated fallback may skip sick providers briefly.
- **Wandbox:** third-party sandbox; occasional latency/availability variance.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Firebase Authentication is not configured on this deployment` | Set `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` (plus the rest of the web config), then **redeploy** — Vite bakes them in at build time. |
| Render exits with `[FATAL] Refusing to start: Firebase Admin is not configured` | Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on Render. Keep the `\n` escapes in the private key. |
| `Invalid email or password` / sign-in fails | Check that Email/Password is enabled in Firebase and the account exists. Firebase owns credentials; the app has no local password database. |
| `This domain is not authorized for sign-in emails` | Add the deployment origin to Firebase → Authentication → Settings → Authorized domains. |
| Verification email never arrives | Check spam, confirm the authorized domain, then use **Resend verification email** (60 s cooldown). The UI reports send failures instead of pretending success. |
| `Email verification required` (403) | Verify the address via the emailed link, then press **I've verified my email**. Google accounts are verified automatically. |
| Signed in but API returns 401 | The backend rejected the ID token. Confirm the frontend and backend use the same Firebase project, and that `CORS_ORIGIN` exactly matches the frontend origin. |
| `Cannot reach the API server` | Backend asleep, wrong `VITE_API_URL`, or CORS blocked. Set Render `CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app` (exact origin, no trailing `/`). |
| `API misconfigured` (HTML instead of JSON) | `VITE_API_URL` must end in `/api` and point at the live backend. Redeploy after changing it. |
| `VITE_ provider keys detected in production … ignoring` | Remove `VITE_*` provider keys from Render env; set `GROQ_API_KEY` etc. |
| CORS error `Access-Control-Allow-Origin` | Ensure `CORS_ORIGIN` exactly matches your Vercel URL (no trailing `/`), comma-no-space. |
| `ws` fails in production | Check `VITE_API_URL` is `https://.../api` (not `http`) and backend `HOST=0.0.0.0 PORT=10000`. WebSocket auth requires a valid ID token; sign in first. |
| `AI_PROVIDER_CONFIG_ERROR` | Set at least one `*_API_KEY` on Render and redeploy. |
| `shell unavailable` message | Expected in production (`ALLOW_SHELL=false`). Use `Run`. |
| `Workspace too large` 413 | Reduce project tree or raise `MAX_WORKSPACE_BYTES`. |
| Health shows `localExecution:false` | Expected in production; execution still works via Wandbox. |
| Port `3001` in use locally | `lsof -iTCP:3001 -sTCP:LISTEN` → `kill <pid>` or let `lifecycle.cjs` reclaim on restart. |

## Documentation

- [Authentication](docs/AUTHENTICATION.md) — Firebase-only model, flows, security properties
- [Services & Utilities](docs/SERVICES.md) — AI, execution, analysis
- [Context & State](docs/CONTEXT.md) — Store + context
- [Components](docs/COMPONENTS.md) — Editor, layout, panels
- [Server](docs/SERVER.md) — Backend routes + WebSocket
- [Security Audit](SECURITY_AUDIT_REPORT.md) — Current security posture
