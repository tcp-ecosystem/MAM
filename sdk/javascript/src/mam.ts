/**
 * MAM Module Types
 */

export interface MAMModuleConfig {
  name: string;
  version?: string;
  author?: string;
  description?: string;
}

export class MAMModule {
  name: string;
  version: string;
  author?: string;
  description?: string;
  sections: Array<{ name: string; content: unknown }> = [];

  constructor(config: MAMModuleConfig) {
    this.name = config.name;
    this.version = config.version || '0.1.0';
    this.author = config.author;
    this.description = config.description;
  }

  addSection(name: string, content: unknown): void {
    this.sections.push({ name, content });
  }

  toJSON(): unknown {
    return {
      name: this.name,
      version: this.version,
      author: this.author,
      description: this.description,
      sections: this.sections,
    };
  }
}
