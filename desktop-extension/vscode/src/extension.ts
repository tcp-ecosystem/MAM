/**
 * MAM VS Code extension entry point.
 *
 * Wires together the language service:
 *  - CliService: spawns the real `mam` CLI for validate/run/build/compile/new.
 *  - MamDiagnostics: live Problems-panel diagnostics (validate on open/save).
 *  - Six commands: validate, run, build, compile, new module, run project.
 *  - Providers: formatting, folding, document symbols, hover.
 *  - A status bar item shown while editing MAM documents.
 */

import * as vscode from 'vscode';
import { CliService, CliUnavailableError } from './cli';
import { MamDiagnostics } from './diagnostics';
import {
  MamFormattingProvider,
  MamFoldingProvider,
  MamDocumentSymbolProvider,
  MamHoverProvider,
} from './providers';

/** Module types the `mam new` command supports. */
const MODULE_TYPES = [
  'module',
  'agent',
  'tool',
  'memory',
  'workflow',
  'team',
  'policy',
  'system',
  'service',
  'component',
  'resource',
  'plugin',
  'api',
];

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('MAM');
  output.appendLine('MAM extension activated');
  context.subscriptions.push(output);

  // ------------------------------------------------------------------
  // Core services
  // ------------------------------------------------------------------
  const config = vscode.workspace.getConfiguration('mam');
  const cliPath = config.get<string>('cliPath', 'mam');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cli = new CliService({ cliPath, cwd: workspaceFolder });
  const diagnostics = new MamDiagnostics(cli);
  context.subscriptions.push(diagnostics);

  /** The active editor's document if it is a MAM module. */
  const activeMamDocument = (): vscode.TextDocument | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.languageId === 'mam' ? editor.document : undefined;
  };

  /** First workspace folder path, if any. */
  const workspacePath = (): string | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  /** Append a heading + block to the MAM output channel and reveal it. */
  const showOutput = (heading: string, body: string): void => {
    output.appendLine('');
    output.appendLine(`— ${heading} —`);
    output.appendLine(body);
    output.show(true);
  };

  // ------------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------------

  const commandValidate = vscode.commands.registerCommand('mam.validate', async () => {
    const doc = activeMamDocument();
    if (!doc) {
      vscode.window.showWarningMessage('MAM: no active .mam document to validate.');
      return;
    }
    diagnostics.invalidateCliCache();
    const available = await cli.available();
    if (!available) {
      // Still run the lightweight fallback so the Problems panel updates.
      diagnostics.validateDocument(doc, 0);
      vscode.window.showWarningMessage('MAM CLI not found. Install @mam/cli or set mam.cliPath.');
      return;
    }
    try {
      const result = await cli.validate(doc.uri.fsPath);
      const { errors, warnings, info } = result.stats;
      const summary = `${errors} error(s), ${warnings} warning(s), ${info} info — ${result.valid ? 'valid' : 'invalid'}`;
      const body = result.diagnostics
        .map((d) => `  ${d.line}:${d.column} [${d.severity}] ${d.message} (${d.ruleId})`)
        .join('\n');
      showOutput(`mam validate ${doc.uri.fsPath}`, body || '  No issues found.');
      output.appendLine(`Summary: ${summary}`);
      if (result.valid) {
        vscode.window.showInformationMessage(`MAM: module valid — ${summary}`);
      } else {
        vscode.window.showWarningMessage(`MAM: ${errors} error(s), ${warnings} warning(s) found`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`mam validate failed: ${(err as Error).message}`);
    }
  });

  const commandRun = vscode.commands.registerCommand('mam.run', async () => {
    const doc = activeMamDocument();
    if (!doc) {
      vscode.window.showWarningMessage('MAM: no active .mam document to run.');
      return;
    }
    try {
      const result = await cli.run(doc.uri.fsPath);
      const lines = [
        `Success: ${result.success}`,
        `Time: ${result.timeMs.toFixed(1)}ms`,
        `Memory: ${(result.memoryUsedBytes / 1024 / 1024).toFixed(2)} MB`,
      ];
      if (result.warnings.length > 0) lines.push(`Warnings:\n${result.warnings.map((w) => `  ${w}`).join('\n')}`);
      if (result.errors.length > 0) lines.push(`Errors:\n${result.errors.map((e) => `  ${e}`).join('\n')}`);
      lines.push(`Output: ${JSON.stringify(result.output, null, 2)}`);
      showOutput(`mam run ${doc.uri.fsPath}`, lines.join('\n'));
      if (result.success) {
        vscode.window.showInformationMessage('MAM: module ran successfully');
      } else {
        vscode.window.showErrorMessage('MAM: module failed to run — see MAM output channel');
      }
    } catch (err) {
      if (err instanceof CliUnavailableError) {
        vscode.window.showWarningMessage(`MAM CLI not found (${cliPath}). Install @mam/cli or set mam.cliPath.`);
      } else {
        vscode.window.showErrorMessage(`mam run failed: ${(err as Error).message}`);
      }
    }
  });

  const commandBuild = vscode.commands.registerCommand('mam.build', async () => {
    const dir = workspacePath();
    if (!dir) {
      vscode.window.showWarningMessage('MAM: open a workspace folder to build.');
      return;
    }
    try {
      const result = await cli.build(dir);
      showOutput(`mam build (${dir})`, result.output || '  No output.');
      if (result.ok) {
        vscode.window.showInformationMessage('MAM: build completed');
      } else {
        vscode.window.showErrorMessage('MAM: build failed — see MAM output channel');
      }
    } catch (err) {
      if (err instanceof CliUnavailableError) {
        vscode.window.showWarningMessage(`MAM CLI not found (${cliPath}). Install @mam/cli or set mam.cliPath.`);
      } else {
        vscode.window.showErrorMessage(`mam build failed: ${(err as Error).message}`);
      }
    }
  });

  const commandCompile = vscode.commands.registerCommand('mam.compile', async () => {
    const doc = activeMamDocument();
    if (!doc) {
      vscode.window.showWarningMessage('MAM: no active .mam document to compile.');
      return;
    }
    const defaultTarget = vscode.workspace.getConfiguration('mam').get<string>('defaultTarget', 'python');
    const picked = await vscode.window.showQuickPick(
      ['python', 'javascript', 'go', 'rust'],
      { placeHolder: `Compile target (default: ${defaultTarget})` },
    );
    const target = picked ?? defaultTarget;
    try {
      const result = await cli.compile(doc.uri.fsPath, target);
      showOutput(`mam compile ${doc.uri.fsPath} -t ${target}`, result.output || '  No output.');
      if (result.ok) {
        vscode.window.showInformationMessage(`MAM: compiled to ${target}`);
      } else {
        vscode.window.showErrorMessage(`MAM: compile to ${target} failed — see MAM output channel`);
      }
    } catch (err) {
      if (err instanceof CliUnavailableError) {
        vscode.window.showWarningMessage(`MAM CLI not found (${cliPath}). Install @mam/cli or set mam.cliPath.`);
      } else {
        vscode.window.showErrorMessage(`mam compile failed: ${(err as Error).message}`);
      }
    }
  });

  const commandNewModule = vscode.commands.registerCommand('mam.newModule', async () => {
    const dir = workspacePath();
    if (!dir) {
      vscode.window.showWarningMessage('MAM: open a workspace folder to create a module.');
      return;
    }
    const type = await vscode.window.showQuickPick(MODULE_TYPES, { placeHolder: 'Module type' });
    if (!type) return;
    const name = await vscode.window.showInputBox({
      prompt: 'Module name (slug, e.g. http-client)',
      validateInput: (value) => (value && value.trim().length > 0 ? undefined : 'A module name is required'),
    });
    if (!name) return;
    try {
      const result = await cli.newModule(type, name.trim(), dir);
      showOutput(`mam new ${type} ${name.trim()}`, result.output || '  No output.');
      if (result.ok && result.files[0]) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(result.files[0]));
        vscode.window.showInformationMessage(`MAM: created ${type} module "${name.trim()}"`);
      } else if (!result.ok) {
        vscode.window.showErrorMessage('MAM: failed to create module — see MAM output channel');
      }
    } catch (err) {
      if (err instanceof CliUnavailableError) {
        vscode.window.showWarningMessage(`MAM CLI not found (${cliPath}). Install @mam/cli or set mam.cliPath.`);
      } else {
        vscode.window.showErrorMessage(`mam new failed: ${(err as Error).message}`);
      }
    }
  });

  const commandRunProject = vscode.commands.registerCommand('mam.runProject', async () => {
    const dir = workspacePath();
    if (!dir) {
      vscode.window.showWarningMessage('MAM: open a workspace folder to run the project.');
      return;
    }
    try {
      const result = await cli.runProject(dir);
      const lines = [
        `Success: ${result.success}`,
        `Time: ${result.timeMs.toFixed(1)}ms`,
        `Output: ${JSON.stringify(result.output, null, 2)}`,
      ];
      if (result.errors.length > 0) lines.push(`Errors:\n${result.errors.map((e) => `  ${e}`).join('\n')}`);
      showOutput(`mam run (project, ${dir})`, lines.join('\n'));
      if (result.success) {
        vscode.window.showInformationMessage('MAM: project ran successfully');
      } else {
        vscode.window.showErrorMessage('MAM: project failed to run — see MAM output channel');
      }
    } catch (err) {
      if (err instanceof CliUnavailableError) {
        vscode.window.showWarningMessage(`MAM CLI not found (${cliPath}). Install @mam/cli or set mam.cliPath.`);
      } else {
        vscode.window.showErrorMessage(`mam run failed: ${(err as Error).message}`);
      }
    }
  });

  context.subscriptions.push(
    commandValidate,
    commandRun,
    commandBuild,
    commandCompile,
    commandNewModule,
    commandRunProject,
  );

  // ------------------------------------------------------------------
  // Status bar item
  // ------------------------------------------------------------------
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(symbol-misc) MAM';
  statusItem.tooltip = 'MAM: Validate Module (Ctrl+Alt+V)';
  statusItem.command = 'mam.validate';

  const updateStatusBar = (): void => {
    const enabled = vscode.workspace.getConfiguration('mam').get<boolean>('showStatusBar', true);
    if (enabled && activeMamDocument()) {
      statusItem.show();
    } else {
      statusItem.hide();
    }
  };
  context.subscriptions.push(statusItem);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
  updateStatusBar();

  // ------------------------------------------------------------------
  // Live diagnostics: validate on open and on save (config-driven).
  // ------------------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'mam') diagnostics.validateDocument(doc);
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'mam') return;
      const validateOnSave = vscode.workspace.getConfiguration('mam').get<boolean>('validateOnSave', true);
      if (validateOnSave) diagnostics.validateDocument(doc, 0);
    }),
  );

  // Validate the document that is already open at activation time.
  if (vscode.window.activeTextEditor?.document.languageId === 'mam') {
    diagnostics.validateDocument(vscode.window.activeTextEditor.document);
  }

  // ------------------------------------------------------------------
  // Language providers
  // ------------------------------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('mam', new MamFormattingProvider()),
    vscode.languages.registerFoldingRangeProvider('mam', new MamFoldingProvider()),
    vscode.languages.registerDocumentSymbolProvider('mam', new MamDocumentSymbolProvider()),
    vscode.languages.registerHoverProvider('mam', new MamHoverProvider()),
  );

  output.appendLine('MAM language services registered.');
}

export function deactivate(): void {
  // All disposables (diagnostics collection, output channel, status bar,
  // providers, subscriptions) are released via context.subscriptions.
}