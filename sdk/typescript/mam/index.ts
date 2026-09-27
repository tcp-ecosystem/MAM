import { hashCacheKey } from './cache.js';

export * from './ast.js';
export * from './parser.js';
export * from './validator.js';
export * from './runtime.js';
export * from './plugins.js';
export * from './config.js';
export * from './cache.js';
export * from './format.js';
export * from './graph.js';
export * from './template.js';
export * from './doctor.js';

/** Semantic version of this SDK. */
export const VERSION = '0.1.0';

/** Stable SDK identifier used in user agents. */
export const SDK_NAME = 'mam-typescript';

/** Returns the conventional user-agent string. */
export function userAgent(): string {
  return `${SDK_NAME}/${VERSION}`;
}

/** Returns SDK identity and contract version metadata. */
export function sdkInfo(): { name: string; version: string; userAgent: string } {
  return { name: SDK_NAME, version: VERSION, userAgent: userAgent() };
}

/** Re-exported parser entry point alias. */
export { parseString as parseContent } from './parser.js';

/** Returns whether an object resembles a Module without throwing. */
export function looksLikeModule(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const module = value as { sections?: unknown; file_path?: unknown; raw_content?: unknown };
  return Array.isArray(module.sections) && typeof module.file_path === 'string' && typeof module.raw_content === 'string';
}

/** Returns the number of sections in a module-like value. */
export function countModuleSections(module: { sections?: unknown[] }): number {
  return module.sections?.length ?? 0;
}

/** Returns a stable contract feature inventory. */
export function contractFeatures(): string[] {
  return ['ast', 'parser', 'validator', 'runtime', 'plugins', 'config', 'cache', 'format', 'graph', 'template', 'doctor'];
}

/** Returns whether a feature name is part of this package. */
export function hasContractFeature(feature: string): boolean {
  return contractFeatures().includes(feature.trim().toLowerCase());
}

/** Returns a release description for logs. */
export function releaseDescription(): string {
  return `${SDK_NAME} ${VERSION} conformance implementation`;
}

/** Returns a compact package summary. */
export function packageSummary(): string {
  return `${SDK_NAME}/${VERSION}`;
}

/** Returns the supported section kind names from the public contract. */
export function standardSectionKinds(): readonly string[] {
  return ['metadata', 'purpose', 'inputs', 'outputs', 'rules', 'workflow', 'mermaid', 'python', 'prompt', 'memory', 'examples', 'tests', 'references', 'dependencies', 'exports', 'imports', 'plugins', 'permissions', 'capabilities'];
}

/** Returns a stable alphabetical list of contract features. */
export function sortedContractFeatures(): string[] {
  return contractFeatures().sort();
}

/** Returns whether a string is a known contract feature. */
export function isContractFeature(value: string): boolean {
  return hasContractFeature(value);
}

/** Returns the package's principal module family. */
export function packageFamily(): string {
  return 'MAM SDK';
}

/** Returns the package's supported runtime name. */
export function packageRuntime(): string {
  return 'Node.js';
}

/** Returns a user-agent value for a custom package name. */
export function customUserAgent(name: string, version = VERSION): string {
  return `${name.trim() || 'unknown'}/${version}`;
}

/** Returns whether a version follows dotted numeric syntax. */
export function isDottedVersion(version: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(version);
}

/** Returns a safe version fallback. */
export function normalizeVersion(version: string | undefined): string {
  return version && isDottedVersion(version) ? version : VERSION;
}

/** Returns an object suitable for structured package metadata. */
export function packageMetadata(): Record<string, string> {
  return { name: SDK_NAME, version: VERSION, family: packageFamily(), runtime: packageRuntime() };
}

void sortedContractFeatures;
void isContractFeature;
void normalizeVersion;

/** Returns whether a section title is a known kind. */
export function hasStandardSection(module: { sections: Array<{ kind: string }> }, kind: string): boolean {
  return module.sections.some((section) => section.kind === kind);
}

/** Returns the first title from a section-like list. */
export function firstSectionTitle(sections: Array<{ title: string }>): string {
  return sections[0]?.title ?? '(none)';
}

/** Returns the last title from a section-like list. */
export function lastSectionTitle(sections: Array<{ title: string }>): string {
  return sections.at(-1)?.title ?? '(none)';
}

