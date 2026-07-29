/**
 * MAM Python Code Block Node
 *
 * Defines the PythonNode and related types for the Python section.
 * A Python node captures executable code along with metadata about imports,
 * function/class definitions, and execution configuration.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** A Python import statement. */
export interface PythonImport {
  /** Module or package name. */
  module: string;
  /** Specific names imported (empty = import module). */
  names?: string[];
  /** Alias for the import. */
  alias?: string;
  /** Import kind. */
  kind?: 'import' | 'from';
}

/** A function definition discovered in the code. */
export interface PythonFunction {
  /** Function name. */
  name: string;
  /** Parameter names. */
  parameters?: string[];
  /** Return type annotation (if present). */
  returnType?: string;
  /** Whether the function is a coroutine (async def). */
  async?: boolean;
  /** Decorator names. */
  decorators?: string[];
  /** Line number where the function starts (1-indexed). */
  line?: number;
}

/** A class definition discovered in the code. */
export interface PythonClass {
  /** Class name. */
  name: string;
  /** Base class names. */
  bases?: string[];
  /** Method names. */
  methods?: string[];
  /** Decorator names. */
  decorators?: string[];
  /** Line number where the class starts (1-indexed). */
  line?: number;
}

/** Execution configuration for the Python code block. */
export interface PythonExecutionConfig {
  /** Execution timeout in seconds. */
  timeout?: number;
  /** Memory limit (e.g. "512MB"). */
  memory?: string;
  /** Required pip packages. */
  packages?: string[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Working directory hint. */
  workingDir?: string;
  /** Whether to capture stdout. */
  captureOutput?: boolean;
}

/** The Python section AST node. */
export interface PythonNode {
  /** Discriminant – always `'Python'`. */
  type: 'Python';
  /** Source location of the section. */
  location?: SourceLocation;
  /** The Python source code. */
  code: string;
  /** Discovered import statements. */
  imports?: PythonImport[];
  /** Discovered function definitions. */
  functions?: PythonFunction[];
  /** Discovered class definitions. */
  classes?: PythonClass[];
  /** Execution configuration. */
  execution?: PythonExecutionConfig;
  /** Code file name hint. */
  fileName?: string;
  /** Whether the code block is marked as executable. */
  executable?: boolean;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a PythonNode.
 * Returns an empty array when the node is valid.
 */
export function validatePythonNode(node: PythonNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'PythonNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Python') {
    errors.push({ path: 'type', message: `Expected type "Python", got "${node.type}".` });
  }

  if (!node.code || typeof node.code !== 'string') {
    errors.push({ path: 'code', message: 'code must be a non-empty string.' });
  }

  if (node.imports) {
    if (!Array.isArray(node.imports)) {
      errors.push({ path: 'imports', message: 'imports must be an array.' });
    } else {
      node.imports.forEach((imp, i) => {
        const base = `imports[${i}]`;
        if (!imp.module || typeof imp.module !== 'string') {
          errors.push({ path: `${base}.module`, message: 'import module must be a non-empty string.' });
        }
      });
    }
  }

  if (node.functions) {
    if (!Array.isArray(node.functions)) {
      errors.push({ path: 'functions', message: 'functions must be an array.' });
    } else {
      node.functions.forEach((fn, i) => {
        const base = `functions[${i}]`;
        if (!fn.name || typeof fn.name !== 'string') {
          errors.push({ path: `${base}.name`, message: 'function name must be a non-empty string.' });
        }
      });
    }
  }

  if (node.classes) {
    if (!Array.isArray(node.classes)) {
      errors.push({ path: 'classes', message: 'classes must be an array.' });
    } else {
      node.classes.forEach((cls, i) => {
        const base = `classes[${i}]`;
        if (!cls.name || typeof cls.name !== 'string') {
          errors.push({ path: `${base}.name`, message: 'class name must be a non-empty string.' });
        }
      });
    }
  }

  if (node.execution) {
    if (node.execution.timeout !== undefined && (typeof node.execution.timeout !== 'number' || node.execution.timeout < 0)) {
      errors.push({ path: 'execution.timeout', message: 'timeout must be a non-negative number.' });
    }
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreatePythonNodeOptions {
  code: string;
  imports?: PythonImport[];
  functions?: PythonFunction[];
  classes?: PythonClass[];
  execution?: PythonExecutionConfig;
  fileName?: string;
  executable?: boolean;
  location?: SourceLocation;
}

/** Create a PythonNode with sensible defaults. */
export function createPythonNode(options: CreatePythonNodeOptions): PythonNode {
  return {
    type: 'Python',
    code: options.code,
    imports: options.imports,
    functions: options.functions,
    classes: options.classes,
    execution: options.execution,
    fileName: options.fileName,
    executable: options.executable ?? true,
    location: options.location,
  };
}

/** Create a PythonImport. */
export function createPythonImport(
  module: string,
  overrides: Partial<Omit<PythonImport, 'module'>> = {},
): PythonImport {
  return { module, kind: 'import', ...overrides };
}

/** Create a PythonFunction. */
export function createPythonFunction(
  name: string,
  overrides: Partial<Omit<PythonFunction, 'name'>> = {},
): PythonFunction {
  return { name, ...overrides };
}

/** Create a PythonClass. */
export function createPythonClass(
  name: string,
  overrides: Partial<Omit<PythonClass, 'name'>> = {},
): PythonClass {
  return { name, ...overrides };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a PythonNode. */
export function isPythonNode(value: unknown): value is PythonNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PythonNode).type === 'Python' &&
    typeof (value as PythonNode).code === 'string'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all import module names. */
export function getImportModuleNames(node: PythonNode): string[] {
  return (node.imports ?? []).map((i) => i.module);
}

/** Return all function names. */
export function getFunctionNames(node: PythonNode): string[] {
  return (node.functions ?? []).map((f) => f.name);
}

/** Find a function by name. */
export function findFunctionByName(node: PythonNode, name: string): PythonFunction | undefined {
  return node.functions?.find((f) => f.name === name);
}

/** Return all class names. */
export function getClassNames(node: PythonNode): string[] {
  return (node.classes ?? []).map((c) => c.name);
}

/** Find a class by name. */
export function findClassByName(node: PythonNode, name: string): PythonClass | undefined {
  return node.classes?.find((c) => c.name === name);
}

/** Return only async functions. */
export function getAsyncFunctions(node: PythonNode): PythonFunction[] {
  return (node.functions ?? []).filter((f) => f.async === true);
}

/** Count lines of code. */
export function countLines(node: PythonNode): number {
  return node.code.split('\n').length;
}

/** Check whether the code imports a specific module. */
export function hasImport(node: PythonNode, module: string): boolean {
  return (node.imports ?? []).some((i) => i.module === module);
}

/** Build a dependency list from imports and execution config. */
export function getRequiredPackages(node: PythonNode): string[] {
  const packages = new Set<string>();
  for (const imp of node.imports ?? []) {
    packages.add(imp.module.split('.')[0]);
  }
  for (const pkg of node.execution?.packages ?? []) {
    packages.add(pkg);
  }
  return Array.from(packages);
}
