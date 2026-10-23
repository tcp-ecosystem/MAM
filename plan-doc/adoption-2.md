# MAM Adoption

> **External adoption is the bridge between MAM being public and MAM
> becoming an ecosystem.**

MAM is designed to be useful beyond the TCP Ecosystem itself.

This document defines the adoption strategy, onboarding path, evidence
model, telemetry boundaries, contributor workflow, and readiness
criteria for external users of MAM.

> **Status snapshot — October 2026** (verified against the running
> system, not projected):
>
> - Distribution: CLI repo public; **Open VSX extension live with 556
>   downloads** (v2.0.0, 2026-10-07); Marketplace listing live.
> - Onboarding: `mam convert` (§5-§6 flow) shipped and documented;
>   5-command quickstart in the README.
> - Reuse: `mam install <module>` from the live Hub verified end-to-end
>   (resolve → download → extract → integrity lockfile).
> - Publish: `mam publish` to the Hub rewritten onto the Hub's real API
>   (module or folder), with ecosystem fan-out to npm / Python / GitHub
>   (`--targets`) shipped in dry-run; real external uploads pending the
>   user's npm/gh tokens.
> - Not yet: public npm `@mam/*` release (404 verified 2026-10-23), docs
>   site URL, template repos, external-repo measurement.
> - Health level (§19): between **L1 Public** and **L2 First External
>   Users** — first external installs are happening; independent
>   `.mam`-in-the-wild evidence still to be collected.

------------------------------------------------------------------------

## 1. Purpose

The adoption layer exists to make it easy for an external developer to:

1.  Discover MAM.
2.  Install the MAM tooling.
3.  Create a first `.mam` artifact.
4.  Validate and execute it.
5.  Integrate MAM into an existing project.
6.  Compile or connect MAM to an implementation target where
    appropriate.
7.  Publish a real MAM artifact.
8.  Contribute improvements, examples, modules, or tooling.
9.  Become an independent MAM user without requiring direct assistance
    from the core team.

The objective is not to manufacture usage numbers.

The objective is to create **real, independent, distributed usage**.

------------------------------------------------------------------------

## 2. Adoption Principle

MAM follows the principle:

> **Build once. Reuse everywhere.**

Adoption should therefore happen through practical system-building
rather than through artificial demonstrations.

A successful adoption path is:

``` text
DISCOVER
   ↓
INSTALL
   ↓
CREATE
   ↓
VALIDATE
   ↓
RUN
   ↓
INTEGRATE
   ↓
PUBLISH
   ↓
CONTRIBUTE
   ↓
REUSE
```

Every stage should reduce friction for the next stage.

------------------------------------------------------------------------

## 3. What External Users Should Understand

MAM is a **System Description Language**.

It provides a declarative layer for describing systems, modules,
capabilities, dependencies, workflows, state, resources, policies,
permissions, and related system semantics.

MAM does not attempt to replace implementation languages.

``` text
MAM
  ↓
System description
  ↓
AST / semantic representation
  ↓
Native runtime OR compiler
  ↓
Target implementation
```

Examples of implementation languages and runtimes may include:

-   Python
-   JavaScript
-   TypeScript
-   Rust
-   Future target languages and runtimes

The distinction is important:

``` text
MAM = what the system is
Implementation language = how the system is implemented
Runtime = where/how it executes
```

------------------------------------------------------------------------

## 4. Canonical Artifacts

### `.mam`

The canonical standalone MAM artifact.

``` text
example.mam
```

A `.mam` file can execute through the MAM Native Runtime.

``` bash
mam run example.mam
```

### `.mam.md`

Legacy/source compatibility format.

``` text
example.mam.md
```

It remains supported where compatibility is required and is executed
through the MAM Native Runtime.

### Compiled artifacts

MAM can compile to target-specific artifacts.

Examples:

``` text
example.mam.py
example.mam.js
```

Compiled artifacts execute through their corresponding target runtime.

``` text
.mam / .mam.md → MAM Native Runtime
.mam.target    → Target Runtime
```

This distinction must remain explicit throughout the documentation and
tooling.

------------------------------------------------------------------------

## 5. First-Time User Experience

The first external interaction with MAM should answer four questions
immediately:

