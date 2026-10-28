# Azemax Studio

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green.svg)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](tsconfig.json)
[![Tests](https://img.shields.io/badge/Tests-2244%20passing-brightgreen.svg)](#testing)

**Azemax Studio** is a browser-based AI-native code editor with Monaco, real-time collaboration via Firebase, server-side AI provider routing, and secure code execution.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Screenshots](#screenshots)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [Building](#building)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Features

| Category | Capabilities |
|----------|--------------|
| **Editor** | Monaco (VS Code engine), multi-tab, split view, minimap, bracket matching, multi-cursor, code folding |
| **AI Assistant** | Streaming chat, agentic editing (read/write/search/list/diagnostics), explanation mode, inline autocomplete, multi-provider fallback (NVIDIA, Groq, OpenRouter, HuggingFace, Kilo Code) |
| **Execution** | Local runtimes (Node, Python, C++, Java, Rust, Go, etc.) in dev; Wandbox sandbox in production; interactive terminal (PTY) in dev |
| **Workspace** | File tree, drag-drop, create/rename/delete, search, recent edits, visible window context |
| **Authentication** | Firebase Auth (Email/Password + Google), verified-email enforcement, no guest mode, account-scoped settings & chat sync |
| **Terminal** | xterm.js with fit, web-links, WebGL addons; PTY shell in dev; disabled in production |
| **Collaboration** | Cross-device workspace sync, conflict resolution, settings merge, chat history union |
| **Security** | Fail-closed production boot, server-only provider keys, CORS allowlist, rate limits, CSP/HSTS, input validation, path-traversal guards |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Browser (Vercel static: dist/)                                              │
│  ├─ Firebase Web SDK → ID token (in memory)                                 │
│  ├─ Authorization: Bearer <idToken>                                         │
│  ├─ VITE_API_URL=https://<backend>/api  →  HTTPS                            │
│  └─ WSS derived from VITE_API_URL (?token=<idToken>)                        │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Express API (Render: node server/index.cjs)                                 │
│  ├─ verifyIdToken on every protected request (Firebase Admin SDK)           │
│  ├─ GET  /api/health              (public)                                  │
│  ├─ POST /api/auth/sync           (verify token, upsert app user)           │
│  ├─ POST /api/ai/chat (SSE)       (verified email; server holds keys)       │
│  ├─ POST /api/execute / GET /api/runtimes   (verified email; Wandbox prod)  │
│  ├─ /api/projects/*               (ownership-scoped workspace sync)         │
│  ├─ /api/account/state/*          (verified email; settings + AI chat sync) │
│  └─ WebSocket (ws) — token at handshake; code sessions + shell              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Build/deploy separation:** frontend is a static Vite build (`dist/`); backend is a persistent Node process. They deploy independently.

## Screenshots

| Editor | AI Assistant | Terminal |
|--------|--------------|----------|
| ![Editor](docs/screenshots/editor.png) | ![AI](docs/screenshots/ai.png) | ![Terminal](docs/screenshots/terminal.png) |

*Screenshots pending — add to `docs/screenshots/`*

## Prerequisites

- **Node.js 22 LTS** (see `.nvmrc`) — also works on 18+
- **npm** (bundled with Node)
- **Firebase project** with **Email/Password** and (optionally) **Google** sign-in enabled
- At least one **AI provider API key** for AI features (NVIDIA_API_KEY recommended)

## Quick Start

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/azemax-studio.git
cd azemax-studio
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — add at least one AI key (NVIDIA_API_KEY) and Firebase config

# 3. Start dev servers (API + Vite)
npm run dev
```

This starts:
- **API** on `http://localhost:3001`
- **UI** on `http://localhost:5173` (Vite proxies `/api` → backend)

Open [http://localhost:5173](http://localhost:5173). The IDE lives at `/app` and requires sign-in.

> **Fail-closed behavior:** If Firebase is not configured, the sign-in screen renders but no account can be created or used, and the workspace stays locked. There is no guest mode or auth-bypass flag.

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | API + Vite together (concurrently + wait-on) |
| `npm run server` | API only (`node --watch server/index.cjs`) |
| `npm start` | Production API (`node server/index.cjs`) — respects `PORT`/`HOST` |
| `npm run build` | Typecheck + Vite production build → `dist/` |
| `npm run build:analyze` | Build with bundle analyzer (`dist/stats.html`) |
| `npm run preview` | Serve `dist/` locally (`vite preview`) |
| `npm run lint` | ESLint (0 errors, pre-existing warnings allowed) |
| `npm run lint:server` | ESLint server-only |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | `vitest run` (jsdom, 2244 tests) |
| `npm run test:e2e:auth` | Fail-closed auth E2E (no live Firebase needed) |
| `npx playwright test` | Editor E2E (authenticated specs skip without real credentials) |
| `npm run db:backup` | Backup SQLite database |

## Configuration

### Environment Variables

#### Public (Vite — safe for browser)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api` (dev) | Browser → API base. **Production:** `https://YOUR-BACKEND.onrender.com/api` |
| `VITE_USE_BACKEND_AI` | `true` | When `true`, AI goes via `/api/ai/*` (keys stay server-side) |
| `VITE_WS_URL` | *(derived)* | Override WebSocket URL. If omitted, derived from `VITE_API_URL` (`https`→`wss`) |
| `VITE_WS_PORT` | `3001` | Dev only |
| `VITE_FIREBASE_API_KEY` | — | Firebase Web SDK API key (required) |
| `VITE_FIREBASE_AUTH_DOMAIN` | — | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | — | Firebase project ID (required) |
| `VITE_FIREBASE_APP_ID` | — | Firebase web app ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | — | Optional |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | — | Optional |

> **Do NOT set** `VITE_GROQ_API_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_HF_TOKEN` / `VITE_KILO_API_KEY` in production — the server must hold provider keys. The Vite build blanks them automatically.

#### Server-only (never `VITE_`)

| Variable | Example | Description |
|----------|---------|-------------|
| `PORT` | `3001` dev / `10000` Render | Server listen port |
| `HOST` | `0.0.0.0` prod | Bind host |
| `NODE_ENV` | `production` | Set to `production` on Render |
| `CORS_ORIGIN` | `https://app.vercel.app` | Comma-separated allowed origins (no `*` with credentials) |
| `FIREBASE_PROJECT_ID` | `azemax-1234` | **Required in production** |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-…@…iam.gserviceaccount.com` | **Required in production** |
| `FIREBASE_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\n…"` | **Required in production** (keep `\n` escapes) |
| `NVIDIA_API_KEY` | — | Primary AI provider |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | — |
| `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | — |
| `GROQ_API_KEY` | — | Fallback provider |
| `OPENROUTER_API_KEY` | — | Fallback provider |
| `HF_TOKEN` | — | Fallback provider |
| `KILO_API_KEY` | — | Fallback provider |
| `KILO_BASE_URL` | `https://api.kilocode.ai/v1` | — |
| `ADMIN_EMAILS` | `you@example.com` | Comma-separated admin allowlist |
| `ALLOW_LOCAL_EXECUTION` | `false` in prod | `true` is **fatal** in production. Uses Wandbox sandbox. |
| `ALLOW_SHELL` | `false` in prod | `true` is **fatal** in production. |
| `MAX_CODE_BYTES` | `204800` | Max code payload |
| `MAX_STDIN_BYTES` | `32768` | Max stdin |
| `MAX_OUTPUT_BYTES` | `524288` | Max captured output |
| `MAX_WORKSPACE_BYTES` | `2097152` | Max project JSON |

See `.env.example` (development) and `.env.production.example` (hosting).

### Firebase Setup

1. Create a Firebase project.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains**: add `localhost` and every production domain (e.g., `your-frontend.vercel.app`). Email actions use `<origin>/login` as the continue URL.
4. **Project settings → Your apps → Web app**: copy the `firebaseConfig` values into the `VITE_FIREBASE_*` variables.
5. **Project settings → Service accounts → Generate new private key**: copy `project_id`, `client_email`, and `private_key` into the backend variables.

The `VITE_FIREBASE_*` web config is public by design. The service-account values are server-only secrets and must never be prefixed with `VITE_`.

## Development

### Project Structure

```
├── public/                 # Static assets (fonts, images, manifest)
├── server/                 # Express backend (CommonJS .cjs)
│   ├── config/             # Environment validation (fail-closed)
│   ├── middleware/         # Auth, error handling, security headers
│   ├── routes/             # API routes (ai, auth, projects, account, execute)
│   ├── services/           # AI providers, execution, account state, projects
│   ├── websocket/          # Code execution + terminal WebSocket
│   └── db/                 # SQLite (better-sqlite3) schema + migrations
├── src/                    # React frontend (TypeScript, Vite)
│   ├── components/         # UI components (Panels, Editor, Layout, etc.)
│   ├── core/               # Core logic (AI, editor, workspace, filesystem)
│   ├── hooks/              # React hooks (auth, sync, workspace)
│   ├── utils/              # Utilities (apiClient, authToken, safeTree)
│   ├── styles/             # Tailwind + global CSS
│   └── main.tsx            # Entry point
├── tests/                  # Vitest unit/integration tests
├── docs/                   # Architecture docs (AUTHENTICATION, SERVICES, etc.)
├── scripts/                # Build/dev utilities
├── .github/workflows/      # GitHub Actions CI
├── .env.example            # Development template
├── .env.production.example # Production template
├── LICENSE                 # Apache 2.0
├── NOTICE                  # Third-party attributions
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── package.json
```

### Key Design Decisions

- **Firebase-only auth** — no custom sessions, cookies, or password storage
- **Server-only AI keys** — provider secrets never reach the browser (validated in `vite.config.ts` and `server/config/env.cjs`)
- **Fail-closed production** — server refuses to boot if Firebase Admin or CORS is misconfigured
- **Atomic edit pipeline** — compile → build → validate → apply → verify → rollback on failure
- **Agent loop** — intent → inspect → plan → execute tools → validate → summarize (no separate planner LLM call)

## Building

```bash
# Production build (typecheck + Vite)
npm run build

# Output: dist/ (static assets for Vercel/Netlify/Cloudflare Pages)
# The Vite build inlines VITE_* values — changing them requires a redeploy.

# Analyze bundle size
npm run build:analyze
# Opens dist/stats.html
```

### Build-time Security (vite.config.ts)

- `clientEnvGuard` plugin (vite.config.ts) defines every client-read `VITE_*` with an explicit fallback and blanks `VITE_GROQ_API_KEY`, `VITE_OPENROUTER_API_KEY`, `VITE_HF_TOKEN`, `VITE_KILO_API_KEY` so provider credentials are never inlined into the production bundle
- `validateApiUrl` warns if `VITE_API_URL` doesn't end in `/api` or isn't HTTPS in production
- `esbuild` drops `console.log`/`debugger` in production

## Testing

```bash
# Unit + integration (Vitest, jsdom)
npm test
# 58 test files, 2244 tests passing

# Type-check only
npm run typecheck

# Lint
npm run lint

# Auth E2E (no live Firebase required — tests fail-closed behavior)
npm run test:e2e:auth

# Full E2E (Playwright — authenticated specs need real credentials)
npx playwright test
```

### Test Coverage Highlights

- `tests/authBackend.test.ts` — Firebase-only backend contract; no sessions, no signup/login, no cookie/token issuance; pre-hijack 409; unconfigured 503
- `tests/authEnforcement.test.ts` — 401/403 for AI, execution, projects, `/auth/me`; ownership; no guest path; no bypass flag
- `tests/authFlow.test.ts` / `authRouter.test.ts` — route classification, redirect validation, state policy
- `tests/authTransport.test.ts` — Bearer header attachment, WebSocket `?token=`, in-memory-only storage, no cookie fallback
- `tests/authVerify.test.ts` — verification copy and deliverability guard

## Deployment

### Frontend → Vercel

1. Push to GitHub.
2. Import project in Vercel → Framework: **Vite** → Build: `npm run build` → Output: `dist`.
3. Set **Production** Environment Variables:
   - `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api`
   - `VITE_USE_BACKEND_AI=true`
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
   - **Do NOT** add any `VITE_*_API_KEY` provider keys or Firebase service-account values.
4. Deploy. `vercel.json` handles SPA fallback (`/app` → `index.html`) and asset caching.
5. Add the Vercel domain to Firebase → Authentication → Settings → Authorized domains.

> Vite inlines `VITE_*` values at build time — changing them requires a redeploy.

### Backend → Render

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

> **Fail-closed:** Render will exit at startup if Firebase Admin cannot be configured. Check logs for `[FATAL] Refusing to start: Firebase Admin is not configured`.

### Deployment Checklist

#### Backend (Render)
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` = exact frontend origin(s), HTTPS, no wildcard, no trailing slash
- [ ] `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` set
- [ ] `ALLOW_LOCAL_EXECUTION=false` (or unset)
- [ ] `ALLOW_SHELL=false` (or unset)
- [ ] At least one AI provider key set
- [ ] Startup log shows `firebaseConfigured: true`
- [ ] `GET /api/health` returns 200
- [ ] `GET /api/projects` without a token returns 401

#### Frontend (Vercel)
- [ ] `VITE_API_URL` ends in `/api` and points at the live backend
- [ ] `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and the rest of the web config set **before** building
- [ ] No `VITE_*` provider keys or Firebase service-account values
- [ ] Deployment origin added to Firebase authorized domains
- [ ] Email/Password (and Google, if used) enabled in Firebase

## Security

- **Authentication:** Firebase-only, verified-email enforcement, no guest mode, fail-closed boot
- **Authorization:** Bearer ID token verified by Firebase Admin on every request; ownership checks on all data
- **AI Keys:** Server-only; Vite build blanks `VITE_*` provider keys; server ignores/warns on leaked keys
- **CORS:** Explicit HTTPS origins only; wildcard fatal with credentials; localhost rejected in production
- **Rate Limits:** Per-user (AI, execution, projects) + per-IP (auth); in-memory with SQLite daily backstop
- **Execution:** Production uses Wandbox sandbox; `ALLOW_LOCAL_EXECUTION=true` is fatal in production
- **Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, CSP, HSTS (prod)
- **Input Validation:** Zod schemas on all API routes; path-traversal guards; byte caps on all payloads
- **Secrets:** Never logged; `.env` gitignored; production uses platform secret managers

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

### Security Audit

Current security posture documented in [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md):
- 2244 tests passing (auth enforcement, backend contract, transport, flow, verification)
- No critical/high-severity authentication vulnerabilities found
- Residual risks documented (in-memory rate limits, single process, WebSocket token in query string)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Contribution workflow
- Coding standards (TypeScript, ESLint, Prettier)
- Pull request process
- Testing requirements

## License

Licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

```
Copyright 2026 Tharunkumar

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

**Third-party attributions:** See [NOTICE](NOTICE) for fonts (Inter, JetBrains Mono, Newsreader, Playfair Display — all SIL OFL 1.1) and dependencies.

**Trademark:** "Azemax" and the Azemax logo are trademarks of Tharunkumar. This license does not grant trademark rights.