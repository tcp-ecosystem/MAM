/**
 * MAM Registry Server
 * 
 * HTTP server for the MAM module registry.
 */

import { ModuleStore, ModuleRecord } from './store.js';
import { AuthManager } from './auth.js';
import { SearchEngine } from './search.js';

// ============================================================================
// Types
// ============================================================================

export interface RegistryServerConfig {
  /** Server port */
  port: number;
  /** Data directory */
  dataDir: string;
  /** Authentication required */
  authRequired: boolean;
  /** Rate limit requests per minute */
  rateLimit: number;
  /** Maximum upload size in bytes */
  maxUploadSize: number;
  /** CORS origins */
  corsOrigins: string[];
}

export interface ApiResponse<T = unknown> {
  /** Whether request succeeded */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message */
  error?: string;
  /** Metadata */
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

// ============================================================================
// Registry Server
// ============================================================================

export class RegistryServer {
  private config: RegistryServerConfig;
  private store: ModuleStore;
  private auth: AuthManager;
  private search: SearchEngine;

  constructor(config: RegistryServerConfig) {
    this.config = config;
    this.store = new ModuleStore(config.dataDir);
    this.auth = new AuthManager();
    this.search = new SearchEngine();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.store.init();
    console.log(`MAM Registry server started on port ${this.config.port}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    console.log('MAM Registry server stopped');
  }

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  /**
   * Search modules
   */
  async handleSearch(query: string, options: { limit?: number; offset?: number } = {}): Promise<ApiResponse> {
    const results = await this.search.search(query, options);
    return {
      success: true,
      data: results.modules,
      meta: {
        total: results.total,
        limit: options.limit || 20,
        offset: options.offset || 0,
      },
    };
  }

  /**
   * Get module info
   */
  async handleGetModule(name: string): Promise<ApiResponse> {
    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }
    return { success: true, data: module };
  }

  /**
   * Get module versions
   */
  async handleGetVersions(name: string): Promise<ApiResponse> {
    const versions = await this.store.getVersions(name);
    return { success: true, data: versions };
  }

  /**
   * Get specific version
   */
  async handleGetVersion(name: string, version: string): Promise<ApiResponse> {
    const versionData = await this.store.getVersion(name, version);
    if (!versionData) {
      return { success: false, error: `Version "${version}" not found for "${name}"` };
    }
    return { success: true, data: versionData };
  }

  /**
   * Publish module
   */
  async handlePublish(
    manifest: Record<string, unknown>,
    files: Map<string, string>,
    token: string
  ): Promise<ApiResponse> {
    // Authenticate
    const user = await this.auth.verifyToken(token);
    if (!user) {
      return { success: false, error: 'Invalid authentication token' };
    }

    // Validate manifest
    if (!manifest.name || !manifest.version) {
      return { success: false, error: 'Name and version are required' };
    }

    // Publish
    try {
      const result = await this.store.publish(
        manifest as any,
        files,
        user.username
      );
      return {
        success: true,
        data: {
          name: result.name,
          version: result.version,
          url: `/api/v1/modules/${result.name}`,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete module
   */
  async handleDeleteModule(name: string, token: string): Promise<ApiResponse> {
    const user = await this.auth.verifyToken(token);
    if (!user) {
      return { success: false, error: 'Invalid authentication token' };
    }

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    // Check ownership
    if (module.author !== user.username) {
      return { success: false, error: 'Not authorized to delete this module' };
    }

    await this.store.deleteModule(name);
    return { success: true };
  }

  /**
   * Login
   */
  async handleLogin(username: string, password: string): Promise<ApiResponse> {
    const token = await this.auth.authenticate(username, password);
    if (!token) {
      return { success: false, error: 'Invalid credentials' };
    }
    return { success: true, data: { token } };
  }

  /**
   * Register
   */
  async handleRegister(username: string, email: string, password: string): Promise<ApiResponse> {
    try {
      const user = await this.auth.register(username, email, password);
      return { success: true, data: { username: user.username } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get stats
   */
  async handleStats(): Promise<ApiResponse> {
    const stats = await this.store.getStats();
    return { success: true, data: stats };
  }
}