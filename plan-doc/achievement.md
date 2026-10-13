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
- **OpenVSX v2.0.0 live** (`arkhangellifejiggy.mam-language`), **426 downloads**
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

> Note: the counts in this section were refreshed on 2026-10-05 and are
> superseded by the verified totals at the end of this file.

## 🏆 2026-10-04 — Language-Recognition Groundwork

- Grammar claims `.mam`/`.mam.md`; all regexes compile; 8/8 constructs tokenize.
- `.gitattributes`: `.mam` as text, compiled outputs as `linguist-generated`.
- Roadmap filed: ~200 public repos is the gate; registry + templates are the engine.

## 🏆 2026-10-07 — Parser Correctness, `.mam` Coverage, 2.0.0 Alignment

Two lexer defects closed, both proven pre-existing rather than assumed:

- **Standalone hyphens rejected.** `a - b` and `value -5` ended the text scan,
  were re-lexed alone where nothing matched, and raised
  `UNEXPECTED_CHARACTER`. Hyphenated words, list markers, `---` and `->` were
  always fine — only the prose dash was broken.
- **Tokenizer hang on a dash-only line.** `isListMarker` tested `[-*+]\s`
  against the remaining input, so `\s` matched the newline of a line holding
  only `-`. `readListItem` then matched against the line text, matched
  nothing, consumed nothing and emitted no token — the tokenizer spun forever.
  Predicate now requires a space/tab, and `readListItem` consumes a character
  rather than stall.

Covered by `parser/tests/lexer/hyphen-regression.test.ts` (14 tests). Parser
suite: **196 tests, all passing**.

**`.mam` was silently unsupported.** `lsp/src/protocol/mam.ts` declared only
`**/*.mam.md`, so plain `.mam` files received no language features at all. The
selector now comes from a shared `MAM_FILE_PATTERNS` covering both, and the
same `.mam.md`-only declarations in `testing`, `cli` (build/new/graph/docs/
execute), `package-manager` and `reference` were corrected — behaviour had
been depending on which code path happened to run. Also declared the missing
`@jupyterlab/settingregistry` dependency that `desktop-extension/jupyter`
imported but never listed.

**Versions realigned to 2.0.0.** All 30 publishable packages had drifted to
`0.1.0` while the canonical `MAM_VERSION` in `ast/src/constants/version.ts` was
already `2.0.0`. Package versions, the hardcoded constants in mcp / validator /
lsp / registry-api / reference / plugins, CLI templates and runtime v2 are now
all `2.0.0`.

**npm release staged (not yet published).** LICENSE shipped into every package,
repository/homepage/bugs/publishConfig metadata added, and three `bin` entries
found that npm was silently dropping because their paths started with `./` —
`mam`, `mam-lsp` and `mamc` would all have been missing from the published
tarballs. `pnpm preflight:publish` now checks auth, `@mam` scope membership,
build artifacts, bin targets and version collisions before anything uploads.

## Running Totals

Verified by running the suites, not by summing the docs:

- **Tests:** 4,039 passing across 30 packages (29 green; `registry/server`
  has a Windows `ENOTEMPTY` cleanup flake)
- **Packages:** 31 leaf workspace packages (30 publishable + 1 private)
- **CLI:** 50 commands (+ aliases)
- **Templates/examples:** 19 type folders each
- **Registry modules live:** 20 (19 seeded + 1 first publish)

## Open Threads (not ours to close today)

- Linguist adoption → 200 public repos (registry + templates + 426 extension
  downloads working on it; evidence file: `language-recognition.md`)
- VPS + custom domain → when funded (Render free holds the launch now)
- Multi-process store locking, `getRecent` ranking → accepted limitations
