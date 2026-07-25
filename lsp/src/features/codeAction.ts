/**
 * MAM Code Actions Provider
 */

import { CodeAction, CodeActionKind, TextEdit } from 'vscode-languageserver-protocol';

export function getCodeActions(uri: string, line: number): CodeAction[] {
  return [{
    title: 'Add Purpose section',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [{
          range: { start: { line, character: 0 }, end: { line, character: 0 } },
          newText: '## Purpose\n\nDescribe module purpose.\n\n',
        } as TextEdit],
      },
    },
  }];
}