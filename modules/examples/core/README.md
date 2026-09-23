# Core Anatomy Project

Demonstrates the core anatomy of a MAM module as a complete project:

| Module | Demonstrates |
|--------|--------------|
| `metadata` | Metadata core — identity, versioning, front matter |
| `configuration` | Configuration core — defaults, overrides, validation |
| `module` | Module core — purpose, inputs, outputs, capabilities, rules |
| `workflow` | Workflow core — ordered steps, branching, final output |

Each module includes the core sections: Metadata (front matter),
Configuration, Purpose/Module, Capabilities, Inputs / Outputs, Rules, and
Workflow.

## Commands

```bash
mam validate        # validate the whole project
mam graph           # project dependency graph
mam build           # compile all modules + system to targets
mam run             # run the entry system natively
mam run modules/metadata.mam    # run a single module
mam test            # run tests across the project
```

## Layout

```
core/
├── mam.toml
├── system.mam  (+ .mam.md)
└── modules/
    ├── metadata.mam      (+ .mam.md)
    ├── configuration.mam (+ .mam.md)
    ├── module.mam        (+ .mam.md)
    └── workflow.mam      (+ .mam.md)
```