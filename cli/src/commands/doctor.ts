/**
 * MAM Doctor Command
 * 
 * Checks environment and dependencies.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  installed: boolean;
  version?: string;
  status: 'ok' | 'missing' | 'error';
}

export interface DoctorOptions {
  fix?: boolean;
}

export async function doctorCommand(_options: DoctorOptions): Promise<void> {
  console.log(chalk.cyan('\nMAM Environment Check\n'));

  const checks: CheckResult[] = [];

  // Check Node.js
  checks.push(await checkCommand('node', 'Node.js'));

  // Check npm
  checks.push(await checkCommand('npm', 'npm'));

  // Check pnpm
  checks.push(await checkCommand('pnpm', 'pnpm'));

  // Check Python
  checks.push(await checkCommand('python3', 'Python'));

  // Check Go
  checks.push(await checkCommand('go', 'Go'));

  // Check Rust
  checks.push(await checkCommand('rustc', 'Rust'));

  // Print results
  let hasError = false;
  for (const check of checks) {
    if (check.status === 'ok') {
      console.log(chalk.green(`  ✓ ${check.name}: ${check.version || 'installed'}`));
    } else if (check.status === 'missing') {
      console.log(chalk.red(`  ✗ ${check.name}: not found`));
      hasError = true;
    } else {
      console.log(chalk.yellow(`  ? ${check.name}: error`));
    }
  }

  console.log('');
  if (hasError) {
    console.log(chalk.yellow('Some dependencies are missing. Install them for full functionality.'));
  } else {
    console.log(chalk.green('All checks passed!'));
  }
}

async function checkCommand(cmd: string, name: string): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync(`${cmd} --version`);
    return { name, installed: true, version: stdout.trim().split('\n')[0], status: 'ok' };
  } catch {
    return { name, installed: false, status: 'missing' };
  }
}