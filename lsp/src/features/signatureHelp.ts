import {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from 'vscode-languageserver-protocol';

export function getSignatureHelp(line: string, character: number): SignatureHelp | null {
  const before = line.slice(0, character);
  const edgeIndex = before.lastIndexOf('->');
  if (edgeIndex >= 0 && isEdgeContext(line, edgeIndex)) {
    const signatures = getEdgeSignatureItems();
    return {
      signatures,
      activeSignature: 0,
      activeParameter: getActiveParameterIndex(line, character),
    };
  }
  const pairMatch = before.match(/^\s*([\w-]+)\s*:\s*\S*$/);
  if (pairMatch) {
    const signatures = getPairSignatureItems(pairMatch[1]!);
    if (signatures.length > 0) {
      return {
        signatures,
        activeSignature: 0,
        activeParameter: 1,
      };
    }
  }
  const fenceMatch = before.match(/^```(\w*)$/);
  if (fenceMatch) {
    return {
      signatures: getCodeFenceSignatureItems(),
      activeSignature: 0,
      activeParameter: 0,
    };
  }
  const frontmatterMatch = before.match(/^\s*(id|version|name|author|runtime|tags|description|dependencies|permissions|license|repository|mam_version)\s*:\s*\S*$/);
  if (frontmatterMatch && isFrontmatterLine(line, character)) {
    return {
      signatures: getFrontmatterFieldSignatures().filter(signature =>
        signature.label.startsWith(`${frontmatterMatch[1]}:`),
      ),
      activeSignature: 0,
      activeParameter: 1,
    };
  }
  const permissionMatch = before.match(/^\s*(filesystem|network|python|memory|exec)\s*:\s*\S*$/);
  if (permissionMatch) {
    return {
      signatures: getPermissionValueSignatures().filter(signature =>
        signature.label.startsWith(`${permissionMatch[1]}:`),
      ),
      activeSignature: 0,
      activeParameter: 1,
    };
  }
  const moduleMatch = before.match(/^(module|agent|tool|memory|workflow|team|policy|system)\s+\S*$/);
  if (moduleMatch) {
    const candidates = getModuleDeclarationSignatures().filter(signature =>
      signature.label.startsWith(`${moduleMatch[1]} `),
    );
    if (candidates.length > 0) {
      return buildSignatureHelp(candidates, 1);
    }
  }
  return null;
}

export function hasSignatureHelp(line: string, character: number): boolean {
  return getSignatureHelp(line, character) !== null;
}

export function getActiveParameterIndex(line: string, character: number): number {
  const before = line.slice(0, character);
  const edgeIndex = before.lastIndexOf('->');
  if (edgeIndex >= 0 && isEdgeContext(line, edgeIndex)) {
    const afterArrow = before.slice(edgeIndex + 2);
    return afterArrow.length > 0 ? 1 : 0;
  }
  const pairMatch = before.match(/^\s*([\w-]+)\s*:\s*(\S*)$/);
  if (pairMatch) {
    return pairMatch[2]!.length > 0 ? 1 : 1;
  }
  return 0;
}

export function getEdgeSignatureItems(): SignatureInformation[] {
  return [
    {
      label: 'source -> target',
      documentation: 'Workflow edge: connects the source step to the target step.',
      parameters: [
        { label: 'source', documentation: 'Name of the source step.' },
        { label: 'target', documentation: 'Name of the target step.' },
      ],
    },
    {
      label: 'source -> target | label',
      documentation: 'Labeled workflow edge with a display label.',
      parameters: [
        { label: 'source', documentation: 'Name of the source step.' },
        { label: 'target', documentation: 'Name of the target step.' },
        { label: 'label', documentation: 'Edge label shown in diagrams.' },
      ],
    },
  ];
}

export function formatSignatureLabel(signature: SignatureInformation): string {
  const params = (signature.parameters ?? []).map(param =>
    typeof param.label === 'string' ? param.label : param.label.join(''),
  );
  return `${signature.label}(${params.join(', ')})`;
}

export function isSignatureTriggerCharacter(ch: string): boolean {
  return ch === '>' || ch === '-' || ch === ':' || ch === '(' || ch === ',';
}

export function countSignatures(): number {
  return getEdgeSignatureItems().length + getPairSignatureItems('inputs').length + getCodeFenceSignatureItems().length;
}

function getPairSignatureItems(key: string): SignatureInformation[] {
  const docs: Record<string, string> = {
    inputs: 'Input port mapping: name to type pairs.',
    outputs: 'Output port mapping: name to type pairs.',
    members: 'Team member list for team modules.',
    steps: 'Ordered workflow step list.',
    edges: 'Workflow edge list in arrow notation.',
    tools: 'Tool references for agent modules.',
    allow: 'Allowed action patterns for policy modules.',
    deny: 'Denied action patterns for policy modules.',
    permissions: 'Permission set for the module.',
    format: 'Memory storage format selection.',
    backend: 'Memory backend system selection.',
    scope: 'Memory or permission scope selection.',
    ttl: 'Time-to-live duration for stored data.',
    handoff: 'Handoff targets for agent modules.',
    runtime: 'Runtime language for code execution.',
  };
  const doc = docs[key.toLowerCase()];
  if (!doc) return [];
  return [
    {
      label: `${key}: value`,
      documentation: doc,
      parameters: [
        { label: key, documentation: 'Section keyword.' },
        { label: 'value', documentation: getPairValueHint(key) },
      ],
    },
  ];
}

function getCodeFenceSignatureItems(): SignatureInformation[] {
  return [
    {
      label: '```language',
      documentation: 'Fenced code block with a language identifier.',
      parameters: [
        { label: 'language', documentation: getLanguageHint() },
      ],
    },
    {
      label: '```mermaid',
      documentation: 'Mermaid diagram block for workflows and graphs.',
      parameters: [
        { label: 'mermaid', documentation: 'Diagram language: flowchart, sequence, class, state, er, gantt, pie.' },
      ],
    },
  ];
}

