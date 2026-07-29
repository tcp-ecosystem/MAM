/**
 * MAM Python Plugin
 *
 * Provides Python code execution context for MAM modules.
 */

import type { MAMPlugin } from '@mam/plugin-api';
import { PYTHON_MANIFEST, pythonSection } from './manifest.js';
import { pythonRule } from './rule.js';
import { pythonContext } from './context.js';

export { PYTHON_MANIFEST, pythonSection, getPythonSection } from './manifest.js';
export { runPythonCode, runPythonFile, runPythonExpression, checkPythonAvailable } from './runner.js';
export type { PythonRunOptions, PythonRunResult } from './runner.js';
export { validatePythonCode, checkPythonSecurityPatterns } from './validator.js';
export type { PythonValidationIssue } from './validator.js';
export { pythonRule, createPythonRule } from './rule.js';
export { pythonContext, createPythonContext } from './context.js';

const pythonPlugin: MAMPlugin = {
  manifest: PYTHON_MANIFEST,
  sections: [pythonSection],
  rules: [pythonRule],
  contexts: [pythonContext],
};

export default pythonPlugin;
