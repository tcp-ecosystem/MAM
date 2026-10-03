# @mam/plugin-python

> Python execution context for MAM modules

Runs Python in a child process, analyses source statically, and validates it with
the interpreter's own parser.

> ## Not a sandbox
>
> This plugin runs the host's Python with a timeout and an output cap. It does
> **not** isolate the code. Untrusted Python needs an OS-level sandbox —
> containers, seccomp, a VM, or a service with its own isolation boundary. The
> security rules here report risky constructs for a human to review; a static
> scan cannot see through indirection like `getattr(os, "system")`.

## Requirements

A Python interpreter on `PATH`. The plugin resolves one automatically, trying
`$PYTHON`, `python3`, `python`, and `py -3` on Windows, and caches the result.

This matters more than it sounds: `python3` is a Microsoft Store alias stub on
Windows that exits `9009` with a store message rather than failing to spawn, so
a hardcoded name looks like a mysterious script error instead of a missing
interpreter.

```bash
pnpm add @mam/plugin-python
```

## Quick start

```typescript
import { runPythonCode, checkPythonAvailable } from '@mam/plugin-python';

const { available, version, interpreter } = await checkPythonAvailable();
// { available: true, version: '3.14.6', interpreter: 'python' }

const result = await runPythonCode('print("hello")');
result.success;   // true
result.stdout;    // 'hello\n'
```

Configured instance:

```typescript
import { createPythonPlugin, createPythonApi } from '@mam/plugin-python';

const plugin = createPythonPlugin({
  allRules: true,
  context: { timeout: 5000, maxOutputBytes: 1_000_000 },
});
```

## Running code

```typescript
runPythonCode(code, {
  timeout,            // wall clock, default 30000
  cwd,
  env,                // merged over the inherited environment
  inheritEnv,         // false to pass only `env`
  isolated,           // run with -I, ignoring PYTHON* and the user site dir
  stdin,              // written to the child, which is then closed
  maxOutputBytes,     // abort past this, default 10 MiB
  trimOutput,         // strip surrounding whitespace
  preserveLineEndings,// keep CRLF instead of normalising to LF
  interpreter,        // override the resolved one
  tempDir,
  pythonArgs,         // extra flags before the script
});
```

The result distinguishes the failure modes a runner usually conflates:

```typescript
result.success;      // exit 0, not timed out, not truncated
result.exitCode;     // real exit status
result.signal;       // signal, when killed
result.timedOut;     // hit the wall clock and was killed
result.truncated;    // output cap reached
result.outputBytes;
```

Two details worth knowing:

- **stdin is always closed**, even with no input. A script that reads stdin would
  otherwise block until the timeout.
- **CRLF is normalised to LF** unless `preserveLineEndings` is set, so a module's
  output does not differ by platform. Leading and trailing whitespace is
  preserved, because a program that prints padded text means it.

### Expressions

```typescript
import { runPythonExpression, parseExpressionResult } from '@mam/plugin-python';

const result = await runPythonExpression('{"a": [1, 2]}');
parseExpressionResult(result);   // { value: { a: [1, 2] } }
```

A failed expression returns the real Python error, not a generic failure:

```typescript
parseExpressionResult(await runPythonExpression('1/0'));   // { error: 'division by zero' }
```

### Interpreter control

```typescript
import { resolveInterpreter, setInterpreter, resetInterpreterCache } from '@mam/plugin-python';

resolveInterpreter();     // probe and cache
setInterpreter({ command: 'python3.12', args: [], source: 'env' });
resetInterpreterCache();  // force a fresh probe
```

### Statistics

```typescript
import { getExecutionStats, resetExecutionStats } from '@mam/plugin-python';
// { runs, successes, failures, timeouts, truncated, totalTimeMs, averageTimeMs }
```

## Static analysis

Synchronous and interpreter-free, so it is safe to run on every keystroke or on
a host with no Python installed:

```typescript
import { validatePythonCodeStatic, getPythonSecurityIssues } from '@mam/plugin-python';

validatePythonCodeStatic(code, { maxLineLength: 100, checkMainGuard: true });
```

| Rule | Severity | Catches |
|------|----------|---------|
| `mixed-indent` | warning | a tab used for indentation |
| `bare-except` | warning | `except:` catching everything |
| `unterminated-string` | error | an unclosed triple-quoted string |
| `unbalanced-quotes` | error | an unterminated string on a `def` line |
| `missing-main-guard` | warning | imports and functions with no `__main__` guard |
| `trailing-whitespace` | info | trailing spaces |
| `line-length` | info | lines past the limit |
| `debug-print` | info | a leftover `print()` |
| `none-comparison` | info | `== None` instead of `is None` |

## Security patterns

```typescript
import { SECURITY_PATTERNS, getPythonSecurityIssues } from '@mam/plugin-python';
```

`os.system`, `eval`, `exec`, `__import__`, `shell=True`, `os.popen`,
`pickle.loads`, unsafe `yaml.load`, and `assert` under `-O`. The last two are
`error` severity because they lead to code execution or silent behaviour change;
the rest are `warning`.

## Syntax validation

```typescript
import { checkPythonSyntax, validatePythonCode } from '@mam/plugin-python';

const result = await checkPythonSyntax('def f(:\n');
result.ok;        // false
result.line;      // 1
result.message;   // "expected ':'"
```

This runs the code through `ast.parse` in the interpreter, so it accepts exactly
the syntax the installed Python accepts — not a regex approximation. A previous
version of this plugin performed no syntax validation at all, so
`def f(:` reported nothing.

`validatePythonCode` combines the static analysis with the syntax check. Because
rules are synchronous by contract, `ValidationRule.check` uses only the static
analyser; the async half is exposed separately:

```typescript
import { checkPythonSyntaxRule } from '@mam/plugin-python';
await checkPythonSyntaxRule(module);
```

## Context

```typescript
import { pythonContext, createPythonContext } from '@mam/plugin-python';

const result = await pythonContext.execute('print("hi")', ctx);
result.success;   // true
result.output;    // 'hi\n'
result.timeMs;

const fast = createPythonContext({ timeout: 1000, asExpression: true });
```

A timeout or a truncated run surfaces as an error with the reason, and
`asExpression` runs the code as an expression and returns its value.

## Rules

| Rule | Catches |
|------|---------|
| `python-not-empty` | empty code blocks |
| `python-style` | indentation, whitespace, line length, leftover prints |
| `python-error-handling` | bare `except`, unterminated strings |
| `python-main-guard` | a script with no `__main__` guard |
| `python-security` | risky constructs |
| `python-size` | blocks past the line limit |

```typescript
import { PYTHON_RULES, runPythonRules, createPythonRules } from '@mam/plugin-python';
```

## API surface

- `runPythonCode`, `runPythonFile`, `runPythonExpression`,
  `parseExpressionResult`, `checkPythonAvailable`, `resolveInterpreter`,
  `setInterpreter`, `getCachedInterpreter`, `resetInterpreterCache`,
  `getExecutionStats`, `resetExecutionStats`
- `validatePythonCode`, `validatePythonCodeStatic`, `checkPythonSyntax`,
  `checkPythonSecurityPatterns`, `getPythonSecurityIssues`,
  `stripPythonComment`, `getEffectiveLines`, `SECURITY_PATTERNS`
- `PYTHON_RULES`, `runPythonRules`, `checkPythonSyntaxRule`
- `pythonContext`, `createPythonContext`, `checkPythonReady`
- `createPythonPlugin`, `createPythonApi`, `describePythonPlugin`

## License

MIT