1.  What is MAM?
2.  Why should I use it?
3.  How do I install it?
4.  How do I create and run something in under a few minutes?

The recommended onboarding flow is:

``` text
Install
  ↓
mam --help
  ↓
mam init
  ↓
Create a module
  ↓
mam validate
  ↓
mam run
  ↓
Inspect result
  ↓
Modify
  ↓
Run again
```

The exact installation command must always be taken from the current
official distribution channel.

Do not document an unverified package name or installation path.

------------------------------------------------------------------------

## 6. Five-Minute Adoption Test

A new user should be able to reach a successful execution quickly.

### Success criteria

A first-time user should be able to:

-   install MAM;
-   initialize or create a project;
-   create a valid `.mam` file;
-   validate it;
-   execute it natively;
-   understand the result;
-   locate the next documentation step.

### Example conceptual workflow

``` bash
# Install MAM using the current official distribution method

mam --version

mam init

mam validate

mam run example.mam
```

The actual commands and generated structure must remain synchronized
with the current CLI implementation.

------------------------------------------------------------------------

## 7. Adoption Layers

MAM adoption should be measured as a funnel rather than as a single
download number.

### Layer 1 --- Awareness

A developer encounters MAM through:

-   GitHub
-   package registries
-   VS Code Marketplace
-   Open VSX
-   documentation
-   search engines
-   community posts
-   examples
-   existing MAM projects

### Layer 2 --- Installation

The developer installs the CLI, extension, or another supported
integration.

### Layer 3 --- First Artifact

The developer creates or modifies a real `.mam` file.

### Layer 4 --- First Execution

The developer successfully validates and runs MAM.

### Layer 5 --- Project Integration

MAM becomes part of an actual software project.

Example:

``` text
my-project/
├── src/
├── tests/
├── package.json
├── README.md
└── architecture.mam
```

### Layer 6 --- External Publication

The developer publishes a real MAM artifact in an independently
controlled repository.

### Layer 7 --- Reuse

Other developers discover and reuse the artifact.

### Layer 8 --- Contribution

External users contribute:

-   bug fixes;
-   modules;
-   examples;
-   documentation;
-   compiler targets;
-   integrations;
-   tooling;
-   tests;
-   language support;
-   ecosystem packages.

------------------------------------------------------------------------

## 8. Real Adoption vs. Artificial Evidence

MAM must never manufacture adoption evidence.

The following do **not** constitute meaningful external adoption by
themselves:

-   duplicated repositories;
-   copied example files;
-   generated repositories created only for metrics;
-   tutorial-only artifacts with no practical use;
-   fork-only usage;
-   automated commits created only to increase file counts;
-   synthetic repositories;
-   spam submissions;
-   artificial stars, downloads, or usage.

The strongest evidence is:

> An independent developer discovers MAM, understands it, uses it for a
> real problem, and continues using it without direct intervention from
> the core team.

------------------------------------------------------------------------

## 9. External Adoption Evidence

The adoption system should track evidence across multiple dimensions.

### Primary signals

-   unique external repositories;
-   unique external users or organizations;
-   real `.mam` files;
-   active MAM projects;
-   independent module publication;
-   package downloads;
-   extension installations;
-   CLI usage where measurable;
-   external contributions;
-   issues and discussions from independent users;
-   reuse of published modules;
-   compiler/runtime integrations.

### Distribution matters

A large number of files controlled by one account is weaker evidence
than a smaller number of files distributed across many independent
repositories.

Therefore:

``` text
Files
+
Repositories
+
Owners
+
Independent projects
+
Actual usage
```

should be considered together.

------------------------------------------------------------------------

## 10. GitHub Linguist Adoption Evidence

GitHub Linguist requires evidence of real-world GitHub usage when
introducing language/file recognition.

MAM adoption work must therefore prioritize genuine public usage.

For common extensions, Linguist may require substantially more indexed
files than for extensions expected to occur only once per repository.
The exact requirement must always be checked against the current
Linguist contribution guidelines before opening a PR.

Evidence should be:

-   publicly indexed;
-   distributed across independent repositories;
-   based on real projects;
-   not primarily forks;
-   representative of actual MAM usage.

Track evidence such as:

