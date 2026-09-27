/**
 * MAM Outputs Section Node
 *
 * Defines the OutputsNode and related types for the Outputs section.
 * An output port describes a typed, named slot through which data flows out
 * of the module, including schema hints and descriptions.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Built-in output port types. */
export type OutputPortType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'json'
  | 'markdown'
  | 'code'
  | string;

/** Schema hint attached to an output port. */
export interface OutputSchema {
  /** JSON Schema URI. */
  schemaUri?: string;
  /** Inline JSON Schema object (encoded as string). */
  schema?: string;
  /** MIME type of the output. */
  mimeType?: string;
  /** Whether the output can be null. */
  nullable?: boolean;
}

/** A single output port definition. */
export interface OutputPort {
  /** Port name. */
  name: string;
  /** Port type. */
  type: OutputPortType;
  /** Human-readable description. */
  description?: string;
  /** Schema hints. */
  schema?: OutputSchema;
  /** Whether the port produces multiple values. */
  multiple?: boolean;
  /** Example value for documentation. */
  example?: string;
  /** Source expression (e.g. how the output is derived). */
  source?: string;
}

/** The Outputs section AST node. */
export interface OutputsNode {
  /** Discriminant – always `'Outputs'`. */
  type: 'Outputs';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of output port definitions. */
  ports: OutputPort[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an OutputsNode.
 * Returns an empty array when the node is valid.
 */
export function validateOutputsNode(node: OutputsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'OutputsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Outputs') {
    errors.push({ path: 'type', message: `Expected type "Outputs", got "${node.type}".` });
  }

  if (!Array.isArray(node.ports)) {
    errors.push({ path: 'ports', message: 'ports must be an array.' });
    return errors;
  }

  const seen = new Set<string>();
  node.ports.forEach((port, idx) => {
    const base = `ports[${idx}]`;

    if (!port.name || typeof port.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'Port name must be a non-empty string.' });
    } else if (seen.has(port.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate port name "${port.name}".` });
    } else {
      seen.add(port.name);
    }

    if (!port.type || typeof port.type !== 'string') {
      errors.push({ path: `${base}.type`, message: 'Port type must be a non-empty string.' });
    }

    if (port.schema) {
      if (port.schema.mimeType !== undefined && typeof port.schema.mimeType !== 'string') {
        errors.push({ path: `${base}.schema.mimeType`, message: 'mimeType must be a string.' });
      }
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateOutputsNodeOptions {
  ports?: OutputPort[];
  location?: SourceLocation;
}

/** Create an OutputsNode with sensible defaults. */
export function createOutputsNode(options: CreateOutputsNodeOptions = {}): OutputsNode {
  return {
    type: 'Outputs',
    ports: options.ports ?? [],
    location: options.location,
  };
}

/** Create a single OutputPort. */
export function createOutputPort(
  name: string,
  type: OutputPortType = 'string',
  overrides: Partial<Omit<OutputPort, 'name' | 'type'>> = {},
): OutputPort {
  return {
    name,
    type,
    ...overrides,
  };
}

/** Create an OutputSchema. */
export function createOutputSchema(options: OutputSchema): OutputSchema {
  return { ...options };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is an OutputsNode. */
export function isOutputsNode(value: unknown): value is OutputsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as OutputsNode).type === 'Outputs' &&
    Array.isArray((value as OutputsNode).ports)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all port names. */
export function getOutputPortNames(node: OutputsNode): string[] {
  return node.ports.map((p) => p.name);
}

/** Find a port by name. */
export function findOutputPortByName(node: OutputsNode, name: string): OutputPort | undefined {
  return node.ports.find((p) => p.name === name);
}

/** Filter ports by type. */
export function getOutputPortsByType(node: OutputsNode, type: OutputPortType): OutputPort[] {
  return node.ports.filter((p) => p.type === type);
}

/** Check whether a port name exists. */
export function hasOutputPort(node: OutputsNode, name: string): boolean {
  return node.ports.some((p) => p.name === name);
}

/** Count total ports. */
export function countOutputPorts(node: OutputsNode): number {
  return node.ports.length;
}

/** Build a human-readable summary of the output interface. */
export function summarizeOutputPorts(node: OutputsNode): string {
  return node.ports
    .map((p) => `${p.name}: ${p.type}`)
    .join(', ');
}

/** Return all nullable output ports. */
export function getNullableOutputPorts(node: OutputsNode): OutputPort[] {
  return node.ports.filter((p) => p.schema?.nullable === true);
}

export function hasOutputs(node: OutputsNode): boolean {
  return node.ports.length > 0;
}

export function countOutputs(node: OutputsNode): number {
  return node.ports.length;
}

export function summarizeOutputs(node: OutputsNode): string {
  const nullable = node.ports.filter((port) => port.schema?.nullable === true).length;
  const suffix = nullable > 0 ? ` (${nullable} nullable)` : '';
  if (node.ports.length === 0) {
    return `0 outputs${suffix}`;
  }
  const list = node.ports.map((port) => `${port.name}: ${port.type}`).join(', ');
  return `${node.ports.length} outputs${suffix}: ${list}`;
}

export function withOutput(node: OutputsNode, port: OutputPort): OutputsNode {
  return {
    ...node,
    ports: [...node.ports, port],
  };
}

export function withoutOutput(
  node: OutputsNode,
  nameOrPredicate: string | ((port: OutputPort) => boolean),
): OutputsNode {
  const predicate =
    typeof nameOrPredicate === 'string'
      ? (port: OutputPort) => port.name === nameOrPredicate
      : nameOrPredicate;
  return {
    ...node,
    ports: node.ports.filter((port) => !predicate(port)),
  };
}

export function cloneOutputsNode(
  node: OutputsNode,
  options?: { stripLocation?: boolean },
): OutputsNode {
  const clone: OutputsNode = {
    ...node,
    ports: node.ports.map((port) => {
      const copy: OutputPort = { ...port };
      if (port.schema) {
        copy.schema = { ...port.schema };
      }
      return copy;
    }),
  };
  if (options?.stripLocation) {
    delete clone.location;
  }
  return clone;
}

export function mergeOutputsNodes(a: OutputsNode, b: OutputsNode): OutputsNode {
  const ports = a.ports.map((port) => ({ ...port }));
  const index = new Map<string, number>(
    ports.map((port, i): [string, number] => [port.name, i]),
  );
  for (const port of b.ports) {
    const existing = index.get(port.name);
    if (existing !== undefined) {
      ports[existing] = { ...port };
    } else {
      index.set(port.name, ports.length);
      ports.push({ ...port });
    }
  }
  return {
    type: 'Outputs',
    ports,
    location: b.location ?? a.location,
  };
}