function getPairValueHint(key: string): string {
  const hints: Record<string, string> = {
    inputs: 'Format: name: type pairs, one per line.',
    outputs: 'Format: name: type pairs, one per line.',
    members: 'Format: list of agent module names.',
    steps: 'Format: ordered list of step descriptions.',
    edges: 'Format: source -> target arrow notation.',
    tools: 'Format: list of tool names.',
    allow: 'Format: list of allowed action patterns.',
    deny: 'Format: list of denied action patterns.',
    permissions: 'Format: permission key and value pairs.',
    format: 'Accepted: vector, key-value, relational, graph, document.',
    backend: 'Accepted: sqlite, redis, postgres, mongodb, memory.',
    scope: 'Accepted: module, workspace, global.',
    ttl: 'Format: duration string, e.g. 24h, 7d, 30m.',
    handoff: 'Format: list of target agent names.',
    runtime: 'Accepted: python, javascript, typescript, rust, go, shell.',
  };
  return hints[key.toLowerCase()] ?? 'Value for this key.';
}

function getLanguageHint(): string {
  return 'Accepted: python, javascript, typescript, rust, go, shell, bash, yaml, json, mermaid.';
}

function isFrontmatterLine(line: string, character: number): boolean {
  void character;
  return /^\s*[\w-]+\s*:/.test(line) && !line.trim().startsWith('-') && !/^#{1,6}\s+/.test(line);
}

