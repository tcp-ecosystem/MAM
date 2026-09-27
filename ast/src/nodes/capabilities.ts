/**
 * MAM Capabilities Section Node
 *
 * Defines the CapabilitiesNode and related types for the Capabilities section.
 * A capability describes a named ability the module provides, including its
 * input/output ports, requirements, and proficiency level.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Proficiency level of a capability. */
export type CapabilityLevel =
  | 'basic'
  | 'intermediate'
  | 'advanced'
  | 'expert';

/** A single port descriptor used by a capability. */
export interface CapabilityPort {
  /** Port name. */
  name: string;
  /** Port type (e.g. "string", "number", "Image"). */
  type: string;
  /** Whether the port is required. */
  required: boolean;
  /** Human-readable description. */
  description?: string;
}

/** Requirement that must be met before a capability can be used. */
export interface CapabilityRequirement {
  /** Requirement identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Requirement type. */
  type: 'permission' | 'dependency' | 'configuration' | 'runtime' | 'custom';
}

/** A single capability offered by a module. */
export interface Capability {
  /** Unique name of the capability. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Input port definitions. */
  inputs?: CapabilityPort[];
  /** Output port definitions. */
  outputs?: CapabilityPort[];
  /** Requirements that must be satisfied. */
  requirements?: CapabilityRequirement[];
  /** Proficiency level. */
  level?: CapabilityLevel;
}

