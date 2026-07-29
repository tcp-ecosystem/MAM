# @mam/visualization

Visualization engine for MAM (Module Architecture Model) systems. Generates graph data structures and renders them to multiple output formats: Mermaid, ASCII art, interactive HTML/SVG, Graphviz DOT, and JSON.

## Installation

```bash
npm install @mam/visualization
```

Requires `@mam/ast` as a peer dependency.

## Quick Start

```ts
import { GraphVisualizer, MermaidGenerator, HTMLRenderer } from '@mam/visualization';

// 1. Build graph from parsed MAM modules
const viz = new GraphVisualizer();
const graph = viz.generate(modules);

// 2. Render to your format of choice
const mermaid = new MermaidGenerator();
const { code } = mermaid.generateFromGraph(graph);

const html = new HTMLRenderer({ theme: 'dark', layout: 'dagre' });
const { html: document } = html.generateFromGraph(graph);
```

## Pipeline

```
MAM modules (V2ModuleNode[])
  → GraphVisualizer.generate()
    → GraphData { nodes, edges, metadata }
      → MermaidGenerator / HTMLRenderer / DOTRenderer / JSONExporter / ASCIIArt
        → output
```

## API Reference

### GraphVisualizer

Converts `V2ModuleNode[]` into a normalized `GraphData` structure.

```ts
import { GraphVisualizer } from '@mam/visualization';

const viz = new GraphVisualizer({
  direction: 'TB',      // 'TB' | 'LR' | 'BT' | 'RL'
  showLabels: true,
  showTypes: true,
  nodeShape: 'rectangle',
  edgeStyle: 'solid',
});

const graph = viz.generate(modules);
const depGraph = viz.generateDependencyGraph(modules);
const workflowGraph = viz.generateWorkflowGraph(modules);
```

**`GraphData`**

| Field | Type | Description |
|-------|------|-------------|
| `nodes` | `GraphNode[]` | `{ id, label, type, metadata? }` |
| `edges` | `GraphEdge[]` | `{ from, to, label?, type }` |
| `metadata` | `GraphMetadata` | `{ nodeCount, edgeCount, depth }` |

---

### MermaidGenerator

Renders `GraphData` or modules to Mermaid flowchart syntax.

```ts
import { MermaidGenerator } from '@mam/visualization';

const gen = new MermaidGenerator({
  type: 'flowchart',
  direction: 'TD',
  showTypes: true,
  styleByType: true,
});

const { code, nodeCount, edgeCount } = gen.generateFromModules(modules);
// or
const result = gen.generateFromGraph(graph);
```

**Output:** `{ code: string, type: string, nodeCount: number, edgeCount: number }`

---

### ASCIIArt

Renders modules or graph data as box-drawing ASCII art for terminal output.

```ts
import { ASCIIArt } from '@mam/visualization';

const art = new ASCIIArt({
  style: 'simple',    // 'simple' | 'double' | 'rounded' | 'bold'
  showTypes: true,
  maxWidth: 80,
});

const { art: text, width, height } = art.generateFromModules(modules);
```

---

### HTMLRenderer

Generates a complete HTML document with inline SVG graph visualization.

```ts
import { HTMLRenderer } from '@mam/visualization';

const renderer = new HTMLRenderer({
  title: 'My System',
  theme: 'dark',          // 'light' | 'dark' | 'auto'
  layout: 'dagre',        // 'dagre' | 'force' | 'circular' | 'tree'
  width: 1200,
  height: 800,
  interactive: true,      // drag, zoom, tooltips
  showLabels: true,
  showEdgeLabels: true,
  nodeStyle: {
    shape: 'rect',        // 'rect' | 'circle' | 'diamond' | 'ellipse'
    fontSize: 14,
    borderWidth: 2,
  },
  css: '.custom { ... }',
  scripts: ['https://example.com/lib.js'],
});

const { html, css, scripts } = renderer.generateFromModules(modules);
```

**Layout modes:**
- `dagre` — layered hierarchical (default)
- `circular` — nodes arranged in a circle
- `tree` — tree structure from root nodes
- `force` — force-directed (falls back to layered)

**Node colors** are determined by module type (agent=green, tool=blue, memory=orange, etc.).

---

### DOTRenderer

Generates Graphviz DOT source code.

```ts
import { DOTRenderer } from '@mam/visualization';

const renderer = new DOTRenderer({
  rankdir: 'TB',         // 'TB' | 'BT' | 'LR' | 'RL'
  ranksep: 1.0,
  nodesep: 0.8,
  dpi: 96,
  format: 'svg',         // 'svg' | 'png' | 'pdf'
  nodeShape: 'box',
});

const { dot, format } = renderer.generateFromModules(modules);
```

Render with Graphviz:
```bash
dot -Tsvg graph.dot -o graph.svg
dot -Tpng graph.dot -o graph.png
```

---

### JSONExporter

Exports graph data as JSON in multiple library-compatible formats.

```ts
import { JSONExporter } from '@mam/visualization';

// Full format (default)
const full = new JSONExporter({ format: 'full', indent: 2, includeMetadata: true });

// Compact tuple format
const compact = new JSONExporter({ format: 'compact' });

// Cytoscape.js compatible
const cytoscape = new JSONExporter({ format: 'cytoscape' });

// D3.js compatible
const d3 = new JSONExporter({ format: 'd3' });

const { data, format } = full.generateFromModules(modules);
```

**Format shapes:**

| Format | `nodes` | `edges` |
|--------|---------|---------|
| `full` | `[{ id, label, type, metadata? }]` | `[{ from, to, label?, type }]` |
| `compact` | `[[id, type]]` | `[[from, to, type]]` |
| `cytoscape` | `{ group: 'nodes', data: { id, label, type } }` | `{ group: 'edges', data: { id, source, target } }` |
| `d3` | `{ id, name, type }` | `{ source, target, type }` |

---

## Examples

### Render a system to HTML and save

```ts
import { GraphVisualizer, HTMLRenderer } from '@mam/visualization';
import { writeFileSync } from 'fs';

const viz = new GraphVisualizer();
const graph = viz.generate(modules);

const renderer = new HTMLRenderer({
  title: 'MAM System Architecture',
  theme: 'dark',
  layout: 'dagre',
  interactive: true,
});

const { html } = renderer.generateFromGraph(graph);
writeFileSync('architecture.html', html);
```

### Generate DOT and render with Graphviz

```ts
import { GraphVisualizer, DOTRenderer } from '@mam/visualization';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const viz = new GraphVisualizer();
const graph = viz.generateDependencyGraph(modules);

const renderer = new DOTRenderer({ rankdir: 'LR', format: 'svg' });
const { dot } = renderer.generateFromGraph(graph);

writeFileSync('deps.dot', dot);
execSync('dot -Tsvg deps.dot -o deps.svg');
```

### Export for D3.js

```ts
import { GraphVisualizer, JSONExporter } from '@mam/visualization';

const viz = new GraphVisualizer();
const graph = viz.generate(modules);

const exporter = new JSONExporter({ format: 'd3' });
const { data } = exporter.generateFromGraph(graph);

// Use data.nodes and data.links with D3 force simulation
```

## Testing

```bash
npm test
```

## License

MIT
