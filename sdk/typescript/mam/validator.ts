import { Module, Section, SectionKind, SourceLocation, sectionByKind, sectionKindOrder } from './ast.js';

/** Diagnostic severity vocabulary shared by every language SDK. */
export type Severity = 'Error' | 'Warning' | 'Info';

/** One validation finding, including a stable fixture code. */
export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  line: number;
  section: string;
  location?: SourceLocation;
}

/** Complete validation result for a module. */
export interface ValidationResult {
  diagnostics: Diagnostic[];
  is_valid: boolean;
}

/** A custom validation rule registered by a caller. */
export interface ValidationRule {
  id: string;
  description: string;
  check: (module: Module) => Diagnostic[];
}

const requiredSections: SectionKind[] = ['metadata', 'purpose'];
const canonicalOrder: SectionKind[] = [
  'metadata', 'purpose', 'inputs', 'outputs', 'rules', 'workflow', 'mermaid', 'python', 'prompt',
  'memory', 'examples', 'tests', 'references', 'dependencies', 'exports', 'imports', 'plugins', 'permissions', 'capabilities',
];

/** Creates an empty valid report. */
export function emptyValidationResult(): ValidationResult {
  return { diagnostics: [], is_valid: true };
}

/** Validates a module using the built-in MAM rules and optional custom rules. */
export function validate(module: Module, rules: ValidationRule[] = []): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...validateFrontmatter(module));
  diagnostics.push(...validateSections(module));
  diagnostics.push(...validateOrder(module));
  diagnostics.push(...validateCodeBlocks(module));
  for (const rule of rules) diagnostics.push(...safeRule(rule, module));
  return { diagnostics, is_valid: !diagnostics.some((item) => item.severity === 'Error') };
}

/** Parses and validates a module in one operation. */
export function validateModule(module: Module, rules: ValidationRule[] = []): ValidationResult {
  return validate(module, rules);
}

/** Returns errors, warnings, or info diagnostics in source order. */
export function diagnosticsBySeverity(result: ValidationResult, severity: Severity): Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

/** Counts diagnostics by severity using the contract capitalization. */
export function countBySeverity(result: ValidationResult): Record<Severity, number> {
  return { Error: diagnosticsBySeverity(result, 'Error').length, Warning: diagnosticsBySeverity(result, 'Warning').length, Info: diagnosticsBySeverity(result, 'Info').length };
}

/** Reports whether a result contains an error. */
export function hasErrors(result: ValidationResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === 'Error');
}

/** Reports whether a result contains a warning. */
export function hasWarnings(result: ValidationResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === 'Warning');
}

/** Formats a validation result for terminal display. */
export function formatValidationResult(result: ValidationResult): string {
  if (result.diagnostics.length === 0) return 'valid module (no diagnostics)';
  return result.diagnostics.map((item) => `${item.severity} ${item.code}: ${item.message}`).join('\n');
}

/** Returns diagnostics with a particular stable code. */
export function diagnosticsByCode(result: ValidationResult, code: string): Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

/** Reports whether a module has a named required section. */
export function hasRequiredSection(module: Module): boolean {
  return requiredSections.every((kind) => sectionByKind(module, kind) !== undefined);
}

/** Returns the section kinds that are missing from a module. */
export function missingRequiredSections(module: Module): SectionKind[] {
  return requiredSections.filter((kind) => sectionByKind(module, kind) === undefined);
}

