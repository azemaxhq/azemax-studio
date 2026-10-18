# Authentication

Azemax uses **Firebase Authentication as its only identity provider**
(Email/Password + Google). The application never stores or verifies passwords,
never mints its own session tokens, and has no guest, anonymous, or
auth-bypass mode. The Firebase Web SDK authenticates the browser; the server
verifies the resulting ID token with the Firebase Admin SDK on every protected
request and never trusts client-supplied identity.

```
Browser (Firebase Web SDK)                    Server (Express)
  │ signInWithEmailAndPassword /                │
  │ signInWithPopup(Google)                     │
  │                                             │
  │ ── Firebase issues a short-lived ID token ──┤
  │                                             │
  │ POST /api/auth/sync { idToken }             │
  │                                             │ verifyIdToken(idToken)   ← Firebase Admin
  │                                             │ syncFirebaseUser(claims)  ← SQLite metadata
  │ ◄── { user }                                │
  │                                             │
  │ GET /api/projects                           │
  │ Authorization: Bearer <idToken>             │
  │                                             │ verifyIdToken(idToken) on every request
  │                                             │ requireVerifiedEmail → 401 / 403
  │ ◄── user-scoped response                    │
```

There is **no server session and no cookie**. The browser holds the Firebase ID
token in memory only (`src/utils/authToken.ts`) and sends it as
`Authorization: Bearer`. Firebase owns token issuance, refresh, and revocation.
The application database stores only app metadata keyed by the verified
Firebase UID.

## Why this architecture (Option A)

The frontend is deployed on Vercel and the API on Render — two different
sites. Third-party-cookie restrictions in Safari, Firefox, and Brave make a
server-issued session cookie unreliable across that boundary, and several
common cross-site cookie configurations fail silently. A bearer ID token that
the client explicitly attaches to each request works in every browser, has no
cross-site cookie dependency, and is verified by Firebase on every call.

The alternative (a server-minted opaque session token stored in SQLite) was
implemented and removed. It duplicated identity state, required its own
revocation path, and created a second system that could drift from Firebase.
Firebase ID tokens are short-lived and refreshed automatically by the SDK, so
they provide the same protection without the extra store.

## Flows

| Flow | Entry point | Notes |
|------|-------------|-------|
| Email + password sign-up | `signUpWithEmail()` → `/signup` | Creates the Firebase account, sends the verification email, and reports honestly when that send fails. |
| Email + password sign-in | `signInWithEmail()` → `/login` | Unverified accounts land on `/verify-email`; they never reach the workspace. |
| Google sign-in | `signInWithGoogle()` → `/login` | Popup with a redirect fallback when the popup is blocked. `/auth/callback` resolves the redirect. The button is hidden when Firebase is not configured. |
| Password reset | `sendPasswordReset()` → `/forgot-password` | Generic success (no account enumeration). Transport/configuration failures are reported so the user can retry. |
| Email verification | `/verify-email` | Explicit "I've verified" check plus resend with a 60 s cooldown. No polling loop. |
| Backend identity sync | `POST /api/auth/sync` | Verifies the ID token, upserts the app user, returns the public profile. |
| Current profile | `GET /api/auth/me` | Requires a valid Bearer ID token. |
| Sign-out | Firebase `signOut()` → `POST /api/auth/logout` | The endpoint is an acknowledgement only; there is no server session to revoke. Firebase discards the local credential. |

## Routes and protection

Client routes (resolved by `src/App.tsx` with helpers from
`src/utils/appRouter.ts`):

- `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/auth/callback`
- `/app` — the workspace. It is rendered only for an authenticated user with a
  provider-verified email (`AuthGate`).
- Unknown non-app paths render the landing page; `/application` does **not**
  match `/app`.
- Signed-in users visiting an auth route are redirected to the intended
  destination (`?redirect=`, restricted to same-origin relative paths).
- While auth state is still resolving, a branded splash is shown — the app
  never flashes a form or protected content first.

Server surface:

| Endpoint | Gate | Behavior |
|----------|------|----------|
| `POST /api/auth/sync` | verified token | 400 missing/oversized token, 401 invalid/expired, 503 provider unconfigured, 409 unsafe email link. Accepts `idToken` in the body or as a Bearer header. |
| `GET /api/auth/me` | `requireAuth` | 401 without a valid ID token. |
| `POST /api/auth/logout` | none | Returns `{ ok: true }`; performs no revocation (no server session exists). |
| `POST /api/ai/chat`, `GET /api/ai/models` | `requireVerifiedEmail` | 401 unauthenticated, 403 unverified. |
| `POST /api/execute`, `GET /api/runtimes` | `requireVerifiedEmail` | 401 unauthenticated, 403 unverified. |
| `/api/projects/*` | `requireVerifiedEmail` + ownership | 401/403 as above; every query is scoped to the authenticated user. |
| `/api/account/state/*` | `requireVerifiedEmail` + ownership | 401/403 as above; synced settings/chat sections are keyed by `req.user.id`, validated and size-capped. |
| WebSocket (terminal) | handshake token | `?token=<idToken>` verified before any session exists. 4401 unauthenticated, 4403 unverified or forbidden origin. |
| Admin routes (if mounted) | `requireAdmin` | `ADMIN_EMAILS` allowlist. No admin router is currently mounted. |
| `GET /api/health` | public | Service status only. |

The frontend gate is a UX boundary, not the security boundary. Even if a
client rendered the workspace, every product API and WebSocket session would
still reject an unauthenticated or unverified caller.

## Account sync

Signed-in account data is synchronized per Firebase identity; there is no
shared/global account store.

| Surface | Storage | Conflict policy |
|---------|---------|-----------------|
| Workspace tree | `/api/projects/*` (one mapped project per account) | Compare the persisted workspace `updatedAt` with the server project timestamp. Newer local wins; otherwise the cloud tree is restored. A pulling device backs up the losing local tree under the account namespace before replacement. Edits made while the initial fetch is in flight always win. Pre-sync local work with no timestamp is preserved as a new project when the cloud copy is non-empty, so neither side is overwritten. |
| Settings | `/api/account/state/settings` | Whole-document last-writer-wins by timestamp; remote is applied only when it is newer than the local change marker. Persisting a restored cloud document does not advance the local timestamp, so a stale device cannot win a later comparison merely by hydrating. |
| AI chat history | `/api/account/state/chats` | Union by session id (newest copy wins), with deletion tombstones so removing a conversation on one device does not resurrect it from another. "Clear all" also stores a timestamp marker: sessions older than the marker stay deleted across devices, including cloud-only conversations this device had not downloaded. Conversations created after the clear survive. |

All three sync paths run only after Firebase authentication reaches
`authenticated`, read the user id from `AuthContext` (ultimately the verified
token), and never send a `userId`/owner in a request body. Pushes are
debounced; the settings account card exposes `Syncing…`, `Synced …`, or
`Sync failed` with a retry that re-runs every registered section. If cloud sync
is unavailable, the local workspace/settings/history remain usable and no
account data is shared between users.

## Security properties

- **Server-side verification.** UID, email, verification state, and sign-in
  provider come from the Admin-verified token. Request bodies, query strings,
  localStorage, and client state are never trusted for identity.
- **Account-sync ownership is server-derived.** Workspace, settings, and chat
  documents are stored under `req.user.id`; a client-supplied `userId`, owner,
  or project id that belongs to another user is ignored or returns 404. Synced
  sections use a closed name allowlist and byte caps, so they cannot be used to
  create arbitrary storage keys or unbounded rows.
- **Per-account local isolation.** Workspace, settings, chat, terminal, and
  other user data live under an account namespace keyed by the verified
  Firebase UID, not the backend row id. The namespace therefore stays stable if
  the initial backend sync fails and reconciles later. Pre-auth global values
  are claimed once by the first account that signs in on that browser and the
  legacy copies are removed, so a later account cannot inherit them.
