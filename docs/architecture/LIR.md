# MAM Language Interoperability Runtime (LIR)

> **Status:** implemented in `@mam/runtime/lir` with first-party Python and
> Node.js (JavaScript/TypeScript) adapters.

## What LIR is

LIR connects a MAM system description to implementations written in ordinary
host languages. MAM remains the system-description and orchestration layer;
Python and TypeScript keep their own toolchains, dependencies, and runtimes.

```text
system.mam
    |
    v
MAM parser / AST / validation
    |
    v
LIR registry (policy, path checks, audit)
    |
    +--> Python adapter  -> python process -> JSON result
    |
    +--> Node adapter    -> node process   -> JSON result
    |
    v
normalized LIR result -> MAM execution output
```

## What LIR is not

- It is not a compiler. `.mam` files are not translated into Python or
  JavaScript before native execution.
- It is not a sandbox. A subprocess can still read files and use the network
  unless the operating system isolates it.
- It does not share runtime objects across languages. Only JSON-compatible
  values cross the boundary.
- It does not install interpreters, Node.js, or project dependencies.

## Declarations

Implementations are declared in the `.mam` frontmatter. MAM frontmatter is
YAML, so no new document syntax is required.

```yaml
implementations:
  - id: normalize
    language: python
    entry: src/normalize.py
    export: normalize
    description: Trim and lowercase a display name.

  - id: score
    language: typescript
    entry: src/score.ts
    export: score
    inputFrom: normalize
```

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | Yes | Stable identifier, unique within the list |
| `language` | Yes | `python`, `javascript`, or `typescript` (aliases: `py`, `js`, `ts`) |
| `entry` | Yes | Project-relative path to the implementation file |
| `export` | No | Callable name; defaults to `main` (Python) or `default` (JS/TS) |
| `inputFrom` | No | Earlier implementation id whose result becomes `upstream` |
| `description` | No | Human-readable purpose |
| `permissions` | No | Extra permissions the implementation requests |
| `env` | No | Environment variable names the implementation may read |
| `timeoutMs` | No | Per-implementation timeout, clamped by policy |

