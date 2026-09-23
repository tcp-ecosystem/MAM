# Basic MAM Examples

This directory is a complete MAM project. It composes six introductory
utility modules into one executable system, demonstrating core MAM concepts:
frontmatter metadata, purpose driven design, inputs and outputs, capabilities,
rules, workflows, executable Python, tests, and examples.

## Layout

```
basic/
├── mam.toml             Project manifest (name, entry, module globs)
├── system.mam           Entry system that composes the modules
├── system.mam.md        Identical copy of the entry system
├── README.md
└── modules/
    ├── hello.mam        Minimal greeting module
    ├── calculator.mam   Arithmetic operations with validation
    ├── password-gen.mam Secure random password generation
    ├── string-utils.mam String manipulation utilities
    ├── temperature.mam  Temperature scale conversion
    └── text-transform.mam Case and format transformation
```

Each module ships as a `.mam` and `.mam.md` pair with byte identical content.
The `.mam.md` form is the human facing Markdown source; the `.mam` form is the
canonical machine readable copy.

## Modules

| Module | Capability | Description |
|--------|-----------|-------------|
| `hello` | `greet` | Greets a name and returns a timestamp |
| `calculator` | `calculate` | Adds, subtracts, multiplies, and divides |
| `password-gen` | `generate` | Generates secure random passwords |
| `string-utils` | `manipulate` | Reverses, counts, and extracts text |
| `temperature` | `convert` | Converts between Celsius, Fahrenheit, Kelvin |
| `text-transform` | `transform` | Changes case and format of text |

## Commands

Run all commands from this directory. Replace `CLI` with the path to the MAM
CLI entry, for example `node C:\Users\USER\LifeJiggy\Prompt_AI-Support\MAM\cli\dist\index.js`.

### Validate the project

```powershell
CLI validate
```

Prints `Project valid` when the manifest, system, and modules are consistent.

### Build the project

```powershell
CLI build
```

Writes a Python target for every module and the system into `dist/`, for
example `dist/hello.mam.py`.

### Run a single module

```powershell
CLI run modules/hello.mam --format json
CLI run modules/calculator.mam --format json
CLI run modules/password-gen.mam --format json
CLI run modules/string-utils.mam --format json
CLI run modules/temperature.mam --format json
CLI run modules/text-transform.mam --format json
```

Each command prints a JSON result with `"success": true`.

### Run the system entry

```powershell
CLI run system.mam --format json
```

## What You Will Learn

- How to write MAM frontmatter (id, name, version, type, runtime, tags)
- How to declare inputs, outputs, capabilities, and permissions
- How to define purpose, rules, and a workflow for a module
- How to embed executable Python in a Markdown module
- How to compose modules into a system with `mam.toml` and `system.mam`
- How to validate, build, and run a complete MAM project