- **Verified email required for product operations.** Unverified accounts can
  sync their profile and access the verification flow, but AI, execution,
  projects, and terminal sessions return 403 until Firebase reports
  `email_verified`. Google identities are treated as verified because Google
  asserts the address.
- **No account pre-hijacking.** An unverified provider identity can never adopt
  a pre-existing account with the same email. Firebase password sign-ups can
  claim any address without proving ownership, so email-based linking is only
  allowed when the token asserts `email_verified = true`. A rejected link
  returns **409** (`auth/email-already-in-use`) and writes no rows.
- **No accidental account merging.** `auth/account-exists-with-different-credential`
  is surfaced as guidance to sign in with the original method. Two matching
  email strings never silently merge two identities.
- **No secrets in the browser.** `FIREBASE_PRIVATE_KEY` and
  `FIREBASE_CLIENT_EMAIL` are server-only. The `VITE_FIREBASE_*` web config is
  public by design (access is enforced by Firebase rules and server-side token
  verification). Provider API keys remain server-only and `VITE_*` provider
  keys are blanked in production builds.
- **In-memory credential only.** The ID token is never written to
  localStorage, sessionStorage, or a cookie. A page reload rehydrates it from
  Firebase's own persistence.
- **No internal metadata in responses.** Public user objects omit the internal
  placeholder credential column and the Firebase UID.
- **Constant-shape auth failures.** Sign-in and password-reset do not reveal
  whether an account exists.
- **Open-redirect protection.** Post-login destinations must be same-origin
  relative paths; auth routes are rejected to prevent loops.
- **Rate limiting.** Per-IP on `/api/auth/sync` (`AUTH_RATE_PER_MINUTE`,
  default 10/min).
- **No token or credential logging.**
- **Sign-out is honest.** It discards the client credential; it does not claim
  to revoke every previously issued ID token. Firebase ID tokens expire on
  their own.

## Fail-closed behavior

Authentication never falls open.

