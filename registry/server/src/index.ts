/**
 * MAM Registry Server
 * 
 * Server-side registry for module discovery, version management,
 * dependency resolution, authentication, publishing, and searching.
 */

export { RegistryServer, type RegistryServerConfig } from './server.js';
export {
  ModuleStore,
  writeFileAtomic,
  type ModuleRecord,
  type VersionRecord,
  type RegistryStats,
} from './store.js';
export {
  AuthManager,
  AuthError,
  ValidationError,
  sha256,
  AUTH_STATE_VERSION,
  AUTH_STATE_FILE,
  type AuthToken,
  type AuthManagerOptions,
  type AuthStateFile,
  type PasswordPolicy,
  type TokenScope,
  type UserInfo,
  type UserRecord,
} from './auth.js';
export {
  SearchEngine,
  compareModulesBySort,
  normalizeSearchLimit,
  normalizeSearchOffset,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
  type SearchQuery,
  type SearchResults,
  type SearchResultItem,
  type SearchSort,
} from './search.js';
export type {
  ApiResponse,
  ArchiveOptions,
  CorsResponse,
  HandlerRequest,
  ListModulesOptions,
  RegistryLogger,
  SearchOptions,
} from './server.js';
export {
  RegistryHttpServer,
  createRegistryHttpServer,
  classifyFailure,
  isSafeErrorMessage,
  readBody,
  matchRoute,
  decodeSegments,
  buildTarballGz,
  DEFAULT_HOST,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  type GraphQLOptions,
  type RawBody,
  type RegistryHttpOptions,
  type RequestContext,
  type RouteResult,
} from './http.js';
export {
  buildGraphQL,
  loadRegistryGraphQL,
  attachResolvers,
  installJsonScalar,
  type GraphQLSource,
  type GraphQLSpec,
  type ResolverMap,
} from './graphql.js';