function isEdgeContext(line: string, arrowIndex: number): boolean {
  const before = line.slice(0, arrowIndex).trim();
  if (before.length === 0) return false;
  if (/^#{1,6}\s+/.test(line)) return false;
  if (line.trim().startsWith('```')) return false;
  if (/^\s*[\w-]+\s*:\s*$/.test(before)) return false;
  return true;
}

function getFrontmatterFieldSignatures(): SignatureInformation[] {
  const fields: Array<{ key: string; doc: string; typeHint: string }> = [
    { key: 'id', doc: 'Module identifier.', typeHint: 'string, lowercase alphanumeric with hyphens' },
    { key: 'version', doc: 'Semantic version.', typeHint: 'MAJOR.MINOR.PATCH' },
    { key: 'name', doc: 'Human-readable module name.', typeHint: 'string' },
    { key: 'author', doc: 'Module author.', typeHint: 'string' },
    { key: 'runtime', doc: 'Runtime language.', typeHint: 'python | javascript | typescript | rust | go | shell' },
    { key: 'tags', doc: 'Search tags.', typeHint: 'string array' },
    { key: 'description', doc: 'Module description.', typeHint: 'string' },
    { key: 'dependencies', doc: 'Module dependencies.', typeHint: 'string array of module identifiers' },
    { key: 'permissions', doc: 'Security permissions.', typeHint: 'string array' },
    { key: 'license', doc: 'License identifier.', typeHint: 'SPDX expression' },
    { key: 'repository', doc: 'Source repository URL.', typeHint: 'URL string' },
    { key: 'mam_version', doc: 'Minimum MAM version.', typeHint: 'semver string' },
  ];
  return fields.map(field => ({
    label: `${field.key}: value`,
    documentation: field.doc,
    parameters: [
      { label: field.key, documentation: 'Frontmatter field.' },
      { label: 'value', documentation: field.typeHint },
    ],
  }));
}

function getPermissionValueSignatures(): SignatureInformation[] {
  const permissions: Array<{ key: string; values: string; doc: string }> = [
    { key: 'filesystem', values: 'read | write | none', doc: 'Local filesystem access level.' },
    { key: 'network', values: 'internet | internal | none', doc: 'Network access level.' },
    { key: 'python', values: 'sandbox | full | none', doc: 'Python execution mode.' },
    { key: 'memory', values: 'local | shared | none', doc: 'Memory access scope.' },
    { key: 'exec', values: 'allowed | denied', doc: 'System command execution.' },
  ];
  return permissions.map(permission => ({
    label: `${permission.key}: ${permission.values}`,
    documentation: permission.doc,
    parameters: [
      { label: permission.key, documentation: 'Permission key.' },
      { label: 'value', documentation: `Accepted: ${permission.values}.` },
    ],
  }));
}

function getModuleDeclarationSignatures(): SignatureInformation[] {
  return [
    {
      label: 'agent name',
      documentation: 'AI agent module declaration with role and goal.',
      parameters: [
        { label: 'agent', documentation: 'Module type keyword.' },
        { label: 'name', documentation: 'Module identifier.' },
      ],
    },
    {
      label: 'tool name',
      documentation: 'Executable tool declaration with provider.',
      parameters: [
        { label: 'tool', documentation: 'Module type keyword.' },
        { label: 'name', documentation: 'Module identifier.' },
      ],
    },
    {
      label: 'workflow name',
      documentation: 'Process workflow declaration with steps.',
      parameters: [
        { label: 'workflow', documentation: 'Module type keyword.' },
        { label: 'name', documentation: 'Module identifier.' },
      ],
    },
  ];
}

function findSignatureByLabel(signatures: SignatureInformation[], label: string): SignatureInformation | undefined {
  return signatures.find(signature => signature.label === label);
}

function getAllSignatures(): SignatureInformation[] {
  return [
    ...getEdgeSignatureItems(),
    ...getCodeFenceSignatureItems(),
    ...getFrontmatterFieldSignatures(),
    ...getPermissionValueSignatures(),
    ...getModuleDeclarationSignatures(),
  ];
}

function countParameters(signature: SignatureInformation): number {
  return signature.parameters?.length ?? 0;
}

function getParameterLabels(signature: SignatureInformation): string[] {
  return (signature.parameters ?? []).map(param =>
    typeof param.label === 'string' ? param.label : param.label.join(''),
  );
}

function getParameterDocumentation(signature: SignatureInformation, index: number): string | undefined {
  const param: ParameterInformation | undefined = signature.parameters?.[index];
  if (!param || !param.documentation) return undefined;
  return typeof param.documentation === 'string' ? param.documentation : param.documentation.value;
}

function buildSignatureHelp(signatures: SignatureInformation[], activeParameter: number): SignatureHelp {
  return {
    signatures,
    activeSignature: 0,
    activeParameter,
  };
}