Paths resolve against the project root (the directory containing `mam.toml`,
or the `.mam` file's directory when no manifest exists). Absolute paths and
paths that escape the root are rejected. Symlinks are resolved and checked
again before invocation.

## Invocation contract

The export receives exactly one positional value:

- Without `inputFrom`: the system inputs object.
- With `inputFrom`: `{ "inputs": <system inputs>, "upstream": <referenced result> }`.

The return value must be JSON-compatible. `undefined`, functions, symbols,
`BigInt`, `NaN`, and `Infinity` are rejected with a serialization error.

The implementation's stdout and stderr are captured separately. LIR appends a
private protocol line to stdout; the adapter removes it and returns the parsed
value. A missing or malformed protocol line is an error, never a silent
success.

Example Python implementation:

```python
def normalize(payload):
    name = " ".join(str(payload["name"]).split()).lower()
    return {"name": name, "length": len(name)}
```

Example TypeScript implementation:

```ts
export function score(payload: { upstream: { name: string; length: number } }) {
  const { name, length } = payload.upstream;
  return { label: name.toUpperCase(), score: length * 10 };
}
```

## CLI

```text
mam lir probe [--language python|javascript|typescript] [--format json]
mam lir list <file> [--format json]
mam lir invoke <file> <id> [--input <json|@file>] [--timeout <ms>] [--format json]
mam run <file> [--inputs <json|@file>] [--format json]
```

`--format json` writes only the JSON payload to stdout. Human diagnostics and
the run observability line go to stderr.

`mam run` invokes declarations in document order. A failure fails the run and
appears in both `output.lir` and the top-level `errors` array. Pure native MAM
modules do not require Python or Node.js.

## Validation

`mam validate` runs the schema-level `LIR001` rule on any module with an
`implementations:` list. It checks required fields, supported languages, unique
ids, `inputFrom` ordering, project-relative paths, and path containment. Run
`mam validate system.mam` before `mam run`; a declaration that fails `LIR001`
is not invoked.

## Python adapter

- Discovers `python`/`py` (Windows) or `python3`/`python` (other platforms), or
  uses `MAM_PYTHON` / `--python`.
- Loads the entry with `importlib`, resolves dotted exports, and awaits
  coroutines with `asyncio.run`.
- Runs in a temporary runner file; the entry path and export are passed as
  separate argv values (no shell interpolation).
- Sets `PYTHONIOENCODING=utf-8` and `PYTHONUNBUFFERED=1`.
- Normalizes exceptions into `LIR_INVOKE_FAILED` with the exception name,
  message, and a bounded stack.

## TypeScript adapter

The adapter uses Node's built-in type stripping:

- Node 23.6+ / 24: enabled by default (`process.features.typescript === 'strip'`).
- Node 22.6–23.5: uses `--experimental-strip-types`.
- Older Node: TypeScript declarations fail with `LIR_RUNTIME_MISSING`;
  JavaScript still works.

Type stripping erases types; it does not generate code. Avoid enums,
namespaces with runtime values, parameter properties, and decorators in LIR
entry files. Import local TypeScript files with explicit `.ts` extensions.
JavaScript entries use the same adapter without the TypeScript flag.

## Security and policy

LIR enforces:

- an allowlist of languages (`python`, `javascript`, `typescript` by default);
- an optional implementation-id allowlist;
- `process:spawn` permission (revoke it to disable host execution entirely);
- declaration permissions and environment names against the granted policy;
- project-root path containment, including symlink resolution;
- a filtered child environment (no wholesale `process.env` inheritance);
- wall-clock timeouts with process-tree termination;
- bounded stdout/stderr (`maxOutputBytes`, default 1 MiB);
- structured errors and an audit record for every invocation.

Default environment allowlist: `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`,
`TEMP`, `TMP`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `LANG`,
`LC_ALL`, `TZ`.

A subprocess is not a sandbox. Use containers, VMs, or OS-level isolation for
untrusted code. Registry seeds from the network should not be executed with
unrestricted permissions.

## Failure codes

| Code | Meaning |
|------|---------|
| `LIR_DECLARATION_INVALID` | Malformed declaration or unknown field |
| `LIR_ADAPTER_MISSING` | No adapter registered for the language |
| `LIR_LANGUAGE_NOT_ALLOWED` | Language blocked by policy |
| `LIR_IMPLEMENTATION_NOT_ALLOWED` | Id blocked by the allowlist |
| `LIR_PERMISSION_DENIED` | Permission or environment variable not granted |
| `LIR_ENTRY_MISSING` | Entry file does not exist |
| `LIR_ENTRY_NOT_FILE` | Entry exists but is not a file |
| `LIR_PATH_ESCAPE` | Entry or working directory escapes the project root |
| `LIR_RUNTIME_MISSING` | Interpreter/Node.js unavailable or TypeScript unsupported |
| `LIR_INPUT_INVALID` | Input is not a JSON value |
| `LIR_TIMEOUT` | Timeout exceeded; process tree terminated |
| `LIR_ABORTED` | Invocation cancelled through an `AbortSignal` |
| `LIR_OUTPUT_LIMIT` | Output exceeded the byte cap before a result |
| `LIR_EXIT` | Process exited non-zero without a usable result |
| `LIR_PROTOCOL` | Missing or malformed LIR protocol payload |
| `LIR_RESULT_INVALID` | Protocol success payload missing `value` |
| `LIR_INVOKE_FAILED` | Implementation raised or returned an invalid value |

## Programmatic API

```ts
import {
  createDefaultLirRegistry,
  parseImplementationDeclarations,
} from '@mam/runtime/lir';

const declarations = parseImplementationDeclarations(frontmatter.implementations, {
  projectRoot,
});

const registry = createDefaultLirRegistry({ projectRoot });
const result = await registry.invoke(declarations[0], { name: 'Ada' });

if (!result.ok) {
  console.error(result.error.code, result.error.message);
}
```

`registry.getAuditLog()` returns one record per invocation, including failures
that occur before a process starts.

## Adding another language adapter

Implement `LirAdapter`:

```ts
interface LirAdapter {
  readonly name: string;
  readonly languages: readonly LirLanguage[];
  probe(options?: LirProbeOptions): Promise<LirProbeResult>;
  invoke(request: LirInvocationRequest): Promise<LirInvocationResult>;
}
```

Register it with `registry.register(adapter)`. Keep runtime discovery explicit,
use the shared `runProcess` helper for timeouts/output limits, and return
normalized failures rather than throwing for execution problems.

## Tests

```text
cd runtime
npx vitest run tests/lir.test.ts
```

Coverage includes adapter registration and discovery, declaration parsing, Python
and TypeScript invocation, exception normalization, missing entries and
runtimes, permission denial, timeouts, cancellation, invalid input, non-zero
process exits, output limits, non-serializable results, upstream data, `.mam.md`
twins, and audit records.

A complete runnable system lives in
[`modules/examples/interop/`](../../modules/examples/interop/README.md).
