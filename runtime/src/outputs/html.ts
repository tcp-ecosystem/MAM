/**
 * HTML Output Formatter
 */

export class HTMLOutput {
  format(data: unknown): string {
    const doc = data as Record<string, unknown>;
    const sections = (doc.sections as Array<{ name: string; content?: unknown }>) || [];

    let html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n';
    html += '<meta charset="UTF-8">\n';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
    html += '<title>MAM Module</title>\n';
    html += '<style>\n';
    html += '  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }\n';
    html += '  pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }\n';
    html += '  section { margin-bottom: 2rem; }\n';
    html += '</style>\n';
    html += '</head>\n<body>\n';

    for (const section of sections) {
      html += `<section>\n<h2>${this.escapeHtml(section.name)}</h2>\n`;
      if (section.content) {
        const content = typeof section.content === 'string'
          ? section.content
          : JSON.stringify(section.content, null, 2);
        html += `<pre>${this.escapeHtml(content)}</pre>\n`;
      }
      html += '</section>\n';
    }

    html += '</body>\n</html>';
    return html;
  }

  getMimeType(): string {
    return 'text/html';
  }

  getExtension(): string {
    return '.html';
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
