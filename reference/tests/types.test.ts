import { describe, it, expect } from 'vitest';
import { TARGET_EXTENSIONS, SUPPORTED_TARGETS } from '../src/types.js';
import type {
  CLIOptions,
  CLIContext,
  MAMConfig,
  ProjectConfig,
  BuildConfig,
  RegistryConfig,
  PluginConfig,
  BuildOptions,
  BuildResult,
  BuildStats,
  ValidationOptions,
  ValidationDetail,
  GraphNode,
  GraphEdge,
  Graph,
  GraphMetadata,
  GraphOptions,
  AnalysisOptions,
  AnalysisResult,
  ModuleInfo,
  DependencyInfo,
  AnalysisStats,
  PackageInitOptions,
  PackageManifest,
  PackageDependency,
  RegistryPublishOptions,
  RegistrySearchOptions,
  RegistryPackageInfo,
  OutputFormat,
} from '../src/types.js';

describe('TARGET_EXTENSIONS', () => {
  it('should map python to py', () => {
    expect(TARGET_EXTENSIONS.python).toBe('py');
  });

  it('should map javascript to js', () => {
    expect(TARGET_EXTENSIONS.javascript).toBe('js');
  });

  it('should map typescript to ts', () => {
    expect(TARGET_EXTENSIONS.typescript).toBe('ts');
  });

  it('should map go to go', () => {
    expect(TARGET_EXTENSIONS.go).toBe('go');
  });

  it('should map rust to rs', () => {
    expect(TARGET_EXTENSIONS.rust).toBe('rs');
  });

  it('should map json to json', () => {
    expect(TARGET_EXTENSIONS.json).toBe('json');
  });

  it('should map yaml to yaml', () => {
    expect(TARGET_EXTENSIONS.yaml).toBe('yaml');
  });

  it('should map openai to py', () => {
    expect(TARGET_EXTENSIONS.openai).toBe('py');
  });

  it('should map langgraph to py', () => {
    expect(TARGET_EXTENSIONS.langgraph).toBe('py');
  });

  it('should map crewai to py', () => {
    expect(TARGET_EXTENSIONS.crewai).toBe('py');
  });

  it('should map csharp to cs', () => {
    expect(TARGET_EXTENSIONS.csharp).toBe('cs');
  });

  it('should map java to java', () => {
    expect(TARGET_EXTENSIONS.java).toBe('java');
  });

  it('should map wasm to wasm', () => {
    expect(TARGET_EXTENSIONS.wasm).toBe('wasm');
  });

  it('should map gemini to py', () => {
    expect(TARGET_EXTENSIONS.gemini).toBe('py');
  });

  it('should map autogen to py', () => {
    expect(TARGET_EXTENSIONS.autogen).toBe('py');
  });

  it('should map kubernetes to yaml', () => {
    expect(TARGET_EXTENSIONS.kubernetes).toBe('yaml');
  });

  it('should map terraform to tf', () => {
    expect(TARGET_EXTENSIONS.terraform).toBe('tf');
  });

  it('should have at least 17 entries', () => {
    expect(Object.keys(TARGET_EXTENSIONS).length).toBeGreaterThanOrEqual(17);
  });
});

describe('SUPPORTED_TARGETS', () => {
  it('should contain all keys from TARGET_EXTENSIONS', () => {
    expect(SUPPORTED_TARGETS).toEqual(Object.keys(TARGET_EXTENSIONS));
  });

  it('should be an array of strings', () => {
    for (const target of SUPPORTED_TARGETS) {
      expect(typeof target).toBe('string');
    }
  });
});

describe('CLIOptions interface', () => {
  it('should create a valid CLIOptions object', () => {
    const opts: CLIOptions = {
      verbose: true,
      quiet: false,
      format: 'json',
      color: true,
      config: './mam.config.json',
    };
    expect(opts.verbose).toBe(true);
    expect(opts.format).toBe('json');
  });

  it('should allow empty CLIOptions', () => {
    const opts: CLIOptions = {};
    expect(opts.verbose).toBeUndefined();
  });
});

