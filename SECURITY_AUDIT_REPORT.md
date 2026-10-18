# Azemax Studio — Authentication & Security Audit

**Scope:** Authentication architecture, API authorization, WebSocket identity,
and the security posture of the deployed frontend/backend split.

**Status:** Complete — Firebase-only model implemented; guest/anonymous/bypass
paths removed; fail-closed behavior verified.
**Automated verification:** `npm test` — **46 files / 1643 tests pass**,
`npm run typecheck` clean, `npm run build` succeeds.

> **Verification boundary:** the backend token-verification path (Firebase Admin
> → ID token → `/api/auth/sync` → authenticated `/api/projects`) was verified
> against the live `azemax-studio` project using a temporary Admin-created user
> that was deleted immediately afterward. Browser Google OAuth, verification/
> reset email delivery, the restored-browser-session path, and real cross-device
> account-sync flows require manual checks; they are not claimed as
> automatically tested. Account-state ownership, validation, and enforcement are
> covered by the automated suite.

**Live backend check (2026-10-18):** password sign-in returned an ID token;
`POST /api/auth/sync` returned 200 with a verified user; `GET /api/projects`
returned 200 with that Bearer token and 401 without it. Firebase Admin logged
`initialized with service account credentials`; the temporary Firebase user
was deleted and confirmed absent.

---

## 1. Executive summary

Azemax now has a single identity system: **Firebase Authentication**
(Email/Password + Google). The application does not store passwords, verify
credentials, issue session cookies, or mint its own tokens. The browser obtains
a short-lived Firebase ID token and sends it as `Authorization: Bearer`; the
server verifies it with the Firebase Admin SDK on every protected request.

The previous public-beta model — anonymous visitors, server-minted `anon:<ip>`
identities, guest quotas, shared-identity `DISABLE_AUTH`, `PUBLIC_BETA`, and the
local password provider — has been removed. There is no runtime flag that can
grant unauthenticated access.

**Key properties:**

- All product routes (`/app`) and APIs require a signed-in, provider-verified
  user.
- Identity claims are taken only from the Admin-verified token.
- Production refuses to boot if Firebase Admin cannot be configured.
- Unauthenticated calls return 401; unverified accounts return 403.
- Project and terminal-session operations are ownership-checked server-side.
- Account-scoped settings and AI chat syncing is keyed by `req.user.id`, uses a
  closed section allowlist, and enforces byte caps.
- Browser caches are per-account. Pre-auth global values are claimed once by
  the first signed-in account on that browser and their legacy copies are
  removed, preventing a later account from inheriting them.
- The ID token is held in memory only — never localStorage or a cookie.
- Credentials, session rows, and custom token signing no longer exist.

**Residual risks** are operational/infrastructure-level (in-memory rate limits,
single-process deployment, no container isolation for local execution) and are
documented in section 5. No critical or high-severity authentication bypass was
found in the current implementation.

---

## 2. Trust boundaries

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Browser (untrusted)          │        │ Firebase Authentication      │
│  - Firebase Web SDK          │◄──────►│  - owns credentials          │
│  - in-memory ID token        │        │  - asserts email_verified    │
│  - renders AuthGate          │        │  - signs ID tokens           │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │ Authorization: Bearer <idToken>       │ Admin SDK
               ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Express API (trusted)                                                │
│  authenticateRequest → verifyIdToken → req.user                      │
│  requireVerifiedEmail → 401 / 403                                    │
│  routes scope every query by req.user.id                             │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend gate is **not** a trust boundary. It improves UX and prevents
flashing protected UI, but every security decision is re-made on the server
from the verified token.

---

## 3. Verified controls

