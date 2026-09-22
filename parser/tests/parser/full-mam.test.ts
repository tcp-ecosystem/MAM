/**
 * Full MAM Spec Front Matter Tests
 *
 * Covers the canonical `.mam.md` / `.mam` structure described in
 * plan-doc/full-mam.md: structured runtime, structured permissions,
 * dependency version constraints, and capability declarations.
 */

import { describe, it, expect } from 'vitest';
import { parseMAM } from '../../src/index.js';

const FULL_MAM = `---
id: security-recon
name: Security Reconnaissance
version: 1.0.0
type: module
author: TCP Ecosystems
description: >
  Modular reconnaissance system.
license: Apache-2.0
runtime:
  language: python
  version: ">=3.12"
tags:
  - security
  - reconnaissance
dependencies:
  - name: http-client
    version: "^1.2"
capabilities:
  - discover
  - analyze
permissions:
  network: internet
  filesystem: read
---

# Security Reconnaissance

## Purpose

Describe what this module does.

## Inputs

- target

## Outputs

- findings

## Capabilities

### discover

Discovers publicly authorized assets.

### analyze

Analyzes discovered assets.

## Rules

- Operate only against authorized targets.
- Do not perform destructive actions.

## Workflow

\`\`\`mermaid
flowchart TD
    A[Input Target] --> B[Discovery]
    B --> C[Analysis]
\`\`\`
`;

describe('Full MAM Spec Front Matter', () => {
  it('parses a structured runtime object', () => {
    const result = parseMAM(FULL_MAM, { source: 'security-recon.mam' });
    expect(result.errors).toHaveLength(0);
    const runtime = result.ast.frontmatter?.data.runtime as Record<string, unknown>;
    expect(runtime).toMatchObject({ language: 'python', version: '>=3.12' });
  });

  it('parses structured permissions', () => {
    const result = parseMAM(FULL_MAM, { source: 'security-recon.mam' });
    const permissions = result.ast.frontmatter?.data.permissions as Record<string, unknown>;
    expect(permissions).toMatchObject({ network: 'internet', filesystem: 'read' });
  });

  it('parses dependency version constraints', () => {
    const result = parseMAM(FULL_MAM, { source: 'security-recon.mam' });
    const deps = result.ast.frontmatter?.data.dependencies as Array<Record<string, unknown>>;
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ name: 'http-client', version: '^1.2' });
  });

  it('parses capability declarations and resolves the Capabilities section', () => {
    const result = parseMAM(FULL_MAM, { source: 'security-recon.mam' });
    expect(result.ast.frontmatter?.data.capabilities).toEqual(['discover', 'analyze']);
    const capabilities = result.ast.sections.find((s) => s.name === 'Capabilities');
    expect(capabilities).toBeDefined();
  });

  it('does not error when a structured runtime is used', () => {
    const result = parseMAM(FULL_MAM, { source: 'security-recon.mam' });
    const runtimeErrors = result.errors.filter((e) => /runtime/i.test(e.message));
    expect(runtimeErrors).toHaveLength(0);
  });

  it('still rejects invalid runtime languages', () => {
    const bad = FULL_MAM.replace('language: python', 'language: brainfuck');
    const result = parseMAM(bad, { source: 'bad.mam' });
    expect(result.errors.some((e) => /Invalid runtime/i.test(e.message))).toBe(true);
  });
});
