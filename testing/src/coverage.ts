/**
 * MAM Test Coverage
 *
 * Track covered lines, sections, and branches across MAM modules and produce
 * aggregate coverage reports with formatting helpers.
 */

import type { MAMASTPartial } from './assertions.js';

// ============================================================================
// Types
// ============================================================================

/** Coverage numbers for a single file */
export interface FileCoverage {
  /** File/module identifier */
  file: string;
  /** Estimated total lines */
  totalLines: number;
  /** Number of covered lines */
  coveredLines: number;
  /** Total sections in the module */
  totalSections: number;
  /** Sections that were covered */
  coveredSections: number;
  /** Total branches (code blocks) in the module */
  totalBranches: number;
  /** Branches that were covered */
  coveredBranches: number;
  /** Coverage percentage (0..100) */
  percentage: number;
}

/** Aggregate coverage report across files */
export interface CoverageReport {
  /** Per-file coverage entries */
  files: FileCoverage[];
  /** Aggregated totals */
  totals: {
    lines: number;
    coveredLines: number;
    sections: number;
    coveredSections: number;
    branches: number;
    coveredBranches: number;
    percentage: number;
  };
}

/** Set of things covered for a file during a test run */
export interface CoverageInput {
  /** Covered line numbers */
  lines?: number[];
  /** Covered section names */
  sections?: string[];
  /** Covered branch identifiers */
  branches?: string[];
}

// ============================================================================
// Coverage Collector
// ============================================================================

/**
 * Accumulates covered lines, sections, and branches across a test run and can
 * produce a {@link CoverageReport}.
 */
export class CoverageCollector {
  private files: Map<
    string,
    { lines: Set<number>; sections: Set<string>; branches: Set<string> }
  > = new Map();

  /**
   * Record a covered line number for a file
   */
  recordLine(file: string, line: number): this {
    this.entry(file).lines.add(line);
    return this;
  }

  /**
   * Record multiple covered line numbers for a file
   */
  recordLines(file: string, lines: number[]): this {
    const entry = this.entry(file);
    for (const line of lines) {
      entry.lines.add(line);
    }
    return this;
  }

  /**
   * Record a covered section name for a file
   */
  recordSection(file: string, section: string): this {
    this.entry(file).sections.add(section);
    return this;
  }

  /**
   * Record a covered branch identifier for a file
   */
  recordBranch(file: string, branchId: string): this {
    this.entry(file).branches.add(branchId);
    return this;
  }

  /**
   * Record a batch of covered items for a file
   */
  record(file: string, covered: CoverageInput): this {
    const entry = this.entry(file);
    for (const line of covered.lines ?? []) {
      entry.lines.add(line);
    }
    for (const section of covered.sections ?? []) {
      entry.sections.add(section);
    }
    for (const branch of covered.branches ?? []) {
      entry.branches.add(branch);
    }
    return this;
  }

  /**
   * Build a coverage report from the tracked data
   */
  getReport(): CoverageReport {
    const files: FileCoverage[] = [];
    const totals = {
      lines: 0,
      coveredLines: 0,
      sections: 0,
      coveredSections: 0,
      branches: 0,
      coveredBranches: 0,
      percentage: 0,
    };

    for (const [file, data] of this.files) {
      const totalLines = Math.max(1, Math.max(...data.lines));
      const totalSections = data.sections.size;
      const totalBranches = data.branches.size;
      const coveredLines = data.lines.size;
      const coveredSections = data.sections.size;
      const coveredBranches = data.branches.size;

      const entry: FileCoverage = {
        file,
        totalLines,
        coveredLines,
        totalSections,
        coveredSections,
        totalBranches,
        coveredBranches,
        percentage: computePercentage(
          { covered: coveredLines, total: totalLines },
          { covered: coveredSections, total: totalSections },
          { covered: coveredBranches, total: totalBranches }
        ),
      };

      files.push(entry);
      totals.lines += totalLines;
      totals.coveredLines += coveredLines;
      totals.sections += totalSections;
      totals.coveredSections += coveredSections;
      totals.branches += totalBranches;
      totals.coveredBranches += coveredBranches;
    }

    totals.percentage = computePercentage(
      { covered: totals.coveredLines, total: totals.lines },
      { covered: totals.coveredSections, total: totals.sections },
      { covered: totals.coveredBranches, total: totals.branches }
    );

    return { files, totals };
  }

