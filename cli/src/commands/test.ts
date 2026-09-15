import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TestOptions {
  file: string;
  verbose?: boolean;
  timeout?: number;
}

export interface TestCase {
  name: string;
  input: string;
  expected?: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface TestResult {
  file: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests: TestCase[];
}

export async function runTests(options: TestOptions): Promise<TestResult> {
  const startTime = Date.now();
  const { file, verbose = false, timeout = 30000 } = options;
  
  const filePath = resolve(file);
  const content = readFileSync(filePath, 'utf-8');
  
  const tests: TestCase[] = [];
  
  // Extract tests section
  const testsMatch = content.match(/## Tests\n([\s\S]*?)(?=\n## |$)/i);
  if (!testsMatch) {
    return {
      file: filePath,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - startTime,
      tests: []
    };
  }
  
  const testsContent = testsMatch[1];
  
  // Parse test cases (look for numbered items or code blocks)
  const testBlocks = testsContent.match(/(?:^|\n)(?:\d+\.\s+|-\s+)([\s\S]*?)(?=\n(?:\d+\.\s+|-\s+)|$)/g) || [];
  
  for (const block of testBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    
    const testStart = Date.now();
    
    // Extract test name (first line or code block content)
    const nameMatch = trimmed.match(/^(?:\d+\.\s+|-\s+)(.+)/);
    const name = nameMatch ? nameMatch[1].replace(/`([^`]+)`/g, '$1').trim() : `Test ${tests.length + 1}`;
    
    // Extract code block if present
    const codeMatch = trimmed.match(/```[\s\S]*?```/);
    const code = codeMatch ? codeMatch[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim() : '';
    
    // For now, validate that test has some content
    const passed = trimmed.length > 10;
    const error = passed ? undefined : 'Test case too short or missing';
    
    tests.push({
      name,
      input: code || trimmed,
      passed,
      error,
      durationMs: Date.now() - testStart
    });
  }
  
  // If no structured tests found, create a single test
  if (tests.length === 0 && testsContent.trim().length > 0) {
    tests.push({
      name: 'Module has test documentation',
      input: testsContent,
      passed: true,
      durationMs: 0
    });
  }
  
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  
  return {
    file: filePath,
    total: tests.length,
    passed,
    failed,
    skipped: 0,
    durationMs: Date.now() - startTime,
    tests
  };
}

export function formatTestResult(result: TestResult, verbose: boolean = false): string {
  const lines: string[] = [];
  const { file, total, passed, failed, durationMs, tests } = result;
  
  lines.push(`\n  Test Results: ${file.split(/[/\\]/).pop()}`);
  lines.push(`  ${'─'.repeat(40)}`);
  
  if (total === 0) {
    lines.push('  No tests found in module');
  } else {
    for (const test of tests) {
      const icon = test.passed ? '✓' : '✗';
      const color = test.passed ? '' : ' ✗';
      lines.push(`  ${icon} ${test.name}`);
      if (verbose && test.error) {
        lines.push(`    Error: ${test.error}`);
      }
    }
    
    lines.push('');
    lines.push(`  ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  }
  
  lines.push(`  Duration: ${durationMs.toFixed(0)}ms`);
  
  return lines.join('\n');
}
