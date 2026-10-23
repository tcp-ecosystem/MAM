# Task Plan — Adoption Phases (live status)

> Health level: **L1 Public → L2 First External Users** (556 Open VSX
> installs verified Oct 23, 2026 — first real users in; independent
> `.mam`-in-the-wild evidence still to collect).
> Priority order: **npm release → docs site URL → before/after README →
> templates → outreach.**
> Quality pass before the NEXT release: the release itself waits until the
> remaining polish items below are finished.
> Rule 1: never manufacture evidence. Every checked item below carries proof
> (command output, file paths, or commit refs).

## Phase 1 — `mam convert` ✅ DONE

Convert what adopters already have (`AGENTS.md`, `CLAUDE.md`, skill files)
into a valid `.mam` module. Two-minute first win.

- [x] `mam convert <file> [-o out.mam]` CLI command (type inference: agent vs module)
      — `cli/src/commands/convert.ts`, registered in `cli/src/index.ts`
      (`-o/--type/--author/--dry-run/--json`)
- [x] Frontmatter synthesis (id, name, version, author, tags from content)
- [x] Section mapping (headings → Purpose/Rules/Prompt/Memory/Tools/Capabilities)
- [x] Fenced code blocks → Python/JavaScript sections by language tag
- [x] Output validates clean — convert validates **before** writing:
      throws at `convert.ts:238`, writes at `convert.ts:241`
- [x] Tests: AGENTS.md sample, CLAUDE.md sample, empty file, non-markdown rejection
      (17 test references across the cli suite; cli: 49/49 passing)
- [x] Docs: `usage.md` Quick Start step 3 + command table; README "Convert What
      You Already Have" section

## Phase 2 — Pitch Visible (IN PROGRESS)

- [ ] README before/after (messy agent markdown vs same thing as MAM + caught errors)
- [x] "MAM in 5 minutes" quickstart — README Quick Start now opens with the
      5-command loop: init → convert/new → validate → run
- [x] README Convert / Validate / MCP (`mam serve --mcp`) sections — stdio config
      verified against `cli/src/commands/serve.ts:startMcpServer` (`--mcp` is the
      MCP flag; plain `mam serve` is the HTTP dev server)
- [ ] Demo recording (convert → validate → publish) — needs the user to record

## Phase 3 — Validate Action ✅ DONE

- [x] `mam validate` GitHub Action — shipped as a repo-local composite action
      `.github/actions/mam-validate` (npm or pre-built CLI mode), wired as the
      `validate-modules` CI job validating the repo's own modules on every
      push/PR. Commit `a6c5abd`. Standalone `tcp-ecosystems/mam-action`
      marketplace repo remains a nice-to-have, not required.
- [x] Pre-commit hook config example — `.pre-commit-config.yaml` (`a6c5abd`)
- [x] Clear errors with fix hints (audit of all 53 built-in rules) — added
      `suggestions:[]` to every error/warning rule that emitted a bare message:
      FM001/002/003/005/006/007, SEC002/003/004/011, CB002/004, LNK001/002/003,
      TBL001. Verified live rendering (`→ ...` hints + `Fix:` lines) via a
      broken temp module; formatter support was already in `validate.ts:1086`.
- [x] (extra, discovered by the CI dogfood) `mam validate <directory>` — accepts
      a directory or single file, walks `.mam`/`.mam.md` recursively, prints
      PASS/FAIL per file, exits non-zero on any failure. Validates all 232
      shipped modules in ~18s (`a6c5abd`).
- [x] (extra) FM002 false-positive bug: the closing-fence search was capped at
      50 lines, failing valid 52-line frontmatter (`a6c5abd`); regression
      covered in `cli/tests/validate-rules.test.ts` (5 tests).

## Phase 4 — npm Release ⛔ BLOCKED (needs user's npm token)

Everything is prepped: versions aligned to `2.0.0`, LICENSE per package,
`publishConfig.access: public`, `bin` entries fixed (`mam`, `mam-lsp`,
`mamc`), scope membership confirmed, preflight runner ready
(`tools/scripts/preflight-publish.mjs`).

- **Truth check (Oct 23, 2026):** the public npm API still returns 404 for
  `@mam/cli`, so no `@mam/*` release has landed on the public registry yet.
  If any packages were pushed to an internal/platform registry, the public
  release below is still outstanding.
- [ ] User creates a granular npm token with 2FA bypass for automation
- [ ] Run preflight: `node tools/scripts/preflight-publish.mjs`
- [ ] Publish: `pnpm -r publish --access public` (user gives the explicit go)
- [ ] Post-publish verify: `npm i -g @mam/cli` exposes `mam`, `mam-lsp`, `mamc`
- [x] Pre-publish metadata: all 30 package.json `repository`/`homepage`/`bugs`
      URLs corrected (`github.com/tcp-ecosystem/` → `tcp-ecosystems/`, 40 files)
- [ ] Follow-up: Open VSX/Marketplace listing metadata still shows the
      singular `tcp-ecosystem/` URLs — fix with the next extension release

## Phase 5 — Templates & Publish Flow

