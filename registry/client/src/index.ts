/**
 * @mam/registry-client
 *
 * Public API surface for the MAM registry client.
 */

// ── Client ──────────────────────────────────────────────────────────────────

export {
  RegistryClient,
  type RegistryConfig,
  type ModuleMetadata,
  type ModuleRecord,
  type VersionInfo,
  type ModuleDependency,
  type ModuleStats,
  type SearchQuery,
  type PaginatedResponse,
  type PublishModuleInput,
  type RequestInterceptor,
  type ResponseInterceptor,
} from './client.js';

// ── Auth ────────────────────────────────────────────────────────────────────

export {
  RegistryAuth,
  type AuthConfig,
  type TokenStorage,
  type LoginResponse,
  type UserProfile,
} from './auth.js';

// ── Errors ──────────────────────────────────────────────────────────────────

export { RegistryError } from './errors.js';
