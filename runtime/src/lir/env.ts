/**
 * Environment filtering for host-language processes.
 *
 * Child processes never inherit the full parent environment. Secrets stay in
 * the parent unless the policy allowlist explicitly includes them.
 */

import { DEFAULT_LIR_POLICY } from './types.js';

export function filterEnvironment(
  source: NodeJS.ProcessEnv,
  allow: readonly string[] = DEFAULT_LIR_POLICY.allowEnvironment,
  extra: readonly string[] = [],
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const names = new Set<string>([...allow, ...extra]);

  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string') result[name] = value;
  }

  return result;
}
