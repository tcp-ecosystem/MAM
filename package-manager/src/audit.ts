/**
 * MAM Package Auditor
 *
 * Security audit and license compliance checking for installed packages.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { PackageManifest } from './package.js';

// ============================================================================
// Types
// ============================================================================

export interface AuditOptions {
  /** Check for known vulnerabilities */
  vulnerabilities?: boolean;
  /** Check license compliance */
  licenses?: boolean;
  /** Allowed licenses */
  allowedLicenses?: string[];
  /** Denied licenses */
  deniedLicenses?: string[];
  /** Output format */
  format?: 'text' | 'json' | 'sarif';
  /** Project directory */
  projectDir: string;
}

export interface AuditResult {
  /** Overall audit status */
  status: 'pass' | 'warn' | 'fail';
  /** Vulnerability findings */
  vulnerabilities: Vulnerability[];
  /** License findings */
  licenseIssues: LicenseIssue[];
  /** Packages checked */
  packagesChecked: number;
  /** Audit time in ms */
  timeMs: number;
  /** Audit timestamp */
  timestamp: string;
}

export interface Vulnerability {
  /** Package name */
  package: string;
  /** Installed version */
  version: string;
  /** Vulnerability severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Vulnerability title */
  title: string;
  /** Vulnerability description */
  description: string;
  /** Advisory URL */
  advisoryUrl?: string;
  /** Patched version */
  patchedVersion?: string;
  /** CVE identifier */
  cve?: string;
}

export interface LicenseIssue {
  /** Package name */
  package: string;
  /** Package version */
  version: string;
  /** Detected license */
  license: string;
  /** Issue type */
  issue: 'unrecognized' | 'denied' | 'copyleft' | 'commercial';
  /** License file path */
  licenseFile?: string;
}

export interface LicenseInfo {
  /** License identifier (SPDX) */
  spdx: string;
  /** License display name */
  name: string;
  /** Whether license is OSI approved */
  osiApproved: boolean;
  /** Whether license is copyleft */
  copyleft: boolean;
  /** License category */
  category: 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'proprietary' | 'unknown';
}

export interface AuditReport {
  /** Project name */
  projectName: string;
  /** Project version */
  projectVersion: string;
  /** Audit result */
  result: AuditResult;
  /** Recommendations */
  recommendations: string[];
  /** Report generation time */
  generatedAt: string;
}

// ============================================================================
// Package Auditor
// ============================================================================

export class PackageAuditor {
  private options: AuditOptions;
  private knownVulnerabilities: Map<string, Vulnerability[]> = new Map();
  private licenses: Map<string, LicenseInfo> = new Map();

  constructor(options: Partial<AuditOptions> & { projectDir: string }) {
    this.options = {
      vulnerabilities: true,
      licenses: true,
      allowedLicenses: ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'],
      deniedLicenses: ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'],
      format: 'text',
      ...options,
    };

    this.initializeLicenseDatabase();
  }