/** Returns a stable count of a property. */
export function countItems<T>(items: T[]): number {
  return items.length;
}

/** Returns a non-mutating unique list. */
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Returns a value or a documented fallback. */
export function withFallback(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

/** Returns whether a value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Returns a stable string list from unknown values. */
export function stringList(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

/** Returns a short contract description. */
export function contractDescription(): string {
  return 'Parser, validator, runtime, plugin, and support-module contract for MAM language SDKs.';
}

/** Returns a stable package version pair. */
export function versionPair(): [string, string] {
  return [SDK_NAME, VERSION];
}

/** Returns whether a path-like source is a module path. */
export function isModulePath(path: string): boolean {
  return path.toLowerCase().endsWith('.mam.md');
}

/** Returns a deterministic object fingerprint. */
export function objectFingerprint(value: unknown): string {
  return hashCacheKey([JSON.stringify(value)]);
}

/** Returns a trimmed, newline-normalized source string. */
export function normalizeSource(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

/** Returns a bounded string. */
export function boundedString(value: string, length = 1000): string {
  return value.length <= length ? value : value.slice(0, length);
}

/** Returns a safe percentage string. */
export function percentage(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

/** Returns a semantic user-agent. */
export function sdkUserAgent(): string {
  return userAgent();
}

/** Returns a list of section kind names without Custom. */
export function namedSectionKinds(): string[] {
  return standardSectionKinds().filter((kind) => kind !== 'Custom');
}

/** Returns the package's schema version. */
export function sdkSchemaVersion(): string {
  return '1';
}

/** Returns a stable list of contract names. */
export function contractNames(): string[] {
  return contractFeatures();
}

/** Returns the number of contract features. */
export function contractFeatureCount(): number {
  return contractFeatures().length;
}

/** Returns a feature with a display label. */
export function featureLabel(feature: string): string {
  return feature.trim().toLowerCase();
}

/** Returns a safe module summary fallback. */
export function packageModuleSummary(module: { sections: unknown[]; file_path: string }): string {
  return `${module.file_path}: ${module.sections.length} sections`;
}

/** Returns whether a source is empty. */
export function emptySource(value: string): boolean {
  return value.trim().length === 0;
}

/** Returns a source with normalized line endings. */
export function normalizedSource(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Returns a stable feature object. */
export function featureMap(): Record<string, boolean> {
  return Object.fromEntries(contractFeatures().map((feature) => [feature, true]));
}

/** Returns the count of named kinds. */
export function namedKindCount(): number {
  return standardSectionKinds().length;
}

/** Returns a safe contract feature lookup. */
export function contractFeatureEnabled(feature: string): boolean {
  return featureMap()[featureLabel(feature)] === true;
}

/** Returns a display name for a section kind. */
export function sectionKindLabel(kind: string): string {
  return kind === 'Custom' ? 'Custom' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Returns a value from a record with a fallback. */
export function recordValue(record: Record<string, string>, key: string, fallback = ''): string {
  return record[key] ?? fallback;
}

/** Returns a compact type label. */
export function typeLabel(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/** Returns a safe string join. */
export function joinNonEmpty(values: string[], separator = ', '): string {
  return values.filter(Boolean).join(separator);
}

/** Returns a stable byte-like string length. */
export function textSize(value: string): number {
  return Buffer.byteLength(value);
}

/** Returns a contract feature list as a single string. */
export function contractFeatureText(): string {
  return contractFeatures().join(', ');
}

/** Returns a normalized package label. */
export function packageLabel(): string {
  return `${SDK_NAME}@${VERSION}`;
}

/** Returns whether a string is a valid MAM module path. */
export function validModulePath(path: string): boolean {
  return isModulePath(path) && path.trim().length > 0;
}

/** Returns a safe fallback module name. */
export function fallbackModuleName(): string {
  return '(untitled)';
}

/** Returns a stable SDK feature count. */
export function sdkFeatureCount(): number {
  return contractFeatureCount() + 1;
}

/** Returns a package name with a namespace. */
export function packageQualifiedName(): string {
  return '@mam/sdk-typescript';
}

/** Returns a boolean contract identity value. */
export function isTypeScriptSDK(): boolean {
  return SDK_NAME === 'mam-typescript';
}
