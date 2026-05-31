# my-dev-tools

## Agents

Tooling for AI coding agents.

### Skills

Portable [agent skills](https://agents.md) — each is a self-contained folder with a `SKILL.md` and supporting scripts that an agent can discover and run.

#### [image-compose](agents/skills/image-compose/SKILL.md)

Combine multiple images (e.g. web screenshots) into a side-by-side, stacked, or grid layout for visual comparison. Adds optional per-panel title bars and emits a JSON manifest of panel positions for downstream annotation.

| Side-by-side with labels | Grid layout |
| --- | --- |
| ![Two screenshots composed side by side with title bars](docs/images/compose-sidebyside.png) | ![Four screenshots in a 2x2 grid with title bars](docs/images/compose-grid.png) |

#### [image-annotate](agents/skills/image-annotate/SKILL.md)

Draw annotations on an image (boxes, ellipses, arrows, labeled connectors, callout bubbles, text, highlights, and blur/blackout redaction) from a JSON spec. Coordinates can be absolute or panel-relative via an image-compose manifest, and a `--caption` bar keeps page/source labels off the content.

![A screenshot marked up with a highlight, a box, a blurred redaction, a callout, and a caption bar](docs/images/annotate-profile.png)

#### [cosmosdb-datamodeling](agents/skills/cosmosdb-datamodeling/SKILL.md)

An interactive, requirements-driven workflow for designing an Azure Cosmos DB for NoSQL data model. It captures access patterns, decides embed-vs-reference and partition keys, applies scaling patterns (hierarchical/synthetic keys, write sharding, data binning, TTL), and produces two artifacts — a requirements scratchpad and a final data model — grounded in current Microsoft Learn guidance. Ships stdlib-only helper scripts for RU/cost estimation and for linting a model against documented service limits.

#### Used together

`image-compose` lays out a comparison and emits a manifest; `image-annotate` reads that manifest to draw on each panel with `"panel": N` — coordinates measured in the original screenshots map straight through. Here two calculations are composed, then boxed and connected to show which values match and which differ.

![Two calculations composed side by side, with green boxes and a "match" connector on equal values and red boxes with a "differs" connector on the divergent rows](docs/images/compose-annotate-comparison.png)
