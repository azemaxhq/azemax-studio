# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (main) | ✅ Yes |
| Previous releases | ❌ No |

Only the latest version on `main` receives security updates. Deploy from `main` for production.

## Reporting a Vulnerability

**Do not open public issues for security vulnerabilities.**

Email: **security@azemax.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will:
1. Acknowledge within **48 hours**
2. Provide initial assessment within **5 business days**
3. Coordinate fix and disclosure timeline
4. Credit reporter (unless anonymous requested)

## Security Architecture

### Authentication & Authorization

- **Firebase-only identity** — no custom sessions, cookies, or password storage
- **Verified-email enforcement** — unverified accounts get 403 on all product routes
- **Fail-closed production boot** — server exits if Firebase Admin or CORS misconfigured
- **Ownership checks** — every query scoped by `req.user.id`

### AI Provider Keys

- **Server-only** — `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `KILO_API_KEY`
- **Vite build blanks `VITE_*` keys** — production build strips all `VITE_*_API_KEY` and `VITE_HF_TOKEN`
- **Server ignores leaked keys** — warns and discards any `VITE_*` provider keys in server env

### Code Execution

| Environment | Execution Path |
|-------------|----------------|
| Development | Local runtimes (Node, Python, C++, Java, Rust, Go, etc.) |
| Production | Wandbox sandbox API (`ALLOW_LOCAL_EXECUTION=false` enforced) |

**Production safeguards:**
- `ALLOW_LOCAL_EXECUTION=true` → fatal startup error
- `ALLOW_SHELL=true` → fatal startup error
- Byte caps: code 200KB, stdin 32KB, output 512KB
- Timeouts: execute 60s, compile 30s, Wandbox 55s
- Path-traversal guards, minimal env, temp dir cleanup

### Network & Transport

- **CORS** — explicit HTTPS origins only; wildcard fatal with credentials; localhost rejected in production
- **WebSocket auth** — ID token in query string (`?token=`), verified at handshake; 4401/4403 on failure
- **Rate limits** — per-user (AI, execution, projects) + per-IP (auth); in-memory with SQLite daily backstop
- **Security headers** — `nosniff`, `DENY` framing, `strict-origin-when-cross-origin`, CSP, HSTS (prod)

### Input Validation

- Zod schemas on all API routes
- Path normalization + traversal rejection (`normalizeResourcePath`)
- Byte caps on all payloads (request body, workspace, account state)
- SQL prepared statements only

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthenticated API access | Firebase Admin `verifyIdToken` on every protected route |
| Guest/anonymous data access | No guest mode; all routes require verified identity |
| Provider key leakage | Server-only keys; Vite build-time blanking; server runtime filter |
| Untrusted code execution | Production uses Wandbox; local execution fatal in prod |
| SQL injection | Prepared statements only; no string concatenation |
| Path traversal | `normalizeResourcePath` rejects `..`, control chars, over-long segments |
| CORS misconfiguration | Fail-closed validation in `server/config/env.cjs` |
| Rate limit bypass | Per-user + per-IP; daily quotas in SQLite |
| Session fixation | No server sessions; Firebase ID tokens only |
| Open redirects | Post-login redirects validated same-origin |

## Known Residual Risks

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| R1 | In-memory rate limits not shared across replicas | Medium | Documented; move to Redis for horizontal scaling |
| R2 | Single Node process — in-flight streams lost on restart | Low | Graceful shutdown; Firebase session persistence |
| R3 | WebSocket token in query string (may appear in proxy logs) | Low | WSS in production; tokens short-lived (~1hr) |
| R4 | No OS isolation for local dev execution | Medium (dev) | Production fail-closed; never expose dev to untrusted users |
| R5 | Sign-out doesn't revoke issued ID tokens | Low | Documented; Firebase Admin revocation available if needed |

## Secure Development Practices

### For Contributors

1. **Never commit secrets** — `.env` is gitignored; use `.env.example` for templates
2. **Validate early** — fail-closed at startup, not at request time
3. **Log variable names only** — never secret values
4. **Use typed errors** — `AIError` with `code`, `provider`, `retryable`
5. **Scope every query** — `req.user.id` ownership checks
6. **Run security checks** — `npm audit`, `npm test`, `npm run typecheck` before PR

### For Maintainers

1. **Dependency updates** — check `npm audit`, license compatibility, test thoroughly
2. **Release process** — security patches cherry-picked to `main`; no LTS branches
3. **Incident response** — rotate affected keys, audit logs, notify users if data exposed
4. **Third-party services** — review Firebase, Wandbox, AI provider ToS changes quarterly

## Security Audit

Current posture documented in [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md):

- **1643 tests passing** (auth enforcement, backend contract, transport, flow, verification)
- **No critical/high-severity** authentication vulnerabilities found
- **Fail-closed** behavior verified against live deployment
- **Residual risks** documented and operational

## Compliance

- **Apache License 2.0** — see [LICENSE](LICENSE)
- **No GPL/AGPL dependencies** — all transitive deps Apache-2.0 compatible
- **Font licenses** — SIL OFL 1.1 (Inter, JetBrains Mono, Newsreader, Playfair Display)
- **Data processing** — Firebase (auth), Wandbox (execution), AI providers (inference) — see respective ToS

## Contact

Security team: **security@azemax.com**

For non-security issues, use [GitHub Issues](https://github.com/your-org/azemax-studio/issues).