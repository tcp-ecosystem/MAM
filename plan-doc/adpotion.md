# MAM Adoption Plan

> Foundation first, everything else follows.

MAM (Machine Agent Modules) is built: spec, CLI, VS Code + Open VSX extension,
TypeScript/JavaScript SDKs, and the MAM Hub registry. The next problem is
**wild usage**: real `.mam` files, written by people outside this org.

This document is the plan for getting there. Execution lives in
[task-plan.md](task-plan.md) — this file explains the strategy, task-plan is
the checklist.

---

## 0. What already exists (the leverage we keep forgetting)

Adoption is not starting from zero. Everything below is shipped and verified;
the plan should exploit it, not rebuild it.

| Asset | State | Evidence |
|-------|-------|----------|
| `mam` CLI, 50 commands | Shipped | `cli/src/index.ts` |
| `mam convert <file>` (AGENTS.md/CLAUDE.md → `.mam`) | **Shipped, tested** | `cli/src/commands/convert.ts`, 17 test references |
| `mam validate`, `mam run`, `mam smoke`, `mam doctor` | Shipped | CLI command catalogue |
| `mam validate <dir>` (recursive `.mam` + `.mam.md`) | **Shipped, tested** | all 232 repo modules pass in one command; FM002 50-line false-positive fixed (`a6c5abd`) |
| `mam validate` GitHub Action + CI dogfood | **Shipped** | `.github/actions/mam-validate` composite + `validate-modules` CI job (`a6c5abd`); fix-hint audit landed (`5087bac`) |
| `mam install <module>` from the live Hub | **Verified end-to-end** | fixed 4 breakages (client protocol, ignored args, dead default domain, tarball root stripping); `example-agent` → exit 0 with extracted module + integrity lockfile (`5087bac`) |
| `mam publish` to the Hub (file or folder) | **Rewritten onto the real Hub API** | `POST /modules` files-map publish, `GET/DELETE /modules/:name` (`ae078c0`) |
| Multi-ecosystem fan-out (`--targets npm,python,github`) | **Shipped, tested (dry-run)** | `cli/src/commands/publish-targets.ts`; npm target passes a real `npm pack --dry-run` (`ae078c0`) |
| 16 compiler targets | Shipped | `compiler/src/` |
| 30 publishable npm packages @ 2.0.0 | **Staged — NOT on public npm yet** | public API returns 404 for `@mam/cli` (verified Oct 23, 2026); preflight green, blocked only on the granular npm token |
| MAM Hub on a permanent domain | Live | `mam-hub.onrender.com`, 19 example modules seeded @ 2.0.0 (verified via `GET /modules`) |
| VS Code extension — Open VSX | **Live — 556 downloads** | extension v2.0.0 published Oct 7, 2026; count read from the Open VSX API Oct 23, 2026 |
| VS Code extension — Marketplace | **Live** | `ArkhAngelLifeJiggy.mam-language` |
| `mam-lsp` language server | Shipped | `lsp/`, bin wired |
| MCP server (`mam serve --mcp`, `@mam/mcp`) | Shipped **and documented** | README + usage.md carry the client config; 26 tests |
| Docs material | README documented (5-command loop, convert/validate/MCP/targets) | `docs/` site — material only, **still no stable URL** |
| Token-efficiency engine | Shipped | `@mam/token-optimization`, 5 layers, 70 tests |

Two of the biggest unshipped levers remain the public npm release and the docs
site URL. Meanwhile the loop that matters is already closed end-to-end:
convert → validate → run → install from the Hub → publish to the Hub → fan
out to npm/PyPI/GitHub.

---

## 1. Why adoption matters

- **GitHub Linguist.** `.mam` language recognition wants roughly 200 unique
  `user/repo` repositories running the extension in the wild. Guideline, not a
  hard rule; distinct owners matter more than raw repo count.
- **Network effect.** The Hub is only as useful as the modules published to it.
- **Feedback.** Real users find spec rough edges faster than we do.
- **The differentiator nobody has.** Markdown agent files are unreadable to
  machines. MAM makes them *validatable, token-budgetable, and executable* —
  and exposes them over MCP so any agent client can use them.

**Goal:** 200+ public repos containing `.mam` files, from many distinct
owners, tracked openly.

> Do not mass-create repos from one account. A handful of real adopters is
> worth more than hundreds of synthetic ones, and synthetic usage risks
> hurting the Linguist case.

