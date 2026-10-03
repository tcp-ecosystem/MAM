# @mam/plugin-yaml

> YAML configuration parsing, validation and serialisation for MAM modules

A hand-written parser for the YAML subset MAM configuration uses: block
mappings, block sequences, flow collections, block scalars, comments, document
markers, anchors and aliases. Anything outside that subset is reported rather
than silently mis-parsed.

## Installation

```bash
pnpm add @mam/plugin-yaml
```

## Quick start

```typescript
import yamlPlugin, { parseYAML, stringifyYAML } from '@mam/plugin-yaml';

const { data, errors, warnings, details } = parseYAML(`
id: my-module
tags:
  - core
  - example
database:
  host: localhost
  port: 5432
`);

data;   // { id: 'my-module', tags: ['core','example'], database: { host: 'localhost', port: 5432 } }
errors; // [] — parsing never throws, problems come back here
```

Configured instance:

```typescript
import { createYamlPlugin, createYamlApi } from '@mam/plugin-yaml';

const plugin = createYamlPlugin({ allRules: true, schema: MAM_CORE_SCHEMA });
const api = createYamlApi();
api.parse(source);
api.validate(data);
api.stringify(data);
```

## Parsing

```typescript
parseYAML(text, { prefix, coerce, flatten, maxDepth, maxEntries, includeBarePairs });
```

| Option | Default | Effect |
|--------|---------|--------|
| `prefix` | `''` | namespace every key, e.g. `runtime.` |
| `coerce` | `false` | convert `'42'` to `42` |
| `flatten` | `true` | nested objects become `db.host` |
| `maxDepth` | `8` | depth limit for `flatten` |
| `maxEntries` | `1000` | cap on produced entries |
| `includeBarePairs` | `false` | also read bare `key: value` prose |
| `allowScalarJson` | `false` | accept a non-object top-level JSON value |

`coerce` is off by default because a padded id like `007` and a version like
`1.0.0` would change meaning. `includeBarePairs` is off by default because it
also matches ordinary prose containing a colon.

Supported: nested maps, block sequences, sequences of maps, nested sequences,
flow collections (`[a, b]`, `{a: 1}`), literal (`|`) and folded (`>`) block
scalars with `-`/`+` chomping, comments, `---` document markers, `&anchor` and
`*alias`, hex/octal/exponent numbers, and `.inf` / `.nan`.

### Errors

```typescript
const { details } = parseYAML('a: 1\na: 2');
details[0];   // { code: 'duplicate-key', message: 'Duplicate key "a"', line: 2 }
```

| Code | Meaning |
|------|---------|
| `duplicate-key` | a key defined twice in one mapping |
| `tab-indent` | tabs used for indentation |
| `expected-key` | a line that is not `key: value` |
| `bad-indent` | inconsistent indentation |
| `empty-key` | a key with no name |
| `unknown-alias` | `*alias` with no matching anchor |
| `invalid-key` | a key that cannot be addressed as a dotted path |

Duplicate keys are an error in YAML, and are reported here rather than silently
overwriting.

## Validation

```typescript
import { validateYAMLContent } from '@mam/plugin-yaml';

const result = validateYAMLContent(source);
result.valid;   // false on any error
result.error;   // first problem, with a line number
result.errors;  // all problems
```

Keys must look like identifiers, optionally dotted: `db.host` is accepted,
`123bad` is not. This is deliberately stricter than YAML, which permits any
string as a key — MAM addresses configuration with dotted paths, so a key that
cannot be written as one is rejected where it is written rather than becoming
unreachable later. Pass `{ allowDottedKeys: false }` for raw-YAML behaviour.

## Schema

```typescript
import { validateYAMLSchema, applyYAMLSchemaDefaults, MAM_CORE_SCHEMA } from '@mam/plugin-yaml';

validateYAMLSchema(data, schema);                        // does not modify data
validateYAMLSchema(data, schema, { applyDefaults: true }); // writes defaults
applyYAMLSchemaDefaults(data, schema);                    // returns a copy
```

A field may declare `type` (or a union), `required`, `default`, `enum`,
`pattern`, `min` / `max`, `minLength` / `maxLength`, `aliases`, `deprecated`,
nested `fields` and array `items`. Field names may be dotted paths, so
`db.port` addresses a nested value.

> `validateYAMLSchema` does not write to the object you hand it. An earlier
> version applied defaults straight into the caller's record, so merely
> validating a config silently changed it.

Bundled schemas: `MAM_CORE_SCHEMA` (module metadata) and `MAM_BUILD_SCHEMA`
(nested build configuration).

## Serialisation

```typescript
stringifyYAML({ a: { b: 1 }, list: [1, 2] });
parseYAML(stringifyYAML(original)).data === original;   // round-trips
```

Values that would be misread on the way back are quoted, and multi-line strings
become block scalars so the output still parses:

```typescript
parseYAML(stringifyYAML({ v: '007' })).data.v;      // '007', not 7
parseYAML(stringifyYAML({ s: 'x: y' })).data.s;     // 'x: y'
parseYAML(stringifyYAML({ m: 'l1\nl2' })).data.m;   // 'l1\nl2'
```

## Utilities

```typescript
import {
  flattenYAML, unflattenYAML, mergeYAMLObjects, mergeYAMLDefaults,
  getYAMLPath, setYAMLPath, deleteYAMLPath, pickYAML,
  diffYAMLObjects, yamlEquals, sortYAMLKeys, describeYAMLShape,
  YAMLToJSON, jsonToYAML,
} from '@mam/plugin-yaml';
```

`YAMLToJSON` goes through the real parser, so nesting and types survive the
conversion.

Paths are rejected rather than sanitised: `setYAMLPath(data, '__proto__.x', v)`
returns `false` and writes nothing. Filtering the unsafe segment out would
quietly write `data.x` instead — a write to a different key than asked for.

## Rules

| Rule | Catches |
|------|---------|
| `yaml-syntax` | source that does not parse |
| `yaml-duplicate-keys` | a key defined twice |
| `yaml-tab-indent` | tabs used for indentation |
| `yaml-key-format` | keys outside the accepted shape |
| `yaml-not-empty` | blocks with no data (opt-in) |
| `yaml-single-document` | multi-document blocks (opt-in) |
| `yaml-size` | blocks past a configured limit |
| `yaml-depth` | very deeply nested blocks |

```typescript
import { YAML_RULES, runYAMLRules, createYAMLValidationRule } from '@mam/plugin-yaml';

runYAMLRules(module, YAML_RULES);
createYAMLValidationRule({ maxLines: 500, rejectEmpty: true });
```

## API surface

- `parseYAML`, `parseYAMLDocuments`, `parseYAMLValue`, `parseFlowCollection`,
  `validateYAMLContent`, `stringifyYAML`, `countDocuments`, `stripYAMLComment`,
  `needsQuoting`
- `validateYAMLSchema`, `applyYAMLSchemaDefaults`, `MAM_CORE_SCHEMA`,
  `MAM_BUILD_SCHEMA`, `getSchemaPaths`, `mergeYAMLSchemas`, `getValueType`
- `flattenYAML`, `unflattenYAML`, `mergeYAMLObjects`, `diffYAMLObjects`,
  `getYAMLPath`, `setYAMLPath`, `deleteYAMLPath`, `YAMLToJSON`, `jsonToYAML`
- `YAML_RULES`, `runYAMLRules`, `createYAMLValidationRule`
- `createYamlPlugin`, `createYamlApi`, `readModuleConfig`, `describeYamlPlugin`

## License

MIT