``` text
Total .mam files
Unique repositories
Unique owners
Repositories excluding forks
Independent organizations
Real-world project categories
```

The goal is not:

> "Reach a number."

The goal is:

> "Reach enough genuine ecosystem usage that language recognition is
> justified."

------------------------------------------------------------------------

## 11. Adoption Infrastructure

The repository should provide a clear home for adoption-related
material.

Recommended structure:

``` text
docs/
├── adoption.md
├── getting-started.md
├── language/
├── runtime/
├── compiler/
├── cli/
└── examples/
```

If the project currently uses another documentation structure,
`adoption.md` should live in the existing documentation hierarchy rather
than introducing unnecessary duplication.

The document should be linked from the main documentation entry point.

------------------------------------------------------------------------

## 12. External User Resources

External users should have access to:

### Getting Started

A short path from installation to first successful execution.

### Language Guide

How to write valid MAM artifacts.

### CLI Reference

Commands, flags, output, errors, and examples.

### Runtime Guide

How native execution works.

### Compiler Guide

How target compilation works.

### Examples

Realistic, reusable systems.

### Troubleshooting

Common installation, validation, runtime, and compilation problems.

### Contribution Guide

How external developers can contribute.

------------------------------------------------------------------------

## 13. Example Strategy

Examples should demonstrate useful system patterns rather than
artificial syntax demonstrations.

Priority examples:

``` text
api-gateway
authentication-system
data-pipeline
agent-system
mcp-server
knowledge-system
memory-system
rag-system
workflow-system
security-system
```

Each example should answer:

-   What problem does this solve?
-   Why is MAM useful here?
-   What does the MAM artifact describe?
-   What implementation/runtime executes it?
-   What can be reused?

Examples should be small enough to understand and real enough to provide
a reason to adopt MAM.

------------------------------------------------------------------------

## 14. Adoption Through Existing Projects

MAM does not require a project to be rewritten.

An existing project can introduce MAM as an additional
system-description layer.

Example:

``` text
existing-project/
├── src/
├── tests/
├── package.json
├── Dockerfile
├── README.md
└── architecture.mam
```

This is an important adoption path because developers can adopt MAM
incrementally.

MAM should coexist with existing programming languages, frameworks,
build systems, and deployment systems.

------------------------------------------------------------------------

## 15. External Module Ecosystem

External users should eventually be able to publish reusable MAM
modules.

Conceptually:

``` text
Developer A
    ↓
creates module
    ↓
publishes module
    ↓
MAM Registry / Hub
    ↓
Developer B discovers module
    ↓
downloads
    ↓
integrates
    ↓
reuses
```

This creates the ecosystem loop:

``` text
CREATE → PUBLISH → DISCOVER → REUSE → IMPROVE → REPUBLISH
```

------------------------------------------------------------------------

## 16. Adoption Feedback Loop

Every external user interaction should improve the system.

``` text
User
 ↓
Adopts MAM
 ↓
Finds friction
 ↓
Issue / Discussion / PR
 ↓
Core team evaluates
 ↓
Fix / Improve
 ↓
Release
 ↓
User upgrades
 ↓
More adoption
```

Adoption is therefore also an engineering feedback mechanism.

------------------------------------------------------------------------

## 17. Telemetry and Privacy

MAM should not require invasive telemetry for adoption.

Where metrics are collected, they should be:

-   explicit;
-   documented;
-   minimal;
-   privacy-conscious;
-   useful to the project;
-   disabled by default unless there is a clearly justified alternative.

Public ecosystem signals such as package downloads, extension
installations, repository activity, and public artifacts may be tracked
without requiring private user telemetry.

Never design adoption around collecting unnecessary personal
information.

------------------------------------------------------------------------

## 18. Adoption Dashboard

As the ecosystem grows, maintain an adoption snapshot.

Suggested metrics:

  Metric                    Meaning
  ------------------------- ------------------------------
  CLI installations         Distribution reach
  Package downloads         Package ecosystem reach
  Extension installs        Editor ecosystem reach
  Public MAM repositories   Project adoption
  `.mam` files              Language usage
  Unique repositories       Distribution
  Unique owners             Independent adoption
  External modules          Ecosystem growth
  External contributors     Community participation
  Active projects           Continuing adoption
  Registry modules          Reusable ecosystem inventory
  Compiler targets          Portability
  Issues resolved           Product maturity