---

## 2. Target audience (start narrow)

**Primary:** developers who already write markdown for agents — `AGENTS.md`,
`CLAUDE.md`, skill files, system prompts, tool specs.

They already feel the pain (unstructured, unvalidated, unshareable). MAM is an
upgrade of an existing habit, not a new one.

**Later:** agent-framework authors, bug-bounty/security tooling builders,
teams standardizing internal agent specs, MCP client users (Claude Desktop,
Cursor, VS Code agent mode).

---

## 3. The first-win principle

A new adopter gets value in **under two minutes**, without buying into the
ecosystem.

| Need | Deliverable | Status |
|------|-------------|--------|
| Convert what I already have | `mam convert AGENTS.md` → valid `.mam` | **Done** |
| Install with one command | `npm install -g @mam/cli` | **Blocked on token** (public npm 404 verified Oct 23, 2026) |
| Start fresh quickly | `mam init` + template repos | `init` done; templates TODO |
| Catch mistakes automatically | `mam validate` GitHub Action + pre-commit hook | **Done** (in-repo action + CI; marketplace repo optional) |
| Edit comfortably | VS Code / Open VSX extension | **Done** (556 installs) |
| Use inside an agent client | `mam serve --mcp` config | **Done** — documented in README + usage.md |
| See the token savings | `mam optimize`/budget report converted vs raw | Shipped, **unpitched** |
| Reuse others' work | `mam install` from the Hub | **Done, verified end-to-end** |
| Share my work | `mam publish` (Hub) + fan-out | **Hub flow shipped; multi-target fan-out shipped in dry-run; real ecosystem uploads need the user's tokens** |

Priority order: **npm release → docs site URL → before/after README →
templates → outreach → launch.**

---

## 4. Workstreams

### A. Ship the distribution that is already staged
- Publish the 30 `@mam/*` packages (`pnpm preflight:publish`, then
  `pnpm -r publish --access public`). Everything else is done; the only blocker
  is a granular npm token with bypass-2FA. Public-npm 404 re-verified Oct 23,
  2026 so this row stays honest until the token lands.
- Verify `npm install -g @mam/cli` puts a working `mam` on PATH with the
  `mam`, `mam-lsp` and `mamc` binaries — the three `bin` entries npm was
  silently dropping before the prefix fix.
- npm weekly downloads become a real external-usage metric for free.

### B. Make the pitch visible
- "MAM in 5 minutes" is **done** — the README Quick Start opens with the
  5-command loop (init → convert/new → validate → run), plus Convert /
  Validate / MCP sections.
- README before/after is still open: a messy markdown agent file next to the
  same thing as a MAM module, including the validation errors MAM caught — and
  the token budget report for both.
- Short demo (GIF or terminal recording): convert → validate → publish.
- Publish the drafted `docs/` site (GitHub Pages) — material exists, no URL
  exists.

### C. Validation everywhere — largely done
- `mam validate` GitHub Action: shipped as the in-repo composite
  `.github/actions/mam-validate`, wired as a `validate-modules` CI job that
  validates all 232 shipped modules on every push/PR. A standalone
  `tcp-ecosystems/mam-action` marketplace repo is optional, not required.
- Pre-commit hook example: `.pre-commit-config.yaml`.
- Fix-hint audit: done — every error/warning rule now carries fix
  suggestions (17 rules updated), rendered as `→ hint` lines.
- CI dogfood found and fixed a real bug: FM002's 50-line search window
  rejected valid 52-line frontmatter (package/runtime/team advanced
  templates); regression tests in `cli/tests/validate-rules.test.ts`.

### D. Seed the ecosystem
- Make the 19 seeded Hub modules genuinely reusable (they are live and
  installable — `mam install example-agent` verified).
- Keep `awesome-mam` populated beyond our own repos, with an "add yours" PR
  template (still TODO).
- Add the `mam-lang` topic to relevant repos.
- 2–3 standalone template repos from `mam init` output (still TODO).

### E. MCP as a distribution channel — documented
- `mam serve --mcp` (MCP over stdio; plain `mam serve` is the HTTP dev
  server) is documented in README and usage.md with a copy-paste client
  config for Claude Desktop / Cursor / VS Code.
- Publish `@mam/mcp` to npm with the snippet — pending the npm release.

