# Server Documentation

The backend is a modular Node.js (Express + WebSocket) API in `server/`. It runs on port **3001** by default (`npm run server`).

## Architecture

```
server/
  index.cjs              # Entry: HTTP + WebSocket; production auth fail-closed check
  app.cjs                # Express app factory, security headers, rate limits
  config/                # Environment, limits, provider configuration
  routes/                # REST API routers
  middleware/            # Auth, error handling, request IDs
  services/
    ai/                  # AI provider proxy + policy
    auth/                # Firebase Admin verification + app user sync
    execution/           # Local + Wandbox code execution
    terminal/            # Terminal session manager (PTY)
    projects/            # Workspace persistence (data/workspaces/)
    account/             # Account-scoped synced documents (settings, chats)
  websocket/             # Interactive code execution
```

## Authentication and authorization

Firebase Authentication is the only identity provider. Every product route
requires a Firebase ID token sent as `Authorization: Bearer <idToken>`. The
server verifies it with the Firebase Admin SDK on every request; identity is
never taken from the request body, query string, or client storage.

There is no guest mode, anonymous identity, local password database, server
session, session cookie, or auth-bypass flag.

| Gate | Applied to | Result |
|------|-----------|--------|
| `requireAuth` | `/api/auth/me` | 401 without a valid ID token |
| `requireVerifiedEmail` | `/api/ai/*`, `/api/execute`, `/api/runtimes`, `/api/projects/*`, `/api/account/*` | 401 unauthenticated, 403 `auth/unverified-email` |
| `requireAdmin` | Admin routes, when mounted (none currently) | 401 unauthenticated, 403 non-admin |
| WS handshake token | Terminal WebSocket | 4401 unauthenticated, 4403 unverified / forbidden origin |
| none | `GET /api/health`, `POST /api/auth/sync`, `POST /api/auth/logout` | Public by design (sync still verifies the token) |

**Fail closed:** in production the server refuses to boot when Firebase Admin
cannot be configured (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, or application default credentials). In development it
boots without credentials, but no token can be verified, so `/api/auth/sync`
returns 503 and every protected route returns 401. Missing configuration never
grants access.

See [AUTHENTICATION.md](AUTHENTICATION.md) for the full model, flows, and
client configuration.

### Health — `GET /api/health`

Returns service status and which AI providers are configured. Public; contains
no secrets or filesystem paths.

### Authentication — `/api/auth/*`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/sync` | Verify a Firebase ID token (body `idToken` or Bearer header), upsert the app user, return `{ user }`. 400 missing token, 401 invalid/expired, 409 unsafe email link, 503 provider unconfigured. |
| GET | `/api/auth/me` | Current app user. Requires a valid Bearer ID token. |
| POST | `/api/auth/logout` | Acknowledgement only (`{ ok: true }`). The server holds no session; Firebase client sign-out discards the credential. |

Email/password and Google credentials are handled by the Firebase Web SDK in
the browser. There are no server-side login, sign-up, or password endpoints.

### AI — `/api/ai/*`

Requires a verified email.

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

API keys stay on the server (`NVIDIA_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`, `HF_TOKEN`, `KILO_API_KEY`). Model allowlists, message/
token caps, and daily quotas are enforced server-side. The frontend uses
`/api/ai/chat` when `VITE_USE_BACKEND_AI=true`.

### Code execution — `/api/*`

Requires a verified email.

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

Requires a verified email. Every operation is scoped to `req.user.id`; a
project owned by another user is reported as not found. Workspaces are stored
as JSON under `data/workspaces/`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List the caller's workspaces |
| POST | `/api/projects` | Create workspace `{ name?, tree? }` |
| GET | `/api/projects/:id` | Get workspace |
| PUT | `/api/projects/:id` | Save `{ name?, tree? }` |
| DELETE | `/api/projects/:id` | Delete workspace |

### Account sync — `/api/account/state/*`

Requires a verified email. These endpoints store the account-scoped documents
that are not workspaces. Ownership is always `req.user.id`; the owner is never
read from the request.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/account/state` | All sections for the caller: `{ sections: { settings?, chats? } }` |
| GET | `/api/account/state/:section` | One section: `{ section, data, updatedAt }` (`data` is `null` when absent) |
| PUT | `/api/account/state/:section` | Replace a section: body `{ data }`; returns the server `updatedAt` |
| DELETE | `/api/account/state/:section` | Delete one section |

Allowed sections are a closed allowlist: `settings` and `chats`. Each body must
be a JSON object and is capped after serialization
(`MAX_ACCOUNT_SETTINGS_BYTES`, default 256 KB; `MAX_ACCOUNT_CHATS_BYTES`,
default 900 KB). Unknown sections and non-object payloads return 400; oversized
payloads return 413. Rows live in the `account_state` table (schema v4) and are
deleted with the owning user.

The frontend uses this API for cross-device settings and AI chat history. The
workspace tree uses `/api/projects/*` and is mapped to one cloud project per
account; all three surfaces report through one account-sync status store.

### WebSocket — `ws://localhost:3001`

Terminal and interactive code execution. Authentication is mandatory at the
handshake: browsers cannot set an `Authorization` header on `new WebSocket()`,
so the client appends its current Firebase ID token as `?token=<idToken>`.
The server verifies it before creating any session, and requires a verified
email. Origin headers, when present, must match `CORS_ORIGIN`.

Messages:

- `{ "action": "execute", "language", "files", "stdinInput?" }`
- `{ "action": "input", "data" }` — send stdin
- `{ "action": "kill" }` — stop process

Session limits are enforced per user, per IP, and globally. Every operation
checks that the session belongs to the authenticated user.

## Configuration

Copy `.env.example` to `.env` and set API keys (server-side only; do not commit `.env`).

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP/WebSocket port (default `3001`) |
| `HOST` | Bind host (default `0.0.0.0` in production) |
| `CORS_ORIGIN` | Exact allowed frontend origin(s), comma-separated. Required in production; `*` is fatal. |
| `FIREBASE_PROJECT_ID` | Firebase project ID (required in production) |
| `FIREBASE_CLIENT_EMAIL` | Service-account email (required in production) |
| `FIREBASE_PRIVATE_KEY` | Service-account private key with `\n` escapes (required in production) |
| `NVIDIA_API_KEY` | Primary AI provider |
| `GROQ_API_KEY` | Fallback AI provider |
| `OPENROUTER_API_KEY` | Fallback AI provider |
| `HF_TOKEN` | Fallback AI provider |
| `KILO_API_KEY` | Fallback AI provider |
| `ALLOW_LOCAL_EXECUTION` | `true` locally; `false`/unset in production (fatal if `true` in production) |
| `ALLOW_SHELL` | `true` locally; `false`/unset in production (fatal if `true` in production) |
| `ADMIN_EMAILS` | Comma-separated admin email allowlist |
| `MAX_ACCOUNT_SETTINGS_BYTES` | Max synced settings document (default 256 KB) |
| `MAX_ACCOUNT_CHATS_BYTES` | Max synced AI chat document (default 900 KB) |

Additional tuning variables (`AI_REQUESTS_PER_DAY`, `EXEC_REQUESTS_PER_DAY`,
size caps, WebSocket limits, `AUTH_RATE_PER_MINUTE`) are validated in
`server/config/env.cjs`; invalid values are a fatal startup error.

## Development

```bash
npm run dev   # Vite (5173) + server (3001); /api proxied to backend
```

Or run the server alone:

```bash
npm run server
```

Authentication still requires Firebase configuration. Without it the UI renders
but the workspace stays locked; there is no development bypass.
