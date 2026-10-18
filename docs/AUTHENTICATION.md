# Authentication

Azemax uses **Firebase Authentication** as the identity provider and keeps its own
application user record + sessions in SQLite. The browser authenticates with the
Firebase Web SDK; the server verifies the resulting ID token with the Firebase
Admin SDK and never trusts client-supplied identity.

```
Browser (Firebase Web SDK)                Server (Express)
  │ signInWithEmail / Google popup           │
  │ ─── Firebase issues ID token ──►         │
  │ POST /api/auth/sync  { idToken }         │
  │                                          │ verifyIdToken(idToken)  ← Firebase Admin
  │                                          │ syncFirebaseUser(...)   ← SQLite upsert
  │ ◄── { user, token, expiresAt } + cookie  │ createSession(...)
  │ GET /api/auth/me  (cookie | Bearer)      │
```

If Firebase is not configured on the client (`VITE_FIREBASE_*` missing), the app
falls back to the local password provider (`POST /api/auth/signup|login`) so the
project stays runnable in development without live provider credentials.

## Flows

| Flow | Where | Notes |
|------|-------|-------|
| Email + password sign-up | `src/core/auth/firebase.ts` → `/signup` | creates the account, sends the Firebase verification email, and reports honestly when that send fails |
| Email + password sign-in | `src/core/auth/firebase.ts` → `/login` | unverified accounts are routed to `/verify-email`, not the workspace (hard-wall mode) |
| Google sign-in (popup, redirect fallback) | `signInWithGoogle()` | `/auth/callback` resolves the redirect result; button is only rendered when Firebase is configured |
| Password reset | `sendPasswordReset` → `/forgot-password` | generic success (no enumeration) when a provider exists; honest "unavailable" when none is configured |
| Email verification | `/verify-email` | explicit status check + resend with a 60 s cooldown; no polling loops |
| Server session | `/api/auth/sync`, `/api/auth/me`, `/api/auth/logout` | httpOnly cookie + `Authorization: Bearer` fallback |

## Routes

Client (resolved in `src/components/Auth/AuthRoutes.tsx`, inside a single shared
`AuthProvider` so state survives navigation):

- `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/auth/callback`
- Authenticated users are redirected to the intended destination (`?redirect=`,
  validated by `src/utils/appRouter.ts`).
- Signed-in-but-unverified users land on `/verify-email` instead of a dead-end login.
- While the session is still being restored, an auth splash is shown — the app
  never flashes a form (or protected content) before it knows the auth state.

Server (`server/routes/auth.cjs`):

- `POST /api/auth/sync` — verify ID token → upsert user → issue session
- `GET  /api/auth/me` — current user (requires a valid session)
- `POST /api/auth/logout` — revoke the session + clear the cookie
- `POST /api/auth/signup`, `POST /api/auth/login` — password fallback (legacy)

## Security properties

- **Server-side verification.** Every identity field (uid, email, verification
  state, provider) comes from the verified token, never from the request body.
- **No account pre-hijacking.** An *unverified* provider identity can never adopt
  a pre-existing account for the same email address. Firebase password sign-ups
  can claim any address without proving ownership, so email-based linking is only
  allowed when the provider asserts `email_verified = true` (Google, or a
  confirmed password account). A rejected link returns **409**
  (`auth/email-already-in-use`) with an actionable, non-technical message.
- **No accidental account merging.** `auth/account-exists-with-different-credential`
  is surfaced to the user as guidance to sign in with the original method — the
  app never silently merges two identities because two email strings match.
- **No secrets in the browser.** `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL`
  are server-only. The `VITE_FIREBASE_*` web config is public by design. The
  production build blanks any `VITE_*` provider keys (verified: they are `""` in
  `dist/`).
- **No internal metadata in responses.** Public user objects omit the password
  hash and the internal Firebase UID.
- **Constant-shape auth failures** — login / password-reset never reveal whether an
  account exists.
- **Open-redirect protection** — post-login destinations must be same-origin
  relative paths; auth routes are rejected to prevent loops.
- **Rate limiting** — per-IP on `/api/auth/{login,signup,sync}`
  (`AUTH_RATE_PER_MINUTE`, default 10).
- **No token or credential logging.**
- **Logout** revokes the server session; it does **not** claim to revoke every
  provider-issued token (Firebase ID tokens are short-lived and client-held).

