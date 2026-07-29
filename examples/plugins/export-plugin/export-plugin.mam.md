---
title: Export Plugin
description: Custom export format plugin for MAM modules
version: 1.0.0
author: MAM Examples
license: MIT
tags: [plugin, export, html, pdf, docx, example]
---

# Export Plugin

Demonstrates how to register custom export formats with the MAM Plugin API.
This plugin adds exporters for HTML, PDF, and DOCX output from MAM modules.

## Overview

Exporters transform a parsed MAM module AST into a target format. Each exporter
declares its format name, file extension, MIME type, and available options. The
plugin registers multiple exporters and hooks into the export lifecycle.

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "custom-export-formats",
  "version": "1.0.0",
  "description": "Custom export formats: HTML, PDF, DOCX for MAM modules",
  "author": "MAM Examples",
  "license": "MIT",
  "mamVersion": ">=0.1.0",
  "keywords": ["export", "html", "pdf", "docx"],
  "categories": ["exporter"],
  "main": "dist/index.js",
  "engines": { "mam": ">=0.1.0" }
}
```

## TypeScript Plugin Code

```typescript
import {
  MAMPlugin,
  Exporter,
  ExportOptions,
  ExportOptionDefinition,
  ExportOutput,
} from "@mam/plugin-api";
import { MAMModule, Section, ContentNode, CodeBlock } from "@mam/ast";

// ─── HTML Exporter ────────────────────────────────────────────────

const htmlExporter: Exporter = {
  name: "custom-html",
  format: "html",
  extension: ".html",
  mimeType: "text/html",
  supportsBatch: true,

  getOptions(): ExportOptionDefinition[] {
    return [
      { name: "pretty", type: "boolean", description: "Pretty-print HTML", default: true },
      { name: "includeSource", type: "boolean", description: "Include source module reference", default: false },
      { name: "theme", type: "select", description: "CSS theme", default: "default", choices: ["default", "dark", "minimal"] },
      { name: "toc", type: "boolean", description: "Generate table of contents", default: true },
    ];
  },

  async export(module: MAMModule, options?: ExportOptions): Promise<string> {
    const opts = { pretty: true, includeSource: false, theme: "default", toc: true, ...options };
    const sections = module.sections || [];

    const tocHtml = opts.toc ? generateToc(sections) : "";
    const sectionsHtml = sections.map((s) => renderSection(s, opts)).join("\n\n");
    const sourceRef = opts.includeSource
      ? `<footer>MAM Module: ${escapeHtml((module as any).path || "unknown")}</footer>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml((module as any).title || "MAM Module")}</title>
  <style>${getStylesheet(opts.theme as string)}</style>
</head>
<body>
  <header>
    <h1>${escapeHtml((module as any).title || "Untitled Module")}</h1>
  </header>
  ${tocHtml}
  <main>
    ${sectionsHtml}
  </main>
  ${sourceRef}
</body>
</html>`;
  },
};

// ─── PDF Exporter ─────────────────────────────────────────────────