/** Returns duplicate section kinds and their occurrence count. */
export function duplicateSections(module: Module): Array<[SectionKind, number]> {
  const counts = new Map<SectionKind, number>();
  for (const section of module.sections) counts.set(section.kind, (counts.get(section.kind) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1);
}

/** Reports whether all standard sections follow canonical order. */
export function isCanonicalOrder(module: Module): boolean {
  let last = -1;
  for (const section of module.sections) {
    if (section.kind === 'Custom') continue;
    const current = sectionKindOrder(section.kind);
    if (current < last) return false;
    last = current;
  }
  return true;
}

/** Returns the first invalid section location, or undefined. */
export function firstOrderError(module: Module): Section | undefined {
  let last = -1;
  for (const section of module.sections) {
    if (section.kind === 'Custom') continue;
    const current = sectionKindOrder(section.kind);
    if (current < last) return section;
    last = current;
  }
  return undefined;
}

/** Returns all locations from diagnostics in stable order. */
export function diagnosticLocations(result: ValidationResult): Array<{ line: number; section: string }> {
  return result.diagnostics.map(({ line, section }) => ({ line, section }));
}

/** Returns a stable summary suitable for a fixture report. */
export function summarizeValidation(result: ValidationResult): string {
  const counts = countBySeverity(result);
  return `${counts.Error} errors, ${counts.Warning} warnings, ${counts.Info} info`;
}

function validateFrontmatter(module: Module): Diagnostic[] {
  if (!module.frontmatter) return [diagnostic('FRONTMATTER_MISSING', 'Error', 'frontmatter block is required', module.location, '')];
  const frontmatter = module.frontmatter;
  const output: Diagnostic[] = [];
  if (!frontmatter.name.trim()) output.push(diagnostic('FRONTMATTER_NAME_REQUIRED', 'Error', "frontmatter field 'name' is required", frontmatter.location, 'metadata'));
  if (!frontmatter.version.trim()) output.push(diagnostic('FRONTMATTER_VERSION_RECOMMENDED', 'Warning', "frontmatter field 'version' is recommended", frontmatter.location, 'metadata'));
  if (!frontmatter.schema_version.trim()) output.push(diagnostic('FRONTMATTER_SCHEMA_VERSION', 'Info', "frontmatter field 'schema_version' is empty", frontmatter.location, 'metadata'));
  for (const field of ['authors', 'tags', 'dependencies']) {
    const values = frontmatter[field as 'authors' | 'tags' | 'dependencies'];
    if (Array.isArray(values) && values.some((value) => typeof value !== 'string')) output.push(diagnostic('FRONTMATTER_FIELD_TYPE', 'Error', `frontmatter field '${field}' must contain strings`, frontmatter.location, 'metadata'));
  }
  if (frontmatter.name && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(frontmatter.name)) output.push(diagnostic('FRONTMATTER_NAME_FORMAT', 'Warning', 'frontmatter name contains unsupported characters', frontmatter.location, 'metadata'));
  if (Array.isArray(frontmatter.metadata.__typeErrors) && frontmatter.metadata.__typeErrors.length) output.push(diagnostic('FRONTMATTER_FIELD_TYPE', 'Error', 'one or more frontmatter fields have invalid types', frontmatter.location, 'metadata'));
  return output;
}

function validateSections(module: Module): Diagnostic[] {
  const output: Diagnostic[] = [];
  if (module.sections.length === 0) output.push(diagnostic('SECTION_REQUIRED', 'Error', 'module must contain at least one section', module.location, ''));
  for (const required of missingRequiredSections(module)) output.push(diagnostic('SECTION_MISSING', 'Error', `required section '${required}' is missing`, module.location, required));
  for (const [kind, count] of duplicateSections(module)) output.push(diagnostic('SECTION_DUPLICATE', 'Error', `section '${kind}' appears ${count} times`, module.sections.find((section) => section.kind === kind)?.location ?? module.location, kind));
  for (const section of module.sections) if (section.kind === 'Custom') output.push(diagnostic('SECTION_UNKNOWN', 'Info', `section '${section.title}' is retained as Custom`, section.location, 'Custom'));
  return output;
}

function validateOrder(module: Module): Diagnostic[] {
  const invalid = firstOrderError(module);
  return invalid ? [diagnostic('SECTION_ORDER', 'Warning', `section '${invalid.title}' is out of canonical order`, invalid.location, invalid.kind)] : [];
}

function validateCodeBlocks(module: Module): Diagnostic[] {
  const output: Diagnostic[] = [];
  for (const section of module.sections) for (const node of section.content) {
    if (node.kind !== 'CodeBlock') continue;
    if (!node.language.trim()) output.push(diagnostic('CODEBLOCK_LANGUAGE', 'Warning', `code block in section '${section.title}' has no language`, node.location, section.kind));
    if (!node.code.trim()) output.push(diagnostic('CODEBLOCK_EMPTY', 'Warning', `code block in section '${section.title}' is empty`, node.location, section.kind));
  }
  return output;
}

function safeRule(rule: ValidationRule, module: Module): Diagnostic[] {
  try {
    return rule.check(module);
  } catch {
    return [diagnostic('CUSTOM_RULE_FAILED', 'Error', `custom rule '${rule.id}' failed`, module.location, '')];
  }
}

function diagnostic(code: string, severity: Severity, message: string, at: SourceLocation, section: string): Diagnostic {
  return { code, severity, message, line: at.line, section, location: at };
}

/** Returns all error diagnostics. */
export function errors(result: ValidationResult): Diagnostic[] {
  return diagnosticsBySeverity(result, 'Error');
}

/** Returns all warning diagnostics. */
export function warnings(result: ValidationResult): Diagnostic[] {
  return diagnosticsBySeverity(result, 'Warning');
}

/** Returns all informational diagnostics. */
export function info(result: ValidationResult): Diagnostic[] {
  return diagnosticsBySeverity(result, 'Info');
}

/** Returns diagnostic messages in source order. */
export function messages(result: ValidationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.message);
}

