/**
 * MAM Help Command
 *
 * Renders the CLI command catalogue: grouped listings, per-topic help and a
 * fuzzy command search.
 *
 * The catalogue is data ({@link COMMAND_CATALOG}) rather than inline
 * `console.log` calls, which keeps it greppable, testable and reusable by the
 * `docs` command and the MCP server, which both advertise the CLI surface.
 *
 * Three entry points:
 *
 *   - {@link showHelp}     the default `mam help` listing
 *   - {@link showTopic}    `mam help <topic>` for a single group
 *   - {@link searchHelp}   `mam help --search <term>`
 *
 * @module help
 */
import chalk from 'chalk';

// ============================================================================
// Catalogue types
// ============================================================================

/** A logical grouping of related commands. */
export type HelpTopic =
  | 'module'
  | 'development'
  | 'execution'
  | 'package'
  | 'intelligence'
  | 'utilities';

/** One catalogue entry. */
export interface CatalogEntry {
  /** Command name as typed by the user. */
  name: string;
  /** Short one-line description. */
  summary: string;
  /** Topic the command belongs to. */
  topic: HelpTopic;
  /** Alternative names that resolve to this command. */
  aliases?: string[];
  /** Canonical usage string. */
  usage?: string;
}

/** A topic heading with its entries. */
export interface TopicGroup {
  /** Topic identifier. */
  topic: HelpTopic;
  /** Human readable heading. */
  heading: string;
  /** Commands belonging to the topic. */
  entries: CatalogEntry[];
}

// ============================================================================
// Catalogue data
// ============================================================================

/**
 * Every command advertised by the CLI.
 *
 * Kept in sync with the commander registrations in `src/index.ts`.
 */
export const COMMAND_CATALOG: readonly CatalogEntry[] = [
  // --- Module management ---------------------------------------------------
  { name: 'init', summary: 'Initialize a MAM project or module', topic: 'module', usage: 'mam init [name] [--project]' },
  { name: 'new', summary: 'Create a new module from a template', topic: 'module', usage: 'mam new <name>' },
  { name: 'create', summary: 'Scaffold a module, agent, workflow or project', topic: 'module', usage: 'mam create [name] [--kind <kind>]' },
  { name: 'build', summary: 'Build a module to AST', topic: 'module', usage: 'mam build <file>' },
  { name: 'validate', summary: 'Validate a module against the spec', topic: 'module', usage: 'mam validate <file> [--strict]' },
  { name: 'inspect', summary: 'Deeply inspect a module and print a report', topic: 'module', usage: 'mam inspect <file> [--json]' },
  { name: 'smoke', summary: 'Smoke-test a module end to end', topic: 'module', usage: 'mam smoke <file> [--target <t>]' },
  { name: 'harmony', summary: 'Check that a module set is internally consistent', topic: 'module', usage: 'mam harmony [path] [--json]' },

  // --- Development ---------------------------------------------------------
  { name: 'lint', summary: 'Lint a MAM module', topic: 'development', usage: 'mam lint <file>' },
  { name: 'format', summary: 'Format a module with consistent style', topic: 'development', usage: 'mam format <file> [-i]', aliases: ['fmt'] },
  { name: 'graph', summary: 'Show the dependency graph', topic: 'development', usage: 'mam graph' },
  { name: 'ast', summary: 'Dump the parsed AST', topic: 'development', usage: 'mam ast <file>' },
  { name: 'test', summary: 'Run module tests', topic: 'development', usage: 'mam test [file]' },
  { name: 'dev', summary: 'Start the development server with hot reload', topic: 'development', usage: 'mam dev [--port <p>]' },
  { name: 'optimize', summary: 'Report token-optimization savings for a module', topic: 'development', usage: 'mam optimize <file>' },

  // --- Execution -----------------------------------------------------------
  { name: 'run', summary: 'Run a MAM module natively', topic: 'execution', usage: 'mam run <file>' },
  { name: 'execute', summary: 'Execute a module section by section', topic: 'execution', usage: 'mam execute <file>' },
  { name: 'compile', summary: 'Compile to a target language', topic: 'execution', usage: 'mam compile <file> -t <target>' },
  { name: 'export', summary: 'Export a module to another format', topic: 'execution', usage: 'mam export <file>' },
  { name: 'serve', summary: 'Serve modules, or an MCP server with --mcp', topic: 'execution', usage: 'mam serve [--mcp]' },
  { name: 'migrate', summary: 'Migrate a v1 module to v2', topic: 'execution', usage: 'mam migrate <file>' },

  // --- Package management --------------------------------------------------
  { name: 'install', summary: 'Install module dependencies', topic: 'package', aliases: ['i'], usage: 'mam install [packages...] [-g]' },
  { name: 'uninstall', summary: 'Remove module dependencies', topic: 'package', usage: 'mam uninstall <packages...>' },
  { name: 'update', summary: 'Update MAM packages', topic: 'package', usage: 'mam update [package] [--check]' },
  { name: 'publish', summary: 'Publish a module to the registry', topic: 'package', usage: 'mam publish' },
  { name: 'global', summary: 'Manage the global MAM installation', topic: 'package', usage: 'mam global [info|link|list]' },

  // --- Intelligence --------------------------------------------------------
  { name: 'memory', summary: 'Inspect and manage the working memory', topic: 'intelligence', usage: 'mam memory [add|get|list|clear|search]' },
  { name: 'system', summary: 'Show the wired MAM engines', topic: 'intelligence', usage: 'mam system' },
  { name: 'check', summary: 'Check a module against the spec', topic: 'intelligence', usage: 'mam check <file>' },

  // --- Utilities -----------------------------------------------------------
  { name: 'doctor', summary: 'Check the local environment', topic: 'utilities', usage: 'mam doctor' },
  { name: 'docs', summary: 'Generate documentation for a module', topic: 'utilities', usage: 'mam docs <file>' },
  { name: 'version', summary: 'Show or bump the version', topic: 'utilities', usage: 'mam version [show|bump|set]' },
  { name: 'help', summary: 'Show this help', topic: 'utilities', usage: 'mam help [topic] [--search <term>]' },
];