| Control | Location | Evidence |
|---------|----------|----------|
| Firebase Admin token verification on every protected request | `server/middleware/auth.cjs` `authenticateRequest` | Unit tests inject a deterministic verifier; invalid/expired tokens leave `req.user = null`. |
| 401 for unauthenticated product APIs | `requireAuth` / `requireVerifiedEmail` | `tests/authEnforcement.test.ts` covers AI, execute, projects, `/auth/me`. |
| 403 for unverified email | `requireVerifiedEmail` | Tested for AI, execution, projects; WebSocket closes with 4403. |
| Verified-email requirement on `/api/projects` | `server/routes/projects.cjs` `router.use(requireVerifiedEmail)` | Enforcement tests exercise 401/403 and ownership. |
| Ownership checks on projects | `server/routes/projects.cjs`, project service | Cross-user reads/writes do not disclose or mutate another user's data. |
| Ownership checks on account state | `server/routes/account.cjs`, `server/services/account/accountStateStore.cjs` | Sections are stored under `req.user.id`; another user's section reads back empty. |
| Account-state input bounds | `accountStateStore.cjs` | Closed `settings`/`chats` allowlist, object-only payloads, post-serialization byte caps; unknown sections 400, oversized 413. |
| Per-user workspace sync mapping | `src/hooks/useAccountWorkspaceSync.ts` | One cloud project per account mapping; stale/foreign project ids are re-resolved from the caller's project list only. |
| Ownership checks on terminal sessions | `server/websocket/executionHandler.cjs` `owns()` and per-operation checks | Session operations require `ownerId === user.id`; foreign ids are reported as not found. |
| WebSocket authentication at handshake | `executionHandler.cjs` `tokenFromUpgrade` / `authenticateSocket` | No session exists before verification; early frames are buffered, then replayed only after auth. 4401 unauthenticated, 4403 unverified. |
| Origin allowlist for WebSocket upgrades | `originAllowed()` | Non-allowlisted browser origins are closed with 4403. Non-browser clients without an Origin header still require a valid token. |
| No client-supplied identity | `server/routes/auth.cjs` `/sync`, `authenticateRequest` | UID, email, verification state, and provider come from the verified token only. |
| Account pre-hijack defence | `server/services/auth/authService.cjs` `syncFirebaseUser` | An unverified identity cannot adopt an existing email; returns 409 and writes no rows. |
| No custom sessions or cookies | `server/routes/auth.cjs`, `server/db/index.cjs` migration v3 | No `sessions` table, no `Set-Cookie`, no opaque token issuance. |
| In-memory-only client credential | `src/utils/authToken.ts` | No localStorage/sessionStorage/cookie writes for the ID token. |
| Fail-closed production boot | `server/index.cjs` | Exits when `NODE_ENV=production` and Firebase Admin is not configured. |
| Fail-closed unconfigured development | `firebaseAdmin.cjs`, `AuthContext.tsx` | `/auth/sync` returns 503; protected APIs 401; UI reports "not configured" and never renders the workspace. |
| Rate limiting on `/api/auth/sync` | `server/app.cjs` | Per-IP sliding window, `AUTH_RATE_PER_MINUTE` (default 10). |
| Per-user rate limits on AI / execution / projects | `server/app.cjs` | Keyed by `req.user.id` when authenticated. |
| Security headers | `server/app.cjs` | `nosniff`, `DENY` framing, strict-origin referrer, Permissions-Policy, CSP, HSTS in production. |
| CORS fail-closed | `server/config/env.cjs` | Wildcard is fatal; production requires explicit HTTPS origins; localhost rejected in production. |
| Production execution gates | `server/config/env.cjs` | `ALLOW_LOCAL_EXECUTION=true` or `ALLOW_SHELL=true` in production is a fatal startup error. |
| Provider keys server-only | `server/config/env.cjs`, `vite.config.ts` | Server ignores/warns on `VITE_*` provider keys; production build blanks them. |
| No secrets in error responses | `server/middleware/errorHandler.cjs`, `aiErrorToUserMessage` | Stable codes/messages; stack traces only outside production. |
| Constant-shape credential failures | `AuthContext.tsx`, Firebase error mapping | Password reset does not reveal account existence. |
| Open-redirect protection | `src/utils/appRouter.ts` | Post-login redirects must be same-origin relative app paths; auth routes are rejected. |
| No guest affordance | `AuthLayout.tsx`, `AuthGate.tsx`, `SettingsHome.tsx`, `MobileHeader.tsx` | Guest labels/buttons removed; E2E asserts no "continue as guest" control exists. |

---

## 4. Attack surface removed

The following were deleted, not merely disabled:

- Guest mode and anonymous workspaces (`ANON_USER_ID`, `beta-anon` namespace,
  guest banners, guest quotas).
