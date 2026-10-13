# Task Plan — Adoption Next Phase (from `adpotion.md` + `adoption-2.md`)

> Health level: **L1 Public → L2 First External Users**.
> Priority order per `adpotion.md`: **convert → validate action → templates → publish flow.**
> Rule 1 of both plans: never manufacture evidence. Every task below serves a
> real adopter need, not a metric.

## Phase 1 — `mam convert` (IN PROGRESS)

Convert what adopters already have (`AGENTS.md`, `CLAUDE.md`, skill files)
into a valid `.mam` module. Two-minute first win.

- [ ] `mam convert <file> [-o out.mam]` CLI command (type inference: agent vs module)
- [ ] Frontmatter synthesis (id, name, version, author, tags from content)
- [ ] Section mapping (headings → Purpose/Rules/Prompt/Memory/Tools/Capabilities)
- [ ] Fenced code blocks → Python/JavaScript sections by language tag
- [ ] Output validates clean (`mam validate` on result, exit non-zero otherwise)
- [ ] Tests: AGENTS.md sample, CLAUDE.md sample, empty file, non-markdown rejection
- [ ] Docs: `usage.md` + README quickstart mention

## Phase 2 — Pitch Visible

- [ ] README before/after (messy agent markdown vs same thing as MAM + caught errors)
- [ ] "MAM in 5 minutes" quickstart (install → init → convert → validate → run)
- [ ] Demo recording (convert → validate → publish)

## Phase 3 — Validate Action

- [ ] `mam validate` GitHub Action (`tcp-ecosystem/mam-action` or marketplace)
- [ ] Pre-commit hook config example
- [ ] Clear errors with fix hints (audit current messages)

## Phase 4 — Templates & Publish Flow

- [ ] 2–3 standalone template repos (own repos, `mam-lang` topic)
- [ ] Verify `mam install` from live Hub end-to-end
- [ ] Verify `mam publish` friction (token flow, errors)
- [ ] `awesome-mam` "add yours" PR template

## Phase 5 — Outreach

- [ ] 5–10 maintainer shortlist (agent/skill repos)
- [ ] Convert-PR template (their files → `.mam`, no obligation)
- [ ] Feedback log + credits

## Phase 6 — Public Launch

- [ ] Readiness checklist (`adpotion.md` §5) all green
- [ ] Show HN + communities with working demo

## Metrics (monthly, per `adpotion.md` §7)

10 external repos → 50 → 200 (Linguist-ready). Track owners, not just files.