Avoid treating any single metric as the definition of success.

------------------------------------------------------------------------

## 19. Adoption Health Levels

### Level 0 --- Internal

MAM is primarily developed and tested by the core team.

### Level 1 --- Public

MAM is publicly available and externally discoverable.

### Level 2 --- First External Users

Independent developers successfully install and use MAM.

### Level 3 --- Distributed Usage

MAM appears in multiple independent repositories and projects.

### Level 4 --- External Contributions

Independent developers begin contributing code, modules, documentation,
examples, or tooling.

### Level 5 --- Ecosystem Reuse

External developers publish modules that are reused by other external
developers.

### Level 6 --- Ecosystem Recognition

MAM has sufficient real-world usage and maturity for broader ecosystem
integrations such as language recognition, registries, IDE tooling,
package ecosystems, and third-party integrations.

------------------------------------------------------------------------

## 20. The Critical Adoption Milestone

The most important early milestone is not a download count.

It is:

> **A developer outside the TCP Ecosystem independently creates a MAM
> module and uses it in a real workflow without requiring the core
> developer to build it for them.**

That is the transition from:

``` text
Project
```

to:

``` text
Technology
```

And eventually:

``` text
Technology
      ↓
Community
      ↓
Ecosystem
```

------------------------------------------------------------------------

## 21. Adoption Roadmap

### Phase 1 --- Distribution

-   Public GitHub repository
-   Package distribution
-   VS Code Marketplace
-   Open VSX
-   Documentation
-   Examples
-   CLI installation path

### Phase 2 --- First External Users

-   Simple onboarding
-   Five-minute quickstart
-   Real examples
-   Clear error messages
-   Issue templates
-   Feedback channel

### Phase 3 --- Distributed Usage

-   Independent repositories
-   Independent owners
-   Real `.mam` artifacts
-   Existing-project integrations
-   Reusable modules

### Phase 4 --- Ecosystem

-   MAM Hub
-   External modules
-   Registry growth
-   Third-party tooling
-   Compiler/runtime integrations
-   Community contributors

### Phase 5 --- Recognition

-   GitHub Linguist
-   Broader editor support
-   Package ecosystem integrations
-   Documentation ecosystem
-   Independent projects and implementations

------------------------------------------------------------------------

## 22. Core Adoption Rules

1.  **Never manufacture adoption evidence.**
2.  **Prioritize independent users over raw counts.**
3.  **Prioritize real projects over demonstrations.**
4.  **Make the first successful execution extremely easy.**
5.  **Keep MAM compatible with existing engineering ecosystems.**
6.  **Document before scaling distribution.**
7.  **Measure adoption without compromising privacy.**
8.  **Treat external feedback as engineering input.**
9.  **Make every reusable artifact easier to discover and reuse.**
10. **Keep the language and runtime boundaries explicit.**

------------------------------------------------------------------------

## 23. Definition of Adoption Success

MAM adoption succeeds when developers no longer need the original author
to explain every use case.

A healthy ecosystem should eventually look like:

``` text
MAM
 │
 ├── Developers
 │    ├── Build
 │    ├── Publish
 │    └── Reuse
 │
 ├── Projects
 │    ├── Systems
 │    ├── Modules
 │    └── Workflows
 │
 ├── Tooling
 │    ├── Editors
 │    ├── CLI
 │    ├── Registries
 │    └── Compilers
 │
 └── Community
      ├── Contributors
      ├── Maintainers
      └── Independent Implementations
```

The ultimate objective is simple:

> **MAM should become useful enough that people build with it because it
> solves a real problem---not because the creator asked them to.**

------------------------------------------------------------------------

## 24. Adoption Philosophy

MAM began as an experiment around modular engineering.

It is now becoming a public language and ecosystem.

The next evolution is not simply:

``` text
More downloads
```

It is:

``` text
More builders
      ↓
More real systems
      ↓
More reusable modules
      ↓
More independent contributors
      ↓
More interoperability
      ↓
Stronger ecosystem
```

**Build once. Reuse everywhere.**

**Describe systems. Compile anywhere.**

**From `.md` to `.mam`.**

**Evolution continues.**