/** The Capabilities section AST node. */
export interface CapabilitiesNode {
  /** Discriminant – always `'Capabilities'`. */
  type: 'Capabilities';
  /** Source location of the section. */
  location?: SourceLocation;
  /** List of capabilities declared by the module. */
  capabilities: Capability[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  /** Path to the offending field. */
  path: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Validate a CapabilitiesNode.
 * Returns an empty array when the node is valid.
 */
export function validateCapabilitiesNode(node: CapabilitiesNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'CapabilitiesNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Capabilities') {
    errors.push({ path: 'type', message: `Expected type "Capabilities", got "${node.type}".` });
  }

  if (!Array.isArray(node.capabilities)) {
    errors.push({ path: 'capabilities', message: 'capabilities must be an array.' });
    return errors;
  }

  node.capabilities.forEach((cap, idx) => {
    const base = `capabilities[${idx}]`;

    if (!cap.name || typeof cap.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'capability.name must be a non-empty string.' });
    }

    if (cap.inputs) {
      if (!Array.isArray(cap.inputs)) {
        errors.push({ path: `${base}.inputs`, message: 'capability.inputs must be an array.' });
      } else {
        cap.inputs.forEach((p, pi) => {
          if (!p.name || typeof p.name !== 'string') {
            errors.push({ path: `${base}.inputs[${pi}].name`, message: 'Port name must be a non-empty string.' });
          }
          if (!p.type || typeof p.type !== 'string') {
            errors.push({ path: `${base}.inputs[${pi}].type`, message: 'Port type must be a non-empty string.' });
          }
        });
      }
    }

    if (cap.outputs) {
      if (!Array.isArray(cap.outputs)) {
        errors.push({ path: `${base}.outputs`, message: 'capability.outputs must be an array.' });
      } else {
        cap.outputs.forEach((p, pi) => {
          if (!p.name || typeof p.name !== 'string') {
            errors.push({ path: `${base}.outputs[${pi}].name`, message: 'Port name must be a non-empty string.' });
          }
          if (!p.type || typeof p.type !== 'string') {
            errors.push({ path: `${base}.outputs[${pi}].type`, message: 'Port type must be a non-empty string.' });
          }
        });
      }
    }

    if (cap.level && !['basic', 'intermediate', 'advanced', 'expert'].includes(cap.level)) {
      errors.push({ path: `${base}.level`, message: `Invalid level "${cap.level}".` });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateCapabilitiesNodeOptions {
  capabilities?: Capability[];
  location?: SourceLocation;
}

/** Create a CapabilitiesNode with sensible defaults. */
export function createCapabilitiesNode(options: CreateCapabilitiesNodeOptions = {}): CapabilitiesNode {
  return {
    type: 'Capabilities',
    capabilities: options.capabilities ?? [],
    location: options.location,
  };
}

/** Create a single Capability with defaults. */
export function createCapability(name: string, overrides: Partial<Omit<Capability, 'name'>> = {}): Capability {
  return {
    name,
    ...overrides,
  };
}

/** Create a CapabilityPort. */
export function createCapabilityPort(
  name: string,
  type: string,
  required = false,
  description?: string,
): CapabilityPort {
  return { name, type, required, description };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a CapabilitiesNode. */
export function isCapabilitiesNode(value: unknown): value is CapabilitiesNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CapabilitiesNode).type === 'Capabilities' &&
    Array.isArray((value as CapabilitiesNode).capabilities)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all capability names from the node. */
export function getCapabilityNames(node: CapabilitiesNode): string[] {
  return node.capabilities.map((c) => c.name);
}

/** Find a capability by name. Returns `undefined` when not found. */
export function findCapabilityByName(node: CapabilitiesNode, name: string): Capability | undefined {
  return node.capabilities.find((c) => c.name === name);
}

/** Filter capabilities by level. */
export function getCapabilitiesByLevel(node: CapabilitiesNode, level: CapabilityLevel): Capability[] {
  return node.capabilities.filter((c) => c.level === level);
}

/** Flatten all input port names across every capability. */
export function getAllInputPortNames(node: CapabilitiesNode): string[] {
  const names: string[] = [];
  for (const cap of node.capabilities) {
    if (cap.inputs) {
      for (const port of cap.inputs) {
        names.push(port.name);
      }
    }
  }
  return names;
}

/** Flatten all output port names across every capability. */
export function getAllOutputPortNames(node: CapabilitiesNode): string[] {
  const names: string[] = [];
  for (const cap of node.capabilities) {
    if (cap.outputs) {
      for (const port of cap.outputs) {
        names.push(port.name);
      }
    }
  }
  return names;
}

/** Collect all unique requirements across capabilities. */
export function getAllRequirements(node: CapabilitiesNode): CapabilityRequirement[] {
  const seen = new Set<string>();
  const result: CapabilityRequirement[] = [];
  for (const cap of node.capabilities) {
    if (cap.requirements) {
      for (const req of cap.requirements) {
        if (!seen.has(req.id)) {
          seen.add(req.id);
          result.push(req);
        }
      }
    }
  }
  return result;
}

/** Count total ports (inputs + outputs) across all capabilities. */
export function countPorts(node: CapabilitiesNode): number {
  let total = 0;
  for (const cap of node.capabilities) {
    total += (cap.inputs?.length ?? 0) + (cap.outputs?.length ?? 0);
  }
  return total;
}

export function hasCapabilities(node: CapabilitiesNode): boolean {
  return node.capabilities.length > 0;
}

export function countCapabilities(node: CapabilitiesNode): number {
  return node.capabilities.length;
}

export function summarizeCapabilities(node: CapabilitiesNode): string {
  const names = node.capabilities.map((capability) => capability.name);
  if (names.length === 0) {
    return '0 capabilities';
  }
  return `${names.length} capabilities: ${names.join(', ')}`;
}

export function withCapability(node: CapabilitiesNode, capability: Capability): CapabilitiesNode {
  return {
    ...node,
    capabilities: [...node.capabilities, capability],
  };
}

export function withoutCapability(
  node: CapabilitiesNode,
  match: string | ((capability: Capability) => boolean),
): CapabilitiesNode {
  const remove =
    typeof match === 'string'
      ? (capability: Capability) => capability.name === match
      : match;
  return {
    ...node,
    capabilities: node.capabilities.filter((capability) => !remove(capability)),
  };
}

export function cloneCapabilitiesNode(
  node: CapabilitiesNode,
  options: { stripLocation?: boolean } = {},
): CapabilitiesNode {
  const copy: CapabilitiesNode = {
    ...node,
    capabilities: node.capabilities.map((capability) => {
      const next: Capability = { ...capability };
      if (capability.inputs) {
        next.inputs = capability.inputs.map((port) => ({ ...port }));
      }
      if (capability.outputs) {
        next.outputs = capability.outputs.map((port) => ({ ...port }));
      }
      if (capability.requirements) {
        next.requirements = capability.requirements.map((req) => ({ ...req }));
      }
      return next;
    }),
  };
  if (options.stripLocation) {
    delete copy.location;
  } else if (copy.location) {
    copy.location = {
      source: copy.location.source,
      start: { ...copy.location.start },
      end: { ...copy.location.end },
    };
  }
  return copy;
}

export function mergeCapabilitiesNodes(a: CapabilitiesNode, b: CapabilitiesNode): CapabilitiesNode {
  return {
    ...a,
    capabilities: [...a.capabilities, ...b.capabilities],
  };
}
