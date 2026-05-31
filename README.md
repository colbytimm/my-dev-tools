# my-dev-tools

## Agents

Tooling for AI coding agents.

### Skills

Portable [agent skills](https://agents.md) — each is a self-contained folder with a `SKILL.md` and supporting scripts that an agent can discover and run.

- [image-compose](agents/skills/image-compose/SKILL.md) — Combine multiple images (e.g. web screenshots) into a side-by-side, stacked, or grid layout for visual comparison. Adds optional per-panel title bars and emits a JSON manifest of panel positions for downstream annotation.
- [image-annotate](agents/skills/image-annotate/SKILL.md) — Draw annotations on an image (boxes, ellipses, arrows, labeled connectors, callout bubbles, text, highlights, and blur/blackout redaction) from a JSON spec. Coordinates can be absolute or panel-relative via an image-compose manifest.