/** Returns the first error message, if any. */
export function firstErrorMessage(result: ValidationResult): string | undefined {
  return errors(result)[0]?.message;
}

/** Returns diagnostic codes in source order. */
export function codes(result: ValidationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Reports whether a result has a specific diagnostic code. */
export function hasCode(result: ValidationResult, code: string): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.code === code);
}

/** Returns the highest severity present in a result. */
export function highestSeverity(result: ValidationResult): Severity | undefined {
  return result.diagnostics.some((item) => item.severity === 'Error') ? 'Error' : result.diagnostics.some((item) => item.severity === 'Warning') ? 'Warning' : result.diagnostics.length ? 'Info' : undefined;
}

/** Returns a compact one-line validation summary. */
export function validationSummary(result: ValidationResult): string {
  return result.is_valid ? `valid (${result.diagnostics.length} diagnostics)` : `invalid (${errors(result).length} errors)`;
}

/** Returns diagnostics belonging to a section. */
export function diagnosticsForSection(result: ValidationResult, section: string): Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.section === section);
}

/** Returns diagnostics at or after a source line. */
export function diagnosticsFromLine(result: ValidationResult, line: number): Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.line >= line);
}

/** Returns whether a section is one of the required kinds. */
export function isRequiredSection(kind: SectionKind): boolean {
  return requiredSections.includes(kind);
}

/** Returns the canonical required section kinds. */
export function requiredSectionKinds(): SectionKind[] {
  return [...requiredSections];
}

/** Returns standard section kinds used for ordering. */
export function canonicalSectionKinds(): SectionKind[] {
  return [...canonicalOrder];
}

/** Returns a count of diagnostics by code. */
export function countByCode(result: ValidationResult): Record<string, number> {
  return result.diagnostics.reduce<Record<string, number>>((counts, diagnostic) => { counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1; return counts; }, {});
}

/** Returns true when a result has no Error severity. */
export function resultIsValid(result: ValidationResult): boolean {
  return result.is_valid && !hasErrors(result);
}

/** Returns a rule-friendly empty report. */
export function reportFrom(diagnostics: Diagnostic[]): ValidationResult {
  return { diagnostics: [...diagnostics], is_valid: !diagnostics.some((item) => item.severity === 'Error') };
}

/** Returns a diagnostic location fallback. */
export function diagnosticLine(diagnostic: Diagnostic): number {
  return Math.max(1, diagnostic.line);
}

/** Returns a stable joined diagnostic report. */
export function joinDiagnostics(result: ValidationResult, separator = '\n'): string {
  return messages(result).join(separator);
}

/** Returns sections that are duplicated by kind. */
export function duplicatedSectionKinds(module: Module): SectionKind[] {
  return duplicateSections(module).map(([kind]) => kind);
}

/** Returns section kinds in canonical order. */
export function sortedSectionKinds(module: Module): SectionKind[] {
  return module.sections.filter((section) => section.kind !== 'Custom').map((section) => section.kind).sort((a, b) => sectionKindOrder(a) - sectionKindOrder(b));
}

/** Returns whether a module passes canonical order. */
export function passesCanonicalOrder(module: Module): boolean {
  return isCanonicalOrder(module);
}

/** Returns a stable code list for fixture reporting. */
export function diagnosticCodeList(result: ValidationResult): string[] {
  return [...new Set(codes(result))];
}

/** Returns a severity count as display text. */
export function severityCountText(result: ValidationResult): string {
  const counts = countBySeverity(result);
  return `${counts.Error}/${counts.Warning}/${counts.Info}`;
}

void canonicalOrder;
