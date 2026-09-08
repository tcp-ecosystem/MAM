# MAM Release Roadmap

> **Last Updated: 2026-09-08**

---

## Section 1: The Roadmap — What's Done, What's Left

MAM is a System Description Language (SDL) whose reference syntax is Markdown.
It describes systems, not implementations.

**Core principle:**
> **Describe once. Compile anywhere.**

### MAM V1 — Foundation ✅ COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| Philosophy | ✅ | "The Language of Systems" |
| Purpose | ✅ | Describe systems, not implementations |
| Canonical Syntax | ✅ | `.mam.md` Markdown |
| Specification | ✅ | `spec/SPEC.md` (600+ lines) |
| Modules | ✅ | 18 module types defined |
| Parser Design | ✅ | 170 tests passing |
| AST Design | ✅ | 482 tests, 25+ node types |
| Compiler Design | ✅ | 16 targets, 72 tests |
| Runtime Model | ✅ | 406 tests (404 passing, 2 env-dependent) |
| CLI Design | ✅ | 21 commands implemented |
| File Formats | ✅ | `.mam.md` → `.mam.{target}` |
| Targets | ✅ | py, js, go, rs, cs, java, wasm, yaml, tf, Dockerfile, json, + 5 AI SDKs |
| Ecosystem Vision | ✅ | Open, portable, implementation-independent |

### MAM V2 — Implementation ✅ MOSTLY COMPLETE

| Item | Status | Gap |
|------|--------|-----|
| Reference Grammar | ✅ | `spec/grammar/grammar-v2.bnf` |
| Parser | ✅ | 170 tests, hyphen bug fixed |
| Validator | ✅ | 131 tests, 40+ rules |
| Formatter | ✅ | `cli/src/commands/format.ts` — basic (trailing whitespace, blank lines) |
| Compiler | ✅ | 16 targets verified, transformer working |
| CLI | ✅ | 21 commands, all building |
| VS Code Extension | ❌ | **NOT BUILT** — syntax highlighting, autocomplete, lint-on-save |
| Documentation Site | ❌ | **NOT BUILT** — no docs site, no getting-started guide |

### MAM V3 — Ecosystem ⚠️ PARTIAL

| Item | Status | Gap |
|------|--------|-----|
| Package Registry | ⚠️ | Server + client built (47 tests). Not deployed. No public instance. |
| Plugin SDK | ✅ | `plugin-api` + 4 core plugins (memory, mermaid, python, yaml) |
| Language Server | ✅ | `lsp/src/` — hover, completion, diagnostics |
| Multiple Targets | ✅ | 16 targets working |
| Community Modules | ❌ | **NONE** — no public modules, no examples beyond fixtures |
| Reference Runtimes | ⚠️ | SDKs built (Python, JS, Rust, Go). Not published to package managers. |

### MAM V4 — Standard 🔮 FUTURE

| Item | Status |
|------|--------|
| Stable Specification | Pending V2 completion |
| Third-party Implementations | Needs community |
| Cross-language Compilers | Future |
| Industry Adoption | Needs documentation + examples |

---

## Section 2: What's Needed Before Release

### Critical (Must-Have for v0.2.0 Release)

1. **VS Code Extension** — syntax highlighting for `.mam.md`, autocomplete for sections
   - Effort: 2-3 days
   - Files: New `vscode-extension/` package
   - Priority: HIGH

2. **Documentation Site** — getting-started guide, API reference, examples
   - Effort: 2-3 days
   - Files: New `docs/` directory or GitHub Pages
   - Priority: HIGH

3. **Example Modules** — 5+ real-world `.mam.md` files that compile and run
   - Effort: 1 day
   - Files: `examples/` directory
   - Priority: HIGH

4. **Published SDKs** — `@mam/sdk-javascript` on npm, `mam` on PyPI
   - Effort: 0.5 days (just publish)
   - Priority: HIGH

### Important (Should-Have for v0.2.0)

5. **Formatter Enhancement** — section ordering, consistent indentation
   - Effort: 1 day
   - Priority: MEDIUM

6. **Registry Deployment** — public registry instance (Vercel/Railway/Fly.io)
   - Effort: 0.5 days
   - Priority: MEDIUM

7. **CLI `mam init` Template** — interactive project scaffolding
   - Effort: 0.5 days
   - Priority: MEDIUM

### Nice-to-Have (v0.3.0+)

8. Community module gallery
9. CI/CD integration guides
10. Performance benchmarks
11. Migration tool from other formats

---

## Release Checklist

```text
v0.2.0 Release Gate
─────────────────────
[ ] VS Code Extension (syntax + autocomplete)
[ ] Documentation Site (getting-started + API)
[ ] 5+ example modules that compile and run
[ ] SDKs published (npm + PyPI)
[ ] Formatter enhanced (section ordering)
[ ] Registry deployed (public instance)
[ ] CHANGELOG updated
[ ] README rewritten for end users
[ ] All tests passing (0 failures)
[ ] Build clean (0 warnings)
```

---

## Principles

> **The core should evolve slowly. The ecosystem should evolve quickly.**

This is how Git, Docker, and LLVM have remained stable while their ecosystems grew rapidly.

> **Open specification first. Reference implementation second. Community extensions third.**

The spec is the authoritative source. Implementations follow it. Others add runtimes, plugins, and tooling without changing the core language.
