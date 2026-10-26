# Interop Demo

A complete mixed-language MAM system. MAM describes the system; ordinary Python
and TypeScript files implement its capabilities.

```text
interop/
├── system.mam              # system description + implementation declarations
├── system.mam.md           # byte-identical canonical twin
├── mam.toml                # project manifest
├── input.json              # sample input
├── modules/
│   └── contracts.mam       # invocation contract
├── src/
│   ├── normalize.py        # Python capability
│   └── score.ts            # TypeScript capability
└── tests/
    ├── test_normalize.py
    └── score.test.mjs
```

## Prerequisites

- Python 3.10 or newer (`python` or `py` on Windows)
- Node.js 22.6 or newer with TypeScript type stripping (Node 24 enables it by
  default)

Check both runtimes:

```text
mam lir probe
```

## Run the system

```text
mam validate system.mam
mam run system.mam --inputs "@input.json" --format json
```

Expected result (abridged):

```json
{
  "lir": {
    "ok": true,
    "implementations": [
      {
        "id": "normalize",
        "language": "python",
        "ok": true,
        "value": {
          "name": "ada lovelace",
          "length": 12,
          "tokens": ["ada", "lovelace"]
        }
      },
      {
        "id": "score",
        "language": "typescript",
        "ok": true,
        "inputFrom": "normalize",
        "value": {
          "score": 122,
          "label": "ADA LOVELACE (12)",
          "tokenCount": 2
        }
      }
    ]
  }
}
```

The `@input.json` form reads JSON from a file, which avoids shell quoting
problems on Windows.

## Inspect and invoke directly

```text
mam lir list system.mam
mam lir invoke system.mam normalize --input "@input.json" --format json
```

`mam lir invoke score` needs the upstream envelope, so direct invocation is
mainly useful for the first step; `mam run` performs the full composition.

## Contract

- A declaration lives in the `.mam` frontmatter under `implementations`.
- `entry` is project-relative and must stay inside the project root.
- The export receives exactly one positional JSON value.
- Without `inputFrom`, the value is the system inputs object.
- With `inputFrom`, the value is `{ inputs, upstream }`, where `upstream` is the
  referenced implementation's result.
- Return values must be JSON-compatible.
- stdout and stderr are diagnostics; the result travels on a separate protocol
  line and is parsed by the adapter.

## Tests

```text
python -m unittest discover -s tests -p "test_*.py"
node --test tests/score.test.mjs
```

## Security boundary

LIR starts local subprocesses. It filters the environment, pins the executable,
controls the working directory, rejects path escapes, enforces timeouts and
output limits, and records every invocation. A subprocess is **not** a sandbox:
only run implementations you trust, and use OS-level isolation for untrusted
code.

## Troubleshooting

- `LIR_RUNTIME_MISSING`: install Python or Node, or pass `--python` / `--node`.
- `LIR_ENTRY_MISSING`: check the `entry` path relative to the project root.
- `LIR_TIMEOUT`: raise `--timeout` or optimize the implementation.
- `LIR_INVOKE_FAILED`: read the message and stack in the JSON result.
- TypeScript syntax errors mentioning enums or namespaces: type stripping only
  supports erasable syntax. Use plain interfaces/types in the entry file.
