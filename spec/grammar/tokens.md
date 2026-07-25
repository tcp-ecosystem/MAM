# MAM Token Definitions

## Token Types

### Special Tokens
| Token | Pattern | Description |
|-------|---------|-------------|
| `EOF` | `$` | End of file |
| `ERROR` | `.` | Unexpected character |

### Front Matter
| Token | Pattern | Description |
|-------|---------|-------------|
| `FRONTMATTER_SEPARATOR` | `^---$` | Front matter delimiter |

### Headings
| Token | Pattern | Description |
|-------|---------|-------------|
| `HEADING_1` | `^#\s` | Level 1 heading |
| `HEADING_2` | `^##\s` | Level 2 heading |
| `HEADING_3` | `^###\s` | Level 3 heading |
| `HEADING_4` | `^####\s` | Level 4 heading |
| `HEADING_5` | `^#####\s` | Level 5 heading |
| `HEADING_6` | `^######\s` | Level 6 heading |
| `HEADING_TEXT` | `.*` | Heading content |

### Code
| Token | Pattern | Description |
|-------|---------|-------------|
| `CODE_FENCE_BACKTICK` | `^`{3,}` | Backtick code fence |
| `CODE_FENCE_TILDE` | `^~{3,}` | Tilde code fence |
| `CODE_LANGUAGE` | Language identifier | Code block language |
| `CODE_CONTENT` | Until closing fence | Code block content |
| `CODE_METADATA` | `# @mam:key=value` | MAM metadata comment |

### Lists
| Token | Pattern | Description |
|-------|---------|-------------|
| `BULLET_LIST` | `[-*+]\s` | Unordered list marker |
| `NUMBERED_LIST` | `\d+\.\s` | Ordered list marker |
| `TASK_CHECKED` | `[x]\s` | Checked task item |
| `TASK_UNCHECKED` | `[ ]\s` | Unchecked task item |

### Tables
| Token | Pattern | Description |
|-------|---------|-------------|
| `TABLE_PIPE` | `\|` | Table cell separator |
| `TABLE_HYPHEN` | `[\s:-]+` | Table separator row |
| `TABLE_HEADER_CELL` | `[^|]+` | Table header cell |
| `TABLE_ROW_CELL` | `[^|]+` | Table data cell |

### Block Elements
| Token | Pattern | Description |
|-------|---------|-------------|
| `BLOCKQUOTE` | `^>\s` | Blockquote marker |
| `HORIZONTAL_RULE` | `^[-*_]{3,}$` | Horizontal rule |

### YAML
| Token | Pattern | Description |
|-------|---------|-------------|
| `YAML_KEY` | `[^:]+` | YAML key |
| `YAML_VALUE` | `.*` | YAML value |
| `YAML_LIST_ITEM` | `^- ` | YAML list item |

### Whitespace
| Token | Pattern | Description |
|-------|---------|-------------|
| `NEWLINE` | `\n` | Newline character |
| `INDENT` | `^\s{2,}` | Indentation |
| `WHITESPACE` | `\s+` | Whitespace |

## Valid Languages

```
python, py, javascript, js, typescript, ts, rust, rs, go,
shell, bash, sh, zsh, yaml, yml, json, mermaid, markdown, md,
html, css, sql, ruby, java, c, cpp, csharp, cs, php, swift,
kotlin, dart, lua, r, perl, toml, xml, dockerfile, makefile
```

## Standard Section Names

```
Purpose, Inputs, Outputs, Rules, Workflow, Mermaid, Python,
JavaScript, TypeScript, Prompt, Memory, Examples, Tests,
References, Dependencies, Exports, Imports, Plugins,
Permissions, Capabilities
```