- Server-minted `anon:<ip>` identities and `requireAuthOrPublicBeta`.
- `DISABLE_AUTH`, `ALLOW_PUBLIC_BYPASS`, `VITE_DISABLE_AUTH`, `PUBLIC_BETA`,
  `VITE_PUBLIC_BETA`.
- Local password provider: `/api/auth/signup`, `/api/auth/login`, scrypt
  hashing, password verification, and credential storage.
- Custom opaque session tokens, the `sessions` table (migration v3), session
  cookies, and `AUTH_SECRET`.
- Hardcoded/mock users, fixtures, fake responses, and dev bypass users.
- Client-side `isAnonymous` branches in settings, header, and workspace.

Removing these eliminates entire vulnerability classes: guest-identity
collision, shared-identity data exposure, bypass-flag misconfiguration, and
credential-handling bugs in code the application no longer owns.

---

## 5. Findings and residual risks

No critical or high-severity authentication vulnerability was found in the
current implementation. The remaining items are operational limitations.

| # | Finding | Severity | Status / mitigation |
|---|---------|----------|---------------------|
| R1 | **In-memory rate limits are per process.** Behind multiple replicas, per-minute limits are not shared. Daily quotas in SQLite (`usage_daily`) remain a cross-restart/cross-instance backstop. | Medium | Documented. Move the limiter to Redis if the API scales horizontally. |
| R2 | **Single Node process.** In-flight AI streams and in-memory limit counters are lost on restart. Sessions are handled by Firebase, so sign-in survives a restart. | Low | Graceful shutdown aborts AI streams and closes terminals; Firebase session persistence rehydrates clients. |
| R3 | **Client IP derivation.** HTTP rate limiting uses `req.ip` with `trust proxy = 1` in production, which assumes exactly one trusted proxy hop (Render). WebSocket session accounting uses `socket.remoteAddress`. A different proxy topology would require revisiting this. | Low | Documented. Keep `trust proxy` aligned with the actual deployment; do not set it to `true`. |
| R4 | **No OS/container isolation for local execution.** `ALLOW_LOCAL_EXECUTION=false` in production routes execution to Wandbox, and `true` is fatal in production. Local development still executes on the host. | Medium (dev only) | Production is fail-closed; never expose a development process to untrusted users. |
| R5 | **WebSocket token in the query string.** Browsers cannot set an Authorization header on `new WebSocket()`, so the ID token is passed as `?token=`. Query strings may appear in proxy/access logs. | Low | WSS in production; Firebase ID tokens are short-lived (about an hour) and scoped to the project. Access logs do not record query strings in the application logger. |
| R6 | **Sign-out does not revoke already-issued ID tokens.** There is no server session; `POST /api/auth/logout` is an acknowledgement. Firebase ID tokens remain valid until expiry. | Low | Documented behavior. Use Firebase Admin revocation checks if immediate global revocation becomes a requirement. |
| R7 | **Fallback profile when the backend is unreachable.** If `/auth/sync` fails (for example a cold start), the UI shows the provider profile so the user is not stuck. Protected APIs remain guarded and return 401 until sync succeeds. | Low | The fallback is display-only; it never grants server-side access. |
| R8 | **Legacy DB column.** `users.password_hash` still exists as a `NOT NULL` column and stores a non-reversible `firebase:<provider>:<uid>` placeholder. No password is ever verified against it. | Informational | Migration-safe compatibility. A future migration can drop the column. |
| R9 | **Firebase project configuration is manual.** Authorized domains, enabled providers, and email templates live in the Firebase console and are not represented in code. | Operational | Documented in `docs/AUTHENTICATION.md` and the deployment checklist below. |

Previously reported issues that no longer apply because the feature was
removed: guest identity isolation, guest quotas, guest shell rejection,
`DISABLE_AUTH` shared identity, anonymous workspace persistence, and
`AUTH_SECRET` validation. They are intentionally not carried forward as open
findings.

---

## 6. Test results

