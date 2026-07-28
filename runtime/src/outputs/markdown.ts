/**
 * Markdown Output Formatter
 */

export class MarkdownOutput {
  format(data: unknown): string {
    const doc = data as Record<string, unknown>;
    const fm = doc.frontmatter as Record<string, unknown> | undefined;
    const sections = (doc.sections as Array<{ name: string; content?: unknown }>) || [];

    let md = '---\n';
    if (fm) {
      for (const [key, value] of Object.entries(fm)) {
        md += `${key}: ${value}\n`;
      }
    }
    md += '---\n\n';

    for (const section of sections) {
      md += `## ${section.name}\n\n`;
      if (section.content) {
        const content = typeof section.content === 'string'
          ? section.content
          : JSON.stringify(section.content, null, 2);
        md += `${content}\n\n`;
      }
    }

    return md;
  }

  getMimeType(): string {
    return 'text/markdown';
  }

  getExtension(): string {
    return '.md';
  }
}
