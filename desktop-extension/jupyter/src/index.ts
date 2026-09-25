import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Mode } from '@jupyterlab/codemirror';
import { IMimeTypeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

const PLUGIN_ID = 'mam-jupyterlab:plugin';

const MAM_EXTENSIONS = ['.mam', '.mam.md'];
const MAM_MIME = 'text/x-mam';

/**
 * Minimal line-based tokenizer for MAM modules.
 *
 * MAM is "Markdown as Module": frontmatter between `---` fences, headings,
 * code fences, and inline markdown constructs. This mirrors the canonical
 * TextMate grammar in `vscode/syntaxes/mam.tmLanguage.json` (scopeName
 * `source.mam`) so highlighting stays consistent across editors.
 */
function createMamStreamParser(): Record<string, any> {
  let inFrontmatter = false;
  let inCodeBlock = false;

  return {
    startState(): Record<string, any> {
      return { inFrontmatter: false, inCodeBlock: false };
    },

    token(stream: any, state: Record<string, any>): string | null {
      const line = stream.string;

      // Toggle frontmatter fences.
      if (/^\s*---\s*$/.test(line)) {
        if (state.inFrontmatter) {
          state.inFrontmatter = false;
        } else {
          state.inFrontmatter = true;
        }
        stream.skipToEnd();
        return 'mam-frontmatter-delim';
      }

      // Frontmatter key: value pairs.
      if (state.inFrontmatter && /^\w+:\s*/.test(line)) {
        stream.skipToEnd();
        return 'mam-frontmatter';
      }

      // Toggle code fences.
      if (/^\s*```/.test(line)) {
        state.inCodeBlock = !state.inCodeBlock;
        stream.skipToEnd();
        return 'mam-code-fence';
      }

      if (state.inCodeBlock) {
        stream.skipToEnd();
        return 'mam-code';
      }

      // Headings.
      if (/^\s{0,3}#{1,6}\s+/.test(line)) {
        stream.skipToEnd();
        return 'mam-heading';
      }

      // HTML comments.
      if (/^\s*<!--/.test(line)) {
        stream.skipToEnd();
        return 'mam-comment';
      }

      // Keywords (section names, booleans) and operators.
      const match = line.match(/->|=>|\||\b(Purpose|Inputs|Outputs|Capabilities|Rules|Workflow|Dependencies|Permissions|Tests|Examples|References|required|optional|yes|no|true|false)\b/);
      if (match && match.index !== undefined) {
        stream.pos = match.index;
        stream.match(/->|=>|\|/);
        if (stream.pos === match.index) {
          stream.match(/\b(Purpose|Inputs|Outputs|Capabilities|Rules|Workflow|Dependencies|Permissions|Tests|Examples|References|required|optional|yes|no|true|false)\b/);
        }
        return match[0] === '->' || match[0] === '=>' || match[0] === '|'
          ? 'mam-operator'
          : 'mam-keyword';
      }

      // Inline code spans.
      if (/`/.test(line)) {
        stream.skipToEnd();
        return 'mam-code-inline';
      }

      stream.skipToEnd();
      return null;
    }
  };
}

function registerCodeMirrorMode(): void {
  const registry = (Mode as any).ensure('mam');
  if (registry) {
    return;
  }
  // Register a lightweight CodeMirror 5 mode for `source.mam`.
  (Mode as any).addModeInfo({
    name: 'mam',
    mime: MAM_MIME,
    mode: 'mam',
    ext: ['mam', 'mam.md']
  });
  const CodeMirror = (Mode as any).getModeInfo
    ? (window as any).CodeMirror
    : (globalThis as any).CodeMirror;
  if (CodeMirror && CodeMirror.defineMode) {
    CodeMirror.defineMode('mam', () => {
      const parser = createMamStreamParser();
      return {
        startState: parser.startState,
        token: parser.token,
        tokenType: (style: string) => style
      };
    });
  }
}

function registerFileTypes(app: JupyterFrontEnd): void {
  const registry = app.docRegistry;
  for (const ext of MAM_EXTENSIONS) {
    registry.addFileType({
      name: `mam${ext === '.mam' ? '' : '-md'}`,
      displayName: 'MAM Module',
      extensions: [ext],
      mimeTypes: [MAM_MIME],
      fileFormat: 'text'
    });
  }
}

function registerMimeType(renderMime: IMimeTypeRegistry): void {
  const factory = renderMime.getFactory('text/markdown');
  if (!factory) {
    return;
  }
  renderMime.addFactory({
    safe: true,
    mimeTypes: [MAM_MIME],
    createRenderer: (options) => factory.createRenderer(options),
    defaultRank: 50
  });
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  optional: [IMimeTypeRegistry, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    renderMime: IMimeTypeRegistry | null
  ): void => {
    registerCodeMirrorMode();
    registerFileTypes(app);
    if (renderMime) {
      registerMimeType(renderMime);
    }
    app.commands.addCommand('mam:openModule', {
      label: 'Open MAM Module',
      caption: 'Open a MAM (.mam) module in the editor',
      execute: async (args: any) => {
        const path = args && typeof args.path === 'string' ? args.path : '';
        if (!path) {
          return;
        }
        const widget = await app.commands.execute('docmanager:open', { path });
        return widget;
      }
    });
    console.log('mam-jupyterlab extension activated');
  }
};

export default plugin;