| Command | Result |
|---------|--------|
| `npm test` | **46 files / 1643 tests pass** |
| `npm run typecheck` | Clean (`tsc -b --noEmit`) |
| `npm run build` | Production build succeeds |
| `npm run lint` | 0 errors (227 pre-existing warnings) |
| `npx vitest run tests/authEnforcement.test.ts` | 17 checks pass |
| `npx vitest run tests/authBackend.test.ts` | Token verification, sync/linking, 409 guard, `/api/auth/*`, rate limiting, fail-closed 503 |
| `npm run test:e2e:auth` | 16/16 pass — fail-closed stack: workspace locked, forms render, validation/focus, no guest affordance, responsive composition |
| `npm run test:e2e` | 5 pass, 15 skipped (authenticated editor specs need real credentials), 0 failed |

Coverage highlights:

- `tests/authBackend.test.ts` — Firebase-only backend contract; no sessions,
  no signup/login, no cookie/token issuance; pre-hijack 409; unconfigured 503.
- `tests/authEnforcement.test.ts` — 401/403 for AI, execution, projects,
  `/auth/me`; ownership; no guest path; no bypass flag.
- `tests/authFlow.test.ts` / `authRouter.test.ts` — route classification,
  redirect validation, state policy.
- `tests/authTransport.test.ts` — Bearer header attachment, WebSocket `?token=`,
  in-memory-only storage, no cookie fallback.
- `tests/authVerify.test.ts` — verification copy and deliverability guard.
- `tests/e2e/_auth.ts` — authenticated editor specs sign in with real
  credentials or `test.skip()`; they never fabricate a session.

---

## 7. Deployment checklist

### Backend (Render)

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` = exact frontend origin(s), HTTPS, no wildcard, no trailing slash
- [ ] `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` set
- [ ] `ALLOW_LOCAL_EXECUTION=false` (or unset)
- [ ] `ALLOW_SHELL=false` (or unset)
- [ ] At least one AI provider key set
- [ ] Startup log shows `firebaseConfigured: true`
- [ ] `GET /api/health` returns 200
- [ ] `GET /api/projects` without a token returns 401

### Frontend (Vercel)

- [ ] `VITE_API_URL` ends in `/api` and points at the live backend
- [ ] `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and the rest of the web config set **before** building
- [ ] No `VITE_*` provider keys or Firebase service-account values
- [ ] Deployment origin added to Firebase authorized domains
- [ ] Email/Password (and Google, if used) enabled in Firebase

---

## 8. Manual verification (browser / provider behavior)

The server-side token path has been verified live. The following browser and
provider behaviors still require manual checks against the Firebase project.

1. **Email sign-up** → `/signup` → account is created and the verification
   email arrives. Unverified sign-in lands on `/verify-email`, not `/app`.
2. **Verification** → open the emailed link → "I've verified my email" →
   workspace loads.
3. **Wrong password** → inline error; no session is created.
4. **Google sign-in** → popup completes (or redirect fallback) → workspace
   loads; Google accounts are treated as verified.
5. **Password reset** → generic success; the email arrives; the new password
   works.
6. **Reload persistence** → sign in, reload, stay signed in (Firebase
   persistence).
7. **Backend enforcement** → with a signed-in but unverified account, call
   `/api/projects` and `/api/ai/chat` → 403. Without a token → 401.
8. **Cross-user isolation** → create a project as user A; as user B, list
   projects and request A's project id → not visible/not found.
9. **Sign-out** → `/app` returns to the sign-in pane; protected APIs return 401.
10. **Fail-closed boot** → unset `FIREBASE_PROJECT_ID` on a production-like
    process → startup exits with `[FATAL] Refusing to start`.
11. **Unconfigured frontend** → build without `VITE_FIREBASE_*` → sign-in forms
    render, Google is hidden, submissions report "not configured", workspace
    stays locked.
12. **Cross-device account sync** → in two browser profiles signed into the
    same account, verify workspace push/pull and its backed-up conflict path,
    settings last-writer-wins, chat union plus deletion tombstones, account
    switch isolation, and recovery from the account card's Retry action.

---

## 9. Conclusion

The authentication system is now a single Firebase-backed model with a clear
trust boundary: verified ID token in, server-derived identity out. Guest and
bypass paths are gone rather than hidden behind flags, production fails closed,
and product APIs enforce authentication, verification, and ownership
independently of the UI.

The remaining risks are infrastructure-level and documented. The items in
section 8 require a live Firebase project and should be completed before
declaring the deployment fully verified.