- **Production server:** `server/index.cjs` refuses to start when Firebase
  Admin is not configured (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`, or application default credentials). A process that
  cannot verify identity must not serve product routes.
- **Development server:** it boots without Firebase Admin so the UI can be
  worked on, but no token can be verified. Protected routes return 401 and
  `/api/auth/sync` returns 503. There is no bypass flag that turns this into
  authenticated access.
- **Frontend without Firebase config:** the auth forms still render (so input
  validation remains usable and testable), the Google button is hidden, and
  every credential operation fails with an explicit
  "Firebase Authentication is not configured on this deployment" message. The
  workspace is never rendered.
- **SDK initialization failure:** the gate shows a retry panel and keeps the
  workspace locked. Credential errors (wrong password, etc.) set an inline
  message but leave the user signed out.
- **Removed flags:** `DISABLE_AUTH`, `ALLOW_PUBLIC_BYPASS`, `VITE_DISABLE_AUTH`,
  `PUBLIC_BETA`, `VITE_PUBLIC_BETA`, `AUTH_SECRET`, anonymous identities, guest
  quotas, and the local password provider no longer exist anywhere in the
  runtime.

## Auth state machine

`AuthContext` exposes exactly one status at a time:

| Status | Meaning | UI |
|--------|---------|----|
| `initializing` | Firebase listener has not settled yet | Branded spinner |
| `authenticated` | Signed in and provider-verified email | Workspace |
| `verification-required` | Signed in, email not verified | Verification pane |
| `unauthenticated` | No signed-in Firebase user | Sign-in pane |
| `error` | Firebase SDK could not initialize | Fail-closed retry panel |

Credential failures set the `error` message but leave `status` as
`unauthenticated`. `error` as a *status* is reserved for an unrecoverable
client initialization failure.

The listener uses `onIdTokenChanged`, so a token refresh or sign-out updates
the in-memory credential immediately. `syncWithBackend` mints a fresh token at
explicit sign-in, sign-up, and verification events so the server observes
current claims. If the backend is unreachable (for example a cold start), the
provider profile is shown as a fallback, but protected APIs stay guarded
server-side and reject until a sync succeeds.

## Required configuration

### Server (Render / `.env`)

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Firebase console → **Project settings → Service accounts → Generate new private
key**; copy `project_id`, `client_email`, and `private_key` from the JSON. Keep
the `\n` escapes — the server converts them to real newlines. These three
values are required in production; missing them is a fatal startup error.

### Frontend (Vercel / `.env`)

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
# optional: VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID
```

Firebase console → **Project settings → Your apps → Web app → SDK setup**.
`isFirebaseClientConfigured()` requires at least `VITE_FIREBASE_API_KEY` and
`VITE_FIREBASE_PROJECT_ID`. Set them **before** the build (Vite inlines them),
then redeploy.

> **Environment values are read through a literal `import.meta.env`
> reference.** Vite only injects the env object when it appears directly in the
> source; indirect access silently disables Firebase in every build.

### Firebase console (one-time, manual)

1. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
2. **Authentication → Settings → Authorized domains**: add `localhost` and every
   production domain (for example `azemax-frontend.vercel.app`). Email actions
   use `<origin>/login` as the continue URL, so the deployment origin must be
   authorized or Firebase rejects the send.
3. **Email templates** (optional): brand the verification and reset emails.
4. **Google provider** (optional): configure the OAuth consent screen and
   support email.

## Tests

| Command | What it covers |
|---------|----------------|
| `npm test` | Full unit/integration suite (46 files, 1643 tests). |
| `npx vitest run tests/authBackend.test.ts` | Token verification through the injected seam, sync/linking including the 409 pre-hijack guard, `/api/auth/*` contract, rate limiting, fail-closed 503. Throwaway temp DB. |
| `npx vitest run tests/authEnforcement.test.ts` | 401/403 enforcement, verified-email gate, project ownership, absence of any guest path or bypass flag. |
| `npx vitest run tests/accountSync.test.ts` | Workspace/chat reconciliation helpers, per-user settings and workspace namespacing, sync status/retry behavior. |
| `npx vitest run tests/authFlow.test.ts tests/authVerify.test.ts tests/authRouter.test.ts tests/authTransport.test.ts` | Frontend state policy, error mapping, route classification, open-redirect protection, deliverability guard, transport headers, per-pane copy. |
| `npm run test:e2e:auth` | Fail-closed E2E against an isolated stack (no Firebase configuration): the workspace is locked, auth forms render, validation and focus work, and no guest affordance exists. |
| `npm run test:e2e` | Editor E2E. Specs that need a signed-in session use `tests/e2e/_auth.ts` and skip unless real credentials are supplied. |

### Authenticated E2E (manual, requires live credentials)

The authenticated editor specs and the real sign-in path need a live Firebase
project. Provide:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
E2E_USER_EMAIL=...
E2E_USER_PASSWORD=...
npm run test:e2e
```

Without `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`, those specs call
`test.skip()`. They never fabricate a session or fall back to a guest identity.

### Not covered by the automated suite

The following require browser/provider interaction and are verified manually
where credentials are available:

- real Google OAuth popup/redirect;
- actual delivery of verification and password-reset emails;
- the restored-session path in a browser with real keys;
- cross-device reconciliation in two real browser profiles (workspace pull/
  push, settings last-writer-wins, chat union/tombstones, account switching,
  and retry after an offline/error state).

**Live backend check performed locally:** with the `azemax-studio` service
account, a temporary verified user was created through Firebase Admin, signed
in through the Firebase REST API, synced through `POST /api/auth/sync` (200),
and used to call `GET /api/projects` (200; 401 without the token). The
temporary Firebase user was deleted immediately afterward. Account state
(`/api/account/state/*`) is covered by the automated ownership/enforcement
suite but was not part of that live check.

The automated suites exercise Firebase through a deterministic verifier seam,
so wiring, the state machine, error mapping, and security rules are covered
even when no hosted provider credentials are present.