  /** Reset all tracked coverage data */
  reset(): void {
    this.files.clear();
  }

  private entry(file: string): { lines: Set<number>; sections: Set<string>; branches: Set<string> } {
    const existing = this.files.get(file);
    if (existing) {
      return existing;
    }
    const created = { lines: new Set<number>(), sections: new Set<string>(), branches: new Set<string>() };
    this.files.set(file, created);
    return created;
  }
}

// ============================================================================
// Calculation & formatting
// ============================================================================

/**
 * Compute a coverage report for a single MAM AST based on what was covered.
 * Branches are derived from code blocks (one branch id per block), sections
 * from section names, and lines from an estimate of the module's content.
 */
export function calculateCoverage(ast: MAMASTPartial, covered?: CoverageInput): CoverageReport {
  const totalSectionNames = (ast.sections ?? []).map((s) => s.name);
  const coveredSections = (covered?.sections ?? []).filter((s) => totalSectionNames.includes(s));

  const branchIds: string[] = [];
  for (const section of ast.sections ?? []) {
    for (let i = 0; i < (section.codeBlocks ?? []).length; i++) {
      branchIds.push(`${section.name}:${i}`);
    }
  }
  const coveredBranchIds = (covered?.branches ?? []).filter((b) => branchIds.includes(b));

  const totalLines = estimateLines(ast);
  const coveredLines = Math.min(totalLines, (covered?.lines ?? []).filter((l) => l >= 1).length);

  const totalSections = totalSectionNames.length;
  const coveredSectionsCount = coveredSections.length;
  const totalBranches = branchIds.length;
  const coveredBranches = coveredBranchIds.length;

  const entry: FileCoverage = {
    file: 'module',
    totalLines,
    coveredLines,
    totalSections,
    coveredSections: coveredSectionsCount,
    totalBranches,
    coveredBranches,
    percentage: computePercentage(
      { covered: coveredLines, total: totalLines },
      { covered: coveredSectionsCount, total: totalSections },
      { covered: coveredBranches, total: totalBranches }
    ),
  };

  return {
    files: [entry],
    totals: {
      lines: totalLines,
      coveredLines,
      sections: totalSections,
      coveredSections: coveredSectionsCount,
      branches: totalBranches,
      coveredBranches,
      percentage: entry.percentage,
    },
  };
}

/**
 * Format a coverage report as a readable text table
 */
export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push('Coverage Report');
  lines.push('--------------');

  for (const file of report.files) {
    lines.push(
      `  ${file.file}: ${file.percentage.toFixed(1)}% ` +
        `(${file.coveredLines}/${file.totalLines} lines, ` +
        `${file.coveredSections}/${file.totalSections} sections, ` +
        `${file.coveredBranches}/${file.totalBranches} branches)`
    );
  }

  lines.push('--------------');
  lines.push(`Total: ${report.totals.percentage.toFixed(1)}%`);
  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

/** A single dimension's coverage counts */
interface CoverageDimension {
  covered: number;
  total: number;
}

/**
 * Compute a blended coverage percentage as the average of each dimension's
 * ratio. Dimensions with zero totals are ignored.
 */
function computePercentage(...dimensions: CoverageDimension[]): number {
  const ratios = dimensions
    .filter((d) => d.total > 0)
    .map((d) => (d.covered / d.total) * 100);
  if (ratios.length === 0) return 0;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/** Estimate the total number of lines in a module AST */
function estimateLines(ast: MAMASTPartial): number {
  let lines = 0;

  if (ast.frontmatter?.data) {
    lines += Object.keys(ast.frontmatter.data).length + 3; // `---` fences plus fields
  }

  for (const section of ast.sections ?? []) {
    const content = section.content ?? '';
    lines += content.length > 0 ? content.split('\n').length : 1;
    for (const block of section.codeBlocks ?? []) {
      lines += block.content.split('\n').length + 2; // fence markers
    }
  }

  return Math.max(1, lines);
}