describe('CLIContext interface', () => {
  it('should create a valid CLIContext', () => {
    const ctx: CLIContext = {
      cwd: '/tmp',
      options: { verbose: true },
      startTime: Date.now(),
    };
    expect(ctx.cwd).toBe('/tmp');
    expect(typeof ctx.startTime).toBe('number');
  });
});

describe('MAMConfig interface', () => {
  it('should create a minimal config', () => {
    const config: MAMConfig = { version: '1' };
    expect(config.version).toBe('1');
  });

  it('should create a full config', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: 'test', version: '1.0.0' },
      build: { target: 'python', output: './dist' },
      registry: { url: 'https://registry.mam.dev' },
      plugins: [{ name: 'my-plugin', enabled: true }],
      targets: { python: { minify: true } },
    };
    expect(config.project?.name).toBe('test');
    expect(config.build?.target).toBe('python');
    expect(config.registry?.url).toContain('https');
    expect(config.plugins).toHaveLength(1);
    expect(config.targets?.python?.minify).toBe(true);
  });
});

describe('ProjectConfig interface', () => {
  it('should create with required fields', () => {
    const p: ProjectConfig = { name: 'my-pkg', version: '0.1.0' };
    expect(p.name).toBe('my-pkg');
  });

  it('should allow optional fields', () => {
    const p: ProjectConfig = {
      name: 'pkg',
      version: '1.0.0',
      description: 'desc',
      author: 'me',
      license: 'MIT',
      runtime: 'python',
      tags: ['ai', 'mam'],
    };
    expect(p.tags).toHaveLength(2);
  });
});

describe('BuildConfig interface', () => {
  it('should allow all optional fields', () => {
    const b: BuildConfig = {
      target: 'python',
      output: './dist',
      sourceMap: true,
      minify: true,
      optimize: false,
      includeComments: false,
      indent: 4,
    };
    expect(b.indent).toBe(4);
  });
});

describe('BuildResult interface', () => {
  it('should create with required fields', () => {
    const r: BuildResult = {
      success: true,
      errors: [],
      warnings: [],
      stats: {
        timeMs: 100,
        inputSize: 1024,
        outputSize: 2048,
        sections: 3,
        codeBlocks: 5,
        edges: 2,
      },
    };
    expect(r.success).toBe(true);
    expect(r.stats.sections).toBe(3);
  });
});

describe('ValidationDetail interface', () => {
  it('should create with all fields', () => {
    const d: ValidationDetail = {
      severity: 'error',
      code: 'E001',
      message: 'Something wrong',
      path: 'src/main.mam.md',
      line: 10,
      column: 5,
    };
    expect(d.severity).toBe('error');
    expect(d.line).toBe(10);
  });
});

describe('Graph interface', () => {
  it('should create a valid graph', () => {
    const g: Graph = {
      nodes: [{ id: 'n1', type: 'module', label: 'A' }],
      edges: [{ source: 'n1', target: 'n2', label: 'uses', kind: 'dependency' }],
      metadata: { nodeCount: 1, edgeCount: 1 },
    };
    expect(g.nodes).toHaveLength(1);
    expect(g.edges[0].kind).toBe('dependency');
  });
});

describe('ModuleInfo interface', () => {
  it('should create with all fields', () => {
    const m: ModuleInfo = {
      name: 'my-module',
      type: 'agent',
      sections: ['Overview', 'Tools'],
      codeBlocks: 3,
      dependencies: ['other-module'],
    };
    expect(m.type).toBe('agent');
  });
});

describe('PackageManifest interface', () => {
  it('should create with required fields', () => {
    const m: PackageManifest = {
      name: 'my-pkg',
      version: '1.0.0',
      dependencies: [],
      devDependencies: [],
    };
    expect(m.dependencies).toHaveLength(0);
  });

  it('should include dependencies', () => {
    const dep: PackageDependency = { name: 'dep-a', version: '^1.0.0' };
    const m: PackageManifest = {
      name: 'pkg',
      version: '1.0.0',
      dependencies: [dep],
      devDependencies: [],
    };
    expect(m.dependencies[0].version).toBe('^1.0.0');
  });
});

describe('OutputFormat type', () => {
  it('should accept valid formats', () => {
    const formats: OutputFormat[] = ['text', 'json', 'yaml'];
    expect(formats).toHaveLength(3);
  });
});
