import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('MAM extension activated');
  
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('mam');
  context.subscriptions.push(diagnosticCollection);
  
  vscode.workspace.onDidOpenTextDocument(validateMam, null, context.subscriptions);
  vscode.workspace.onDidSaveTextDocument(validateMam, null, context.subscriptions);
  
  function validateMam(doc: vscode.TextDocument) {
    if (doc.languageId !== 'mam') return;
    const diagnostics: vscode.Diagnostic[] = [];
    const text = doc.getText();
    
    // Check for frontmatter
    if (!text.match(/^---\s*$/m)) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        'MAM module missing frontmatter (---)',
        vscode.DiagnosticSeverity.Warning
      ));
    }
    
    // Check for required sections
    const requiredSections = ['Purpose', 'Inputs', 'Outputs'];
    for (const section of requiredSections) {
      if (!text.match(new RegExp(`^##\\s+${section}`, 'm'))) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `Missing recommended section: ${section}`,
          vscode.DiagnosticSeverity.Information
        ));
      }
    }
    
    diagnosticCollection.set(doc.uri, diagnostics);
  }
}

export function deactivate() {}
