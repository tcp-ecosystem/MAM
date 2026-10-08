# MAM Achievements — Launch Record

> **2026-10-05: MAM Hub launched publicly.** This file records what shipped,
> what was proven, and what remains. Dates are facts; targets live in
> [goal.md](../goal.md).

---

## 🏆 2026-10-05 — Public Registry Launch

**MAM Hub serves real traffic**: production registry (HTTP + GraphQL + typed
client), 20 founding modules seeded, publicly reachable and verified
end-to-end from the outside with no credentials.

| Proof | Result |
|-------|--------|
| Health | `{"status":"ok"}` via public URL |
| Search (anonymous) | `example-agent, example-team` |
| Download (anonymous) | real URL + `sha256-…` |
| GraphQL (anonymous) | `{"modules":20,"totalVersions":20}` |
| Tarball | 4,600 real bytes, unpacks to published files |
| Auth gating | unauthenticated writes correctly 401 |

## 🏆 2026-10-04/05 — Production Registry Service

| Work | Tests |
|------|-------|
| HTTP service (`node:http`, zero framework): routing, CORS, security headers, body limits, rate-limit headers, graceful shutdown | 58 (`http.test.ts`) |
| GraphQL execution (reference `graphql-js`, shared store) | 24 (`graphql.test.ts`) |
| Client↔server integration (published client vs live server) | 11 (`client-integration.test.ts`) |
| Auth persistence, atomic writes, per-module locks | auth/store suites |
| Path traversal closure (proven escape → fixed + 30 tests) | `store.test.ts` |
| Inverted search index, client token hydration | search/client suites |
| Real gzip tarballs with integrity; JSON scalar that parses | download + scalar fixes |
| **Total** | **400 server + 123 api + 131 client** |

Bugs the integration suite caught that unit suites missed: tagless-publish
500, stale client token after logout, JSON scalar pass-through, SDL/contract
mismatches, missing `dependencies` publish field.

## 🏆 2026-10-07 — Permanent Registry + Editor Distribution Complete

- **Render live:** `https://mam-hub.onrender.com` — self-seeding image (19/19 on
  cold boot), verified health + GraphQL + anonymous search from outside.
  Tunnels retired; Docker builds fixed clean (lockfile committed, ordered
  builds, declared `@types/node`).
- **OpenVSX v2.0.0 live** (`arkhangellifejiggy.mam-language`), **324 downloads**
  and climbing — namespace ownership granted.
- **VS Code Marketplace LIVE:** `ArkhAngelLifeJiggy.mam-language` (fixed
  invalid `Syntax Highlighting` category + v2.0.0).

## 🏆 2026-10-05 — Editor Distribution (day one)

- VS Code extension 1.0.0 published on OpenVSX, namespace ownership granted.
- TextMate `fileTypes` fixed in vscode/zed/visualstudio grammars.

## 🏆 2026-10-03/04 — Documentation Catch-Up

- README: full 45-command catalogue, complete `mam.toml`, 19-type examples
  catalogue, registry section, phased delivery (745 → 855 lines).
- purpose/goal/scope/brain + usage/relevant-file/SECURITY/CONTRIBUTING refreshed
  to real counts: 58 packages, 7,000+ tests, 19 templates.
- `DEPLOY.md`, `account.md`, `plan-doc/language-recognition.md`,
  `plan-doc/launch-kit/` (awesome-mam + announce) written.

## 🏆 2026-10-04 — Language-Recognition Groundwork

- Grammar claims `.mam`/`.mam.md`; all regexes compile; 8/8 constructs tokenize.
- `.gitattributes`: `.mam` as text, compiled outputs as `linguist-generated`.
- Roadmap filed: ~200 public repos is the gate; registry + templates are the engine.

## Running Totals

- **Tests:** 7,000+ across 264 files (registry: 654 + 11 e2e)
- **Packages:** 58 workspace (+ root)
- **CLI:** 45 commands (+ aliases)
- **Templates/examples:** 19 type folders each
- **Registry modules live:** 20 (19 seeded + 1 first publish)

## Open Threads (not ours to close today)

- Linguist adoption → 200 public repos (registry + templates + 324 extension
  downloads working on it; evidence file: `language-recognition.md`)
- VPS + custom domain → when funded (Render free holds the launch now)
- Multi-process store locking, `getRecent` ranking → accepted limitations
