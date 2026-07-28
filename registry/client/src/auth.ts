/**
 * MAM Registry Authentication
 */

export interface AuthConfig {
  apiKey?: string;
  token?: string;
}

export class RegistryAuth {
  private config: AuthConfig;

  constructor(config: AuthConfig = {}) {
    this.config = config;
  }

  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.token) {
      headers['X-MAM-Token'] = this.config.token;
    }
    return headers;
  }

  isAuthenticated(): boolean {
    return !!(this.config.apiKey || this.config.token);
  }
}
