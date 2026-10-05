# MAM Hub — Admin Account Runbook

> **The password is NEVER written here, in chat, or in git.**
> It lives in the operator's password manager. This file records everything
> *around* the secret so a future operator can rotate, recover, and audit
> without guessing.

## Identity

| Field | Value |
|-------|-------|
| Username | `admin` (override via `MAM_ADMIN_USER`) |
| Email | set via `MAM_ADMIN_EMAIL` |
| Password | env-only (`MAM_ADMIN_PASSWORD`), generated per deployment |
| Scope | full (bootstrap administrator) |

## How the Password Is Set

The launcher **requires** `MAM_ADMIN_PASSWORD` and refuses to start without it.
There is no default, no fallback, nothing hardcoded:

```bash
# Generate (Linux / sprite)
export MAM_ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")

# Generate (Windows PowerShell)
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:MAM_ADMIN_PASSWORD = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
```

## Rotation

1. Log in with the current password → `POST /auth/login`.
2. Change it → `POST /auth/password` (old + new). **All existing tokens are
   revoked on change** — every client re-authenticates.
3. Store the new value in the password manager; destroy the old one.
4. Restart is NOT required; revocation is immediate.

## Lockout & Recovery

- Repeated failed logins lock the account (see `auth.ts`: `maxFailedAttempts`,
  `lockoutMs`). Wait out the window — do not restart to clear it (state is
  persistent by design).
- Lost password with no other admin: stop the server, delete ONLY the user
  record via a fresh `bootstrapAdmin` on an empty `auth.json`… in practice,
  rotate from a backup of `data/` taken before the loss. **Back up `data/`.**

## Audit

- Every login, password change, and lockout is server-logged (never the password).
- `auth.json` holds scrypt hashes + tokens. `auth.json.corrupt-N` files are
  quarantined unparsable state — investigate, never delete blindly.

## Instances

| Instance | URL | Password location | Notes |
|----------|-----|-------------------|-------|
| Local dev (Windows) | `http://127.0.0.1:3000` | operator password manager | rotated off `local-test-only` 2026-10-05 |
| Public sprite | TBD — filled at launch | operator password manager (fresh value, never the local one) | `HOST=0.0.0.0`, data at `/home/sprite/mam-data` |