## UI, states and accessibility

The auth surface is built from one set of primitives
(`src/components/Auth/primitives.tsx`) so every pane shares the same control
height (40 px), radii, spacing, focus ring (`.az-ring`), spinner, alerts and
disabled/loading states.

- **Layout** (`AuthLayout.tsx`): a fixed brand column (logo + wordmark + accurate
  `Beta` badge, task-adapted headline, a static editor preview with honest editor
  chrome only — no fabricated runtime status) beside a single, internally
  scrolling form column (max 440 px). Only the form column scrolls; the brand
  composition never drifts, and no action is clipped when the on-screen keyboard
  opens.
- **Copy** (`src/core/auth/copy.ts`): each pane has distinct, task-adapted
  headings — no repeated marketing block.
- **Guest access**: exactly one labelled "Continue as guest" action per pane (no
  competing duplicate links).
- **Field errors** are wired with `aria-invalid` + `aria-describedby`, announced
  (`role="alert"`), and rendered in **reserved space** so validation never reflows
  the form out from under the user's pointer. Focus moves to the first invalid
  field (or the error banner on provider failures).
- **Verification pane** only ever prints an address a message could actually reach
  (`src/core/auth/verification.ts`); it never shows a non-deliverable fixture.
- Reduced-motion is honoured on the auth surface (`.az-auth`).

## Required configuration

### Server (Render / `.env`)

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Firebase console → **Project settings → Service accounts → Generate new private
key**; copy `project_id`, `client_email`, `private_key` from the JSON. Keep the
`\n` escapes — the server converts them to real newlines.

Without these the server still boots and everything else works, but
`POST /api/auth/sync` returns **503** (`auth/not-configured`).

### Frontend (Vercel / `.env`)

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
# optional: VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID
```

Firebase console → **Project settings → Your apps → Web app → SDK setup**.
Set them **before** the build (Vite inlines them), then redeploy.

> **Environment flags are read via a literal `import.meta.env` reference.** Vite
> only injects the env object when it appears as `import.meta.env` (not
> `import.meta?.env`). This was fixed in `sessionToken.ts`, `betaAccess.ts` and
> `core/auth/firebase.ts`; before the fix `VITE_PUBLIC_BETA=false` and
> `VITE_DISABLE_AUTH=true` had no effect in any build.

### Firebase console (one-time, manual)

1. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
2. **Authentication → Settings → Authorized domains**: add `localhost` and every
   production domain (e.g. `azemax-frontend.vercel.app`). The app sets the email
   action continue-URL to `<origin>/login`, so the deployment origin must be an
   authorized domain or Firebase rejects the send.
3. **Email templates** (optional): brand the verification / reset emails.

## Tests

| Command | What it covers |
|---------|----------------|
| `npm test` | full unit/integration suite (44 files) |
| `npx vitest run tests/authBackend.test.ts` | token verification (injected seam, no network), sync/linking incl. the 409 pre-hijack guard, sessions, middleware, `/api/auth/*` HTTP surface, rate limiting, dev-identity flag — throwaway temp DB |
| `npx vitest run tests/authFlow.test.ts tests/authVerify.test.ts tests/authRouter.test.ts` | frontend policy, error mapping, route classification, open-redirect protection, deliverability guard, per-pane copy |
| `npm run test:e2e:auth` | real end-to-end auth against an isolated backend (`DISABLE_AUTH=false`, `PUBLIC_BETA=false`, temp DB): hard wall, validation + focus, sign-up → workspace, session persistence across reload, duplicate email, wrong password, Enter-to-submit, recovery states, and 1440/768/390 responsive composition |

### Not covered automatically (requires live credentials)

These are implemented but cannot be verified without a real Firebase project:

- live Firebase ID-token verification and real Google OAuth popup/redirect;
- actual delivery of verification and password-reset emails;
- the Firebase restored-session path in a browser with real keys.

The unit and E2E suites exercise Firebase through a deterministic verifier seam
and the local password provider, so the wiring, state machine, error mapping and
security rules are covered even though the hosted provider is not.

The pre-existing default E2E suite (`npm run test:e2e`) has failures that are
unrelated to authentication — e.g. `landing.spec.ts` asserts copy
(`BEYOND THE EDITOR`) that no longer exists anywhere in the source, and the
syntax-highlight specs are timing-sensitive. The auth work did not change those
specs' targets.
