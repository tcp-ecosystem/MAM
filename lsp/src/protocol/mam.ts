/**
 * MAM LSP Protocol Extensions
 */

export const MAM_LANGUAGE_ID = 'mam';

export const MAM_DOCUMENT_SELECTOR = [{ scheme: 'file', pattern: '**/*.mam.md' }];

export interface MAMDiagnostics {
  errors: MAMDiagnostic[];
  warnings: MAMDiagnostic[];
}

export interface MAMDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
}

export interface MAMModuleInfo {
  id: string;
  version: string;
  name: string;
  author: string;
  runtime: string;
  sections: string[];
  dependencies: string[];
}

export function isMAMFile(uri: string): boolean {
  return uri.endsWith('.mam.md');
}