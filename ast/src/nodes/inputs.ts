/**
 * MAM Inputs Section Node
 *
 * Defines the InputsNode and related types for the Inputs section.
 * An input port describes a typed, named slot through which data flows into
 * the module, including validation constraints and default values.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Built-in port types recognised by the parser. */
export type PortType =
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

/** Validation constraint attached to an input port. */
export interface InputValidation {
  /** Minimum value (for numbers) or minimum length (for strings/arrays). */
  min?: number;
  /** Maximum value (for numbers) or maximum length (for strings/arrays). */
  max?: number;
  /** Regex pattern the value must match. */
  pattern?: string;
  /** Enumerated set of allowed values. */
  enum?: string[];
  /** Custom validation expression (e.g. Python expression). */
  custom?: string;
}

/** A single input port definition. */
export interface InputPort {
  /** Port name. */
  name: string;
  /** Port type. */
  type: PortType;
  /** Whether the port is required. */
  required: boolean;
  /** Human-readable description. */
  description?: string;
  /** Default value (JSON-encoded string). */
  default?: string;
  /** Validation constraints. */
  validation?: InputValidation;
  /** Whether the port accepts multiple values. */
  multiple?: boolean;
  /** Example value for documentation. */
  example?: string;
}

/** The Inputs section AST node. */
export interface InputsNode {
  /** Discriminant – always `'Inputs'`. */
  type: 'Inputs';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of input port definitions. */
  ports: InputPort[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an InputsNode.
 * Returns an empty array when the node is valid.
 */
export function validateInputsNode(node: InputsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'InputsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Inputs') {
    errors.push({ path: 'type', message: `Expected type "Inputs", got "${node.type}".` });
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

    if (typeof port.required !== 'boolean') {
      errors.push({ path: `${base}.required`, message: 'required must be a boolean.' });
    }

    if (port.validation) {
      if (port.validation.min !== undefined && typeof port.validation.min !== 'number') {
        errors.push({ path: `${base}.validation.min`, message: 'min must be a number.' });
      }
      if (port.validation.max !== undefined && typeof port.validation.max !== 'number') {
        errors.push({ path: `${base}.validation.max`, message: 'max must be a number.' });
      }
      if (port.validation.enum !== undefined && !Array.isArray(port.validation.enum)) {
        errors.push({ path: `${base}.validation.enum`, message: 'enum must be an array.' });
      }
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateInputsNodeOptions {
  ports?: InputPort[];
  location?: SourceLocation;
}

/** Create an InputsNode with sensible defaults. */
export function createInputsNode(options: CreateInputsNodeOptions = {}): InputsNode {
  return {
    type: 'Inputs',
    ports: options.ports ?? [],
    location: options.location,
  };
}

/** Create a single InputPort. */
export function createInputPort(
  name: string,
  type: PortType = 'string',
  required = false,
  overrides: Partial<Omit<InputPort, 'name' | 'type' | 'required'>> = {},
): InputPort {
  return {
    name,
    type,
    required,
    ...overrides,
  };
}

/** Create an InputValidation object. */
export function createInputValidation(options: InputValidation): InputValidation {
  return { ...options };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is an InputsNode. */
export function isInputsNode(value: unknown): value is InputsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as InputsNode).type === 'Inputs' &&
    Array.isArray((value as InputsNode).ports)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all port names. */
export function getInputPortNames(node: InputsNode): string[] {
  return node.ports.map((p) => p.name);
}

/** Find a port by name. */
export function findInputPortByName(node: InputsNode, name: string): InputPort | undefined {
  return node.ports.find((p) => p.name === name);
}

/** Return only required ports. */
export function getRequiredInputPorts(node: InputsNode): InputPort[] {
  return node.ports.filter((p) => p.required);
}

/** Return only optional ports. */
export function getOptionalInputPorts(node: InputsNode): InputPort[] {
  return node.ports.filter((p) => !p.required);
}

/** Filter ports by type. */
export function getInputPortsByType(node: InputsNode, type: PortType): InputPort[] {
  return node.ports.filter((p) => p.type === type);
}

/** Check whether a port name exists. */
export function hasInputPort(node: InputsNode, name: string): boolean {
  return node.ports.some((p) => p.name === name);
}

/** Count total ports. */
export function countInputPorts(node: InputsNode): number {
  return node.ports.length;
}

/** Build a human-readable summary of the input interface. */
export function summarizeInputPorts(node: InputsNode): string {
  return node.ports
    .map((p) => `${p.name}: ${p.type}${p.required ? ' (required)' : ''}`)
    .join(', ');
}