### F. Outreach (before any big launch)
- Identify 5–10 maintainers of agent/skill repos.
- Offer a PR that converts their existing files to `.mam`, no obligation.
- Collect feedback and credit them.

### G. Public launch (when ready)
- Only after the hardening checklist is green.
- Show HN / relevant communities, led by a working demo and one command to try.
- The demo itself is now cheap: convert → validate → run → `mam install` →
  `mam publish --targets npm,github` is a fully scripted, verified path.

---

## 5. Pre-launch readiness checklist

- [x] Permanent Hub domain — `mam-hub.onrender.com`
- [ ] No temporary tunnel URL remaining in docs or badges (sweep needed)
- [x] Rate limits and gated writes verified
- [ ] Backups for registry data
- [x] `mam convert` shipped
- [ ] npm packages published (`@mam/*` at 2.0.0) — public API 404 verified Oct 23, 2026
- [ ] `npm i -g @mam/cli` verified end to end — waits on the publish above
- [x] `mam validate` action — shipped in-repo (+135-line CI job); marketplace repo optional
- [x] `mam install` verified end-to-end against the live Hub
- [x] `mam publish` verified against the real Hub API (auth gate + target fan-out)
- [ ] 2–3 template repos
- [x] Quickstart in README (5-command loop)
- [ ] README before/after comparison
- [x] VS Code Marketplace listing (in addition to Open VSX — 556 installs)
- [ ] Open VSX / Marketplace listing metadata points at `github.com/tcp-ecosystem/…`
      (singular, verified via the Open VSX API) — fix to `tcp-ecosystems/…` in
      the next extension release
- [ ] Docs site published with a stable URL
- [x] `mam serve --mcp` documented as the MCP integration path (README + usage.md)
- [ ] `awesome-mam` seeded with external entries

---

## 6. Linguist track (long-term)

1. `.mam` is the canonical extension. `.mam.md` ends in `.md` and is detected
   as Markdown, so it never counts toward `.mam` usage.
2. Check that `.mam` does not collide with another format's owner claims.
3. Keep the TextMate grammar current (`.mam` and `.mam.md` both covered).
4. Real `.gitattributes` decision already made: no `linguist-language=MAM`
   override, because the attribute only accepts languages Linguist already
   knows. Do not add a bogus override that Linguist will ignore.
5. Collect real-world sample files with clear licenses (no hello-world files).
6. When usage is real, open the Linguist PR with a GitHub search link showing
   in-the-wild usage.
7. Interim render: `output/**` is already `linguist-generated`; keep compiled
   artifacts out of Linguist noise.

---

## 7. Metrics

Track monthly:

| Metric | How |
|--------|-----|
| Public `.mam` files | GitHub code search `path:*.mam` |
| Distinct owners | Unique `user` values in those results |
| Hub modules (external count, not our seeds) | Registry stats |
| Extension installs | Open VSX / Marketplace dashboards |
| npm weekly downloads | npmjs per-package (30 `@mam/*`) |
| MCP-configured adopters | Self-reported / issue count |
| Stars / forks on `tcp-ecosystems/MAM` | GitHub |

**Current verified snapshot (Oct 23, 2026):**

- Open VSX extension: **556 downloads** (`arkhangellifejiggy.mam-language`
  v2.0.0, published 2026-10-07; count from the Open VSX API).
- Hub: **19 live example modules @ 2.0.0** — all listed and one installed
  end-to-end via `mam install example-agent`.
- npm `@mam/*`: **0 public** (release staged; token pending).
- External `.mam` repositories: **not yet measured** — first sweep scheduled
  with the next metrics pass.

**Milestones:** 10 external repos → 50 → 200 (Linguist-ready).

---

## 8. Next actions

1. Publish the npm release (token → preflight → publish → verify global
   install) — still the single biggest blocker for `npm i -g @mam/cli`.
   Quality pass first: the next release waits for the open polish items.
2. Publish the `docs/` site to a stable URL (GitHub Pages), then link it from
   the README.
3. Write the before/after README section; record the demo.
4. Publish the standalone `mam-action` marketplace repo (the in-repo action
   already works).
5. Template repos + `awesome-mam` PR template.
6. Prepare outreach list and Convert-PR template.
7. Finish the readiness checklist, then plan the public launch.

---

*Living document. Update as milestones land; keep strategy here, execution in
task-plan.md.*
