# Contributing to Azemax Studio

Thank you for your interest in contributing! This document outlines the workflow, standards, and expectations for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Testing](#testing)
- [Security](#security)
- [Architecture Decisions](#architecture-decisions)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/your-username/azemax-studio.git`
3. **Install dependencies**: `npm install`
4. **Configure environment**: `cp .env.example .env` and add required values
5. **Start dev**: `npm run dev`
6. **Run tests**: `npm test` (must pass before submitting)

## Development Workflow

### Branch Strategy

- `main` — production-ready, protected branch
- Feature branches: `feat/<short-description>`
- Fix branches: `fix/<short-description>`
- Docs branches: `docs/<short-description>`
- Refactor branches: `refactor/<short-description>`

### Before You Start

1. Check existing [Issues](https://github.com/your-org/azemax-studio/issues) and [Discussions](https://github.com/your-org/azemax-studio/discussions)
2. For significant changes, open an issue first to discuss the approach
3. Keep PRs focused — one logical change per PR

### Local Development

```bash
# Start dev servers (API + Vite)
npm run dev

# Run type-check
npm run typecheck

# Run linter
npm run lint

# Run tests
npm test

# Build to verify production compile
npm run build
```

## Coding Standards

### TypeScript

- **Strict mode** enabled — no `any` without justification
- **Explicit return types** for exported functions
- **Interfaces over types** for object shapes
- **Const assertions** for literal unions
- **Discriminated unions** for state machines (e.g., `AIResult`, `AgentLoopResult`)

### React

- **Function components** with hooks only
- **Colocated state** — keep state as local as possible
- **Memoization** only when profiling shows benefit
- **No inline styles** — use Tailwind classes or CSS modules
- **Props destructuring** with defaults

### Backend (CommonJS)

- **Fail-closed** — validate early, exit loudly on misconfiguration
- **No secrets in logs** — variable names only, never values
- **Typed errors** — use `AIError` with `code`, `provider`, `retryable`
- **SQLite transactions** for multi-step operations
- **Prepared statements** — never string-concatenate SQL

### File Organization

```
src/
├── components/     # Presentational UI (Panels, Editor, Layout)
├── core/           # Business logic (AI, editor, workspace, filesystem)
├── hooks/          # React hooks (auth, sync, workspace)
├── utils/          # Pure utilities (apiClient, authToken, safeTree)
└── styles/         # Global CSS + Tailwind
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `aiToolExecutor.ts` |
| Components | PascalCase | `AIAssistant.tsx` |
| Hooks | camelCase + `use` | `useAuth.ts` |
| Functions | camelCase | `buildWorkspaceSnapshot` |
| Constants | UPPER_SNAKE_CASE | `MAX_STREAM_BYTES` |
| Types/Interfaces | PascalCase | `WorkspaceSnapshot` |
| Enums | PascalCase | `RequestKind` |

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding/modifying tests |
| `chore` | Maintenance (deps, build, CI) |
| `security` | Security fix |
| `build` | Build system changes |
| `ci` | CI configuration changes |

### Examples

```
feat(ai): fuse semantic planner into agent loop

Eliminates separate planner LLM call (~5-15s latency).
Agent now handles intent → inspect → execute in one loop.

Closes #123
```

```
fix(security): add SSE stream byte limit (10 MB)

Prevents unbounded provider streams from consuming memory.
Added MAX_STREAM_BYTES constant and byte counter in pipeProviderStream.
```

```
docs(readme): add architecture diagram and deployment checklist
```

## Pull Requests

### PR Requirements

1. **All checks pass**: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
2. **Focused scope** — one logical change
3. **Tests included** for new behavior
4. **Documentation updated** if user-facing change
5. **No breaking changes** without major version bump discussion

### PR Template

```markdown
## Summary
Brief description of the change.

## Type
- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor
- [ ] perf
- [ ] test
- [ ] chore
- [ ] security

## Testing
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Manual verification (describe)

## Breaking Changes
- [ ] No breaking changes
- [ ] Breaking changes documented (migration guide if needed)

## Screenshots (if UI)
<!-- Add before/after screenshots -->

## Related Issues
Closes #XXX
```

### Review Process

1. **Automated checks** must pass (GitHub Actions)
2. **Code review** by at least one maintainer
3. **Security review** for auth, AI, execution, or config changes
4. **Merge** after approval — squash and merge preferred

## Testing

### Test Categories

| Category | Command | Purpose |
|----------|---------|---------|
| Unit/Integration | `npm test` | Vitest, jsdom, 1643 tests |
| Type-check | `npm run typecheck` | `tsc -b --noEmit` |
| Lint | `npm run lint` | ESLint (React + TS rules) |
| Auth E2E | `npm run test:e2e:auth` | Fail-closed auth (no Firebase) |
| Editor E2E | `npx playwright test` | Authenticated specs (needs credentials) |

### Writing Tests

- **Unit tests** for pure functions (parsers, validators, formatters)
- **Integration tests** for API routes (using test fixtures)
- **E2E tests** for critical auth/execution flows
- **No test-only exports** — test through public APIs
- **Deterministic** — no flaky timeouts, fixed test data

### Test Conventions

```typescript
// File: tests/featureName.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('featureName', () => {
  it('does X when Y', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Security

### Reporting Vulnerabilities

See [SECURITY.md](SECURITY.md) — **do not open public issues** for security vulnerabilities.

### Security-Relevant Changes

Changes to these areas require explicit security review:

- Authentication/authorization (`server/middleware/auth.cjs`, `server/routes/auth.cjs`)
- AI provider routing (`server/services/ai/`)
- Code execution (`server/services/execution/`, `server/websocket/`)
- Environment validation (`server/config/env.cjs`)
- CORS/origin handling
- Rate limiting
- Input validation / path traversal

### Dependency Updates

- Run `npm audit` before updating
- Check licenses for compatibility (Apache-2.0 compatible only)
- Update `package-lock.json` with `npm install`
- Test thoroughly — `npm test` + `npm run build`

## Architecture Decisions

Major architectural decisions are recorded in:

- [AZEMUX_ARCHITECTURE_AUDIT.md](AZEMUX_ARCHITECTURE_AUDIT.md) — comprehensive audit with prioritized improvements
- [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md) — authentication security audit
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — high-level architecture (if exists)

### Key Invariants (Do Not Break)

1. **Firebase is the only identity provider** — no custom sessions, cookies, or passwords
2. **Provider keys never reach the browser** — enforced by Vite build + server validation
3. **Fail-closed production boot** — server exits if Firebase Admin or CORS misconfigured
4. **Atomic edit pipeline** — compile → validate → apply → verify → rollback
5. **Ownership checks on all data** — every query scoped by `req.user.id`
6. **No guest/anonymous access** — no bypass flags, no `DISABLE_AUTH`

### When in Doubt

- Open a discussion or issue before implementing
- Prefer explicit over implicit
- Fail loudly with actionable error messages
- Preserve backward compatibility for environment variables

---

**Questions?** Open a [Discussion](https://github.com/your-org/azemax-studio/discussions) or ask in the PR.