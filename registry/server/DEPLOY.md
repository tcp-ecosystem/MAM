# Deploying MAM Hub (Production)

The registry service code is complete and tested (654 + 11 tests). This guide
covers running it as a public instance. Code on `main` is not a registry
anyone can use — this is the step that makes it one.

## Architecture

```text
Internet ──TLS──► Reverse proxy ──► 127.0.0.1:3000 ──► RegistryHttpServer
                                                          └── RegistryServer
                                                               ├── ModuleStore (./data/modules)
                                                               ├── auth.json (./data)
                                                               └── SearchEngine (in-memory, rebuilt on start)
```

Node serves plain HTTP. **Always put TLS termination in front** (Caddy/nginx);
never expose Node directly.

## Quick Start (local)

```bash
cd registry/server
pnpm install
pnpm build
node launcher.mjs   # see below
```

## Fly.io (free tier — start here)

The repo ships `Dockerfile` + `fly.toml` + `launcher.mjs`, all validated.
Docker is not needed locally; Fly builds remotely.

```bash
# One-time setup
fly auth login
cd registry/server
fly launch --no-deploy          # accept defaults; app name mam-hub
fly volumes create mam_data --size 1 --region iad   # persistent /data
fly secrets set MAM_ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
# Optional: fly secrets set MAM_ADMIN_USER=admin MAM_ADMIN_EMAIL=you@x.test MAM_CORS=https://yoursite.dev

# Ship it
fly deploy
fly status                      # check the /healthz check goes green
fly logs                        # watch startup: "MAM Hub listening…"
```

Notes:
- `fly.toml` pins `min_machines_running = 1` with a 1 GB volume so `auth.json`
  and `modules/` survive restarts. Free-tier machines sleep when idle and wake
  on request (`auto_start_machines`); the first request after sleep is slow.
- `force_https = true` terminates TLS at Fly — no Caddy needed here.
- The health check hits `/healthz`, which is auth-exempt and rate-limit-exempt
  by design, so Fly's prober never gets a 429.
- **Moving to a VPS later:** same `Dockerfile`/`launcher.mjs` run anywhere —
  only the host changes. See below.

## VPS (later — Hetzner/DO, ~$5/mo)

## Production Launcher (`launcher.mjs`)

```js
import { RegistryServer, RegistryHttpServer } from './dist/index.js';

const server = new RegistryServer({
  port: 3000,
  dataDir: process.env.MAM_DATA_DIR ?? './data',
  authRequired: true,               // public registry: everything gated
  rateLimit: 100,                   // per token/client per window
  rateLimitWindowMs: 60_000,
  maxUploadSize: 5 * 1024 * 1024,   // 5 MB publishes
  corsOrigins: (process.env.MAM_CORS ?? '').split(',').filter(Boolean),
  auth: {
    bootstrapAdmin: {
      username: process.env.MAM_ADMIN_USER ?? 'admin',
      email: process.env.MAM_ADMIN_EMAIL ?? 'admin@example.com',
      // NEVER ship a known password. Generate one per deployment:
      //   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
      password: process.env.MAM_ADMIN_PASSWORD ?? (() => { throw new Error('MAM_ADMIN_PASSWORD is required'); })(),
    },
  },
  logger: console,
});

await server.start();
const http = new RegistryHttpServer({ server, port: 3000, host: '127.0.0.1' });
await http.listen();
console.log('MAM Hub listening on 127.0.0.1:3000');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await http.close();   // drains in-flight, then closes
    await server.stop();
    process.exit(0);
  });
}
```

## Reverse Proxy (Caddy — TLS automatic)

```caddy
registry.mam.dev {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy provisions and renews TLS. For nginx, terminate TLS there and
`proxy_pass http://127.0.0.1:3000;` with `X-Forwarded-Proto` set — and only
then set `trustProxy: true` on the HTTP server.

## Configuration Reference

| Option | Env | Default | Notes |
|--------|-----|---------|-------|
| `port` | — | 3000 | Bind via `host: '127.0.0.1'` always |
| `dataDir` | `MAM_DATA_DIR` | `./data` | Holds `modules/` + `auth.json`; back it up |
| `authRequired` | — | `true` in prod | `false` only for local dev |
| `rateLimit` | — | 100 | Requests per window per token/client |
| `maxUploadSize` | — | 5 MB | Enforced while reading (413) |
| `corsOrigins` | `MAM_CORS` | `[]` | Comma-separated; never `*` with credentials |
| `auth.bootstrapAdmin` | `MAM_ADMIN_*` | none | Required; no defaults |

## Data & Backups

```text
data/
├── auth.json            # users (scrypt hashes) + tokens; versioned
├── auth.json.corrupt-N  # quarantined unparsable state (investigate, don't delete blindly)
└── modules/
    └── <name>/
        ├── meta.json    # always complete (atomic rename)
        └── <version>/…  # published files
```

Back up `data/` whole (filesystem snapshot or `rsync`). Restoring is
copying it back — the search index rebuilds from disk on `start()`.
Locking is per-process: **run exactly one writer per data directory**.

## Seeding the Founding Modules

```bash
# Point the CLI at the public instance, then publish each founding module:
export MAM_REGISTRY_URL=https://registry.mam.dev
for m in ../../modules/examples/*/*.mam; do mam publish "$m"; done
for m in ../../modules/templates/*/*.mam; do mam publish "$m"; done
```

Then verify: `mam search agent`, `curl $MAM_REGISTRY_URL/healthz`.

## Monitoring

- Liveness: `GET /healthz` (no auth, rate-limit exempt) — point uptime checks here.
- Logs: lifecycle + quarantines + internal errors via the configured logger.
- Metrics to watch: 429 rate (too tight?), 413 rate (limit too low?), 5xx
  (bugs — the client gets a generic message, the detail is server-side).
- Download counts feed the language-recognition evidence file
  (`plan-doc/language-recognition.md`).

## Security Checklist (pre-launch)

- [ ] `MAM_ADMIN_PASSWORD` generated per deployment, stored in a secret manager
- [ ] Bound to `127.0.0.1`, TLS at the proxy, HSTS enabled
- [ ] `authRequired: true`, `corsOrigins` explicit, `trustProxy` only if set
- [ ] `data/` backed up and restore-tested
- [ ] `mam audit` clean on all seeded modules
- [ ] Rate limits smoke-tested (`mam search` burst → 429 with `RateLimit-*`)
