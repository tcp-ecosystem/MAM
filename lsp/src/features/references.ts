/**
 * MAM References Provider
 */

import { Location } from 'vscode-languageserver-protocol';

export function getReferences(_uri: string, _line: number, _content: string): Location[] {
  // Reference finding for MAM modules
  // Would find section usage and dependency references
  return [];
}