- [x] Verify `mam install` from live Hub end-to-end — verified and it was
      **broken three ways**, now fixed in `cli/src/commands/install.ts`:
      1. `mam install <pkg>` ignored its explicit package argument entirely and
         installed a `package.json`-manifest fallback instead (`options.packages`
         was never read).
      2. The `RegistryClient` spoke npm-registry protocol (`GET /{name}`,
         `dist-tags`, `dist.tarball`) that the Hub has never served; the real
         API is `GET /modules/:name` → `GET /modules/:name/download?version=`
         → `GET /tarballs/:name/:version.tgz`, with bare data objects (no
         envelope) and no `package/` prefix inside tarballs.
      3. Default registry was the dead domain `registry.mam.dev`; now the live
         Hub `https://mam-hub.onrender.com` (README's advertised instance).
         Plus `extractTarball` now lists entries before stripping: Hub tarballs
         have no `package/` root, so the old `--strip-components=1` ate the
         file names and installed an empty directory.
      Proof: fresh temp project, `mam install example-agent` → exit 0, real
      extracted `.mam` module with correct frontmatter, lockfile v3 with the
      resolved URL + sha256 integrity, cli tests 49/49.
- [x] `mam publish` to the Hub — same class of breakage as install, fixed in
      `cli/src/commands/publish.ts`: the client now speaks the real Hub
      protocol (`POST /modules` with a `files: {path → content}` map collected
      by walking the module folder; `GET /modules/:name` for the
      version-exists check; `DELETE /modules/:name` for unpublish, with an
      honest "no single-version unpublish" error, since the Hub has no such
      API). The dead `registry.mam.dev` default is gone here too. The npm
      spec-echoing `unpublish <pkg> <version>` form now fails with a clear
      explanation instead of silently hitting the wrong endpoint.
      Proof: real example module, `mam publish --dry-run` → parses, lists
      targets; `mam publish` against the live Hub without a token → stops at
      the gate with the exact remedy ("Set MAM_TOKEN or use --token").
- [x] Multi-ecosystem publishing links **npm / python / github** — the
      "publish to the Hub → reuse everywhere" loop from `adoption-2.md` §15.
      New `mam publish --targets npm,python,github` (default stays `hub`):
      - `npm`  → generates `dist/npm/<id>/` (package.json with the .mam in
        `files`, mam metadata, README from the module info) and publishes with
        the real `npm` CLI; `npm pack --dry-run` verified locally.
      - `python` → generates `dist/python/` (setuptools pyproject with the
        module as package data); builds via `python -m build` and uploads via
        `twine` when installed, with install instructions when not.
      - `github` → writes release notes and attaches the module files to a
        Release on the module's own repo via the `gh` CLI; no remote/gh →
        notes only, clearly reported.
      Implementation: `cli/src/commands/publish-targets.ts` +
      `cli/tests/publish-targets.test.ts` (7 tests, dry-run only — no tokens
      needed). cli suite 59/59.
- [ ] Docs site published with a stable URL (GitHub Pages) — material
      exists at `docs/`, no URL
- [ ] README before/after comparison — the last Phase-2 doc piece
- [x] `awesome-mam` production library ladder (separate repo:
      `github.com/tcp-ecosystem/awesome-mam`, push `c94dfc9`, Oct 23 2026) —
      five folder levels built on `plan-doc/full-mam.md`'s full component set,
      no placeholders: `01-modules/` **complete** with 5 executable reference
      modules (`schema-validator`, `retry-policy`, `rate-limiter`,
      `structured-logging`, `config-loader`) — every module stdlib-pure with
      the envelope discipline (verdict + stable code + `duration_ms`), twins
      shipped; verification: Python harness **57/57 test cases executed and
      passing**, `mam validate awesome-mam` 10/10 files PASS (19 rules),
      `mam test` structural pass on all five; `config-loader` composes
      `schema-validator` via real dependency resolution (`DEPENDENCY_UNRESOLVED`
      gate proven). Levels 2–5 (components/workflows/services/systems) carry
      complete authoring contracts (Memory+Exports; retry/compensate/replay/stop;
      lifecycle+health+shutdown; repo-as-system with `mam.toml`+`system.mam.md`)
      — their `.mam` files are authored level by level, next up 02.
- [ ] `awesome-mam` "add yours" PR template — still TODO
- [ ] 2–3 standalone template repos (own repos, `mam-lang` topic) — external

## Phase 6 — Outreach

- [ ] 5–10 maintainer shortlist (agent/skill repos)
- [ ] Convert-PR template (their files → `.mam`, no obligation)
- [ ] Feedback log + credits

## Phase 7 — Public Launch

- [ ] Readiness checklist (`adpotion.md` §5) all green
- [ ] Show HN + communities with working demo

## Metrics (monthly, per `adpotion.md` §7)

10 external repos → 50 → 200 (Linguist-ready). Track owners, not just files.

**Verified snapshot (Oct 23, 2026):**

- Open VSX extension: **556 downloads** (v2.0.0, published 2026-10-07) —
  read from the Open VSX API.
- Hub: **19 live modules @ 2.0.0**, all listable; one installed end-to-end.
- npm `@mam/*`: **0 public** (404 verified; release staged behind the token).
- External `.mam` repositories: not yet measured.
