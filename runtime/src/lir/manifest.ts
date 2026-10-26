/**
 * Declaration parsing and deterministic path resolution.
 *
 * Implementations are declared in a module's frontmatter:
 *
 * ```yaml
 * implementations:
 *   - id: normalize
 *     language: python
 *     entry: src/normalize.py
 *     export: normalize
 *   - id: score
 *     language: typescript
 *     entry: src/score.ts
 *     export: score
 *     inputFrom: normalize
 * ```
 *
 * The parser accepts this shape because MAM frontmatter is YAML. No new
 * top-level document syntax is introduced.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { LirError } from './errors.js';
import {
  SUPPORTED_LIR_LANGUAGES,
  type ImplementationDeclaration,
  type LirLanguage,
  type ResolvedImplementation,
} from './types.js';

export interface DeclarationParseOptions {
  /** Human-readable origin used in diagnostics. */
  source?: string;
  /** When provided, entries are checked for path escapes immediately. */
  projectRoot?: string;
}

export interface ResolveContext {
  projectRoot: string;
  cwd?: string;
  manifestPath?: string;
}

export const DEFAULT_EXPORT_FOR_LANGUAGE: Record<LirLanguage, string> = {
  python: 'main',
  javascript: 'default',
  typescript: 'default',
};

const LANGUAGE_ALIASES: Record<string, LirLanguage> = {
  py: 'python',
  python: 'python',
  python3: 'python',
  js: 'javascript',
  javascript: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
};

const DOTTED_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

const ALLOWED_KEYS = new Set([
  'id',
  'language',
  'entry',
  'export',
  'description',
  'inputFrom',
  'permissions',
  'env',
  'timeoutMs',
]);

function invalid(message: string): never {
  throw new LirError('LIR_DECLARATION_INVALID', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  index: number,
  source: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`${source}[${index}].${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  field: string,
  index: number,
  source: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    invalid(`${source}[${index}].${field} must be a string when provided`);
  }
  return value.trim();
}

function stringArray(
  value: unknown,
  field: string,
  index: number,
  source: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(`${source}[${index}].${field} must be an array of strings`);
  }
  const values = value.map((item) => (item as string).trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/**
 * Parse a frontmatter `implementations` value.
 *
 * Passing `undefined` or `null` means "no implementations" and returns an
 * empty list. Any malformed declaration raises `LIR_DECLARATION_INVALID`.
 */
export function parseImplementationDeclarations(
  value: unknown,
  options: DeclarationParseOptions = {},
): ImplementationDeclaration[] {
  const source = options.source ?? 'implementations';
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    invalid(`${source} must be an array of implementation declarations`);
  }

  const declarations: ImplementationDeclaration[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!isRecord(raw)) {
      invalid(`${source}[${index}] must be an object`);
    }

    for (const key of Object.keys(raw)) {
      if (!ALLOWED_KEYS.has(key)) {
        invalid(
          `${source}[${index}] has unknown field "${key}" (allowed: ${[...ALLOWED_KEYS].join(', ')})`,
        );
      }
    }

    const id = requiredString(raw.id, 'id', index, source);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      invalid(
        `${source}[${index}].id "${id}" must start with a letter or digit and contain only letters, digits, ".", "_" or "-"`,
      );
    }
    if (seen.has(id)) {
      invalid(`${source}[${index}].id "${id}" is declared more than once`);
    }
    seen.add(id);

    const languageRaw = requiredString(raw.language, 'language', index, source).toLowerCase();
    const language = LANGUAGE_ALIASES[languageRaw];
    if (!language) {
      invalid(
        `${source}[${index}].language "${languageRaw}" is not supported (supported: ${SUPPORTED_LIR_LANGUAGES.join(', ')})`,
      );
    }

    const entry = requiredString(raw.entry, 'entry', index, source);
    if (isAbsolute(entry)) {
      invalid(`${source}[${index}].entry must be project-relative, not absolute: ${entry}`);
    }

    const exportName = optionalString(raw.export, 'export', index, source)
      ?? DEFAULT_EXPORT_FOR_LANGUAGE[language];
    if (!DOTTED_IDENTIFIER.test(exportName)) {
      invalid(`${source}[${index}].export "${exportName}" is not a valid export path`);
    }

    const description = optionalString(raw.description, 'description', index, source);
    const inputFrom = optionalString(raw.inputFrom, 'inputFrom', index, source);
    if (inputFrom !== undefined && !seen.has(inputFrom)) {
      invalid(
        `${source}[${index}].inputFrom "${inputFrom}" must reference an earlier implementation in the same declaration list`,
      );
    }

    const permissions = stringArray(raw.permissions, 'permissions', index, source);
    const env = stringArray(raw.env, 'env', index, source);
    if (env) {
      for (const name of env) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          invalid(`${source}[${index}].env contains an invalid variable name: ${name}`);
        }
      }
    }

    let timeoutMs: number | undefined;
    if (raw.timeoutMs !== undefined && raw.timeoutMs !== null) {
      if (
        typeof raw.timeoutMs !== 'number'
        || !Number.isFinite(raw.timeoutMs)
        || raw.timeoutMs <= 0
      ) {
        invalid(`${source}[${index}].timeoutMs must be a positive number`);
      }
      timeoutMs = Math.floor(raw.timeoutMs);
    }

    const declaration: ImplementationDeclaration = {
      id,
      language,
      entry,
      export: exportName,
    };
    if (description !== undefined) declaration.description = description;
    if (inputFrom !== undefined) declaration.inputFrom = inputFrom;
    if (permissions !== undefined) declaration.permissions = permissions;
    if (env !== undefined) declaration.env = env;
    if (timeoutMs !== undefined) declaration.timeoutMs = timeoutMs;

    if (options.projectRoot) {
      // Validate the path early so `mam validate` catches escapes without
      // starting a process.
      resolveImplementation(declaration, { projectRoot: options.projectRoot });
    }

    declarations.push(declaration);
  }

  return declarations;
}

function assertInside(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new LirError(
      'LIR_PATH_ESCAPE',
      `${label} "${candidate}" escapes the project root "${root}"`,
    );
  }
}

/**
 * Resolve a declaration against a project root.
 *
 * Entries and working directories must stay inside the project root. The
 * registry additionally verifies existence and resolves symlinks before
 * invoking anything.
 */
export function resolveImplementation(
  declaration: ImplementationDeclaration,
  context: ResolveContext,
): ResolvedImplementation {
  const projectRoot = resolve(context.projectRoot);
  const entry = resolve(projectRoot, declaration.entry);
  assertInside(projectRoot, entry, 'entry');

  const cwd = resolve(context.cwd ?? projectRoot);
  if (cwd !== projectRoot) assertInside(projectRoot, cwd, 'cwd');

  return {
    ...declaration,
    entry,
    projectRoot,
    cwd,
    manifestPath: context.manifestPath ? resolve(context.manifestPath) : undefined,
  };
}
