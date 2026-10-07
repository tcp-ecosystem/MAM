# MAM Adoption Plan

> Foundation first, everything else follows.

MAM (Machine Agent Modules) is built: spec, CLI, VS Code / Open VSX extension, and the MAM Hub registry. The next problem is **wild usage**: real `.mam` files, written by people outside this org.

This document is the plan for getting there.

---

## 1. Why adoption matters

- **GitHub Linguist.** To get `.mam` recognized as a language, Linguist generally wants the extension in use in roughly 200 unique `user/repo` repositories. That is a guideline, not a hard rule, and unique users matter more than raw repo count.
- **Network effect.** The Hub is only as useful as the modules published to it.
- **Feedback.** Real users find the spec's rough edges faster than we do.

**Goal:** 200+ public repos containing `.mam` files, from many distinct owners, tracked openly.

> Do not mass-create repos from one account. A handful of real adopters is worth more than hundreds of synthetic ones, and synthetic usage risks hurting the Linguist case.

---

## 2. Target audience (start narrow)

**Primary:** developers who already write markdown for agents: `AGENTS.md`, `CLAUDE.md`, skill files, system-prompt files, tool specs.

They already feel the pain (unstructured, unvalidated, unshareable files). MAM is a direct upgrade, not a new habit.

**Later:** agent-framework authors, bug bounty / security tooling builders, teams standardizing internal agent specs.

---

## 3. The first-win principle

A new adopter should get value in **under two minutes**, without buying into the whole ecosystem.

| Need | Deliverable | Status |
|------|-------------|--------|
| Convert what I already have | `mam convert AGENTS.md` -> valid `.mam` | TODO |
| Start fresh quickly | `mam init` + template repos | TODO |
| Catch mistakes automatically | `mam validate` GitHub Action + pre-commit hook | TODO |
| Edit comfortably | VS Code extension (Open VSX) | Done |
| Reuse others' work | `mam install` from the Hub | Verify |
| Share my work | `mam publish` with minimal friction | Verify |

Priority order: **convert -> validate action -> templates -> publish flow.**

---

## 4. Workstreams

### A. Make the pitch visible
- README "before / after": a messy markdown agent file next to the same thing as a MAM module, including the validation errors MAM caught.
- A "MAM in 5 minutes" quickstart.
- A short demo (GIF or terminal recording) of convert -> validate -> publish.

### B. Remove friction
- One-line install for the CLI.
- Clear errors from `mam validate`, with fix hints.
- Works without the Hub: local `.mam` files must be useful on their own.

### C. Seed the ecosystem
- Make the 20 founding modules genuinely reusable (code reviewer, recon agent, test writer, etc.).
- Keep `awesome-mam` populated with entries beyond our own projects, with a clear "add yours" PR template.
- Add the `mam-lang` topic to relevant repos.

### D. Outreach (before any big launch)
- Identify 5 to 10 maintainers of agent / skill repos.
- Offer a **PR that converts their existing files** to `.mam`, with no obligation.
- Collect their feedback and credit them.

### E. Public launch (when ready)
- Only after the Hub runs on a permanent domain and the hardening checklist below is done.
- Show HN / relevant communities, led by a working demo and one command to try.

---

## 5. Pre-launch readiness checklist

- [ ] Permanent Hub domain (no temporary tunnel URL in docs or badges)
- [ ] Rate limits and gated writes verified
- [ ] Backups for registry data
- [ ] `mam convert` shipped
- [ ] `mam validate` GitHub Action published
- [ ] 2 to 3 template repos
- [ ] Quickstart and before/after README
- [ ] VS Code Marketplace listing (in addition to Open VSX)
- [ ] `awesome-mam` seeded with external entries

---

## 6. Linguist track (long-term)

1. Treat `.mam` as the canonical extension. `.mam.md` ends in `.md` and is detected as Markdown, so it will not count toward `.mam` usage.
2. Check that `.mam` does not collide with other file formats.
3. Keep the TextMate grammar current and ready.
4. Collect real-world sample files with a clear license (no hello-world samples).
5. When usage is real, open a PR linking a GitHub search that shows in-the-wild usage.
6. Interim: add `*.mam linguist-language=Markdown` in `.gitattributes` so files render readably on GitHub.

---

## 7. Metrics

Track monthly:

| Metric | How |
|--------|-----|
| Public `.mam` files | GitHub code search: `path:*.mam` |
| Distinct owners | Unique `user` values in those results |
| Hub modules (external) | Registry stats |
| Hub downloads | Registry stats |
| Extension installs | Open VSX / Marketplace |
| Stars / forks on `tcp-ecosystems/MAM` | GitHub |

**Milestones:** 10 external repos -> 50 -> 200 (Linguist-ready).

---

## 8. Next actions

1. Ship `mam convert`.
2. Write the before/after README and quickstart.
3. Publish the `mam validate` GitHub Action.
4. Prepare outreach list and PR template.
5. Finish the readiness checklist, then plan the public launch.

---

*Living document. Update as milestones land.*