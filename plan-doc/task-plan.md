# Task Plan — Adoption Phases (live status)

> Health level: **L1 Public → L2 First External Users**.
> Priority order: **convert → validate action → npm release → templates → publish flow.**
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

- [ ] User creates a granular npm token with 2FA bypass for automation
- [ ] Run preflight: `node tools/scripts/preflight-publish.mjs`
- [ ] Publish: `pnpm -r publish --access public` (user gives the explicit go)
- [ ] Post-publish verify: `npm i -g @mam/cli` exposes `mam`, `mam-lsp`, `mamc`
- [x] Pre-publish metadata: all 30 package.json `repository`/`homepage`/`bugs`
      URLs corrected (`github.com/tcp-ecosystem/` → `tcp-ecosystems/`, 40 files)

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
- [ ] Verify `mam publish` friction (token flow, error messages) — `mam publish`
      has its own command path, not yet audited against the same protocol
- [ ] 2–3 standalone template repos (own repos, `mam-lang` topic) — external
- [ ] `awesome-mam` "add yours" PR template — separate repo

## Phase 6 — Outreach

- [ ] 5–10 maintainer shortlist (agent/skill repos)
- [ ] Convert-PR template (their files → `.mam`, no obligation)
- [ ] Feedback log + credits

## Phase 7 — Public Launch

- [ ] Readiness checklist (`adpotion.md` §5) all green
- [ ] Show HN + communities with working demo

## Metrics (monthly, per `adpotion.md` §7)

10 external repos → 50 → 200 (Linguist-ready). Track owners, not just files.