/** Display headings for each topic, in listing order. */
export const TOPIC_HEADINGS: ReadonlyArray<{ topic: HelpTopic; heading: string }> = [
  { topic: 'module', heading: 'Module Management' },
  { topic: 'development', heading: 'Development' },
  { topic: 'execution', heading: 'Execution' },
  { topic: 'package', heading: 'Package Management' },
  { topic: 'intelligence', heading: 'Intelligence' },
  { topic: 'utilities', heading: 'Utilities' },
];

// ============================================================================
// Query helpers
// ============================================================================

/**
 * Group the catalogue by topic, preserving {@link TOPIC_HEADINGS} order and
 * dropping empty topics.
 *
 * @returns one {@link TopicGroup} per non-empty topic.
 */
export function groupByTopic(): TopicGroup[] {
  const groups: TopicGroup[] = [];
  for (const { topic, heading } of TOPIC_HEADINGS) {
    const entries = COMMAND_CATALOG.filter((e) => e.topic === topic);
    if (entries.length > 0) groups.push({ topic, heading, entries });
  }
  return groups;
}

/**
 * Resolve a command by name or alias.
 *
 * @param name - command name or alias.
 * @returns the catalogue entry, or `undefined`.
 */
export function findCommand(name: string): CatalogEntry | undefined {
  const needle = name.trim().toLowerCase();
  return COMMAND_CATALOG.find(
    (e) => e.name === needle || (e.aliases ?? []).some((a) => a === needle),
  );
}

/**
 * Whether a string names a topic.
 *
 * @param topic - candidate topic.
 * @returns `true` when the topic exists.
 */
export function isTopic(topic: string): topic is HelpTopic {
  return TOPIC_HEADINGS.some((t) => t.topic === topic);
}

/**
 * Search the catalogue by substring across name, summary and usage.
 *
 * @param term - search term.
 * @returns matching entries, best (name matches) first.
 */
