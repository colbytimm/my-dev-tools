---
name: d2-diagram
description: Author software- and cloud-architecture diagrams as code with d2
  (d2lang.com), render them to SVG/PNG/PDF, and embed them into markdown. Includes
  a lookup for the correct AWS/GCP/Azure service icons (whose hosted URLs are
  impossible to guess) and a renderer that degrades gracefully when raster export
  or the icon host is unavailable. Use when asked to draw, diagram, or visualize a
  system, service topology, request flow, or cloud architecture — or to add such a
  diagram to docs/a README.
---

# d2 Diagram

Generate architecture diagrams as text with [d2](https://d2lang.com), then render
and embed them. Two scripts support the workflow:

- `scripts/icons.py` — resolve exact `icon:` URLs for AWS/GCP/Azure services.
- `scripts/render.py` — render/validate/format `.d2` files and embed them in markdown.

## Workflow

1. **Write a `.d2` file.** Keep the source next to the doc it illustrates so it
   stays re-renderable. Use containers for tiers/boundaries and `classes` for
   consistent styling.
2. **For cloud diagrams, resolve icons first** with `icons.py` and paste the URLs
   verbatim — never hand-write `icons.terrastruct.com` URLs (they're URL-encoded
   and unguessable).
3. **Validate, then render** with `render.py` (SVG by default).
4. **Embed in markdown** with `render.py --md` if the diagram belongs in docs.

## Syntax cheat-sheet

```d2
# Objects (default shape is rectangle) and connections
user: User { shape: person }
api: API Gateway { shape: hexagon }
cache: Redis { shape: cylinder }     # cylinder = datastore
user -> api: HTTPS                    # -> directed, -- plain, <-> bidirectional

# Containers (nesting) + cross-container edges
backend: Backend {
  svc: Order Service
  db: Postgres { shape: cylinder }
}
api -> backend.svc
backend.svc -> backend.db: SQL

# Reusable styles via classes
classes: {
  service: { style: { fill: "#E6F4EA"; stroke: "#34A853" } }
}
backend.svc.class: service

# Inline style + icon (see icons.py for cloud URLs)
queue: Event Bus { shape: queue; style.fill: "#FEF7E0" }
lambda: Worker { icon: https://icons.terrastruct.com/aws%2FCompute%2FAWS-Lambda.svg }

# Database schema / ERD
orders: { shape: sql_table; id: uuid; total: int }
```

Useful shapes: `rectangle` (default), `square`, `cylinder` (datastores),
`person` (actors), `hexagon`, `cloud`, `queue`, `package`, `page`, `step`,
`diamond`, `callout`, `sql_table`. Icons render top-left on containers and
centered on plain shapes; `icon:` decorates a shape, while `shape: image` makes
the image *be* the shape.

## Software architecture recipe

Group components into layered containers (client → edge → application → data),
give each tier a `class` for visual consistency, and label connections with the
protocol or action. **Render with `elk`** (`--layout elk`, or set
`layout-engine: elk`) — its orthogonal routing keeps labels and edges from
overlapping; raise `--elk-node-spacing` if it's still tight.
See **`examples/software-arch.d2`**
for a complete 3-tier example (containers, classes, a `sql_table`, and a request
flow). General guidance on architecture-diagram structure:
[Atlassian: architecture diagrams](https://www.atlassian.com/work-management/project-management/architecture-diagram).

## Cloud architecture recipe

1. **Resolve every service icon** before writing the diagram:

   ```bash
   python scripts/icons.py search "lambda" --provider aws
   python scripts/icons.py search "cloud storage" --provider gcp
   python scripts/icons.py search "app service" --provider azure
   ```

   Each result prints a paste-ready `icon: <url>` line. `--json` for machine
   output; `--limit N` to widen; `categories`/`providers` to browse. The bundled
   index (`assets/icons.csv`) is a snapshot of the most common AWS/GCP/Azure
   services — if a service isn't found, try broader terms or a sibling service,
   or browse <https://icons.terrastruct.com>.

2. **Use one provider's icon set per diagram**, and group resources by their real
   boundaries (cloud account → region/VPC → subnet, or subscription → resource
   group). Style the cloud boundary to match the brand (e.g. AWS `#FF9900`).

3. See **`examples/aws-arch.d2`** for a complete, validated AWS example whose
   icon URLs all came from `icons.py`.

## Other diagram types

- **Sequence diagrams** (auth flows, request/response): set `shape: sequence_diagram`
  at the root; child objects become lifelines and connections become ordered
  messages. A self-edge is a self-call; `a -> a: label`. See **`examples/auth-flow.d2`**.
- **User-journey / flowcharts**: `oval` start/end, plain steps, `diamond` decisions,
  and edges labeled `yes`/`no` for branches and retry loops. See **`examples/user-flow.d2`**
  (also shows `sketch` style).

## Rendering & embedding

```bash
# SVG (default; no dependencies, ideal for web/markdown). Output path derived from input.
python scripts/render.py examples/software-arch.d2

# Options: format, theme, layout, spacing, sketch, padding.
# --layout elk + --elk-node-spacing is the go-to fix for a cramped/overlapping diagram.
python scripts/render.py examples/aws-arch.d2 -o out.svg \
  --theme 1 --layout elk --elk-node-spacing 100 --pad 40

# Validate or autoformat before committing
python scripts/render.py examples/aws-arch.d2 --validate
python scripts/render.py examples/aws-arch.d2 --fmt

# Render and embed (or update) in a markdown file, between markers so re-runs
# replace the image in place rather than appending:
#   <!-- d2:arch --> ![arch](path.svg) <!-- /d2:arch -->
python scripts/render.py examples/software-arch.d2 --md README.md --md-marker arch
```

**Graceful degradation** (both handled automatically, no crash):

- **PNG/PDF** make d2 launch a headless Chromium (downloaded on first use). If it
  can't be installed/launched (e.g. restricted network), `render.py` falls back to
  SVG and prints how to enable raster output.
- **Icon bundling**: by default d2 inlines remote icons into the output for a
  self-contained file. If the icon host is unreachable at render time, `render.py`
  retries with `--no-bundle`, keeping icons as remote refs that load when the image
  is viewed online. Pass `--no-bundle` explicitly to force this.

## Readability — preventing label / icon / line overlap

Overlapping labels, edges, and icons are the most common quality problem. Apply
these rules when authoring (they are baked into the examples):

- **Use the ELK layout for architecture & flow diagrams** — `--layout elk` (or
  `layout-engine: elk` in `vars.d2-config`). ELK routes edges orthogonally and
  places labels with far less overlap than the default `dagre`. This is the single
  biggest win. If a diagram is still cramped, spread it out:
  `--layout elk --elk-node-spacing 100` (and/or `--elk-padding "[top=60,left=50,bottom=50,right=50]"`).
- **Keep edge labels short** — ideally ≤ 3 words (`3. GraphQL (Bearer)`, not
  `3. GraphQL query with bearer access token`). Push detail into the *node* label
  or drop it. Wrap any unavoidably long label with `\n`.
- **Don't put `icon:` on a container that also carries an important label.** A
  container anchors both its label and its icon at the top, so on tight layouts
  they crowd each other. Put icons on **leaf** nodes; label grouping containers
  (VPCs, subnets, tiers) with text only.
- **Lift grouping-container labels out of the box.** A container label defaults to
  the top edge — exactly where ELK routes edges into the box, so lines draw over it.
  Set `label.near: outside-top-left` (or `outside-top-center`) so the label sits
  *above* the border, clear of every routed edge. This works in a reusable `class`:

  ```d2
  classes: {
    subnet: {
      label.near: outside-top-left
      style: {fill: "#F3F2F1"; stroke: "#8A8886"; stroke-dash: 3}
    }
  }
  vnet: VNet 10.0.0.0/16 {
    snet_app: snet-app 10.0.3.0/24 {class: subnet; api: API; worker: Worker}
  }
  ```

  (Don't shrink these labels with a tiny `font-size`; the readable default is fine.)
- **One short label per icon'd node.** A node with an icon *and* a long multi-line
  label squeezes the icon — prefer a concise name plus the icon.
- **Give the diagram air** with `--pad 40` (or more) and split very large systems
  into multiple focused diagrams.
- **Sequence diagrams** ignore the layout engine, so readability there is all about
  concise, `\n`-wrapped message labels. d2 masks the lifeline/arrow *behind* each
  label so lines don't strike through text — this is honored by d2's native
  SVG/PNG export (and any compliant SVG renderer). If you rasterize the SVG with a
  tool that ignores SVG masks (some `rsvg`/`cairo` builds), lines can appear to run
  through labels; prefer `render.py`'s own PNG export, which uses d2 directly.
- **Always eyeball the rendered output.** If labels still collide, in order: switch
  to `elk`, raise `--elk-node-spacing`, shorten labels, then bump `--pad`.

## Best practices

- Run `--validate` and `--fmt` before committing; commit the `.d2` source, not just
  the rendered image, so diagrams can be regenerated.
- Prefer `classes` over repeating inline styles; keep labels short and action-oriented.
- For very large systems, split into multiple focused diagrams.

## Requirements

- The **`d2` CLI** on `PATH`:
  ```bash
  curl -fsSL https://d2lang.com/install.sh | sh -s --   # or:
  brew install d2                                        # or:
  go install oss.terrastruct.com/d2@latest               # needs Go 1.20+
  ```
- Scripts are **pure Python 3 stdlib** (no pip installs).
- PNG/PDF export additionally needs d2's headless Chromium (auto-downloaded on
  first raster render; SVG needs nothing).

`assets/icons.csv` is bundled verbatim from the public
[tf2d2/terrastruct-icons](https://github.com/tf2d2/terrastruct-icons) project
(columns `Cloud,Title,URL`). Terrastruct does not change or expire existing icon
URLs, so the bundled values stay valid.