  /**
   * Run full audit on project
   */
  async audit(): Promise<AuditResult> {
    const startTime = performance.now();
    const vulnerabilities: Vulnerability[] = [];
    const licenseIssues: LicenseIssue[] = [];
    let packagesChecked = 0;

    // Discover installed packages
    const packages = await this.discoverPackages();

    for (const pkg of packages) {
      packagesChecked++;

      // Check vulnerabilities
      if (this.options.vulnerabilities) {
        const vulns = await this.checkVulnerabilities(pkg.name, pkg.version);
        vulnerabilities.push(...vulns);
      }

      // Check licenses
      if (this.options.licenses) {
        const license = await this.checkLicense(pkg.name, pkg.version, pkg.path);

        if (license) {
          licenseIssues.push(...license);
        }
      }
    }

    // Determine status
    let status: AuditResult['status'] = 'pass';

    if (vulnerabilities.some(v => v.severity === 'critical' || v.severity === 'high')) {
      status = 'fail';
    } else if (vulnerabilities.length > 0 || licenseIssues.length > 0) {
      status = 'warn';
    }

    return {
      status,
      vulnerabilities,
      licenseIssues,
      packagesChecked,
      timeMs: performance.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check license for a specific package
   */
  async checkLicense(name: string, version: string, packagePath?: string): Promise<LicenseIssue[]> {
    const issues: LicenseIssue[] = [];
    const manifest = await this.loadPackageManifest(name, packagePath);

    if (!manifest) {
      return issues;
    }

    const license = manifest.license || 'Unknown';
    const licenseInfo = this.licenses.get(license);

    if (!licenseInfo) {
      // Unrecognized license
      issues.push({
        package: name,
        version,
        license,
        issue: 'unrecognized',
      });

      return issues;
    }

    // Check against denied licenses
    if (this.options.deniedLicenses?.includes(license)) {
      issues.push({
        package: name,
        version,
        license,
        issue: 'denied',
      });
    }

    // Check for copyleft
    if (licenseInfo.copyleft) {
      issues.push({
        package: name,
        version,
        license,
        issue: 'copyleft',
      });
    }

    return issues;
  }

  /**
   * Check for known vulnerabilities
   */
  async getVulnerabilities(name: string, version: string): Promise<Vulnerability[]> {
    const vulns = this.knownVulnerabilities.get(name) || [];

    // Filter to matching versions
    return vulns.filter(vuln => {
      if (vuln.patchedVersion) {
        return this.versionLessThan(version, vuln.patchedVersion);
      }

      return true;
    });
  }

  /**
   * Generate audit report
   */
  async generateReport(result: AuditResult): Promise<AuditReport> {
    const manifest = await this.loadProjectManifest();

    const recommendations: string[] = [];

    // Add vulnerability recommendations
    for (const vuln of result.vulnerabilities) {
      if (vuln.patchedVersion) {
        recommendations.push(
          `Update ${vuln.package} to version ${vuln.patchedVersion} or later to fix ${vuln.title}`
        );
      } else {
        recommendations.push(
          `Review ${vuln.package} for ${vuln.title} - no patch available`
        );
      }
    }

    // Add license recommendations
    for (const issue of result.licenseIssues) {
      if (issue.issue === 'denied') {
        recommendations.push(
          `Replace ${issue.package} (${issue.license}) with an alternative that uses a permissive license`
        );
      } else if (issue.issue === 'copyleft') {
        recommendations.push(
          `Review ${issue.package} (${issue.license}) for copyleft implications`
        );
      }
    }

    return {
      projectName: manifest?.name || 'unknown',
      projectVersion: manifest?.version || '0.0.0',
      result,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if a license is allowed
   */
  isLicenseAllowed(license: string): boolean {
    if (this.options.deniedLicenses?.includes(license)) {
      return false;
    }

    if (this.options.allowedLicenses?.includes(license)) {
      return true;
    }

    const info = this.licenses.get(license);

    if (info && info.osiApproved) {
      return true;
    }

    return false;
  }

  /**
   * Get license information
   */
  getLicenseInfo(license: string): LicenseInfo | null {
    return this.licenses.get(license) || null;
  }

  /**
   * Add a custom vulnerability entry
   */
  addVulnerability(vuln: Vulnerability): void {
    const existing = this.knownVulnerabilities.get(vuln.package) || [];
    existing.push(vuln);
    this.knownVulnerabilities.set(vuln.package, existing);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async checkVulnerabilities(name: string, version: string): Promise<Vulnerability[]> {
    // In real implementation, this would query a vulnerability database
    // For now, return empty array
    return [];
  }

  private async discoverPackages(): Promise<Array<{ name: string; version: string; path: string }>> {
    const packages: Array<{ name: string; version: string; path: string }> = [];
    const nodeModulesDir = join(this.options.projectDir, 'node_modules');

    try {
      const entries = await readdir(nodeModulesDir);

      for (const entry of entries) {
        if (entry.startsWith('.')) {
          continue;
        }

        const packagePath = join(nodeModulesDir, entry);
        const manifest = await this.loadPackageManifest(entry, packagePath);

        if (manifest) {
          packages.push({
            name: manifest.name,
            version: manifest.version,
            path: packagePath,
          });
        }
      }
    } catch {
      // node_modules doesn't exist
    }

    return packages;
  }

  private async loadPackageManifest(name: string, basePath?: string): Promise<PackageManifest | null> {
    const base = basePath || join(this.options.projectDir, 'node_modules', name);
    const manifestPath = join(base, 'mam-package.json');

    try {
      const content = await readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadProjectManifest(): Promise<PackageManifest | null> {
    return this.loadPackageManifest('', this.options.projectDir);
  }

  private versionLessThan(a: string, b: string): boolean {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;

      if (aVal !== bVal) {
        return aVal < bVal;
      }
    }

    return false;
  }

  private initializeLicenseDatabase(): void {
    const licenses: Array<[string, LicenseInfo]> = [
      ['MIT', {
        spdx: 'MIT',
        name: 'MIT License',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['ISC', {
        spdx: 'ISC',
        name: 'ISC License',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['BSD-2-Clause', {
        spdx: 'BSD-2-Clause',
        name: 'BSD 2-Clause "Simplified" License',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['BSD-3-Clause', {
        spdx: 'BSD-3-Clause',
        name: 'BSD 3-Clause "New" or "Revised" License',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['Apache-2.0', {
        spdx: 'Apache-2.0',
        name: 'Apache License 2.0',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['GPL-2.0', {
        spdx: 'GPL-2.0-only',
        name: 'GNU General Public License v2.0',
        osiApproved: true,
        copyleft: true,
        category: 'strong-copyleft',
      }],
      ['GPL-3.0', {
        spdx: 'GPL-3.0-only',
        name: 'GNU General Public License v3.0',
        osiApproved: true,
        copyleft: true,
        category: 'strong-copyleft',
      }],
      ['AGPL-3.0', {
        spdx: 'AGPL-3.0-only',
        name: 'GNU Affero General Public License v3.0',
        osiApproved: true,
        copyleft: true,
        category: 'strong-copyleft',
      }],
      ['LGPL-2.1', {
        spdx: 'LGPL-2.1-only',
        name: 'GNU Lesser General Public License v2.1',
        osiApproved: true,
        copyleft: true,
        category: 'weak-copyleft',
      }],
      ['LGPL-3.0', {
        spdx: 'LGPL-3.0-only',
        name: 'GNU Lesser General Public License v3.0',
        osiApproved: true,
        copyleft: true,
        category: 'weak-copyleft',
      }],
      ['MPL-2.0', {
        spdx: 'MPL-2.0',
        name: 'Mozilla Public License 2.0',
        osiApproved: true,
        copyleft: true,
        category: 'weak-copyleft',
      }],
      ['Unlicense', {
        spdx: 'Unlicense',
        name: 'The Unlicense',
        osiApproved: true,
        copyleft: false,
        category: 'permissive',
      }],
      ['0BSD', {
        spdx: '0BSD',
        name: 'Zero-Clause BSD License',
        osiApproved: false,
        copyleft: false,
        category: 'permissive',
      }],
    ];

    for (const [key, value] of licenses) {
      this.licenses.set(key, value);
    }
  }
}
