/**
 * MAM Definition Provider
 */

import { Location } from 'vscode-languageserver-protocol';

export function getDefinition(_uri: string, _line: number, _content: string): Location | null {
  // Definition support for MAM modules
  // Would resolve section references and dependency links
  return null;
}