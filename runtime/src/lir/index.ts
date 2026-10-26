/**
 * Public LIR surface.
 */

export {
  SUPPORTED_LIR_LANGUAGES,
  DEFAULT_LIR_POLICY,
  type ImplementationDeclaration,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type LirAdapter,
  type LirErrorCode,
  type LirFailure,
  type LirInvocationFailure,
  type LirInvocationRecord,
  type LirInvocationRequest,
  type LirInvocationResult,
  type LirInvocationSuccess,
  type LirInvokeOptions,
  type LirLanguage,
  type LirPolicy,
  type LirProbeOptions,
  type LirProbeResult,
  type LirRegistryOptions,
  type ResolvedImplementation,
} from './types.js';

export { LirError, isLirError, errorMessage } from './errors.js';
export {
  DEFAULT_EXPORT_FOR_LANGUAGE,
  parseImplementationDeclarations,
  resolveImplementation,
  type DeclarationParseOptions,
  type ResolveContext,
} from './manifest.js';
export {
  LirRegistry,
  createDefaultLirRegistry,
  type CreateDefaultLirRegistryOptions,
} from './registry.js';
export { PythonLirAdapter, type PythonAdapterOptions } from './adapters/python.js';
export { NodeLirAdapter, type NodeAdapterOptions } from './adapters/node.js';