const pdfExporter: Exporter = {
  name: "custom-pdf",
  format: "pdf",
  extension: ".pdf",
  mimeType: "application/pdf",
  supportsBatch: false,

  getOptions(): ExportOptionDefinition[] {
    return [
      { name: "pageSize", type: "select", description: "Page size", default: "A4", choices: ["A4", "Letter", "Legal"] },
      { name: "orientation", type: "select", description: "Page orientation", default: "portrait", choices: ["portrait", "landscape"] },
      { name: "margin", type: "number", description: "Page margin in points", default: 72 },
      { name: "fontSize", type: "number", description: "Base font size in points", default: 11 },
    ];
  },

  async export(module: MAMModule, options?: ExportOptions): Promise<string> {
    const opts = { pageSize: "A4", orientation: "portrait", margin: 72, fontSize: 11, ...options };

    // Generate a PDF-compatible HTML wrapper
    const sections = module.sections || [];
    const sectionsHtml = sections.map((s) => renderSection(s, { pretty: false })).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeHtml((module as any).title || "MAM Module")}</title>
  <style>
    @page { size: ${opts.pageSize} ${opts.orientation}; margin: ${opts.margin}pt; }
    body { font-size: ${opts.fontSize}pt; font-family: 'Times New Roman', serif; line-height: 1.5; }
    h1 { font-size: ${Number(opts.fontSize) + 6}pt; margin-top: 2em; }
    h2 { font-size: ${Number(opts.fontSize) + 4}pt; margin-top: 1.5em; }
    pre { background: #f5f5f5; padding: 12px; font-size: ${Number(opts.fontSize) - 1}pt; overflow-wrap: break-word; }
    code { font-family: 'Courier New', monospace; font-size: ${Number(opts.fontSize) - 1}pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml((module as any).title || "Untitled Module")}</h1>
  ${sectionsHtml}
</body>
</html>`;
  },
};

// ─── DOCX Exporter ────────────────────────────────────────────────

const docxExporter: Exporter = {
  name: "custom-docx",
  format: "docx",
  extension: ".docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  supportsBatch: false,

  getOptions(): ExportOptionDefinition[] {
    return [
      { name: "author", type: "string", description: "Document author", required: false },
      { name: "company", type: "string", description: "Company name", required: false },
      { name: "includeToc", type: "boolean", description: "Include table of contents", default: true },
    ];
  },

  async export(module: MAMModule, options?: ExportOptions): Promise<string> {
    const opts = { author: "", company: "", includeToc: true, ...options };
    const sections = module.sections || [];
    const title = (module as any).title || "Untitled Module";

    const paragraphs: string[] = [];

    // Title
    paragraphs.push(`
  <w:p>
    <w:pPr><w:pStyle w:val="Title"/></w:pPr>
    <w:r><w:t>${escapeXml(title)}</w:t></w:r>
  </w:p>`);

    // Author info
    if (opts.author) {
      paragraphs.push(`
  <w:p>
    <w:r><w:t>Author: ${escapeXml(opts.author as string)}</w:t></w:r>
  </w:p>`);
    }

    // Table of contents placeholder
    if (opts.includeToc) {
      paragraphs.push(`
  <w:p>
    <w:r><w:rPr><w:b/></w:rPr><w:t>Table of Contents</w:t></w:r>
  </w:p>
  <w:p>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>[Update field to populate TOC]</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>`);
    }

    // Sections
    for (const section of sections) {
      const heading = section.type.charAt(0).toUpperCase() + section.type.slice(1);
      paragraphs.push(`
  <w:p>
    <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:t>${escapeXml(heading)}</w:t></w:r>
  </w:p>`);

      for (const node of section.content || []) {
        paragraphs.push(renderNodeToDocx(node));
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  },
};

// ─── Plugin Assembly ──────────────────────────────────────────────

const exportPlugin: MAMPlugin = {
  manifest: {
    name: "custom-export-formats",
    version: "1.0.0",
    description: "Custom export formats: HTML, PDF, DOCX for MAM modules",
    author: "MAM Examples",
    license: "MIT",
    mamVersion: ">=0.1.0",
    keywords: ["export", "html", "pdf", "docx"],
    categories: ["exporter"],
    main: "dist/index.js",
  },

  exporters: [htmlExporter, pdfExporter, docxExporter],

  hooks: {
    beforeExport: (module) => {
      // Ensure module has required metadata for export
      if (!(module as any).title) {
        (module as any).title = extractTitle(module) || "Untitled Module";
      }
      return module;
    },

    afterExport: (output) => {
      // Log export completion
      console.log(`[export-plugin] Exported to ${output.format}: ${output.filename || "stdout"}`);
      return output;
    },
  },
};

// ─── Utilities ────────────────────────────────────────────────────

function renderSection(section: Section, opts: ExportOptions): string {
  const heading = section.type.charAt(0).toUpperCase() + section.type.slice(1);
  const content = (section.content || []).map((n) => renderNode(n)).join("\n");
  return `<section class="mam-section mam-section-${section.type}">
  <h2>${escapeHtml(heading)}</h2>
  ${content}
</section>`;
}

function renderNode(node: ContentNode): string {
  switch (node.type) {
    case "text":
      return `<p>${escapeHtml((node as any).value || "")}</p>`;
    case "code": {
      const block = node as CodeBlock;
      const lang = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      return `<pre><code${lang}>${escapeHtml(block.value || "")}</code></pre>`;
    }
    case "list":
      return `<ul>${((node as any).items || []).map((i: string) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    case "table":
      return `<table>${(node as any).rows?.map((r: string[]) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("") || ""}</table>`;
    default:
      return `<div>${escapeHtml(JSON.stringify(node))}</div>`;
  }
}

function renderNodeToDocx(node: ContentNode): string {
  switch (node.type) {
    case "text":
      return `<w:p><w:r><w:t>${escapeXml((node as any).value || "")}</w:t></w:r></w:p>`;
    case "code":
      return `<w:p>
  <w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr>
  <w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr>
  <w:t xml:space="preserve">${escapeXml((node as CodeBlock).value || "")}</w:t></w:r>
</w:p>`;
    default:
      return `<w:p><w:r><w:t>${escapeXml(JSON.stringify(node))}</w:t></w:r></w:p>`;
  }
}

function generateToc(sections: Section[]): string {
  const items = sections.map((s, i) => {
    const heading = s.type.charAt(0).toUpperCase() + s.type.slice(1);
    return `<li><a href="#section-${i}">${escapeHtml(heading)}</a></li>`;
  });
  return `<nav class="toc"><h2>Contents</h2><ol>${items.join("")}</ol></nav>`;
}

function extractTitle(module: MAMModule): string | null {
  for (const section of module.sections || []) {
    if (section.type === "title" || section.type === "description") {
      const text = (section.content || []).find((n) => n.type === "text");
      if (text) return (text as any).value?.slice(0, 100) || null;
    }
  }
  return null;
}

function getStylesheet(theme: string): string {
  const base = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.9em; }
  .toc { background: #fafafa; padding: 1rem; border: 1px solid #eee; border-radius: 4px; }
  .toc ol { padding-left: 1.5rem; }
  .toc a { text-decoration: none; color: #0366d6; }
  .mam-section { margin-bottom: 2rem; }`;
  return base;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export default exportPlugin;
```

## Python Export Engine

```python
"""
Custom export engine for MAM modules.

Provides HTML, PDF-ready, and DOCX generation from module dictionaries.
Designed for use in CI/CD pipelines or as a standalone CLI tool.
"""

from __future__ import annotations

import json
import html
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any
from enum import Enum
from datetime import datetime


class ExportFormat(Enum):
    """Supported export formats."""
    HTML = "html"
    PDF = "pdf"
    DOCX = "docx"


@dataclass
class ExportOptions:
    """Configuration for an export operation."""
    format: ExportFormat = ExportFormat.HTML
    pretty: bool = True
    include_source: bool = False
    theme: str = "default"
    include_toc: bool = True
    page_size: str = "A4"
    orientation: str = "portrait"
    margin: int = 72
    font_size: int = 11
    author: str = ""
    company: str = ""


@dataclass
class ExportResult:
    """Result of an export operation."""
    content: str
    format: ExportFormat
    filename: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def export_to_html(module: dict[str, Any], options: ExportOptions | None = None) -> ExportResult:
    """Export a MAM module to a standalone HTML document."""
    opts = options or ExportOptions()
    sections = module.get("sections", [])
    title = module.get("title", "Untitled Module")

    toc_html = _generate_toc(sections) if opts.include_toc else ""
    sections_html = "\n\n".join(_render_section_html(s, i) for i, s in enumerate(sections))
    source_ref = f'<footer>MAM Module: {html.escape(module.get("path", "unknown"))}</footer>' if opts.include_source else ""

    content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  <style>{_get_stylesheet(opts.theme)}</style>
</head>
<body>
  <header>
    <h1>{html.escape(title)}</h1>
    <p class="meta">Exported on {datetime.now().strftime("%Y-%m-%d %H:%M")}</p>
  </header>
  {toc_html}
  <main>
    {sections_html}
  </main>
  {source_ref}
</body>
</html>"""

    return ExportResult(
        content=content,
        format=ExportFormat.HTML,
        filename=f"{_slugify(title)}.html",
        metadata={"sections": len(sections), "theme": opts.theme},
    )


def export_to_pdf(module: dict[str, Any], options: ExportOptions | None = None) -> ExportResult:
    """Export a MAM module to PDF-ready XSL-FO or HTML with @page rules."""
    opts = options or ExportOptions()
    sections = module.get("sections", [])
    title = module.get("title", "Untitled Module")

    sections_html = "\n".join(_render_section_html(s, i) for i, s in enumerate(sections))

    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>{html.escape(title)}</title>
  <style>
    @page {{ size: {opts.page_size} {opts.orientation}; margin: {opts.margin}pt; }}
    body {{ font-size: {opts.font_size}pt; font-family: 'Times New Roman', serif; line-height: 1.5; }}
    h1 {{ font-size: {opts.font_size + 6}pt; margin-top: 2em; }}
    h2 {{ font-size: {opts.font_size + 4}pt; margin-top: 1.5em; }}
    pre {{ background: #f5f5f5; padding: 12px; font-size: {opts.font_size - 1}pt; }}
  </style>
</head>
<body>
  <h1>{html.escape(title)}</h1>
  {sections_html}
</body>
</html>"""

    return ExportResult(
        content=content,
        format=ExportFormat.PDF,
        filename=f"{_slugify(title)}.html",
        metadata={"page_size": opts.page_size, "orientation": opts.orientation},
    )


def export_to_docx(module: dict[str, Any], options: ExportOptions | None = None) -> ExportResult:
    """Export a MAM module to Office Open XML (DOCX) format."""
    opts = options or ExportOptions()
    sections = module.get("sections", [])
    title = module.get("title", "Untitled Module")

    paragraphs: list[str] = []

    paragraphs.append(
        f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>'
        f'<w:r><w:t>{_escape_xml(title)}</w:t></w:r></w:p>'
    )

    if opts.author:
        paragraphs.append(
            f'<w:p><w:r><w:t>Author: {_escape_xml(opts.author)}</w:t></w:r></w:p>'
        )

    if opts.include_toc:
        paragraphs.append(
            '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Table of Contents</w:t></w:r></w:p>'
            '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r><w:instrText> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            '<w:r><w:t>[Update field to populate TOC]</w:t></w:r>'
            '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
        )

    for section in sections:
        heading = section.get("type", "section").capitalize()
        paragraphs.append(
            f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
            f'<w:r><w:t>{_escape_xml(heading)}</w:t></w:r></w:p>'
        )
        for node in section.get("content", []):
            paragraphs.append(_render_node_docx(node))

    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    {chr(10).join(paragraphs)}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>"""

    return ExportResult(
        content=content,
        format=ExportFormat.DOCX,
        filename=f"{_slugify(title)}.xml",
        metadata={"author": opts.author, "sections": len(sections)},
    )


class ModuleExporter:
    """High-level exporter that dispatches to format-specific handlers."""

    def __init__(self) -> None:
        self.handlers: dict[ExportFormat, Any] = {
            ExportFormat.HTML: export_to_html,
            ExportFormat.PDF: export_to_pdf,
            ExportFormat.DOCX: export_to_docx,
        }

    def export(self, module: dict[str, Any], options: ExportOptions | None = None) -> ExportResult:
        """Export a module using the specified format."""
        opts = options or ExportOptions()
        handler = self.handlers.get(opts.format)
        if not handler:
            raise ValueError(f"Unsupported format: {opts.format}")
        return handler(module, opts)


# ─── Private Helpers ────────────────────────────────────────────────

def _render_section_html(section: dict[str, Any], index: int) -> str:
    heading = section.get("type", "section").capitalize()
    content_nodes = section.get("content", [])
    body = "\n".join(_render_node_html(n) for n in content_nodes)
    return (
        f'<section class="mam-section mam-section-{section.get("type", "unknown")}" id="section-{index}">'
        f'<h2>{html.escape(heading)}</h2>\n{body}\n</section>'
    )


def _render_node_html(node: dict[str, Any]) -> str:
    node_type = node.get("type", "")
    if node_type == "text":
        return f"<p>{html.escape(node.get('value', ''))}</p>"
    if node_type == "code":
        lang = node.get("language", "")
        cls = f' class="language-{html.escape(lang)}"' if lang else ""
        return f"<pre><code{cls}>{html.escape(node.get('value', ''))}</code></pre>"
    if node_type == "list":
        items = "".join(f"<li>{html.escape(str(i))}</li>" for i in node.get("items", []))
        return f"<ul>{items}</ul>"
    return f"<pre>{html.escape(json.dumps(node))}</pre>"


def _render_node_docx(node: dict[str, Any]) -> str:
    node_type = node.get("type", "")
    if node_type == "text":
        return f'<w:p><w:r><w:t>{_escape_xml(node.get("value", ""))}</w:t></w:r></w:p>'
    if node_type == "code":
        val = _escape_xml(node.get("value", ""))
        return (
            f'<w:p><w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr>'
            f'<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>'
            f'<w:t xml:space="preserve">{val}</w:t></w:r></w:p>'
        )
    return f'<w:p><w:r><w:t>{_escape_xml(json.dumps(node))}</w:t></w:r></w:p>'


def _generate_toc(sections: list[dict[str, Any]]) -> str:
    items = []
    for i, s in enumerate(sections):
        heading = s.get("type", "section").capitalize()
        items.append(f'<li><a href="#section-{i}">{html.escape(heading)}</a></li>')
    return f'<nav class="toc"><h2>Contents</h2><ol>{"".join(items)}</ol></nav>'


def _get_stylesheet(theme: str) -> str:
    return (
        "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; "
        "line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; }\n"
        "h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }\n"
        "pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }\n"
        ".toc { background: #fafafa; padding: 1rem; border: 1px solid #eee; border-radius: 4px; }\n"
    )


def _slugify(text: str) -> str:
    return text.lower().replace(" ", "-").replace("_", "-")[:64]


def _escape_xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ─── Tests ──────────────────────────────────────────────────────────

def test_export_html():
    module = {"title": "Test Module", "sections": [{"type": "description", "content": [{"type": "text", "value": "Hello"}]}]}
    result = export_to_html(module)
    assert result.format == ExportFormat.HTML
    assert "Test Module" in result.content
    assert "<!DOCTYPE html>" in result.content


def test_export_pdf():
    module = {"title": "PDF Test", "sections": [{"type": "code", "content": [{"type": "code", "language": "python", "value": "print()"}]}]}
    result = export_to_pdf(module)
    assert "@page" in result.content
    assert "PDF Test" in result.content


def test_export_docx():
    module = {"title": "DOCX Test", "sections": [{"type": "info", "content": [{"type": "text", "value": "Content"}]}]}
    result = export_to_docx(module, ExportOptions(author="Test Author"))
    assert "w:document" in result.content
    assert "Test Author" in result.content


def test_exporter_dispatch():
    exporter = ModuleExporter()
    module = {"title": "Dispatch Test", "sections": []}
    result = exporter.export(module, ExportOptions(format=ExportFormat.HTML))
    assert result.format == ExportFormat.HTML


def test_toc_generation():
    module = {
        "title": "TOC Test",
        "sections": [
            {"type": "intro", "content": []},
            {"type": "body", "content": []},
            {"type": "conclusion", "content": []},
        ],
    }
    result = export_to_html(module, ExportOptions(include_toc=True))
    assert "Contents" in result.content
    assert "section-0" in result.content


if __name__ == "__main__":
    test_export_html()
    test_export_pdf()
    test_export_docx()
    test_exporter_dispatch()
    test_toc_generation()
    print("All tests passed.")
```

## Usage

```bash
# Via MAM CLI
mam export my-module.mam.md --format html
mam export my-module.mam.md --format pdf --page-size Letter
mam export my-module.mam.md --format docx --author "Jane Doe"
```

```typescript
// Programmatically
import { PluginRegistry, HookManager } from "@mam/plugin-api";
import customExportPlugin from "./plugins/export-plugin";

const hookManager = new HookManager();
const registry = new PluginRegistry(hookManager);
registry.loadPlugin("./plugins/export-plugin");

const exporter = registry.getPlugin("custom-export-formats")?.plugin.exporters?.[0];
if (exporter) {
  const html = await exporter.export(module, { pretty: true, theme: "dark" });
}
```

## What This Demonstrates

| Concept | Where |
|---------|-------|
| Exporter registration | `exporters` array with `format`, `extension`, `mimeType` |
| Option definitions | `getOptions()` returning `ExportOptionDefinition[]` |
| Format dispatch | Multiple exporters for HTML, PDF, DOCX |
| Hook integration | `beforeExport` / `afterExport` lifecycle hooks |
| Batch support | `supportsBatch` flag for multi-module export |
| XML generation | DOCX OOXML output with proper namespaces |
| Python engine | Standalone `ModuleExporter` class with format handlers |