export function searchCatalog(term: string): CatalogEntry[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return [];
  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of COMMAND_CATALOG) {
    let score = 0;
    if (entry.name === needle) score += 100;
    else if (entry.name.startsWith(needle)) score += 60;
    else if (entry.name.includes(needle)) score += 40;
    if (entry.summary.toLowerCase().includes(needle)) score += 15;
    if ((entry.usage ?? '').toLowerCase().includes(needle)) score += 10;
    if ((entry.aliases ?? []).some((a) => a.includes(needle))) score += 20;
    if (score > 0) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

/**
 * The width of the command column for aligned output.
 *
 * @returns the padded column width.
 */
export function nameColumnWidth(): number {
  return COMMAND_CATALOG.reduce((max, e) => Math.max(max, e.name.length), 0) + 2;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render the header block.
 *
 * @returns the header lines.
 */
export function renderHeader(): string[] {
  return [
    '',
    chalk.cyan.bold('MAM — Markdown as Module'),
    chalk.gray('Machine Agent Modules · System Description Language'),
    '',
    chalk.white('Usage: mam <command> [options]'),
    chalk.gray('       mam help [topic]        show help for a topic'),
    chalk.gray('       mam help --search <t>   search commands'),
    '',
  ];
}

/**
 * Render one topic group.
 *
 * @param group - the group to render.
 * @returns the rendered lines.
 */
export function renderTopicGroup(group: TopicGroup): string[] {
  const width = nameColumnWidth();
  const lines = [chalk.yellow.bold(`${group.heading}:`)];
  for (const entry of group.entries) {
    const alias = entry.aliases?.length ? chalk.gray(` (${entry.aliases.join(', ')})`) : '';
    lines.push(`  ${chalk.cyan(entry.name.padEnd(width))} ${entry.summary}${alias}`);
  }
  lines.push('');
  return lines;
}

/**
 * Render the full command listing.
 *
 * @returns the rendered help text.
 */
export function renderHelp(): string {
  const lines = [...renderHeader()];
  for (const group of groupByTopic()) {
    lines.push(...renderTopicGroup(group));
  }
  lines.push(chalk.gray(`  ${COMMAND_CATALOG.length} commands available.`));
  lines.push(chalk.gray('  Run `mam <command> --help` for command specific options.'));
  lines.push('');
  return lines.join('\n');
}

/**
 * Render help for a single topic.
 *
 * @param topic - the topic to render.
 * @returns the rendered text.
 */
export function renderTopic(topic: HelpTopic): string {
  const group = groupByTopic().find((g) => g.topic === topic);
  const lines = ['', chalk.cyan.bold(`MAM — ${topic}`), ''];
  if (!group) {
    lines.push(chalk.red(`Unknown topic: ${topic}`), '');
    lines.push(chalk.gray(`Available topics: ${TOPIC_HEADINGS.map((t) => t.topic).join(', ')}`), '');
    return lines.join('\n');
  }
  lines.push(...renderTopicGroup(group));
  return lines.join('\n');
}

/**
 * Render search results.
 *
 * @param term - the search term.
 * @returns the rendered text.
 */
export function renderSearch(term: string): string {
  const results = searchCatalog(term);
  const lines = ['', chalk.cyan.bold(`Search: ${term}`), ''];
  if (results.length === 0) {
    lines.push(chalk.yellow('  No matching commands.'), '');
    return lines.join('\n');
  }
  const width = nameColumnWidth();
  for (const entry of results) {
    lines.push(`  ${chalk.cyan(entry.name.padEnd(width))} ${entry.summary}`);
    if (entry.usage) lines.push(`  ${' '.repeat(width)} ${chalk.gray(entry.usage)}`);
  }
  lines.push('', chalk.gray(`  ${results.length} match${results.length === 1 ? '' : 'es'}.`), '');
  return lines.join('\n');
}

/**
 * Render detailed help for a single command.
 *
 * @param name - command name or alias.
 * @returns the rendered text, or a "not found" notice.
 */
export function renderCommandHelp(name: string): string {
  const entry = findCommand(name);
  if (!entry) {
    return ['', chalk.red(`Unknown command: ${name}`), '', chalk.gray('Run `mam help` to list commands.'), ''].join('\n');
  }
  const heading = TOPIC_HEADINGS.find((t) => t.topic === entry.topic)?.heading ?? entry.topic;
  return [
    '',
    chalk.cyan.bold(`${entry.name} — ${entry.summary}`),
    '',
    chalk.gray(heading),
    entry.usage ? chalk.white(`  usage: ${entry.usage}`) : '',
    entry.aliases?.length ? chalk.gray(`  aliases: ${entry.aliases.join(', ')}`) : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ============================================================================
// Entry points
// ============================================================================

/**
 * Print the full help listing.
 *
 * @returns void; the help text is written to stdout.
 */
export function showHelp(): void {
  console.log(renderHelp());
}

/**
 * Print help for a topic, a command, or run a search.
 *
 * @param target - topic name, command name, or an empty string for the listing.
 * @param options - optional search override.
 * @returns void; output is written to stdout.
 */
export function showTopic(target: string, options: { search?: string } = {}): void {
  const needle = (options.search ?? target ?? '').trim();
  if (needle.length === 0) {
    showHelp();
    return;
  }
  const lower = needle.toLowerCase();
  if (lower.startsWith('--search=')) {
    console.log(renderSearch(lower.slice('--search='.length)));
    return;
  }
  if (isTopic(lower)) {
    console.log(renderTopic(lower));
    return;
  }
  if (findCommand(lower)) {
    console.log(renderCommandHelp(lower));
    return;
  }
  const results = searchCatalog(lower);
  console.log(results.length > 0 ? renderSearch(lower) : renderHelp());
}

/**
 * Search the catalogue and print the results.
 *
 * @param term - the search term.
 * @returns the matching entries.
 */
export function searchHelp(term: string): CatalogEntry[] {
  const results = searchCatalog(term);
  console.log(renderSearch(term));
  return results;
}

/**
 * Every command name in the catalogue.
 *
 * @returns the list of command names.
 */
export function commandNames(): string[] {
  return COMMAND_CATALOG.map((e) => e.name);
}

/**
 * Every alias in the catalogue.
 *
 * @returns the list of aliases.
 */
export function commandAliases(): string[] {
  return COMMAND_CATALOG.flatMap((e) => e.aliases ?? []);
}