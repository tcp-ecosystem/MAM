# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within MAM, please send an email to the project maintainers. All security vulnerabilities will be promptly addressed.

**Please do NOT report security vulnerabilities through public GitHub issues.**

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- Initial response: within 48 hours
- Assessment: within 1 week
- Fix timeline: dependent on severity

## Security Model

MAM is designed with layered, verifiable boundaries. What each layer guarantees:

### Module Permissions

Every module declares what it may touch in frontmatter (`permissions:`), and the
runtime enforces it — filesystem, network, and process access are denied unless
granted. A module that exceeds its grant fails closed, not open. Audit with
`mam audit <file>`.

### Sandboxing

Untrusted steps execute under filesystem/network/process policies with limits
and timeouts (`runtime/src/v2/sandbox.ts`). Treat any sandbox escape as a
critical vulnerability.

### Registry Authentication

- Passwords are salted scrypt hashes (never plaintext, never logged).
- No default credentials: the bootstrap admin is explicit, opt-in configuration.
- Failed logins lock the account; tokens are opaque, scoped, revocable, and
  expire — including across restarts.
- Auth state is versioned on disk; corrupt state quarantines rather than loading.

### Registry Storage Safety

- Module names and file paths are validated before touching the filesystem:
  `../` escapes, absolute paths, null bytes, and backslashes are rejected, and
  every resolved path is re-checked to stay inside the data directory.
- Metadata writes are atomic (temp file + rename), so a crash leaves the old
  complete record or the new one — never a partial `meta.json`.
- Error responses never leak stack traces or filesystem paths; detail goes to
  server-side logs only.

### Transport

- CORS origins are enforced, never `*` with credentials.
- Request bodies are size-limited (413, enforced while reading).
- Rate limiting is keyed by token then client IP; `X-Forwarded-For` is only
  trusted behind an explicitly configured proxy.
- Security headers (`nosniff`, `DENY`, CSP, referrer policy, HSTS on TLS) on
  every response.

## Security Best Practices

When using MAM in production:

- Keep dependencies up to date (`mam update`, `pnpm update`)
- Run with minimal privileges; bind the registry to `127.0.0.1` behind a reverse proxy
- Use environment variables for secrets — never commit tokens or passwords
- Set `auth.bootstrapAdmin` explicitly; never ship a known password
- Enable audit logging (`mam audit`, registry server logs)
- Review plugin code before installation (`mam plugin`, `mam inspect`)
- Pin dependency versions in `mam.toml` and verify tarball integrity hashes
- Run `mam validate --level strict` and `mam lint` in CI before publishing
