/**
 * MAM Diagnostics Provider
 */

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { parseMAM } from '@mam/parser';

export function getDiagnostics(content: string, uri: string): Diagnostic[] {
  const result = parseMAM(content, { source: uri });
  return result.errors.map(e => ({
    range: {
      start: { line: (e as { line?: number }).line || 0, character: (e as { column?: number }).column || 0 },
      end: { line: (e as { line?: number }).line || 0, character: (e as { column?: number }).column || 0 },
    },
    severity: DiagnosticSeverity.Error,
    message: (e as { message: string }).message,
    source: 'mam-lsp',
  }));
}