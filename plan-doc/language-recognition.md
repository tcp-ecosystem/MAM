# MAM Language Recognition Plan — GitHub Linguist Roadmap

> **Goal:** "MAM" appears as its own language in GitHub's language bar,
> with `.mam` syntax highlighting everywhere.
>
> **Gate:** acceptance into [github-linguist/linguist](https://github.com/github-linguist/linguist)
> — requires ~200 public repos using `.mam` files, a grammar, and samples.
> The timeline is adoption-gated, not effort-gated.

---

## 1. What Is Done (2026-10-04)

| Item | Status |
|------|--------|
| TextMate grammar (`source.mam`) | ✅ `desktop-extension/vscode|zed|visualstudio` |
| `fileTypes: ["mam", "mam.md"]` in all 3 grammars | ✅ was empty — Linguist could not associate |
| `.gitattributes` hygiene | ✅ `.mam` as text/LF/diff; `output/`, `dist/`, compiled targets as `linguist-generated` |
| Grammar validation | ✅ all regexes compile; 8/8 constructs tokenize real files |
| `.mam` corpus for samples | ✅ 258 `.mam` + 215 `.mam.md` in-repo |
| Editor extensions (vim, sublime, emacs, jetbrains, …) | ✅ 14 editors |

## 2. Why Not PR Today

Linguist closes new/hobby-language PRs as "Pending Popularity". We have 1 repo;
the bar is ~200. Opening now burns the shot. Prepare everything, open once,
with evidence.

## 3. Routes (in order)

### 3a. Editor marketplaces — immediate, no Linguist dependency
- [ ] Publish VS Code extension to VS Marketplace + OpenVSX
- [ ] JetBrains, Neovim, Sublime, Zed, Emacs follow
- Effect: "MAM" presence where developers live; maturity evidence for the PR

### 3b. Seed repos — the actual gate work
- [ ] Each `mam new <type>` scaffold → its own public repo (19 on day one)
- [ ] Docs examples, showcases, community challenges as repos
- [ ] `awesome-mam` curated list + `mam-lang` GitHub topic on everything
- [ ] README language badge (shields.io, cosmetic, instant)

### 3c. Registry as evidence
- [ ] Launch public MAM Hub instance (deployment, not code — code is done)
- [ ] Seed 100+ community modules, each linked to its GitHub repo
- [ ] Track repo URLs per module: "N modules, M linked repos" is the PR story

### 3d. The PR — once, with evidence (accumulating 2026-10-07)

- [x] Production registry live: `https://mam-hub.onrender.com` (20 modules)
- [x] Editor distribution: OpenVSX v2.0.0 (**324 downloads**), VS Code Marketplace live
- [ ] `languages.yml` entry (type: programming, color, extensions `.mam`)
- [ ] `script/add-grammar` with the vscode `mam.tmLanguage.json`
- [ ] 2+ real-world samples from `modules/examples/`
- [ ] Usage evidence: GitHub Search for `extension:mam`, registry stats
- [ ] Our case: spec + 16 targets + native runtime + production registry
  (genuine language, not a toy — reviewers exercise judgment)

## 4. Timeline

| Phase | Work | Gate |
|-------|------|------|
| Now | Grammar ✅, attributes ✅, marketplace publishes | Effort only — days/weeks |
| Launch | Registry deployed, 100+ modules seeded | Release work — weeks |
| Growth | Community repos accumulate toward ~200 | Adoption — 12–24 months |
| PR | Open once, with evidence | Review — one release cycle |

## 5. Release Checklist (production evolution starts here)

The registry service code is complete (654 + 11 tests). Launch means:

- [x] Deploy public instance → **LIVE at `https://mam-hub.onrender.com`** (Render free tier, verified 2026-10-07: health, GraphQL 19/19, anonymous search)
- [x] Self-seeding image (cold boots rebuild all founding modules from git)
- [ ] Seed: 19 founding modules live; grow toward 100+ community modules
- [ ] Publish VS Code extension (3a) in the same window → done (OpenVSX)
- [ ] Announce: README badge, `awesome-mam`, changelog entry → badges + awesome-mam done
- [ ] Monitor: registry logs, download counts → feed the Linguist evidence file


---

*Companion to [goal.md](../goal.md) (Q4 registry launch) and [brain.md](../brain.md)
(Distribution Intelligence). Update repo counts here as they grow.*
